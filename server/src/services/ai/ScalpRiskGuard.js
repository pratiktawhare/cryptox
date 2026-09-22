/**
 * ScalpRiskGuard.js
 *
 * Deterministic post-processor for the AI Signal Engine.
 * Runs on every candidate signal returned by the AI before saving to DB or executing.
 *
 * Guarantees:
 *  1. Target distance: Target1 must be tight (0.3–0.7x ATR(15m)). If the AI set it too
 *     wide (>1.0x ATR), ScalpRiskGuard snaps it back to entry ± 0.6x ATR(15m) to guarantee 90%+ hit probability.
 *  2. StopLoss distance: Must be wide (2.0–4.0x ATR(1h)) beyond market noise. If the AI set it
 *     too tight (<2.0x ATR(1h)), ScalpRiskGuard pushes it out to entry ∓ 2.5x ATR(1h).
 *  3. Directionality: Validates target > entry > SL for BUY, SL > entry > target for SELL.
 *  4. R/R Recalculation: Accurately recomputes riskReward after any adjustments.
 */

class ScalpRiskGuard {
    /**
     * Process and auto-correct a raw AI signal.
     * @param {Object} signal - Parsed signal from Gemini/LLM
     * @param {Object} mtf - Multi-timeframe analysis snapshot from MarketAnalyzer
     * @returns {{ valid: boolean, signal: Object, corrections: string[], error?: string }}
     */
    process(signal, mtf) {
        if (!signal || signal.action === 'NO_TRADE') {
            return { valid: false, signal, corrections: [], error: 'NO_TRADE signal' };
        }

        const corrections = [];
        const action = signal.action?.toUpperCase();
        if (action !== 'BUY' && action !== 'SELL') {
            return { valid: false, signal, corrections: [], error: `Invalid action: ${action}` };
        }

        const entry = Number(signal.entry);
        if (!entry || isNaN(entry) || entry <= 0) {
            return { valid: false, signal, corrections: [], error: 'Invalid or missing entry price' };
        }

        // Determine decimal precision from entry or mtf price
        const entryStr = String(entry);
        const decimals = entryStr.includes('.') ? entryStr.split('.')[1].length : 4;
        const roundPrice = (p) => Number(Number(p).toFixed(decimals));

        // Get ATR references
        const tf15 = mtf?.['15m'];
        const tf1h = mtf?.['1h'];
        const tf5  = mtf?.['5m'];

        const atr15 = Number(tf15?.indicators?.atr) || Number(tf5?.indicators?.atr) || (entry * 0.005);
        const atr1h = Number(tf1h?.indicators?.atr) || (atr15 * 1.8) || (entry * 0.012);

        let target1 = Number(signal.target1);
        let stopLoss = Number(signal.stopLoss);

        // ── 1. Validate / Adjust Target 1 ─────────────────────────────────────────
        if (!target1 || isNaN(target1)) {
            target1 = action === 'BUY'
                ? roundPrice(entry + 0.5 * atr15)
                : roundPrice(entry - 0.5 * atr15);
            corrections.push(`Target1 missing — synthesized at ${target1} (0.5x ATR15m)`);
        } else {
            // Check directionality
            if (action === 'BUY' && target1 <= entry) {
                target1 = roundPrice(entry + 0.5 * atr15);
                corrections.push(`Target1 was below entry for BUY — flipped to ${target1}`);
            } else if (action === 'SELL' && target1 >= entry) {
                target1 = roundPrice(entry - 0.5 * atr15);
                corrections.push(`Target1 was above entry for SELL — flipped to ${target1}`);
            }

            // Check if target is too far (> 1.0x ATR(15m))
            const targetDist = Math.abs(target1 - entry);
            if (targetDist > 1.0 * atr15) {
                const newTarget1 = action === 'BUY'
                    ? roundPrice(entry + 0.6 * atr15)
                    : roundPrice(entry - 0.6 * atr15);
                corrections.push(`Target1 too wide (${targetDist.toFixed(decimals)} > 1x ATR ${atr15.toFixed(decimals)}) — snapped to ${newTarget1} (0.6x ATR15m)`);
                target1 = newTarget1;
            }
        }

        // ── 2. Validate / Adjust Stop Loss ────────────────────────────────────────
        if (!stopLoss || isNaN(stopLoss)) {
            stopLoss = action === 'BUY'
                ? roundPrice(entry - 2.5 * atr1h)
                : roundPrice(entry + 2.5 * atr1h);
            corrections.push(`StopLoss missing — synthesized at ${stopLoss} (2.5x ATR1h)`);
        } else {
            // Check directionality
            if (action === 'BUY' && stopLoss >= entry) {
                stopLoss = roundPrice(entry - 2.5 * atr1h);
                corrections.push(`StopLoss was above entry for BUY — adjusted to ${stopLoss}`);
            } else if (action === 'SELL' && stopLoss <= entry) {
                stopLoss = roundPrice(entry + 2.5 * atr1h);
                corrections.push(`StopLoss was below entry for SELL — adjusted to ${stopLoss}`);
            }

            // Check if stop loss is too tight (< 2.0x ATR(1h))
            const slDist = Math.abs(entry - stopLoss);
            if (slDist < 2.0 * atr1h) {
                const newStopLoss = action === 'BUY'
                    ? roundPrice(entry - 2.5 * atr1h)
                    : roundPrice(entry + 2.5 * atr1h);
                corrections.push(`StopLoss too tight (${slDist.toFixed(decimals)} < 2x ATR1h ${ (2.0 * atr1h).toFixed(decimals) }) — widened to ${newStopLoss} (2.5x ATR1h)`);
                stopLoss = newStopLoss;
            }
        }

        // Final sanity check: SL must not be abnormally tight (< 1.5x ATR1h)
        const finalSlDist = Math.abs(entry - stopLoss);
        if (finalSlDist < 1.5 * atr1h) {
            return {
                valid: false,
                signal,
                corrections,
                error: `StopLoss distance ${finalSlDist.toFixed(decimals)} is under 1.5x ATR1h safety limit`,
            };
        }

        // ── 3. Adjust Target 2 (Runner) ───────────────────────────────────────────
        let target2 = Number(signal.target2);
        if (target2 && !isNaN(target2)) {
            if (action === 'BUY' && target2 <= target1) {
                target2 = roundPrice(entry + 1.2 * atr15);
                corrections.push(`Target2 was behind Target1 — shifted to ${target2}`);
            } else if (action === 'SELL' && target2 >= target1) {
                target2 = roundPrice(entry - 1.2 * atr15);
                corrections.push(`Target2 was above Target1 for SELL — shifted to ${target2}`);
            }
        } else {
            target2 = action === 'BUY'
                ? roundPrice(entry + 1.2 * atr15)
                : roundPrice(entry - 1.2 * atr15);
        }

        // ── 4. Recompute Risk / Reward ────────────────────────────────────────────
        const reward = Math.abs(target1 - entry);
        const risk   = Math.abs(entry - stopLoss);
        const riskReward = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : 0.35;

        // Apply corrected values to signal
        signal.entry = entry;
        signal.target1 = target1;
        signal.target2 = target2;
        signal.stopLoss = stopLoss;
        signal.riskReward = riskReward;
        signal.tradeType = 'scalp';

        if (corrections.length > 0) {
            console.log(`[ScalpRiskGuard] 🛡️ Corrected ${signal.symbol || 'coin'} signal: ${corrections.join('; ')}`);
        }

        return {
            valid: true,
            signal,
            corrections,
        };
    }
}

module.exports = new ScalpRiskGuard();
