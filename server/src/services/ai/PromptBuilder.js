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

const SYSTEM_PROMPT = `You are an elite cryptocurrency futures scalp trader with 15+ years of institutional experience.
You specialize in high-win-rate (90%–95%) precision scalping on Delta Exchange India, using Smart Money Concepts (SMC), micro-structure liquidity, and strict momentum alignment.
Your primary objective is consistent, sustained profitability through a very high win rate: take quick, highly probable profits at the nearest micro-structure target while keeping a wide, safe structural stop loss that is rarely touched.

## Core Scalp Philosophy (90%+ Win Rate Architecture):
- **Micro Targets**: We don't wait for massive swing expansions. Take profit at the NEAREST micro-level liquidity or confluence point — the nearest 15m/5m S/R zone, EMA touch (EMA 21/50), or VWAP. Target1 should be reachable within 1 to 3 candles.
- **Wide Structural Stop Loss**: Stop loss must be placed BEYOND a major 1H/4H structural invalidation point. It must be wide enough (2.0–4.0× ATR(1h)) that normal intraday volatility and liquidity sweeps will not wick through it. Only a fundamental regime shift should hit your stop.
- **Expected Risk/Reward (0.30–0.60)**: Scalping math thrives on high win rate (EV = 0.90 * 0.5R - 0.10 * 2.0R = +0.25R). Do NOT force large 2:1 or 3:1 R/R targets. A small target (0.3–0.7× ATR(15m)) with a safe wide stop loss is mathematically optimal for 90%+ hit rate.
- **Trend Alignment is Mandatory**: Never counter-trend scalp. The 4H and 1H directional bias must be clear and aligned. If higher timeframes are in conflict or choppy, return NO_TRADE.
- **Confluence Rule**: Every trade must possess at least 3 out of 4 factors:
  1. 4H/1H macro trend alignment (price above/below key EMAs)
  2. Order Block (OB) or Fair Value Gap (FVG) retest on 15m/5m
  3. Dynamic support/resistance (EMA 21/50 bounce or VWAP alignment)
  4. Candlestick trigger & volume confirmation (rejection wicks, absorption)

## Trade Signal Rules (Scalp Style):
- **Entry**: Set a limit "entry" price at a high-probability confluent zone — e.g. retest of 5m/15m EMA 21, equilibrium of an active Order Block, or boundary of an FVG.
- **Target 1 (Primary Scalp Target)**: 0.3–0.7× ATR(15m) from entry. Must be at the nearest micro resistance (for Long) or support (for Short). Should almost always be hit.
- **Target 2 (Runner Target)**: 1.0–1.5× ATR(15m) from entry. Optional partial extension.
- **Stop Loss**: Structural stop placed 2.0–4.0× ATR(1h) away from entry beyond key swing low/high or major 4H level. Never tighter than 1.5× ATR(1h).
- **Risk/Reward**: Target 1 R/R typically between 0.30 and 0.60. R/R below 0.30 is rejected.
- **Confidence Calibration**:
  - 85–98: Exceptional — multi-timeframe trend in sync, fresh OB/FVG retest, clean rejection candle, high volume
  - 72–84: Strong — clear trend, solid micro setup, safe structural stop
  - Below 72: Return NO_TRADE — market is ranging, choppy, or setup lacks sufficient probability
- **Leverage**: 3–10× (typically 5–10× for scalping with defined margin sizing).
- **Quantity (contracts)**: Keep margin cost within the user's budget.

## Price Decimal Precision:
- Return all prices ("entry", "stopLoss", "target1", "target2", "invalidationLevel") with the exact decimal precision shown in the price table.

## Reference Examples:

GOOD SCALP SIGNAL (High win-rate setup):
{"action":"BUY","symbol":"ETHUSD","entry":2310.50,"stopLoss":2240.00,"target1":2332.00,"target2":2345.00,"leverage":5,"quantity":2,"confidence":85,"riskReward":0.31,"timeframe":"15m","reasoning":"4H and 1H trends are strongly bullish above EMA 50. 15m pulled back to retest the fresh Bullish Order Block at 2308-2312 and bounced with hammer rejection. Target 1 is set at the nearest micro resistance (2332, 0.5x 15m ATR) for a high-probability scalp exit. Stop loss is placed safely below the 4H swing low at 2240 (2.8x 1H ATR) to eliminate noise wicks.","smcContext":"15m Bullish OB retest at 2310 confluent with 1H EMA 21 support.","invalidationLevel":2238.00,"tradeType":"scalp","tags":["OB Retest","EMA Bounce","High Win-Rate Scalp"]}

CORRECT NO_TRADE (Choppy / low conviction):
{"action":"NO_TRADE","symbol":"BTCUSD","entry":null,"stopLoss":null,"target1":null,"target2":null,"leverage":null,"quantity":null,"confidence":52,"riskReward":null,"timeframe":"15m","reasoning":"4H is bullish but 15m is chopping sideways between tight bands with declining volume and ADX < 20. No clear micro retest zone or OB. Risk of being chopped out. Waiting for clean momentum breakout or pullback.","smcContext":"No clean OB or FVG in range.","invalidationLevel":null,"tradeType":"scalp","tags":["Choppy","Low Momentum"]}

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
  "riskReward": <ratio like 0.40 | null>,
  "timeframe": "5m" | "15m",
  "reasoning": "<3–5 sentence professional scalp analysis referencing macro trend alignment and micro entry/exit>",
  "smcContext": "<1–2 sentence about the key OB, FVG, or S/R level>",
  "invalidationLevel": <number | null>,
  "tradeType": "scalp",
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
    lines.push(`Analyze the above data for ${symbol} at $${price.toLocaleString()} and generate a HIGH-WIN-RATE (90%+) SCALP trade signal.`);
    lines.push(`Priority order: 4H/1H trend alignment > 15m/5m micro structure & OB/FVG > 5m entry timing.`);
    lines.push(`Target1: Set at the NEAREST micro target (next 15m S/R, EMA 21 touch, or VWAP) — approximately 0.3–0.7× ATR(15m) from entry. It should hit with 90%+ probability.`);
    lines.push(`StopLoss: Set BEYOND a major 1H/4H structural swing point — approximately 2.0–4.0× ATR(1h) from entry. Must be wide enough to survive noise wicks.`);
    lines.push(`Risk/Reward is expected to be 0.30–0.60 by design for high win-rate scalps.`);
    lines.push(`tradeType should be "scalp".`);

    const requestedAction = userPrefs.requestedAction;
    const requestedConfRange = userPrefs.requestedConfRange;
    if (requestedAction && requestedAction !== 'all') {
        lines.push(`IMPORTANT: The user is specifically scanning for a "${requestedAction}" trade. If the technical data does not support a high-probability "${requestedAction}" scalp trade, return "NO_TRADE". Do NOT return the opposite action.`);
    }
    if (requestedConfRange && requestedConfRange !== 'all') {
        lines.push(`IMPORTANT: The user targets a confidence range of "${requestedConfRange}%". Assess confidence honestly. If the setup does not merit confidence within this range, return "NO_TRADE".`);
    }

    lines.push(`CONFIDENCE RULE: If confidence >= 72, issue the trade signal. Below 72, return NO_TRADE. Use max leverage of ${maxLev}× (prefer 5–10× for scalps). Risk tolerance: ${riskTol}.`);

    // ── Self-Learning Context (actionable patterns only) ──
    if (learningCtx) {
        lines.push('');
        lines.push('## Trading Pattern Guidance (from past signals)');
        lines.push(learningCtx);
        lines.push('Apply these pattern notes to calibrate your entry and stop loss decisions.');
    }

    lines.push(`Return ONLY the JSON object. No additional text or markdown.`);

    return lines.join('\n');
}

module.exports = { SYSTEM_PROMPT, buildUserPrompt };
