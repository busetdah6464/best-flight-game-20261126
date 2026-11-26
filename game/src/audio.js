// Sky Courier sound: everything is synthesised live with WebAudio — an
// engine drone that follows the throttle, wind noise that follows the
// speed, a chime for each ring and a thud for the landing. No audio files.

export function makeAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineGain = null;
  let windSource = null;
  let windGain = null;
  let windFilter = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    } catch (e) {
      return false;
    }
    // Engine: two detuned saws through a low-pass filter.
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 60;
    const engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'sawtooth';
    engineOsc2.frequency.value = 61.5;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(ctx.destination);
    engineOsc.start();
    engineOsc2.start();
    // Wind: looped noise through a band-pass filter.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    windSource = ctx.createBufferSource();
    windSource.buffer = buffer;
    windSource.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ctx.destination);
    windSource.start();
    return true;
  }

  function tone(freq, dur, type, vol, when) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + (when || 0);
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  return {
    // Call on the first user gesture; browsers block audio before it.
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    update(throttle, speed, flying) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(flying || throttle > 0.05 ? 0.05 + throttle * 0.06 : 0.0, t, 0.1);
      engineOsc.frequency.setTargetAtTime(55 + throttle * 75 + speed * 0.35, t, 0.1);
      windGain.gain.setTargetAtTime(flying ? Math.min(0.12, speed * 0.0012) : 0, t, 0.2);
      windFilter.frequency.setTargetAtTime(500 + speed * 9, t, 0.2);
    },
    ring() {
      tone(880, 0.35, 'sine', 0.22);
      tone(1318, 0.5, 'sine', 0.18, 0.08);
    },
    land() {
      tone(180, 0.25, 'sine', 0.3);
      tone(90, 0.4, 'triangle', 0.25, 0.05);
    },
    crash() {
      tone(70, 0.7, 'sawtooth', 0.3);
      tone(45, 0.9, 'triangle', 0.25, 0.1);
    },
    click() {
      tone(660, 0.08, 'square', 0.08);
    },
    toggleMute() {
      muted = !muted;
      if (ctx) {
        engineGain.gain.value = 0;
        windGain.gain.value = 0;
      }
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
