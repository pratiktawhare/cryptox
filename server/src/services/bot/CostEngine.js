/**
 * CostEngine.js
 *
 * Calculates ALL costs associated with a potential trade BEFORE entry.
 * A trade is rejected if expectedReward <= totalCost (net expectancy negative).
 *
 * Cost components:
 *   1. Entry fee    = notional × makerFeeRate  (assuming limit entry)
 *   2. Exit fee     = notional × takerFeeRate  (assuming market exit on TP/SL)
 *   3. Slippage     = spread × slippageFactor  (as % of notional)
 *   4. Funding      = fundingRate × holdHours  (linear estimate)
 *   Total cost expressed as both USD and % of notional (breakEvenPct)
 *
 * Delta Exchange India fee structure:
 *   Maker: 0.020% (0.0002)
 *   Taker: 0.050% (0.0005)
 *   GST on Brokerage: 18% applied to trading fees in India
 *   Maker with GST: 0.020% × 1.18 = 0.0236% (0.000236)
 *   Taker with GST: 0.050% × 1.18 = 0.0590% (0.000590)
 *   Round-trip with GST: 0.0826% (0.000826)
 */

const GST_RATE = 0.18; // 18% GST on trading brokerage in India
const BASE_MAKER_RATE = 0.0002; // 0.020%
const BASE_TAKER_RATE = 0.0005; // 0.050%

// ── Fee configuration ────────────────────────────────────────────────────────
const FEES = {
    BASE_MAKER_RATE,
    BASE_TAKER_RATE,
    GST_RATE,
    MAKER_RATE:          parseFloat((BASE_MAKER_RATE * (1 + GST_RATE)).toFixed(8)), // 0.0236%
    TAKER_RATE:          parseFloat((BASE_TAKER_RATE * (1 + GST_RATE)).toFixed(8)), // 0.0590%
    ROUND_TRIP_RATE:     parseFloat(((BASE_MAKER_RATE + BASE_TAKER_RATE) * (1 + GST_RATE)).toFixed(8)), // 0.0826%
    SLIPPAGE_FACTOR:     0.5,      // multiply spread by this (conservative: 50% of spread)
    DEFAULT_SPREAD_PCT:  0.0005,   // fallback if spread not known: 0.05% of price
    ESTIMATED_HOLD_HOURS: 4,       // default hold time for funding estimate (4h)
};

/**
 * Calculate total trade costs and determine if the trade is viable.
 *
 * @param {object} params
 * @param {number} params.entryPrice     - Planned entry price
 * @param {number} params.targetPrice    - Planned take profit price
 * @param {number} params.stopPrice      - Planned stop loss price
 * @param {string} params.direction      - 'long' | 'short'
 * @param {number} params.qty            - Number of contracts
 * @param {number} params.contractValue  - Value per contract (from ProductCatalog, usually 1)
 * @param {number} [params.spread]       - Bid-ask spread (optional, estimated if null)
 * @param {number} [params.fundingRate]  - Current funding rate per 8h (optional)
 * @param {number} [params.holdHours]    - Estimated hold time in hours (optional)
 * @param {number} [params.minRewardRisk]- Minimum R:R ratio required
 *
 * @returns {{
 *   notional:       number,   // qty × contractValue × entryPrice (total position value)
 *   entryFee:       number,   // maker fee on entry
 *   exitFee:        number,   // taker fee on exit
 *   slippageCost:   number,   // estimated slippage
 *   fundingCost:    number,   // estimated funding over hold period
 *   totalCost:      number,   // sum of all costs
 *   breakEvenPct:   number,   // price must move this % just to break even
 *   breakEvenAbs:   number,   // price must move this many points to break even
 *   expectedReward: number,   // reward if TP is hit (gross)
 *   expectedRisk:   number,   // risk if SL is hit (gross)
 *   netReward:      number,   // expectedReward - totalCost
 *   netRisk:        number,   // expectedRisk   + totalCost
 *   actualRR:       number,   // netReward / netRisk (net R:R)
 *   viable:         boolean,  // true if netReward > 0 and actualRR >= minRR
 *   rejectReason:   string|null,
 * }}
 */
function calcTradeCosts(params) {
    const {
        entryPrice,
        targetPrice,
        stopPrice,
        direction,
        qty,
        contractValue   = 1,
        spread          = null,
        fundingRate     = null,
        holdHours       = FEES.ESTIMATED_HOLD_HOURS,
        minRewardRisk   = 1.5,
    } = params;

    // ── Notional value of the position (in USDT) ─────────────────────────────
    // For linear perps: notional = qty × contractValue × entryPrice
    // e.g. DOGEUSD: 166 contracts × 1 × $0.08 = $13.28 USDT
    // This is the basis for fee calculation.
    //
    // PnL formula (separate): qty × contractValue × (exitPrice - entryPrice)
    // Both formulas are standard for linear (USDT-settled) perpetuals.
    const notional = qty * contractValue * entryPrice;

    // ── Fee calculation ────────────────────────────────────────────────────────
    const entryFee = notional * FEES.MAKER_RATE;
    const exitFee  = notional * FEES.TAKER_RATE;

    // ── Slippage estimate ─────────────────────────────────────────────────────
    // Use actual spread if known, else fall back to % of price
    const effectiveSpread = spread ?? (entryPrice * FEES.DEFAULT_SPREAD_PCT);
    const slippageCost    = effectiveSpread * FEES.SLIPPAGE_FACTOR * qty * contractValue;

    // ── Funding cost estimate ─────────────────────────────────────────────────
    // Funding is paid every 8h. Estimate: rate × (holdHours / 8) × notional
    // Funding can be positive (paid) or negative (received)
    let fundingCost = 0;
    if (fundingRate !== null && holdHours > 0) {
        const fundingPeriods = holdHours / 8;
        // For long: pay positive funding rate, receive negative
        // For short: receive positive funding rate, pay negative
        const dirMultiplier = direction === 'long' ? 1 : -1;
        fundingCost = fundingRate * fundingPeriods * notional * dirMultiplier;
        // Negative fundingCost = we receive funding (good), positive = we pay (cost)
        fundingCost = Math.max(0, fundingCost); // only count as cost if we pay
    }

    // ── Total cost ────────────────────────────────────────────────────────────
    const totalCost = entryFee + exitFee + slippageCost + fundingCost;

    // ── Break-even ───────────────────────────────────────────────────────────
    // How much price must move (in points) just to cover all costs
    const breakEvenAbs = notional > 0 ? (totalCost / notional) * entryPrice : 0;
    const breakEvenPct = notional > 0 ? (totalCost / notional) * 100 : 0;

    // ── Gross P&L at TP and SL ────────────────────────────────────────────────
    // For linear perps: PnL = qty × contractValue × (exit - entry) × direction
    const dirSign = direction === 'long' ? 1 : -1;
    const pnlAtTP = qty * contractValue * (targetPrice - entryPrice) * dirSign;
    const lossAtSL = qty * contractValue * (entryPrice - stopPrice) * dirSign;
    const expectedReward = Math.max(0, pnlAtTP);
    const expectedRisk   = Math.max(0, lossAtSL);

    // ── Net figures ───────────────────────────────────────────────────────────
    const netReward = expectedReward - totalCost;
    const netRisk   = expectedRisk + totalCost;
    const actualRR  = netRisk > 0 ? netReward / netRisk : 0;
    const roundedRR = parseFloat(actualRR.toFixed(4));

    // ── GST calculation on fees ──────────────────────────────────────────────
    const gstCost = (entryFee + exitFee) * (FEES.GST_RATE / (1 + FEES.GST_RATE));

    // ── Viability check ───────────────────────────────────────────────────────
    let viable = true;
    let rejectReason = null;

    if (netReward <= 0) {
        viable = false;
        rejectReason = `Costs ($${totalCost.toFixed(4)}) exceed expected reward ($${expectedReward.toFixed(4)})`;
    } else if (minRewardRisk > 0.05 && roundedRR < (minRewardRisk - 0.001)) {
        viable = false;
        rejectReason = `Net R:R ${roundedRR.toFixed(2)} below minimum ${minRewardRisk}`;
    }

    return {
        notional:       parseFloat(notional.toFixed(6)),
        entryFee:       parseFloat(entryFee.toFixed(6)),
        exitFee:        parseFloat(exitFee.toFixed(6)),
        gstCost:        parseFloat(gstCost.toFixed(6)),
        slippageCost:   parseFloat(slippageCost.toFixed(6)),
        fundingCost:    parseFloat(fundingCost.toFixed(6)),
        totalCost:      parseFloat(totalCost.toFixed(6)),
        breakEvenPct:   parseFloat(breakEvenPct.toFixed(6)),
        breakEvenAbs:   parseFloat(breakEvenAbs.toFixed(6)),
        expectedReward: parseFloat(expectedReward.toFixed(6)),
        expectedRisk:   parseFloat(Math.abs(expectedRisk).toFixed(6)),
        netReward:      parseFloat(netReward.toFixed(6)),
        netRisk:        parseFloat(netRisk.toFixed(6)),
        actualRR:       parseFloat(actualRR.toFixed(4)),
        viable,
        rejectReason,
    };
}

module.exports = { calcTradeCosts, FEES };
