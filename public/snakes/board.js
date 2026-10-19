// Snakes & Ladders board: one SVG drawn per layout, plus pieces that hop, climb and slide.
// Colours come only from CSS classes (snakes.css, tokens.css): nothing here names a colour.
// The SVG node is kept across renders, so a move in progress is never interrupted by a re-render.
(function (root) {
  const C = root.SnakesConfig;
  const NS = 'http://www.w3.org/2000/svg';
  const N = 10;
  const CELL = 100;
  const W = CELL * N;
  const TRAY = 92; // strip under square 1 where pieces wait before they enter the board
  const H = W + TRAY;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.append(e);
    return e;
  }

  function reduced() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // centre of a square (1..100); 0 is the start tray
  function center(sq) {
    if (sq <= 0) return { x: CELL * 0.6, y: W + TRAY / 2 };
    const r = Math.floor((sq - 1) / N);
    const c = (sq - 1) % N;
    const col = r % 2 === 0 ? c : N - 1 - c;
    return { x: col * CELL + CELL / 2, y: W - r * CELL - CELL / 2 };
  }

  const f1 = function (n) { return Math.round(n * 10) / 10; };
  const pt = function (p) { return f1(p.x) + ' ' + f1(p.y); };

  // A snake's spine from its head (t = 0) to its tail (t = 1): a sine wave along the straight line.
  function snakeSpine(head, tail, flip) {
    const a = center(head);
    const b = center(tail);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    const waves = Math.max(1, Math.round(len / 200));
    const amp = Math.min(40, 16 + len * 0.05) * (flip ? -1 : 1);
    return function (t) {
      const o = Math.sin(t * Math.PI * waves) * amp;
      return { x: a.x + dx * t + nx * o, y: a.y + dy * t + ny * o };
    };
  }

  function unitAt(f, t) {
    const p = f(Math.max(0, t - 0.004));
    const q = f(Math.min(1, t + 0.004));
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
  }

  function drawSnake(layer, head, tail, i) {
    const f = snakeSpine(head, tail, i % 2 === 1);
    const g = el('g', { class: 'sl-snake c' + ((i % 5) + 1) }, layer);
    const left = [];
    const right = [];
    const M = 80;
    for (let k = 0; k <= M; k++) {
      const t = k / M;
      const p = f(t);
      const u = unitAt(f, t);
      const w = (30 * (1 - t) + 5 * t) / 2;
      left.push({ x: p.x - u.y * w, y: p.y + u.x * w });
      right.push({ x: p.x + u.y * w, y: p.y - u.x * w });
    }
    const body = 'M' + left.map(pt).join(' L') + ' L' + right.reverse().map(pt).join(' L') + ' Z';
    el('path', { d: body, class: 'shadow', transform: 'translate(5 7)' }, g);
    el('path', { d: body, class: 'body' }, g);
    const spine = [];
    for (let k = 4; k <= 76; k++) spine.push(f(k / M));
    el('path', { d: 'M' + spine.map(pt).join(' L'), class: 'belly' }, g);
    // head: points away from the body
    const a = f(0);
    const u = unitAt(f, 0);
    const d = { x: -u.x, y: -u.y };
    const n = { x: -d.y, y: d.x };
    const ang = Math.atan2(d.y, d.x) * 180 / Math.PI;
    const hc = { x: a.x + d.x * 4, y: a.y + d.y * 4 };
    const tip = { x: a.x + d.x * 30, y: a.y + d.y * 30 };
    el('path', {
      class: 'tongue',
      d: 'M' + pt(tip) + ' L' + pt({ x: tip.x + d.x * 14, y: tip.y + d.y * 14 }) +
        ' M' + pt({ x: tip.x + d.x * 14, y: tip.y + d.y * 14 }) + ' L' + pt({ x: tip.x + d.x * 22 + n.x * 6, y: tip.y + d.y * 22 + n.y * 6 }) +
        ' M' + pt({ x: tip.x + d.x * 14, y: tip.y + d.y * 14 }) + ' L' + pt({ x: tip.x + d.x * 22 - n.x * 6, y: tip.y + d.y * 22 - n.y * 6 }),
    }, g);
    el('ellipse', { cx: f1(hc.x), cy: f1(hc.y), rx: 27, ry: 21, transform: 'rotate(' + f1(ang) + ' ' + pt(hc) + ')', class: 'head' }, g);
    [1, -1].forEach(function (side) {
      const e = { x: a.x + d.x * 11 + n.x * 10 * side, y: a.y + d.y * 11 + n.y * 10 * side };
      el('circle', { cx: f1(e.x), cy: f1(e.y), r: 6.5, class: 'eye' }, g);
      el('circle', { cx: f1(e.x + d.x * 2), cy: f1(e.y + d.y * 2), r: 3.2, class: 'pupil' }, g);
    });
    return f;
  }

  function drawLadder(layer, from, to) {
    const a = center(from);
    const b = center(to);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    const half = 19;
    const inset = 14;
    const s = { x: a.x - u.x * inset, y: a.y - u.y * inset };
    const e = { x: b.x + u.x * inset, y: b.y + u.y * inset };
    const g = el('g', { class: 'sl-ladder' }, layer);
    const rails = function (cls, ox, oy) {
      [1, -1].forEach(function (side) {
        el('line', {
          x1: f1(s.x + n.x * half * side + ox), y1: f1(s.y + n.y * half * side + oy),
          x2: f1(e.x + n.x * half * side + ox), y2: f1(e.y + n.y * half * side + oy), class: cls,
        }, g);
      });
    };
    const total = len + inset * 2;
    const steps = Math.max(2, Math.round(total / 40));
    const rungs = function (cls, ox, oy) {
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const c = { x: s.x + (e.x - s.x) * t + ox, y: s.y + (e.y - s.y) * t + oy };
        el('line', { x1: f1(c.x + n.x * half), y1: f1(c.y + n.y * half), x2: f1(c.x - n.x * half), y2: f1(c.y - n.y * half), class: cls }, g);
      }
    };
    rungs('shadow rung', 5, 7);
    rails('shadow rail', 5, 7);
    rungs('rung', 0, 0);
    rails('rail', 0, 0);
  }

  // where each piece sits inside its square when several share it
  const OFFS = {
    1: [[0, 0]],
    2: [[-20, -6], [20, 6]],
    3: [[-21, 13], [21, 13], [0, -19]],
    4: [[-22, -22], [22, -22], [-22, 22], [22, 22]],
    5: [[-27, -21], [0, -21], [27, -21], [-14, 21], [14, 21]],
    6: [[-28, -21], [0, -21], [28, -21], [-28, 21], [0, 21], [28, 21]],
  };
  const SCALE = { 1: 1, 2: 0.78, 3: 0.68, 4: 0.64, 5: 0.54, 6: 0.5 };

  function create() {
    const svgEl = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'sl-svg', role: 'img', 'aria-label': 'لوحة حية ودرج' });
    const squares = el('g', { class: 'sl-squares' }, svgEl);
    const jumps = el('g', { class: 'sl-jumps' }, svgEl);
    const marks = el('g', { class: 'sl-marks' }, svgEl);
    const pieces = el('g', { class: 'sl-pieces' }, svgEl);
    const api = { el: svgEl, board: null };
    const P = {}; // id -> {g, x, y, s, moving}
    let spines = {}; // snake head -> spine function
    let shown = {}; // id -> square the piece is drawn on

    function build(boardName) {
      if (api.board === boardName) return;
      api.board = boardName;
      const B = C.BOARDS[boardName];
      squares.replaceChildren();
      jumps.replaceChildren();
      marks.replaceChildren();
      spines = {};
      el('rect', { x: -8, y: -8, width: W + 16, height: H + 16, rx: 26, class: 'frame' }, squares);
      for (let sq = 1; sq <= C.SQUARES; sq++) {
        const c = center(sq);
        const r = Math.floor((sq - 1) / N);
        el('rect', { x: c.x - CELL / 2, y: c.y - CELL / 2, width: CELL, height: CELL, class: 'sq r' + (r % 5) + (sq % 2 ? ' a' : ' b') + (sq === C.SQUARES ? ' goal' : '') }, squares);
        const t = el('text', { x: c.x - CELL / 2 + 9, y: c.y - CELL / 2 + 27, class: 'sq-n' }, squares);
        t.textContent = String(sq);
      }
      // the goal: a star on 100
      const g = center(C.SQUARES);
      const star = [];
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? 15 : 34;
        const a = -Math.PI / 2 + k * Math.PI / 5;
        star.push({ x: g.x + Math.cos(a) * rr, y: g.y + 8 + Math.sin(a) * rr });
      }
      el('path', { d: 'M' + star.map(pt).join(' L') + ' Z', class: 'goal-star' }, squares);
      // start tray
      el('rect', { x: 0, y: W + 10, width: W, height: TRAY - 14, rx: 18, class: 'tray' }, squares);
      const lbl = el('text', { x: W - 24, y: W + TRAY / 2 + 9, class: 'tray-l' }, squares);
      lbl.textContent = 'البداية ↑';
      Object.keys(B.ladders).forEach(function (f) { drawLadder(jumps, +f, B.ladders[f]); });
      Object.keys(B.snakes).forEach(function (h, i) { spines[h] = drawSnake(jumps, +h, B.snakes[h], i); });
    }

    function place(p, x, y, s) {
      p.x = x; p.y = y; p.s = s;
      p.g.setAttribute('transform', 'translate(' + f1(x) + ' ' + f1(y) + ') scale(' + s + ')');
    }

    // ids: [{id, token, name}] in seat order. Adds and removes pieces, refreshes colours and initials.
    function setPlayers(list) {
      const keep = {};
      list.forEach(function (pl, i) {
        keep[pl.id] = true;
        let p = P[pl.id];
        if (!p) {
          const g = el('g', { class: 'sl-pc', 'data-id': pl.id }, pieces);
          el('ellipse', { cx: 0, cy: 30, rx: 26, ry: 8, class: 'sh' }, g);
          el('circle', { r: 42, class: 'ring' }, g);
          el('circle', { r: 32, class: 'body' }, g);
          el('circle', { r: 23, class: 'inner' }, g);
          const t = el('text', { y: 11, class: 'ini' }, g);
          p = P[pl.id] = { g: g, t: t, x: center(0).x, y: center(0).y, s: 1, moving: false, seat: i };
        }
        p.seat = i;
        p.token = pl.token || C.COLORS[i % C.COLORS.length];
        p.g.setAttribute('class', 'sl-pc tok-' + (pl.token || C.COLORS[i % C.COLORS.length]) + (p.cur ? ' cur' : '') + (p.moving ? ' moving' : '') + (p.g.classList.contains('ping') ? ' ping' : ''));
        p.t.textContent = Array.from(pl.name || '؟')[0];
        p.g.setAttribute('aria-label', pl.name || '');
      });
      Object.keys(P).forEach(function (id) { if (!keep[id]) { P[id].g.remove(); delete P[id]; delete shown[id]; } });
    }

    function setCurrent(id) {
      Object.keys(P).forEach(function (k) {
        P[k].cur = k === id;
        P[k].g.classList.toggle('cur', P[k].cur);
      });
    }

    // the resting spot of every piece that is not moving, given the squares they are drawn on
    function spots() {
      const groups = {};
      Object.keys(P).forEach(function (id) {
        const sq = shown[id] || 0;
        (groups[sq] = groups[sq] || []).push(id);
      });
      const out = {};
      Object.keys(groups).forEach(function (sq) {
        const ids = groups[sq].sort(function (a, b) { return P[a].seat - P[b].seat; });
        const c = center(+sq);
        if (+sq === 0) {
          ids.forEach(function (id, i) { out[id] = { x: c.x + i * 84, y: c.y, s: 0.9 }; });
          return;
        }
        const offs = OFFS[Math.min(6, ids.length)];
        const sc = SCALE[Math.min(6, ids.length)];
        ids.forEach(function (id, i) { out[id] = { x: c.x + offs[i][0], y: c.y + offs[i][1], s: sc }; });
      });
      return out;
    }

    // tween one piece; f(t) gives the point, hop lifts it in an arc
    function tween(p, ms, f, hop, s1) {
      return new Promise(function (resolve) {
        const s0 = p.s;
        if (reduced() || document.hidden || ms <= 0) { const e = f(1); place(p, e.x, e.y, s1); resolve(); return; }
        const t0 = performance.now();
        let done = false;
        const step = function (now) {
          if (done) return;
          const t = Math.min(1, (now - t0) / ms);
          const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const q = f(k);
          place(p, q.x, q.y - Math.sin(Math.PI * t) * (hop || 0), s0 + (s1 - s0) * k);
          if (t < 1) requestAnimationFrame(step); else { done = true; resolve(); }
        };
        requestAnimationFrame(step);
        setTimeout(function () { if (!done) { done = true; const e = f(1); place(p, e.x, e.y, s1); resolve(); } }, ms + 600);
      });
    }

    function line(a, b) { return function (t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }; }

    // move every resting piece to its spot (after someone arrives or leaves a square)
    function relayout(ms) {
      const sp = spots();
      return Promise.all(Object.keys(P).map(function (id) {
        const p = P[id];
        if (p.moving || !sp[id]) return null;
        const to = sp[id];
        if (Math.abs(p.x - to.x) < 0.5 && Math.abs(p.y - to.y) < 0.5 && p.s === to.s) return null;
        return tween(p, ms === undefined ? 180 : ms, line({ x: p.x, y: p.y }, to), 0, to.s);
      }));
    }

    function lift(id) {
      const p = P[id];
      p.moving = true;
      p.g.classList.add('moving');
      pieces.append(p.g); // on top of the others
      return p;
    }
    function land(id, sq) {
      const p = P[id];
      shown[id] = sq;
      p.moving = false;
      p.g.classList.remove('moving');
      flash(sq, p.token);
      return relayout();
    }

    // the square a piece just reached glows in its colour for a moment
    function flash(sq, token) {
      if (!sq || reduced()) return;
      const c = center(sq);
      const r = el('rect', { x: c.x - CELL / 2 + 3, y: c.y - CELL / 2 + 3, width: CELL - 6, height: CELL - 6, rx: 10, class: 'sl-flash tok-' + (token || 'red') }, marks);
      setTimeout(function () { r.remove(); }, 1100);
    }

    // "where is my piece?": its ring pulses a few times
    function ping(id) {
      const p = P[id];
      if (!p) return;
      p.g.classList.remove('ping');
      void p.g.getBoundingClientRect(); // restart the animation
      p.g.classList.add('ping');
      pieces.append(p.g);
      clearTimeout(p.pingTimer);
      p.pingTimer = setTimeout(function () { p.g.classList.remove('ping'); }, 1900);
    }

    // snap every piece to these squares (first view, reconnect, or after a burst of moves)
    function setPositions(positions, ms) {
      Object.keys(P).forEach(function (id) { if (!P[id].moving && positions[id] !== undefined) shown[id] = positions[id]; });
      return relayout(ms);
    }

    // walk square by square; onStep(i) runs as each square is reached
    function hop(id, path, stepMs, onStep) {
      const p = P[id];
      if (!p || !path.length) return Promise.resolve();
      lift(id);
      const sz = 1.08;
      let chain = tween(p, 90, line({ x: p.x, y: p.y }, center(shown[id] || 0)), 0, sz);
      path.forEach(function (sq, i) {
        chain = chain.then(function () {
          const a = { x: p.x, y: p.y };
          return tween(p, stepMs, line(a, center(sq)), 26, sz).then(function () { if (onStep) onStep(i, sq); });
        });
      });
      return chain.then(function () { return land(id, path[path.length - 1]); });
    }

    // up a ladder or down a snake
    function slide(id, kind, from, to, ms) {
      const p = P[id];
      if (!p) return Promise.resolve();
      lift(id);
      const f = kind === 'snake' && spines[from] ? spines[from] : line(center(from), center(to));
      return tween(p, 120, line({ x: p.x, y: p.y }, f(0)), 0, 1.08)
        .then(function () { return tween(p, ms, f, 0, 1.08); })
        .then(function () { return land(id, to); });
    }

    // straight there in one big jump (three sixes in a row)
    function leap(id, to, ms) {
      const p = P[id];
      if (!p) return Promise.resolve();
      lift(id);
      return tween(p, ms, line({ x: p.x, y: p.y }, center(to)), 140, 1.08).then(function () { return land(id, to); });
    }

    // a little shake when the piece cannot move
    function shake(id) {
      const p = P[id];
      if (!p || reduced()) return Promise.resolve();
      const x = p.x;
      const y = p.y;
      return tween(p, 260, function (t) { return { x: x + Math.sin(t * Math.PI * 6) * 9, y: y }; }, 0, p.s);
    }

    api.build = build;
    api.setPlayers = setPlayers;
    api.setCurrent = setCurrent;
    api.setPositions = setPositions;
    api.hop = hop;
    api.slide = slide;
    api.leap = leap;
    api.shake = shake;
    api.ping = ping;
    api.shown = function () { return Object.assign({}, shown); };
    return api;
  }

  // ---------- the die: a CSS cube; roll(value) spins it and lands on that face ----------

  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const FACE = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] }; // rotateX, rotateY to show a face

  function die() {
    const wrap = document.createElement('div');
    wrap.className = 'sl-die';
    const cube = document.createElement('div');
    cube.className = 'cube';
    wrap.append(cube);
    [1, 2, 3, 4, 5, 6].forEach(function (v) {
      const f = document.createElement('div');
      f.className = 'face f' + v;
      for (let k = 1; k <= 9; k++) {
        const b = document.createElement('i');
        if (PIPS[v].indexOf(k) >= 0) b.className = 'on';
        f.append(b);
      }
      cube.append(f);
    });
    let rx = -20;
    let ry = 25;
    let value = 1;
    const tf = function (x, y) { return 'rotateX(' + x + 'deg) rotateY(' + y + 'deg)'; };
    cube.style.transform = tf(rx + FACE[1][0], ry + FACE[1][1]);
    return {
      el: wrap,
      value: function () { return value; },
      show: function (v) { value = v; cube.style.transform = tf(rx + FACE[v][0], ry + FACE[v][1]); },
      roll: function (v, ms) {
        value = v;
        const from = cube.style.transform;
        const spins = 2 + Math.floor(Math.random() * 2);
        const to = tf(rx + FACE[v][0] + 360 * spins, ry + FACE[v][1] + 360 * (spins - 1));
        cube.style.transform = tf(rx + FACE[v][0], ry + FACE[v][1]);
        if (reduced() || document.hidden || !cube.animate) return Promise.resolve();
        wrap.classList.add('rolling');
        return new Promise(function (resolve) {
          const a = cube.animate([{ transform: from }, { transform: to }], { duration: ms || 700, easing: 'cubic-bezier(.2,.75,.25,1)' });
          let done = false;
          const fin = function () { if (done) return; done = true; wrap.classList.remove('rolling'); resolve(); };
          a.onfinish = fin;
          setTimeout(fin, (ms || 700) + 400);
        });
      },
    };
  }

  root.SnakesBoard = { create: create, die: die, center: center };
})(window);
