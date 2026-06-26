/**
 * IndicatorEngine.js
 *
 * Pure-function technical indicator library.
 * All indicators operate on OHLCV candle arrays.
 * No external dependencies — fully self-contained.
 *
 * Candle shape expected: { time, open, high, low, close, volume }
 *
 * Exported: IndicatorEngine.compute(candles, options) → IndicatorSnapshot
 */

// ─── Math helpers ─────────────────────────────────────────────────────────────

const sum  = (arr) => arr.reduce((a, b) => a + b, 0);
const mean = (arr) => sum(arr) / arr.length;
const std  = (arr) => { const m = mean(arr); return Math.sqrt(mean(arr.map(v => (v-m)**2))); };
const tail = (arr, n) => arr.slice(-n);
const closes = (candles) => candles.map(c => c.close);
const highs  = (candles) => candles.map(c => c.high);
const lows   = (candles) => candles.map(c => c.low);
const volumes= (candles) => candles.map(c => c.volume);

// ─── EMA ─────────────────────────────────────────────────────────────────────

function ema(data, period) {
    if (data.length < period) return [];
    const k = 2 / (period + 1);
    const result = [];
    let prev = mean(data.slice(0, period));
    result.push(prev);
    for (let i = period; i < data.length; i++) {
        prev = data[i] * k + prev * (1 - k);
        result.push(prev);
    }
    return result;
}

// ─── SMA ─────────────────────────────────────────────────────────────────────

function sma(data, period) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
        result.push(mean(data.slice(i - period + 1, i + 1)));
    }
    return result;
}

// ─── RSI ─────────────────────────────────────────────────────────────────────

function rsi(data, period = 14) {
    if (data.length < period + 1) return null;
    const gains = [], losses = [];
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i-1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }
    let avgGain = mean(gains);
    let avgLoss = mean(losses);

    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i-1];
        avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

// ─── MACD ─────────────────────────────────────────────────────────────────────

function macd(data, fast = 12, slow = 26, signal = 9) {
    if (data.length < slow + signal) return null;
    const eFast   = ema(data, fast);
    const eSlow   = ema(data, slow);
    const overlap = Math.min(eFast.length, eSlow.length);
    const macdLine = [];
    for (let i = 0; i < overlap; i++) {
        macdLine.push(eFast[eFast.length - overlap + i] - eSlow[eSlow.length - overlap + i]);
    }
    const signalLine = ema(macdLine, signal);
    const histogram  = signalLine.map((s, i) => macdLine[macdLine.length - signalLine.length + i] - s);

    const last = histogram.length - 1;
    return {
        macd:      parseFloat((macdLine[macdLine.length - 1] || 0).toFixed(8)),
        signal:    parseFloat((signalLine[signalLine.length - 1] || 0).toFixed(8)),
        histogram: parseFloat((histogram[last] || 0).toFixed(8)),
        trend:     histogram[last] > 0 && histogram[last] > (histogram[last - 1] || 0) ? 'bullish' : 'bearish',
    };
}

// ─── Bollinger Bands ─────────────────────────────────────────────────────────

function bollingerBands(data, period = 20, mult = 2) {
    if (data.length < period) return null;
    const slice = tail(data, period);
    const mid   = mean(slice);
    const sd    = std(slice);
    const upper = mid + mult * sd;
    const lower = mid - mult * sd;
    const last  = data[data.length - 1];
    const width = (upper - lower) / mid;
    const pctB  = (last - lower) / (upper - lower);
    return {
        upper: parseFloat(upper.toFixed(8)),
        mid:   parseFloat(mid.toFixed(8)),
        lower: parseFloat(lower.toFixed(8)),
        width: parseFloat(width.toFixed(8)),
        pctB:  parseFloat(pctB.toFixed(8)),
        squeeze: width < 0.015, // Bollinger Squeeze signal
    };
}

// ─── ATR ─────────────────────────────────────────────────────────────────────

function atr(candles, period = 14) {
    if (candles.length < period + 1) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const hl  = candles[i].high - candles[i].low;
        const hpc = Math.abs(candles[i].high - candles[i-1].close);
        const lpc = Math.abs(candles[i].low  - candles[i-1].close);
        trs.push(Math.max(hl, hpc, lpc));
    }
    // Wilder smoothing
    let result = mean(trs.slice(0, period));
    for (let i = period; i < trs.length; i++) {
        result = (result * (period - 1) + trs[i]) / period;
    }
    return parseFloat(result.toFixed(8));
}

// ─── Stochastic ───────────────────────────────────────────────────────────────

function stochastic(candles, kPeriod = 14, dPeriod = 3) {
    if (candles.length < kPeriod) return null;
    const kValues = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const slice = candles.slice(i - kPeriod + 1, i + 1);
        const high  = Math.max(...slice.map(c => c.high));
        const low   = Math.min(...slice.map(c => c.low));
        const close = candles[i].close;
        kValues.push(high === low ? 50 : ((close - low) / (high - low)) * 100);
    }
    const dValues = sma(kValues, dPeriod);
    return {
        k: parseFloat((kValues[kValues.length - 1] || 50).toFixed(2)),
        d: parseFloat((dValues[dValues.length - 1] || 50).toFixed(2)),
    };
}

// ─── ADX ─────────────────────────────────────────────────────────────────────

function adx(candles, period = 14) {
    if (candles.length < period * 2) return null;
    const dmPlus = [], dmMinus = [], trs = [];

    for (let i = 1; i < candles.length; i++) {
        const upMove   = candles[i].high - candles[i-1].high;
        const downMove = candles[i-1].low - candles[i].low;
        dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
        dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
        const hl  = candles[i].high - candles[i].low;
        const hpc = Math.abs(candles[i].high - candles[i-1].close);
        const lpc = Math.abs(candles[i].low  - candles[i-1].close);
        trs.push(Math.max(hl, hpc, lpc));
    }

    let smoothTR = sum(trs.slice(0, period));
    let smoothDMPlus = sum(dmPlus.slice(0, period));
    let smoothDMMinus = sum(dmMinus.slice(0, period));
    const diPlus = [], diMinus = [], dx = [];

    for (let i = period; i < trs.length; i++) {
        smoothTR    = smoothTR - smoothTR / period + trs[i];
        smoothDMPlus  = smoothDMPlus  - smoothDMPlus / period  + dmPlus[i];
        smoothDMMinus = smoothDMMinus - smoothDMMinus / period + dmMinus[i];
        const dip = smoothTR > 0 ? (smoothDMPlus / smoothTR) * 100 : 0;
        const dim = smoothTR > 0 ? (smoothDMMinus / smoothTR) * 100 : 0;
        diPlus.push(dip);
        diMinus.push(dim);
        const di_sum = dip + dim;
        dx.push(di_sum > 0 ? (Math.abs(dip - dim) / di_sum) * 100 : 0);
    }

    const adxValue = dx.length >= period ? mean(tail(dx, period)) : mean(dx);
    return {
        adx:     parseFloat(adxValue.toFixed(2)),
        diPlus:  parseFloat((diPlus[diPlus.length - 1] || 0).toFixed(2)),
        diMinus: parseFloat((diMinus[diMinus.length - 1] || 0).toFixed(2)),
        trend:   adxValue > 25 ? (diPlus[diPlus.length-1] > diMinus[diMinus.length-1] ? 'bullish' : 'bearish') : 'ranging',
    };
}

// ─── OBV (On-Balance Volume) ──────────────────────────────────────────────────

function obv(candles) {
    if (candles.length < 2) return null;
    let val = 0;
    for (let i = 1; i < candles.length; i++) {
        if (candles[i].close > candles[i-1].close) val += candles[i].volume;
        else if (candles[i].close < candles[i-1].close) val -= candles[i].volume;
    }
    // Trend: compare current OBV vs 10-bar ago
    let val10 = 0;
    for (let i = 1; i < candles.length - 10; i++) {
        if (candles[i].close > candles[i-1].close) val10 += candles[i].volume;
        else if (candles[i].close < candles[i-1].close) val10 -= candles[i].volume;
    }
    return {
        value: parseFloat(val.toFixed(0)),
        trend: val > val10 ? 'rising' : 'falling',
    };
}

// ─── CCI ─────────────────────────────────────────────────────────────────────

function cci(candles, period = 20) {
    if (candles.length < period) return null;
    const slice = candles.slice(-period);
    const typicals = slice.map(c => (c.high + c.low + c.close) / 3);
    const m = mean(typicals);
    const meanDev = mean(typicals.map(t => Math.abs(t - m)));
    const last = typicals[typicals.length - 1];
    return parseFloat(((last - m) / (0.015 * meanDev)).toFixed(2));
}

// ─── Williams %R ─────────────────────────────────────────────────────────────

function williamsR(candles, period = 14) {
    if (candles.length < period) return null;
    const slice = candles.slice(-period);
    const highestHigh = Math.max(...slice.map(c => c.high));
    const lowestLow   = Math.min(...slice.map(c => c.low));
    const lastClose   = candles[candles.length - 1].close;
    return parseFloat((((highestHigh - lastClose) / (highestHigh - lowestLow)) * -100).toFixed(2));
}

// ─── VWAP ────────────────────────────────────────────────────────────────────

function vwap(candles) {
    if (candles.length === 0) return null;
    let tpv = 0, totalVol = 0;
    for (const c of candles) {
        const tp = (c.high + c.low + c.close) / 3;
        tpv += tp * c.volume;
        totalVol += c.volume;
    }
    return totalVol > 0 ? parseFloat((tpv / totalVol).toFixed(8)) : null;
}

// ─── EMAs for multi-timeframe trend ──────────────────────────────────────────

function emaSnapshot(candles) {
    const cl = closes(candles);
    const ema8  = tail(ema(cl, 8),  1)[0];
    const ema21 = tail(ema(cl, 21), 1)[0];
    const ema50 = tail(ema(cl, 50), 1)[0];
    const ema200= tail(ema(cl, 200),1)[0];
    const last  = cl[cl.length - 1];
    return {
        ema8:  ema8  ? parseFloat(ema8.toFixed(8)) : null,
        ema21: ema21 ? parseFloat(ema21.toFixed(8)) : null,
        ema50: ema50 ? parseFloat(ema50.toFixed(8)) : null,
        ema200:ema200? parseFloat(ema200.toFixed(8)) : null,
        trend: (ema8 && ema21 && ema50)
            ? (ema8 > ema21 && ema21 > ema50 ? 'bullish'
                : ema8 < ema21 && ema21 < ema50 ? 'bearish' : 'mixed')
            : 'mixed',
        aboveVwap: null, // filled in compute()
    };
}

// ─── Momentum / ROC ──────────────────────────────────────────────────────────

function roc(data, period = 10) {
    if (data.length <= period) return null;
    const last = data[data.length - 1];
    const prev = data[data.length - 1 - period];
    return parseFloat(((last - prev) / prev * 100).toFixed(4));
}

// ─── Main compute function ────────────────────────────────────────────────────

/**
 * Compute a full indicator snapshot from an array of candles.
 * @param {object[]} candles  — OHLCV candles (minimum 30 recommended)
 * @returns {IndicatorSnapshot}
 */
function compute(candles) {
    if (!candles || candles.length < 5) {
        return { error: 'Insufficient candle data' };
    }

    const cl  = closes(candles);
    const last = cl[cl.length - 1];

    const rsiVal    = rsi(cl, 14);
    const macdVal   = macd(cl);
    const bbVal     = bollingerBands(cl);
    const atrVal    = atr(candles);
    const stochVal  = stochastic(candles);
    const adxVal    = adx(candles);
    const obvVal    = obv(candles);
    const cciVal    = cci(candles);
    const wrVal     = williamsR(candles);
    const vwapVal   = vwap(candles);
    const emaSnap   = emaSnapshot(candles);
    const rocVal    = roc(cl, 10);

    // Fill aboveVwap
    if (emaSnap && vwapVal) emaSnap.aboveVwap = last > vwapVal;

    // Composite trend score: -1 (strong bear) … +1 (strong bull)
    let bullSignals = 0, totalSignals = 0;

    if (rsiVal !== null) {
        totalSignals++;
        if (rsiVal < 30) bullSignals++;        // oversold = potential bounce
        else if (rsiVal > 70) bullSignals--;   // overbought = potential reversal
        else if (rsiVal > 50) bullSignals += 0.5;
    }
    if (macdVal) {
        totalSignals++;
        if (macdVal.trend === 'bullish') bullSignals++;
    }
    if (emaSnap) {
        totalSignals++;
        if (emaSnap.trend === 'bullish') bullSignals++;
        else if (emaSnap.trend === 'bearish') bullSignals--;
    }
    if (stochVal) {
        totalSignals++;
        if (stochVal.k < 20) bullSignals++;
        else if (stochVal.k > 80) bullSignals--;
        else if (stochVal.k > stochVal.d) bullSignals += 0.5;
    }
    if (adxVal && adxVal.adx > 20) {
        totalSignals++;
        if (adxVal.trend === 'bullish') bullSignals++;
        else if (adxVal.trend === 'bearish') bullSignals--;
    }
    if (bbVal) {
        totalSignals++;
        if (bbVal.pctB < 0.2) bullSignals++;
        else if (bbVal.pctB > 0.8) bullSignals--;
    }
    if (vwapVal) {
        totalSignals++;
        if (last > vwapVal) bullSignals += 0.5;
        else bullSignals -= 0.5;
    }

    const compositeScore = totalSignals > 0 ? bullSignals / totalSignals : 0;
    const compositeSignal = compositeScore > 0.5 ? 'BULLISH' :
                            compositeScore < -0.1 ? 'BEARISH' : 'NEUTRAL';

    return {
        timestamp:  Date.now(),
        close:      last,
        rsi:        rsiVal,
        macd:       macdVal,
        bb:         bbVal,
        atr:        atrVal,
        stoch:      stochVal,
        adx:        adxVal,
        obv:        obvVal,
        cci:        cciVal,
        williamsR:  wrVal,
        vwap:       vwapVal,
        ema:        emaSnap,
        roc:        rocVal,
        composite: {
            score:   parseFloat(compositeScore.toFixed(4)),
            signal:  compositeSignal,
            bullCount: bullSignals,
            totalChecks: totalSignals,
        },
    };
}

module.exports = { compute, ema, sma, rsi, macd, bollingerBands, atr, stochastic, adx, obv, cci, williamsR, vwap };
