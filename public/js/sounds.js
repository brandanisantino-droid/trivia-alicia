// Sonidos simples generados por código (sin archivos de audio, sin depender de internet).
window.AliciaSounds = (function () {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    return ctx;
  }

  function unlock() {
    const c = getCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }

  function tone(freq, duration, { type = "sine", peak = 0.2, delay = 0 } = {}) {
    const c = getCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = c.currentTime + delay;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  return {
    unlock,
    tick() {
      tone(880, 0.07, { type: "square", peak: 0.07 });
    },
    reveal() {
      tone(659.25, 0.1, { peak: 0.2 });
      tone(987.77, 0.18, { peak: 0.2, delay: 0.1 });
    },
    correct() {
      tone(523.25, 0.12, { peak: 0.22 });
      tone(659.25, 0.12, { peak: 0.22, delay: 0.1 });
      tone(783.99, 0.22, { peak: 0.22, delay: 0.2 });
    },
    wrong() {
      tone(196, 0.28, { type: "sawtooth", peak: 0.16 });
      tone(174.61, 0.3, { type: "sawtooth", peak: 0.14, delay: 0.08 });
    },
    gameStart() {
      tone(392, 0.12, { peak: 0.2 });
      tone(523.25, 0.12, { peak: 0.2, delay: 0.12 });
      tone(659.25, 0.22, { peak: 0.2, delay: 0.24 });
    },
    finale() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.28, { peak: 0.22, delay: i * 0.13 }));
    },
  };
})();
