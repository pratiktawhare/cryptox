/**
 * soundAlert.js
 *
 * Synthesises notification sounds using the Web Audio API.
 * No external sound files needed.
 *
 * Sound types:
 *   signal_high   — 3-tone ascending chime  (high-confidence AI signal)
 *   signal_normal — 2-tone chime            (medium-confidence signal)
 *   target_hit    — 3-tone major chord up   (TP achieved — victory)
 *   stoploss_hit  — 2-tone descending low   (SL hit — warning)
 */

let _ctx = null;

function getCtx() {
    if (!_ctx) {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume context if suspended (browser autoplay policy)
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
}

function beep(freq, startTime, duration, gainVal = 0.4, type = 'sine') {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.connect(env);
    env.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(gainVal, startTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
}

const sounds = {
    signal_high(ctx) {
        const t = ctx.currentTime;
        beep(660, t,       0.15, 0.4);
        beep(880, t + 0.18, 0.15, 0.4);
        beep(1100, t + 0.36, 0.20, 0.5);
    },
    signal_normal(ctx) {
        const t = ctx.currentTime;
        beep(660, t,       0.15, 0.3);
        beep(880, t + 0.18, 0.15, 0.3);
    },
    target_hit(ctx) {
        const t = ctx.currentTime;
        beep(523, t,       0.12, 0.3); // C5
        beep(659, t + 0.14, 0.12, 0.3); // E5
        beep(784, t + 0.28, 0.20, 0.5); // G5
    },
    stoploss_hit(ctx) {
        const t = ctx.currentTime;
        beep(400, t,       0.20, 0.4, 'sawtooth');
        beep(280, t + 0.22, 0.30, 0.4, 'sawtooth');
    },
};

/**
 * Play a named sound effect.
 * @param {string} name - one of the keys in `sounds`
 */
export function playSound(name) {
    try {
        if (!name || !sounds[name]) return;
        const ctx = getCtx();
        sounds[name](ctx);
    } catch (err) {
        // Non-fatal — user may not have interacted with the page yet
        console.warn('[SoundAlert] could not play sound:', name, err.message);
    }
}