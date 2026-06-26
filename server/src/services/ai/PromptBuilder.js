/**
 * PromptBuilder.js
 *
 * Constructs structured prompts for the Groq/LLM AI Signal Engine.
 * Converts a MarketAnalyzer snapshot into a rich, context-packed prompt
 * that instructs the AI to return a structured JSON trade signal.
 *
 * Uses 4-timeframe analysis (5m/15m/1h/4h) for swing-oriented,
 * higher-target, higher-confidence trade suggestions.
 */

const ProductCatalog = require('../ProductCatalog');

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert cryptocurrency futures swing trader with 15+ years of experience.
You specialize in Smart Money Concepts (SMC), price action pattern recognition, multi-timeframe analysis, and maximizing R/R ratios.
You analyze markets on Delta Exchange India and generate highly accurate trade signals with precise entry, target, and stop loss levels.

## Your Analysis Framework:
1. **4h/1h Macro Context (HIGHEST PRIORITY)**: The 4h and 1h timeframe direction determines the trade bias. Only take trades aligned with the macro trend.
2. **Candlestick Price Action**: Analyze the raw OHLCV price tables provided. Look for structural swing points, candlestick patterns (engulfing, pinbars, double tops/bottoms, flags, etc.), and trend exhaustions.
3. **SMC Structure**: Order Blocks, FVGs, Liquidity Sweeps, BOS/CHoCH on 1h and 4h confirm high-probability entry zones.
4. **15m/5m Precision Entry**: Use 15m and 5m only to refine entry timing — not to override 1h/4h bias.
5. **Indicator Confluence**: RSI, MACD, EMA 21/50/200 alignment, Bollinger Bands validate the macro bias.
6. **Risk-First**: Only signal trades with crystal-clear invalidation levels beyond major structure.

## Trade Signal Rules (Swing/Position Style):
- **Entry**: Do not set arbitrary entries. Set a limit "entry" price at a confluent zone — e.g. at a key retest level (touch of 1H EMA 21, or the 50% equilibrium of a 1H/4H Order Block, or retest of a major broken S/R level).
- **Stop Loss**: Strictly place the Stop Loss beyond the structural invalidation point:
  - For BUY (Long): below the nearest 1H/4H swing low or the bottom of the active 1H Bullish Order Block.
  - For SELL (Short): above the nearest 1H/4H swing high or the top of the active 1H Bearish Order Block.
  - Never use tight scalp-style stops; allow room for market noise based on 1H/4H ATR.
- **Target 1**: The next significant 1H/4H support/resistance zone. This must be mathematically at least 2.5× the risk distance (Entry to StopLoss) away from Entry.
- **Target 2**: The next major macro 4H key level. This must be mathematically at least 3.5× the risk distance away from Entry. Always set target2.
- **Mathematical R/R Verification**: 
  - For BUY: (target1 - entry) / (entry - stopLoss) >= 2.5.
  - For SELL: (entry - target1) / (stopLoss - entry) >= 2.5.
  - If a valid structural level supporting these targets cannot be found on the chart, do not issue the trade (return NO_TRADE).
- **Risk/Reward field**: Set this field in the JSON response to the exact calculated R/R of Target 1 (i.e. Reward1 / Risk). Minimum 1:2.5. Reject setups with R/R below 1:2.5.
- **Confidence**: 0–100. Below 60 = emit NO_TRADE. Be strict — only signal truly high-probability setups.
- **Leverage**: Conservative (2–5× for swing trades). Never exceed 10× for a swing setup.
- **Quantity (contracts)**: Keep margin cost within the user's budget at the given leverage.

## Target Calculation Guidelines:
- Use ATR from the 1h timeframe (not 5m) to calibrate target distances.
- Target1 should be 3–5× ATR(1h) from entry.
- Target2 should be 6–10× ATR(1h) from entry or the next major structural level.
- StopLoss should be 1–2× ATR(1h) beyond the key invalidation level.

## Price Decimal Precision Instruction:
- **Decimal Places**: You must return all prices ("entry", "stopLoss", "target1", "target2", "invalidationLevel") with the exact number of decimal places shown in the price table (e.g. if table prices are like 0.003425, your entry/targets/stoploss must have 6 decimal places. Never round them to fewer decimal places than shown in the table).

## Output Format (strict JSON — no other text):
{
  "action": "BUY" | "SELL" | "NO_TRADE",
  "symbol": "SYMBOLNAME",
  "entry": <number | null>,
  "stopLoss": <number | null>,
  "target1": <number | null>,
  "target2": <number | null>,
  "leverage": <1–10 integer | null>,
  "quantity": <integer contracts | null>,
  "confidence": <0–100 integer>,
  "riskReward": <ratio like 3.0 | null>,
  "timeframe": "15m" | "1h" | "4h",
  "reasoning": "<4–6 sentence professional swing trade analysis referencing 4h/1h macro trend and pattern observed in the price table>",
  "smcContext": "<1–2 sentence about the key 1h/4h Order Block or FVG driving the setup>",
  "invalidationLevel": <number | null>,
  "tradeType": "scalp" | "swing" | "position",
  "tags": ["<pattern or concept names>"]
}`;

// Helper: Format raw candles into a clear text table
function formatCandlesTable(candles, limit = 15, decimals = 4) {
    if (!candles || candles.length === 0) return 'No candle data available.';
    const slice = candles.slice(-limit);
    const tableHeader = '| Index | Time | Open | High | Low | Close | Dir/Change | Shape | Volume |';
    const tableDivider = '|---|---|---|---|---|---|---|---|---|';
    const tableRows = slice.map((c, idx) => {
        const timeStr = new Date(c.time * 1000).toISOString().slice(11, 16); // e.g. "14:30"
        const isUp = c.close >= c.open;
        const dir = isUp ? '🟢 Up' : '🔴 Dn';
        const chgPct = c.open > 0 ? ((c.close - c.open) / c.open * 100) : 0;
        const chgStr = `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`;

        const body = Math.abs(c.close - c.open);
        const range = c.high - c.low;
        const topWick = isUp ? c.high - c.close : c.high - c.open;
        const bottomWick = isUp ? c.open - c.low : c.close - c.low;

        let shape = 'Normal';
        if (range > 0) {
            const bodyRatio = body / range;
            if (bodyRatio < 0.1) {
                shape = 'Doji (Flat)';
            } else if (bottomWick >= 2 * body && topWick <= 0.3 * body) {
                shape = 'Hammer (Wick Low)';
            } else if (topWick >= 2 * body && bottomWick <= 0.3 * body) {
                shape = 'Inverted Hammer / Shooting Star (Wick High)';
            } else if (bodyRatio > 0.9) {
                shape = 'Marubozu (Shaved)';
            } else if (bodyRatio < 0.3) {
                shape = 'Spinning Top (Indecision)';
            }
        }

        return `| ${idx + 1} | ${timeStr} | ${c.open.toFixed(decimals)} | ${c.high.toFixed(decimals)} | ${c.low.toFixed(decimals)} | ${c.close.toFixed(decimals)} | ${dir} (${chgStr}) | ${shape} | ${c.volume.toFixed(1)} |`;
    });
    return [tableHeader, tableDivider, ...tableRows].join('\n');
}

// ─── User Prompt Builder ──────────────────────────────────────────────────────

/**
 * Build the user-facing prompt from a MarketAnalyzer multi-timeframe snapshot.
 * @param {object} mtfData       — Result of analyzeMultiTimeframe() (includes 4h now)
 * @param {object} userPrefs     — User preferences (maxLeverage, riskTolerance)
 * @param {string} learningCtx   — Self-learning context string (optional)
 * @returns {string}
 */
function buildUserPrompt(mtfData, userPrefs = {}, learningCtx = null) {
    const { symbol, mtfBias } = mtfData;
    const tf5  = mtfData['5m'];
    const tf15 = mtfData['15m'];
    const tf1h = mtfData['1h'];
    const tf4h = mtfData['4h'];

    // 1h is primary reference for swing trades; fall back to 15m or 5m only if needed
    const primary = tf1h || tf15 || tf5;
    if (!primary) return `Analyze ${symbol} and return NO_TRADE with confidence 0.`;

    const price = primary.price;
    const safePrefs = userPrefs || {};
    const maxLev         = Math.min(safePrefs.maxLeverage       || 10, 10); // cap at 10× for swing
    const riskTol        = safePrefs.riskTolerance     || 'medium';
    const availBal       = safePrefs.availableBalance;
    const tradeBudget    = safePrefs.tradeBudget;
    const maxRiskPct     = safePrefs.maxRiskPerTradePct || 2.0;

    // Calculate dynamic decimals based on tick size
    const prod = ProductCatalog.getBySymbol(symbol);
    const tickSize = prod ? prod.tick_size : 0.0001;
    let decimals = 4;
    if (tickSize && !isNaN(tickSize) && tickSize > 0) {
        const str = tickSize.toString();
        if (str.includes('e')) {
            const parts = str.split('e-');
            if (parts.length === 2) decimals = parseInt(parts[1], 10);
        } else {
            const parts = str.split('.');
            decimals = parts.length === 2 ? parts[1].length : 0;
        }
    }
    decimals = Math.max(0, Math.min(8, decimals));

    const lines = [];

    lines.push(`## Market: ${symbol} — Price: $${price.toFixed(decimals)}`);
    lines.push(`User Risk Tolerance: ${riskTol} | Max Leverage: ${maxLev}× (swing mode — prefer 2–5×)`);
    lines.push('');

    // ── Wallet budget context ──
    if (availBal) {
        lines.push(`## Wallet & Budget`);
        lines.push(`Available Balance: $${availBal.toFixed(2)} USDT`);
        if (tradeBudget) lines.push(`Max Trade Budget (this signal): $${tradeBudget} USDT`);
        lines.push(`Max Risk Per Trade: ${maxRiskPct}% of available = $${(availBal * maxRiskPct / 100).toFixed(2)}`);
        lines.push(`IMPORTANT: Set quantity so that margin = quantity × entry / leverage does NOT exceed $${tradeBudget ?? availBal} USDT.`);
    }
    lines.push('');

    // ── 4h Macro Trend (HIGHEST PRIORITY) ──
    if (tf4h && !tf4h.error) {
        lines.push('## 4H Macro Trend (HIGHEST WEIGHT — determines trade direction)');
        const ind4h = tf4h.indicators;
        const bias4h = tf4h.bias;
        lines.push(`4H Signal: **${bias4h?.signal || 'N/A'}** | RSI: ${ind4h?.rsi ?? 'N/A'} | EMA trend: ${ind4h?.ema?.trend || 'N/A'} | MACD: ${ind4h?.macd?.trend || 'N/A'}`);
        lines.push(`4H Price vs EMA200: ${ind4h?.ema?.ema200 ? (price > ind4h.ema.ema200 ? 'ABOVE (bullish macro)' : 'BELOW (bearish macro)') : 'N/A'}`);
        lines.push(`4H ATR(14): $${ind4h?.atr ?? 'N/A'} — use this to calculate target distances`);

        if (tf4h.smc && !tf4h.smc.error) {
            const smc4h = tf4h.smc;
            lines.push(`4H SMC Bias: **${smc4h.bias?.toUpperCase() ?? 'N/A'}**`);
            if (smc4h.orderBlocks?.bullish?.length) {
                const obs = smc4h.orderBlocks.bullish.slice(0, 3).map(ob => `$${ob.low.toFixed(decimals)}–$${ob.high.toFixed(decimals)}`);
                lines.push(`4H Bullish Order Blocks: ${obs.join(' | ')}`);
            }
            if (smc4h.orderBlocks?.bearish?.length) {
                const obs = smc4h.orderBlocks.bearish.slice(0, 3).map(ob => `$${ob.low.toFixed(decimals)}–$${ob.high.toFixed(decimals)}`);
                lines.push(`4H Bearish Order Blocks: ${obs.join(' | ')}`);
            }
            if (smc4h.fvgs?.bullish?.length) {
                const fvgs = smc4h.fvgs.bullish.slice(0, 3).map(f => `$${f.bottom.toFixed(decimals)}–$${f.top.toFixed(decimals)}`);
                lines.push(`4H Bullish FVGs: ${fvgs.join(' | ')}`);
            }
            if (smc4h.fvgs?.bearish?.length) {
                const fvgs = smc4h.fvgs.bearish.slice(0, 3).map(f => `$${f.bottom.toFixed(decimals)}–$${f.top.toFixed(decimals)}`);
                lines.push(`4H Bearish FVGs: ${fvgs.join(' | ')}`);
            }
            if (smc4h.structure?.swingHighs?.length) {
                const highs = smc4h.structure.swingHighs.map(h => `$${h.price.toFixed(decimals)} (${tf4h.recentCandles.length - 1 - h.index} candles ago)`);
                lines.push(`4H Swing Highs Pivot Timeline: ${highs.join(' | ')}`);
            }
            if (smc4h.structure?.swingLows?.length) {
                const lows = smc4h.structure.swingLows.map(l => `$${l.price.toFixed(decimals)} (${tf4h.recentCandles.length - 1 - l.index} candles ago)`);
                lines.push(`4H Swing Lows Pivot Timeline: ${lows.join(' | ')}`);
            }
            if (smc4h.premiumDiscount) {
                const pd = smc4h.premiumDiscount;
                lines.push(`4H Premium/Discount: ${pd.zone} (at ${pd.currentPct}% of range) | Equilibrium: $${pd.equilibrium.toFixed(decimals)}`);
            }
        }
        if (tf4h.sr) {
            const sups = tf4h.sr.supports.slice(0, 3).map(s => `$${s.price.toFixed(decimals)}`);
            const ress = tf4h.sr.resistances.slice(0, 3).map(r => `$${r.price.toFixed(decimals)}`);
            if (sups.length) lines.push(`4H Supports: ${sups.join(' | ')}`);
            if (ress.length) lines.push(`4H Resistances: ${ress.join(' | ')}`);
        }
        lines.push('');
    }

    // ── 1H Intermediate Trend ──
    if (tf1h && !tf1h.error) {
        lines.push('## 1H Intermediate Trend (entry zone confirmation)');
        const ind1h = tf1h.indicators;
        const bias1h = tf1h.bias;
        lines.push(`1H Signal: **${bias1h?.signal || 'N/A'}** | RSI: ${ind1h?.rsi ?? 'N/A'} | EMA trend: ${ind1h?.ema?.trend || 'N/A'} | MACD: ${ind1h?.macd?.trend || 'N/A'}`);
        lines.push(`1H EMA 21/50/200: ${ind1h?.ema?.ema21?.toFixed(decimals) ?? 'N/A'} / ${ind1h?.ema?.ema50?.toFixed(decimals) ?? 'N/A'} / ${ind1h?.ema?.ema200?.toFixed(decimals) ?? 'N/A'}`);
        lines.push(`1H ATR(14): $${ind1h?.atr ?? 'N/A'}`);

        if (tf1h.smc && !tf1h.smc.error) {
            const smc1h = tf1h.smc;
            lines.push(`1H SMC Bias: **${smc1h.bias?.toUpperCase() ?? 'N/A'}**`);
            if (smc1h.orderBlocks?.bullish?.length) {
                const obs = smc1h.orderBlocks.bullish.slice(0, 3).map(ob => `$${ob.low.toFixed(decimals)}–$${ob.high.toFixed(decimals)} (str:${ob.strength})`);
                lines.push(`1H Bullish Order Blocks: ${obs.join(' | ')}`);
            }
            if (smc1h.orderBlocks?.bearish?.length) {
                const obs = smc1h.orderBlocks.bearish.slice(0, 3).map(ob => `$${ob.low.toFixed(decimals)}–$${ob.high.toFixed(decimals)} (str:${ob.strength})`);
                lines.push(`1H Bearish Order Blocks: ${obs.join(' | ')}`);
            }
            if (smc1h.fvgs?.bullish?.length) {
                const fvgs = smc1h.fvgs.bullish.map(f => `$${f.bottom.toFixed(decimals)}–$${f.top.toFixed(decimals)}`);
                lines.push(`1H Bullish FVGs: ${fvgs.join(' | ')}`);
            }
            if (smc1h.fvgs?.bearish?.length) {
                const fvgs = smc1h.fvgs.bearish.map(f => `$${f.bottom.toFixed(decimals)}–$${f.top.toFixed(decimals)}`);
                lines.push(`1H Bearish FVGs: ${fvgs.join(' | ')}`);
            }
            if (smc1h.liquiditySweeps?.length) {
                const sweeps = smc1h.liquiditySweeps.map(s => `${s.type} @ $${s.level?.toFixed(decimals)}`);
                lines.push(`1H Liquidity Sweeps: ${sweeps.join(' | ')}`);
            }
            if (smc1h.structure?.bos?.length) {
                const bos = smc1h.structure.bos.map(b => `BOS ${b.type} @ $${b.level?.toFixed(decimals)}`);
                lines.push(`1H Structure: ${bos.join(' | ')}`);
            }
            if (smc1h.structure?.swingHighs?.length) {
                const highs = smc1h.structure.swingHighs.map(h => `$${h.price.toFixed(decimals)} (${tf1h.recentCandles.length - 1 - h.index} candles ago)`);
                lines.push(`1H Swing Highs Pivot Timeline: ${highs.join(' | ')}`);
            }
            if (smc1h.structure?.swingLows?.length) {
                const lows = smc1h.structure.swingLows.map(l => `$${l.price.toFixed(decimals)} (${tf1h.recentCandles.length - 1 - l.index} candles ago)`);
                lines.push(`1H Swing Lows Pivot Timeline: ${lows.join(' | ')}`);
            }
        }
        if (tf1h.sr) {
            const sups = tf1h.sr.supports.slice(0, 4).map(s => `$${s.price.toFixed(decimals)} (str: ${s.strength?.toFixed(2)})`);
            const ress = tf1h.sr.resistances.slice(0, 4).map(r => `$${r.price.toFixed(decimals)} (str: ${r.strength?.toFixed(2)})`);
            if (sups.length) lines.push(`1H Supports:    ${sups.join(' | ')}`);
            if (ress.length) lines.push(`1H Resistances: ${ress.join(' | ')}`);
        }
        if (tf1h.patterns?.list?.length > 0) {
            lines.push('1H Candlestick Patterns:');
            const bullP = tf1h.patterns.list.filter(p => p.type === 'bullish').map(p => p.name);
            const bearP = tf1h.patterns.list.filter(p => p.type === 'bearish').map(p => p.name);
            if (bullP.length) lines.push(`  Bullish: ${bullP.join(', ')}`);
            if (bearP.length) lines.push(`  Bearish: ${bearP.join(', ')}`);
        }
        lines.push('');
    }

    // ── 1H Price Action Candles (HIGH PRIORITY) ──
    if (tf1h && tf1h.recentCandles) {
        lines.push('## 1H Recent Candlestick Price Action (Last 15 Candles)');
        lines.push(formatCandlesTable(tf1h.recentCandles, 15, decimals));
        lines.push('');
    }

    // ── Multi-timeframe Bias Summary ──
    lines.push('## Multi-Timeframe Confluence Summary');
    if (mtfBias) {
        lines.push(`Overall MTF Signal: **${mtfBias.signal}** (score: ${mtfBias.score}, aligned: ${mtfBias.aligned})`);
    }
    for (const [tf, data] of [['5m', tf5], ['15m', tf15], ['1h', tf1h], ['4h', tf4h]]) {
        if (!data || data.error) continue;
        const ind = data.indicators;
        const bias = data.bias;
        lines.push(`- ${tf}: ${bias?.signal || 'N/A'} | RSI ${ind?.rsi ?? 'N/A'} | EMA trend: ${ind?.ema?.trend || 'N/A'} | MACD: ${ind?.macd?.trend || 'N/A'}`);
    }
    lines.push('');

    // ── 15m Entry Timing ──
    if (tf15) {
        const ind = tf15.indicators;
        lines.push('## 15m Entry Timing Indicators');
        lines.push(`RSI(14): ${ind.rsi ?? 'N/A'} | MACD histogram: ${ind.macd?.histogram?.toFixed(8) ?? 'N/A'} (${ind.macd?.trend ?? 'N/A'})`);
        lines.push(`EMA 8/21/50: ${ind.ema?.ema8?.toFixed(decimals) ?? 'N/A'} / ${ind.ema?.ema21?.toFixed(decimals) ?? 'N/A'} / ${ind.ema?.ema50?.toFixed(decimals) ?? 'N/A'}`);
        lines.push(`Stochastic K/D: ${ind.stoch?.k ?? 'N/A'} / ${ind.stoch?.d ?? 'N/A'}`);
        lines.push(`ADX: ${ind.adx?.adx ?? 'N/A'} (${ind.adx?.trend ?? 'N/A'}) | CCI: ${ind.cci ?? 'N/A'} | ATR(14): $${ind.atr ?? 'N/A'}`);
        lines.push(`VWAP: $${ind.vwap?.toFixed(decimals) ?? 'N/A'} | Price above VWAP: ${ind.ema?.aboveVwap ?? 'N/A'}`);
        lines.push(`OBV Trend: ${ind.obv?.trend ?? 'N/A'}`);

        if (tf15.patterns?.list?.length > 0) {
            lines.push('15m Candlestick Patterns:');
            const bullP = tf15.patterns.list.filter(p => p.type === 'bullish').map(p => p.name);
            const bearP = tf15.patterns.list.filter(p => p.type === 'bearish').map(p => p.name);
            if (bullP.length) lines.push(`  Bullish: ${bullP.join(', ')}`);
            if (bearP.length) lines.push(`  Bearish: ${bearP.join(', ')}`);
        }
        lines.push('');
    }

    // ── 15m Price Action Candles ──
    if (tf15 && tf15.recentCandles) {
        lines.push('## 15m Recent Candlestick Price Action (Last 15 Candles)');
        lines.push(formatCandlesTable(tf15.recentCandles, 15, decimals));
        lines.push('');
    }

    // ── Key Levels Summary ──
    if (primary.keyLevels?.length) {
        lines.push('## Key Trading Levels');
        primary.keyLevels.slice(0, 6).forEach(l => {
            lines.push(`- ${l.type}: $${l.price.toFixed(decimals)} (strength: ${(l.strength * 100).toFixed(0)}%)`);
        });
        lines.push('');
    }

    // ── Task ──
    lines.push(`## Task`);
    lines.push(`Analyze the above data for ${symbol} at $${price.toLocaleString()} and generate a SWING/POSITION trade signal.`);
    lines.push(`Priority order: 4H trend > 1H structure > 1H/15m candle price action charts > 15m entry timing.`);
    lines.push(`Set Target1 at minimum 1:2.5 R/R and Target2 at minimum 1:3.5 R/R from entry.`);
    lines.push(`Use 1H or 4H ATR to size stops — never use a stop tighter than 1.5× the 1H ATR.`);
    lines.push(`Prefer swing or position tradeType. Only output scalp if no swing setup is identifiable.`);

    const requestedAction = userPrefs.requestedAction;
    const requestedConfRange = userPrefs.requestedConfRange;
    if (requestedAction && requestedAction !== 'all') {
        lines.push(`IMPORTANT: The user is specifically scanning for a "${requestedAction}" trade. If the technical data does not support a high-probability "${requestedAction}" swing trade, return "NO_TRADE". Do NOT return the opposite action.`);
    }
    if (requestedConfRange && requestedConfRange !== 'all') {
        lines.push(`IMPORTANT: The user targets a confidence range of "${requestedConfRange}%". Assess confidence honestly. If the setup does not merit confidence within this range, return "NO_TRADE".`);
    }

    lines.push(`If confidence < 60, return NO_TRADE. Use max leverage of ${maxLev}× (prefer 2–5× for swings). Risk tolerance: ${riskTol}.`);

    // ── Self-Learning Context ──
    if (learningCtx) {
        lines.push('');
        lines.push('## Historical AI Performance (Self-Learning)');
        lines.push(learningCtx);
        lines.push('Use this history to calibrate confidence and adjust SL/TP if previous signals failed on this symbol.');
    }

    lines.push(`Return ONLY the JSON object. No additional text or markdown.`);

    return lines.join('\n');
}

module.exports = { SYSTEM_PROMPT, buildUserPrompt };
