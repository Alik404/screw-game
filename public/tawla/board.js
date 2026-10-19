// Tawla board: one SVG (wooden frame, inlaid points, checkers, dice) seen from my side: my home is at
// the bottom right and my checkers run 24 -> 1 on screen, whichever colour I play. Colours come from CSS.
// The board picks moves (tap a checker then a point, or drag it) and animates every step.
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000;
  let H = 760; // grows on tall screens (see fit): the points get longer
  const F = 18; // frame
  const BW = 56; // bar
  const TR = 64; // bear-off tray
  const PW = (W - F * 3 - BW - TR) / 12; // one point
  const LX0 = F;
  const LX1 = F + 6 * PW;
  const BX0 = LX1;
  const BX1 = BX0 + BW;
  const RX0 = BX1;
  const RX1 = RX0 + 6 * PW;
  const TX0 = RX1 + F;
  const TX1 = TX0 + TR;
  const TOP = F;
  let BOT = H - F;
  let PH = 300;
  const R = 31;
  let MIDY = H / 2;
  function setHeight(h) {
    H = h;
    BOT = H - F;
    MIDY = H / 2;
    PH = Math.round((H - 2 * F - 124) / 2);
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.append(e);
    return e;
  }
  const r1 = function (n) { return Math.round(n * 10) / 10; };
  function reduced() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  // screen point (1..24 from my side) -> column centre
  function colX(dp) {
    if (dp <= 6) return RX1 - (dp - 0.5) * PW;
    if (dp <= 12) return LX1 - (dp - 6.5) * PW;
    if (dp <= 18) return LX0 + (dp - 12.5) * PW;
    return RX0 + (dp - 18.5) * PW;
  }
  const isTop = function (dp) { return dp >= 13; };
  function stackStep(n) { return n <= 5 ? 2 * R - 2 : (PH - 2 * R) / (n - 1); }
  function stackXY(dp, k, n) {
    const st = stackStep(Math.max(n, 1));
    return { x: colX(dp), y: isTop(dp) ? TOP + R + k * st : BOT - R - k * st };
  }
  function barXY(mine, k, n) {
    const st = Math.min(2 * R - 4, 230 / Math.max(n, 1));
    return { x: (BX0 + BX1) / 2, y: mine ? TOP + R + 34 + k * st : BOT - R - 34 - k * st };
  }
  function offXY(mine, k) {
    return { x: (TX0 + TX1) / 2, y: mine ? BOT - 12 - k * 19 : TOP + 12 + k * 19 };
  }

  const PIPS = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 25], [28, 50], [28, 75], [72, 25], [72, 50], [72, 75]] };

  function dieMarkup(v, size) {
    let s = '<rect class="die-sh" x="2" y="5" width="' + size + '" height="' + size + '" rx="' + size * 0.2 + '"/>' +
      '<rect class="die-body" width="' + size + '" height="' + size + '" rx="' + size * 0.2 + '"/>';
    (PIPS[v] || []).forEach(function (p) { s += '<circle class="die-pip" cx="' + r1(p[0] / 100 * size) + '" cy="' + r1(p[1] / 100 * size) + '" r="' + r1(size * 0.095) + '"/>'; });
    return s;
  }

  function create(opts) {
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'tw-svg', role: 'img', 'aria-label': 'لوحة الطاولي' });
    svg.innerHTML = '<defs>' +
      '<pattern id="tw-grain" width="120" height="14" patternUnits="userSpaceOnUse"><rect width="120" height="14" class="tw-grain-bg"/><path class="tw-grain-l" d="M0 4 Q30 2 60 5 T120 4 M0 10 Q40 12 80 9 T120 11"/></pattern>' +
      '<pattern id="tw-grain2" width="160" height="18" patternUnits="userSpaceOnUse"><rect width="160" height="18" class="tw-grain2-bg"/><path class="tw-grain2-l" d="M0 5 Q40 3 80 6 T160 5 M0 13 Q60 15 100 12 T160 14"/></pattern>' +
      '<radialGradient id="tw-c0" cx="0.38" cy="0.32" r="0.75"><stop offset="0" class="tw-c0a"/><stop offset="1" class="tw-c0b"/></radialGradient>' +
      '<radialGradient id="tw-c1" cx="0.38" cy="0.32" r="0.75"><stop offset="0" class="tw-c1a"/><stop offset="1" class="tw-c1b"/></radialGradient>' +
      '<linearGradient id="tw-die" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" class="tw-da"/><stop offset="1" class="tw-db"/></linearGradient>' +
      '</defs>';
    const gBoard = el('g', { class: 'tw-wood' }, svg);
    const gMarks = el('g', { class: 'tw-marks' }, svg);
    const gCk = el('g', { class: 'tw-checkers' }, svg);
    const gDice = el('g', { class: 'tw-dice' }, svg);
    const gTop = el('g', { class: 'tw-top' }, svg); // flying checkers, drag ghost
    let seat = 0;
    let pos = null;
    let inter = { legal: [], paths: [], enabled: false };
    let sel = null; // actual point the selected checker comes from
    let drag = null;
    let hidden = null; // {a, k}: a checker lifted by a drag or a flight

    // ---------- the wooden board ----------
    function drawBoard() {
      gBoard.innerHTML = '';
      el('rect', { x: 0, y: 0, width: W, height: H, rx: 26, class: 'frame' }, gBoard);
      el('rect', { x: 6, y: 6, width: W - 12, height: H - 12, rx: 22, class: 'frame-in' }, gBoard);
      [[LX0, LX1], [RX0, RX1]].forEach(function (h) { el('rect', { x: h[0], y: TOP, width: h[1] - h[0], height: BOT - TOP, rx: 6, class: 'surface' }, gBoard); });
      el('rect', { x: BX0, y: TOP - 4, width: BW, height: BOT - TOP + 8, class: 'bar' }, gBoard);
      el('line', { x1: (BX0 + BX1) / 2, y1: TOP + 8, x2: (BX0 + BX1) / 2, y2: BOT - 8, class: 'bar-seam' }, gBoard);
      el('rect', { x: TX0, y: TOP, width: TX1 - TX0, height: BOT - TOP, rx: 10, class: 'tray' }, gBoard);
      el('line', { x1: TX0 + 6, y1: MIDY, x2: TX1 - 6, y2: MIDY, class: 'tray-seam' }, gBoard);
      for (let dp = 1; dp <= 24; dp++) {
        const x = colX(dp);
        const top = isTop(dp);
        const y0 = top ? TOP : BOT;
        const y1 = top ? TOP + PH : BOT - PH;
        const d = 'M' + r1(x - PW / 2 + 2) + ' ' + y0 + ' L' + r1(x + PW / 2 - 2) + ' ' + y0 + ' L' + r1(x) + ' ' + y1 + ' Z';
        el('path', { d: d, class: 'pt ' + (dp % 2 ? 'a' : 'b') }, gBoard);
        el('path', { d: d, class: 'pt-edge' }, gBoard);
      }
      // brass studs on the corners and the hinges
      [[14, 14], [W - 14, 14], [14, H - 14], [W - 14, H - 14], [(BX0 + BX1) / 2, 9], [(BX0 + BX1) / 2, H - 9]].forEach(function (c) {
        el('circle', { cx: c[0], cy: c[1], r: 5.5, class: 'stud' }, gBoard);
      });
    }

    // ---------- checkers ----------
    function dpOf(a) { return seat === 0 ? a : 25 - a; }
    function aOf(dp) { return seat === 0 ? dp : 25 - dp; }
    const myBar = function () { return seat === 0 ? 25 : 0; };
    const myOff = function () { return seat === 0 ? 0 : 25; };

    function checker(color, x, y, extra) {
      const g = el('g', { class: 'tw-ck c' + color + (extra ? ' ' + extra : ''), transform: 'translate(' + r1(x) + ' ' + r1(y) + ')' });
      el('circle', { class: 'sh', cy: 4, r: R }, g);
      el('circle', { class: 'body', r: R }, g);
      el('circle', { class: 'ring', r: R - 7 }, g);
      el('circle', { class: 'ring2', r: R - 15 }, g);
      el('ellipse', { class: 'hi', cx: -9, cy: -12, rx: 12, ry: 7 }, g);
      return g;
    }

    // where checker number k (0 = bottom of the stack) of point / bar / off sits right now
    function slot(where, k, n) {
      if (where.kind === 'bar') return barXY(where.p === seat, k, n);
      if (where.kind === 'off') return offXY(where.p === seat, k);
      return stackXY(dpOf(where.a), k, n);
    }

    function render() {
      gCk.innerHTML = '';
      if (!pos) return;
      for (let a = 1; a <= 24; a++) {
        const v = pos.pts[a];
        const n = Math.abs(v);
        if (!n) continue;
        const color = v > 0 ? 0 : 1;
        for (let k = 0; k < n; k++) {
          if (hidden && hidden.a === a && k === n - 1) continue;
          const xy = stackXY(dpOf(a), k, n);
          const g = checker(color, xy.x, xy.y);
          if (k === n - 1 && n > 5) { const t = el('text', { class: 'cnt', y: 9 }, g); t.textContent = n; }
          gCk.append(g);
        }
      }
      [0, 1].forEach(function (p) {
        for (let k = 0; k < pos.bar[p]; k++) {
          if (hidden && hidden.a === 'bar' + p && k === pos.bar[p] - 1) continue;
          const xy = barXY(p === seat, k, pos.bar[p]);
          gCk.append(checker(p, xy.x, xy.y, 'onbar'));
        }
        for (let k = 0; k < pos.off[p]; k++) {
          const xy = offXY(p === seat, k);
          el('rect', { x: r1(xy.x - 26), y: r1(xy.y - 8), width: 52, height: 16, rx: 5, class: 'tw-slab c' + p }, gCk);
        }
      });
      marks();
    }

    // ---------- choosing a move ----------
    function sources() {
      const out = {};
      inter.legal.forEach(function (m) { out[m.from] = true; });
      return out;
    }
    // destinations of the selected checker: to -> dice to play (one die, or several for a long move)
    function targets(from) {
      const out = {};
      inter.legal.forEach(function (m) {
        if (m.from !== from) return;
        if (!out[m.to] || m.die < out[m.to][0]) out[m.to] = [m.die]; // bearing off: the smaller die that works
      });
      inter.paths.forEach(function (pth) { if (pth.from === from && !out[pth.to]) out[pth.to] = pth.dice; });
      return out;
    }

    function topOf(a) {
      if (a === myBar()) { const n = pos.bar[seat]; return n ? barXY(true, n - 1, n) : null; }
      const n = Math.abs(pos.pts[a]);
      return n ? stackXY(dpOf(a), n - 1, n) : null;
    }

    function marks() {
      gMarks.innerHTML = '';
      gTop.querySelectorAll('.tw-src').forEach(function (e) { e.remove(); });
      if (!inter.enabled || !pos) return;
      const src = sources();
      // movable checkers: a soft ring on the top one
      Object.keys(src).forEach(function (k) {
        const a = +k;
        const t = topOf(a);
        if (!t) return;
        el('circle', { cx: r1(t.x), cy: r1(t.y), r: R + 5, class: 'tw-src' + (sel === a ? ' on' : '') }, gTop);
      });
      if (sel === null) return;
      const tg = targets(sel);
      Object.keys(tg).forEach(function (k) {
        const to = +k;
        if (to === myOff()) {
          el('rect', { x: TX0 + 3, y: MIDY + 3, width: TX1 - TX0 - 6, height: BOT - MIDY - 6, rx: 10, class: 'tw-dest tray-dest' }, gMarks);
          return;
        }
        const dp = dpOf(to);
        const x = colX(dp);
        const top = isTop(dp);
        const y0 = top ? TOP : BOT;
        const y1 = top ? TOP + PH : BOT - PH;
        el('path', { d: 'M' + r1(x - PW / 2 + 2) + ' ' + y0 + ' L' + r1(x + PW / 2 - 2) + ' ' + y0 + ' L' + r1(x) + ' ' + y1 + ' Z', class: 'tw-dest' + (tg[k].length > 1 ? ' far' : '') }, gMarks);
        const v = pos.pts[to];
        const mine = seat === 0 ? v > 0 : v < 0;
        const n = mine ? Math.abs(v) : 0; // a hit replaces their single checker
        const xy = stackXY(dp, n, n + 1);
        el('circle', { cx: r1(xy.x), cy: r1(xy.y), r: R - 3, class: 'tw-ghost' }, gMarks);
      });
    }

    function regionAt(x, y) {
      if (x >= TX0 && x <= TX1 && y >= MIDY) return { kind: 'off', a: myOff() };
      if (x >= BX0 && x <= BX1 && y >= TOP && y <= BOT) return { kind: 'bar', a: myBar() };
      let col = -1;
      let left = false;
      if (x >= LX0 && x < LX1) { col = Math.floor((x - LX0) / PW); left = true; } else if (x >= RX0 && x < RX1) col = Math.floor((x - RX0) / PW);
      if (col < 0 || y < TOP || y > BOT) return null;
      let dp;
      if (y < MIDY) dp = left ? 13 + col : 19 + col;
      else dp = left ? 12 - col : 6 - col;
      return { kind: 'point', a: aOf(dp) };
    }

    function svgPoint(ev) {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const p = svg.createSVGPoint();
      p.x = ev.clientX;
      p.y = ev.clientY;
      return p.matrixTransform(m.inverse());
    }

    function select(a) { sel = a; marks(); }
    function pick(to) {
      const tg = targets(sel);
      const dice = tg[to];
      if (!dice) return false;
      const from = sel;
      sel = null;
      marks();
      if (opts.onMove) opts.onMove(from, dice);
      return true;
    }

    // a lone source (a checker on the bar, or only one checker can move) is picked for you
    function autoSelect() {
      const s = Object.keys(sources()).map(Number);
      if (sel !== null && s.indexOf(sel) < 0) sel = null;
      if (sel === null && (s.indexOf(myBar()) >= 0 || s.length === 1)) sel = s[0];
    }

    svg.addEventListener('pointerdown', function (ev) {
      if (!inter.enabled) { if (inter.canRoll && opts.onRoll) { const p0 = svgPoint(ev); if (p0 && p0.y > TOP + PH - 40 && p0.y < BOT - PH + 40 && p0.x > RX0) opts.onRoll(); } return; }
      const p = svgPoint(ev);
      if (!p) return;
      const r = regionAt(p.x, p.y);
      if (!r) { select(null); return; }
      if (sel !== null && targets(sel)[r.a]) { pick(r.a); ev.preventDefault(); return; }
      if (sources()[r.a]) {
        select(r.a);
        const t = topOf(r.a);
        drag = { from: r.a, x0: p.x, y0: p.y, moved: false, ghost: null, start: t };
        try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        ev.preventDefault();
        return;
      }
      select(null);
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      const p = svgPoint(ev);
      if (!p) return;
      if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) > 14) {
        drag.moved = true;
        const color = seat;
        drag.ghost = checker(color, p.x, p.y, 'dragging');
        gTop.append(drag.ghost);
        hidden = drag.from === myBar() ? { a: 'bar' + seat } : { a: drag.from };
        render();
      }
      if (drag.moved) drag.ghost.setAttribute('transform', 'translate(' + r1(p.x) + ' ' + r1(p.y - 10) + ')');
    });
    function endDrag(ev) {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) return; // a tap: the checker stays selected
      const p = svgPoint(ev);
      d.ghost.remove();
      hidden = null;
      const r = p ? regionAt(p.x, p.y) : null;
      if (r && sel !== null && targets(sel)[r.a]) { pick(r.a); render(); return; }
      render();
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    // ---------- dice ----------
    const diceState = { me: null, opp: null };
    function drawDice() {
      gDice.innerHTML = '';
      ['opp', 'me'].forEach(function (who) {
        const d = diceState[who];
        if (!d || !d.values.length) return;
        const dbl = d.values.length === 2 && d.values[0] === d.values[1] && d.left !== undefined && d.showFour;
        const list = dbl ? [d.values[0], d.values[0], d.values[0], d.values[0]] : d.values;
        const size = list.length > 2 ? 48 : 62;
        const gap = 14;
        const cx = who === 'me' ? (RX0 + RX1) / 2 : (LX0 + LX1) / 2;
        const total = list.length * size + (list.length - 1) * gap;
        let used = d.used || 0;
        list.forEach(function (v, i) {
          const g = el('g', { class: 'tw-die' + (i < used ? ' used' : '') + (d.rolling ? ' rolling' : ''), transform: 'translate(' + r1(cx - total / 2 + i * (size + gap)) + ' ' + r1(MIDY - size / 2) + ') rotate(' + (d.tilt ? d.tilt[i] || 0 : 0) + ' ' + size / 2 + ' ' + size / 2 + ')' }, gDice);
          g.innerHTML = dieMarkup(d.rolling ? 1 + Math.floor(Math.random() * 6) : v, size);
        });
      });
      if (diceState.prompt) {
        const g = el('g', { class: 'tw-rollme', transform: 'translate(' + r1((RX0 + RX1) / 2) + ' ' + MIDY + ')' }, gDice);
        el('rect', { x: -90, y: -32, width: 180, height: 64, rx: 32, class: 'btn' }, g);
        const t = el('text', { y: 11, class: 'lbl' }, g);
        t.textContent = 'ارمِ النرد';
      }
    }
    // values: [a, b]; used: how many are spent; four: a double shows four dice
    function setDice(who, values, usedCount, four) {
      diceState[who] = values && values.length ? { values: values.slice(), used: usedCount || 0, showFour: !!four, left: 0, tilt: diceState[who] && diceState[who].values.join() === values.join() ? diceState[who].tilt : [Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8] } : null;
      drawDice();
    }
    function clearDice() { diceState.me = null; diceState.opp = null; drawDice(); }
    function setPrompt(on) { diceState.prompt = !!on; drawDice(); }
    function rollDice(who, values, ms) {
      setDice(who, values, 0, true);
      if (reduced() || document.hidden) return Promise.resolve();
      const d = diceState[who];
      d.rolling = true;
      const t0 = performance.now();
      return new Promise(function (resolve) {
        const tick = function () {
          const k = (performance.now() - t0) / (ms || 650);
          if (k >= 1) { d.rolling = false; drawDice(); resolve(); return; }
          d.tilt = d.tilt.map(function () { return Math.random() * 50 - 25; });
          drawDice();
          setTimeout(tick, 70);
        };
        tick();
      });
    }

    // ---------- animation ----------
    function tween(g, from, to, ms, hop) {
      return new Promise(function (resolve) {
        if (reduced() || document.hidden) { resolve(); return; }
        const t0 = performance.now();
        const step = function (now) {
          const k = Math.min(1, (now - t0) / ms);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          const x = from.x + (to.x - from.x) * e;
          const y = from.y + (to.y - from.y) * e - Math.sin(Math.PI * k) * (hop || 0);
          g.setAttribute('transform', 'translate(' + r1(x) + ' ' + r1(y) + ') scale(' + r1((1 + Math.sin(Math.PI * k) * 0.12) * 100) / 100 + ')');
          if (k < 1) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
        setTimeout(resolve, ms + 500);
      });
    }

    function whereFrom(p, a) {
      if (a === (p === 0 ? 25 : 0)) return { kind: 'bar', p: p };
      return { kind: 'point', a: a };
    }
    function whereTo(p, a) {
      if (a === (p === 0 ? 0 : 25)) return { kind: 'off', p: p };
      return { kind: 'point', a: a };
    }
    function count(where) {
      if (where.kind === 'bar') return pos.bar[where.p];
      if (where.kind === 'off') return pos.off[where.p];
      return Math.abs(pos.pts[where.a]);
    }
    function take(p, where) {
      if (where.kind === 'bar') pos.bar[where.p] -= 1;
      else if (where.kind === 'off') pos.off[where.p] -= 1;
      else pos.pts[where.a] -= p === 0 ? 1 : -1;
    }
    function put(p, where) {
      if (where.kind === 'bar') pos.bar[where.p] += 1;
      else if (where.kind === 'off') pos.off[where.p] += 1;
      else pos.pts[where.a] += p === 0 ? 1 : -1;
    }

    // one checker of colour p from `a` to `b` (each {kind, ...}); updates the shown position
    function fly(p, a, b, ms, hop) {
      const n0 = count(a);
      const from = n0 ? slot(a, n0 - 1, n0) : slot(a, 0, 1);
      take(p, a);
      render();
      const n1 = count(b);
      const to = b.kind === 'off' ? offXY(b.p === seat, n1) : slot(b, n1, n1 + 1);
      const g = checker(p, from.x, from.y, 'flying');
      gTop.append(g);
      return tween(g, from, to, ms, hop).then(function () {
        g.remove();
        put(p, b);
        render();
      });
    }

    // a step of the game (also for the other player): the hit checker goes to the bar first
    function step(p, st, hit, ms) {
      const q = 1 - p;
      const to = whereTo(p, st.to);
      const chain = hit ? fly(q, { kind: 'point', a: st.to }, { kind: 'bar', p: q }, ms * 0.8, 40) : Promise.resolve();
      return chain.then(function () { return fly(p, whereFrom(p, st.from), to, ms, 70); });
    }
    function unstep(p, st, hit, ms) {
      const q = 1 - p;
      return fly(p, whereTo(p, st.to), whereFrom(p, st.from), ms, 60).then(function () {
        if (hit) return fly(q, { kind: 'bar', p: q }, { kind: 'point', a: st.to }, ms * 0.8, 40);
        return null;
      });
    }

    drawBoard();
    return {
      el: svg,
      // the space on screen: a taller board when there is room for it (between 760 and 940 high)
      fit: function (w, hh) {
        if (!w || !hh) return;
        const want = Math.max(760, Math.min(940, Math.round(W * hh / w / 20) * 20));
        if (want === H) return;
        setHeight(want);
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        drawBoard();
        render();
        drawDice();
      },
      setSeat: function (s) { if (s !== seat) { seat = s; sel = null; render(); } },
      setPos: function (p) { pos = { pts: p.pts.slice(), bar: p.bar.slice(), off: p.off.slice() }; render(); },
      setInteractive: function (o) { inter = o; autoSelect(); marks(); },
      deselect: function () { sel = null; marks(); },
      setDice: setDice,
      clearDice: clearDice,
      rollDice: rollDice,
      setPrompt: setPrompt,
      step: step,
      unstep: unstep,
    };
  }

  // a small die for HTML (the home page)
  function dieSVG(v) {
    return '<svg viewBox="-2 -2 70 72" class="tw-dieart" aria-hidden="true">' + dieMarkup(v, 64) + '</svg>';
  }

  root.TawlaBoard = { create: create, dieSVG: dieSVG };
})(window);
