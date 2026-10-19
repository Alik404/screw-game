// Short sounds generated with Web Audio (no audio files). Mute choice is kept in localStorage.
(function (root) {
  const KEY = 'screw.muted';
  let ctx = null;
  let muted = false;
  try { muted = root.localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }

  function audio() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Browsers only allow audio after a user gesture: unlock on the first tap.
  function unlock() {
    audio();
    root.removeEventListener('pointerdown', unlock);
    root.removeEventListener('keydown', unlock);
  }
  root.addEventListener('pointerdown', unlock);
  root.addEventListener('keydown', unlock);

  function noise(c, seconds) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function env(c, node, t, peak, attack, decay) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(c.destination);
    return g;
  }

  function tone(c, type, f1, f2, t, dur, peak) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    env(c, o, t, peak, 0.01, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    // card hitting the table: filtered noise slap
    throw: function (c, t) {
      const n = noise(c, 0.12);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      n.connect(f);
      env(c, f, t, 0.5, 0.004, 0.11);
      n.start(t);
    },
    // card turning over: short bright tick
    flip: function (c, t) {
      const n = noise(c, 0.05);
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 2500;
      n.connect(f);
      env(c, f, t, 0.25, 0.002, 0.045);
      n.start(t);
    },
    // very soft tick while dealing
    deal: function (c, t) {
      const n = noise(c, 0.03);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 3200;
      n.connect(f);
      env(c, f, t, 0.12, 0.002, 0.03);
      n.start(t);
    },
    // my turn: two rising notes
    turn: function (c, t) {
      tone(c, 'sine', 660, 0, t, 0.14, 0.18);
      tone(c, 'sine', 990, 0, t + 0.12, 0.2, 0.16);
    },
    // screw: a heavy falling sweep with a thump
    screw: function (c, t) {
      tone(c, 'sawtooth', 330, 70, t, 0.6, 0.18);
      tone(c, 'sine', 110, 45, t, 0.45, 0.4);
      const n = noise(c, 0.2);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      n.connect(f);
      env(c, f, t, 0.35, 0.005, 0.2);
      n.start(t);
    },
    // dice rattling in a cup: a few quick knocks
    dice: function (c, t) {
      [0, 0.07, 0.15, 0.26, 0.4].forEach(function (d, i) {
        const n = noise(c, 0.04);
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1400 + i * 260;
        n.connect(f);
        env(c, f, t + d, 0.32 - i * 0.04, 0.002, 0.035);
        n.start(t + d);
      });
    },
    // a piece landing on a square: a soft wooden tock
    step: function (c, t) {
      tone(c, 'triangle', 520, 380, t, 0.07, 0.12);
    },
    // climbing a ladder: quick rising notes
    ladder: function (c, t) {
      [523, 659, 784, 1047].forEach(function (f, i) { tone(c, 'triangle', f, 0, t + i * 0.08, 0.16, 0.16); });
    },
    // a snake: a hiss and a falling slide
    snake: function (c, t) {
      const n = noise(c, 0.45);
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 4200;
      n.connect(f);
      env(c, f, t, 0.18, 0.05, 0.4);
      n.start(t);
      tone(c, 'sine', 700, 120, t + 0.12, 0.7, 0.2);
    },
    // a domino tile put down on the table: a hard double click
    clack: function (c, t) {
      [0, 0.035].forEach(function (d, i) {
        const n = noise(c, 0.05);
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = i ? 2300 : 3400;
        f.Q.value = 3;
        n.connect(f);
        env(c, f, t + d, i ? 0.35 : 0.55, 0.001, 0.045);
        n.start(t + d);
      });
      tone(c, 'sine', 180, 120, t, 0.06, 0.12);
    },
    // knocking on the table: "I pass"
    knock: function (c, t) {
      [0, 0.16].forEach(function (d) {
        tone(c, 'sine', 140, 90, t + d, 0.09, 0.35);
        const n = noise(c, 0.04);
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        n.connect(f);
        env(c, f, t + d, 0.3, 0.001, 0.04);
        n.start(t + d);
      });
    },
    // the electronic edition of "Minhu?": square-wave beeps like a handheld toy
    'e-beep': function (c, t) { tone(c, 'square', 988, 0, t, 0.07, 0.05); tone(c, 'square', 1319, 0, t + 0.09, 0.08, 0.05); },
    'e-tick': function (c, t) { tone(c, 'square', 1600, 900, t, 0.025, 0.04); },
    'e-yes': function (c, t) { [784, 988, 1319].forEach(function (f, i) { tone(c, 'square', f, 0, t + i * 0.09, 0.08, 0.05); }); },
    'e-no': function (c, t) { tone(c, 'sawtooth', 220, 150, t, 0.38, 0.07); tone(c, 'square', 110, 90, t, 0.38, 0.04); },
    'e-boot': function (c, t) { [523, 659, 784, 1047, 1568].forEach(function (f, i) { tone(c, 'square', f, 0, t + i * 0.07, 0.06, 0.045); }); },
    'e-jingle': function (c, t) {
      [784, 988, 1175, 1568, 1175, 1568].forEach(function (f, i) { tone(c, 'square', f, 0, t + i * 0.11, i === 5 ? 0.4 : 0.09, 0.05); });
    },
    // the winner: a short fanfare
    win: function (c, t) {
      [523, 659, 784, 1047, 784, 1047].forEach(function (f, i) {
        tone(c, 'triangle', f, 0, t + i * 0.12, i === 5 ? 0.5 : 0.14, 0.18);
      });
    },
  };

  function play(name, delayMs) {
    if (muted || !SOUNDS[name]) return;
    const c = audio();
    if (!c || c.state !== 'running') return;
    try { SOUNDS[name](c, c.currentTime + (delayMs || 0) / 1000); } catch (e) { /* ignore */ }
  }

  function setMuted(v) {
    muted = !!v;
    try { root.localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  root.ScrewSound = { play: play, isMuted: function () { return muted; }, setMuted: setMuted };
})(window);
