/**
 * SelfLearning.js
 *
 * Analyses the AiCorrection history to build a compact, actionable
 * "learning context" that is injected into future Gemini prompts.
 *
 * Runs once per hour (triggered by SignalEngine) and writes a
 * JSON summary to a lightweight in-memory + DB cache.
 *
 * Context injected into prompts includes:
 *   - Win rate by symbol (last 20 signals)
 *   - Avg R/R achieved vs predicted
 *   - Common failure patterns (e.g., "SL too tight for BTC volatility")
 *   - Symbols to avoid / favour based on AI accuracy
 *
 * Usage:
 *   const sl = require('./SelfLearning');
 *   const ctx = await sl.getContext('BTCUSD');
 *   // Inject ctx.summary into the Gemini prompt
 */

const AiCorrection = require('../../models/AiCorrection');

class SelfLearning {
    constructor() {
        // In-memory cache: symbol → { summary, updatedAt }
        this._cache   = new Map();
        this._global  = null;
        this._globalUpdatedAt = 0;
        this.CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
    }

    // ── Get learning context for a symbol ──────────────────────────────────────

    async getContext(symbol) {
        const now = Date.now();

        // Check in-memory cache
        const cached = this._cache.get(symbol);
        if (cached && (now - cached.updatedAt) < this.CACHE_TTL_MS) {
            return cached.summary;
        }

        const summary = await this._buildSymbolContext(symbol);
        this._cache.set(symbol, { summary, updatedAt: now });
        return summary;
    }

    async getGlobalContext() {
        const now = Date.now();
        if (this._global && (now - this._globalUpdatedAt) < this.CACHE_TTL_MS) {
            return this._global;
        }
        this._global = await this._buildGlobalContext();
        this._globalUpdatedAt = now;
        return this._global;
    }

    // ── Build symbol-specific learning context ─────────────────────────────────

    async _buildSymbolContext(symbol) {
        try {
            const corrections = await AiCorrection.find({ symbol })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean();

            if (corrections.length === 0) {
                return null; // No history yet
            }

            const total  = corrections.length;
            const wins   = corrections.filter(c => c.outcome === 'win').length;
            const losses = corrections.filter(c => c.outcome === 'loss').length;
            const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : null;

            const avgPnl = this._avg(corrections.map(c => c.realisedPnlPct).filter(v => v != null));
            const avgRR  = this._avg(corrections.map(c => c.rrAchieved).filter(v => v != null));
            const avgHoldHours = this._avg(corrections.map(c => c.holdingHours).filter(v => v != null));

            // Failure patterns
            const slHits = corrections.filter(c => c.outcome === 'sl_hit' || c.outcome === 'loss');
            const avgSlRROnLoss = this._avg(slHits.map(c => c.rrAchieved).filter(v => v != null));

            // Best and worst signals
            const sorted = [...corrections].sort((a, b) => (b.realisedPnlPct || 0) - (a.realisedPnlPct || 0));
            const best   = sorted[0];
            const worst  = sorted[sorted.length - 1];

            return {
                symbol,
                signals: total,
                winRate: `${winRate}%`,
                avgPnlPct: avgPnl?.toFixed(1) ?? null,
                avgRRachieved: avgRR?.toFixed(2) ?? null,
                avgHoldingHours: avgHoldHours?.toFixed(1) ?? null,
                slTightness: avgSlRROnLoss != null
                    ? (avgSlRROnLoss < -0.5 ? 'SL too tight — price wicks through before target' : 'SL level seems appropriate')
                    : null,
                recommendation: this._symbolRecommendation(winRate, avgRR),
                bestSignal: best  ? { outcome: best.outcome,  pnl: best.realisedPnlPct?.toFixed(1) }  : null,
                worstSignal: worst ? { outcome: worst.outcome, pnl: worst.realisedPnlPct?.toFixed(1) } : null,
            };
        } catch (err) {
            console.error('[SelfLearning] buildSymbolContext error:', err.message);
            return null;
        }
    }

    // ── Build global learning summary (injected into every prompt) ─────────────

    async _buildGlobalContext() {
        try {
            const allRecent = await AiCorrection.find()
                .sort({ createdAt: -1 })
                .limit(200)
                .lean();

            if (allRecent.length === 0) return null;

            const total  = allRecent.length;
            const wins   = allRecent.filter(c => c.outcome === 'win').length;
            const losses = allRecent.filter(c => c.outcome === 'loss').length;
            const timeout = allRecent.filter(c => c.outcome === 'timeout').length;

            const globalWinRate = ((wins / total) * 100).toFixed(1);
            const avgRR = this._avg(allRecent.map(c => c.rrAchieved).filter(v => v != null));
            const avgPnl = this._avg(allRecent.map(c => c.realisedPnlPct).filter(v => v != null));

            // Per-symbol win rates (top performers and underperformers)
            const bySymbol = {};
            for (const c of allRecent) {
                if (!bySymbol[c.symbol]) bySymbol[c.symbol] = { wins: 0, total: 0 };
                bySymbol[c.symbol].total++;
                if (c.outcome === 'win') bySymbol[c.symbol].wins++;
            }

            const symbolRates = Object.entries(bySymbol)
                .filter(([, v]) => v.total >= 3)
                .map(([sym, v]) => ({ sym, wr: (v.wins / v.total * 100).toFixed(0), n: v.total }))
                .sort((a, b) => parseFloat(b.wr) - parseFloat(a.wr));

            const topSymbols   = symbolRates.slice(0, 5);
            const worstSymbols = symbolRates.slice(-5).reverse();

            return {
                totalSignals: total,
                globalWinRate: `${globalWinRate}%`,
                wins, losses, timeouts: timeout,
                avgRRachieved: avgRR?.toFixed(2) ?? 'N/A',
                avgPnlPct: avgPnl?.toFixed(1) ?? 'N/A',
                topPerformers:  topSymbols.map(s => `${s.sym}(${s.wr}%,n=${s.n})`).join(', ') || 'N/A',
                underPerformers: worstSymbols.map(s => `${s.sym}(${s.wr}%,n=${s.n})`).join(', ') || 'N/A',
            };
        } catch (err) {
            console.error('[SelfLearning] buildGlobalContext error:', err.message);
            return null;
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    _avg(arr) {
        if (!arr.length) return null;
        return arr.reduce((s, v) => s + v, 0) / arr.length;
    }

    _symbolRecommendation(winRate, avgRR) {
        const wr = parseFloat(winRate);
        const rr = avgRR;
        if (wr >= 60 && rr >= 1.5) return 'HIGH_CONFIDENCE — historically strong signals on this symbol';
        if (wr >= 50 && rr >= 1.0) return 'MODERATE — decent win rate, maintain current approach';
        if (wr < 40)               return 'CAUTION — low win rate; tighten entry conditions or skip';
        if (rr < 0.5)              return 'CAUTION — R/R below 1:1; widen TP or tighten SL';
        return 'NEUTRAL';
    }

    // ── Format for Gemini prompt injection ────────────────────────────────────

    formatForPrompt(symbolCtx, globalCtx) {
        const parts = [];

        if (globalCtx) {
            parts.push(`[AI SELF-LEARNING — Global: ${globalCtx.globalWinRate} win rate across ${globalCtx.totalSignals} signals | Avg R/R: ${globalCtx.avgRRachieved} | Top performers: ${globalCtx.topPerformers} | Underperformers: ${globalCtx.underPerformers}]`);
        }

        if (symbolCtx) {
            parts.push(`[Symbol history — ${symbolCtx.symbol}: ${symbolCtx.winRate} win rate (${symbolCtx.signals} signals) | Avg R/R: ${symbolCtx.avgRRachieved} | Holding: ~${symbolCtx.avgHoldingHours}h | Note: ${symbolCtx.slTightness || 'N/A'} | Recommendation: ${symbolCtx.recommendation}]`);
        }

        if (parts.length === 0) {
            return '[AI SELF-LEARNING — No historical data yet; using base analysis only]';
        }

        return parts.join('\n');
    }
}

module.exports = new SelfLearning();
