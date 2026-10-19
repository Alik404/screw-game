// Domino tiles and the table. Tiles are SVG (ivory face, a thickness edge, engraved pips, a brass pin);
// the table lays the line of play out from the opening tile: both arms run outwards, turn at the edges
// (the right arm downwards, the left arm upwards) and doubles lie crosswise. Colours come from CSS only.
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const U = 100; // one unit = the short side of a tile, in SVG units
  const EDGE = 6; // visible thickness under the face

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.append(e);
    return e;
  }
  function reduced() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  const r1 = function (n) { return Math.round(n * 10) / 10; };

  // pip spots inside one half (0..100 both ways)
  const SPOTS = {
    0: [],
    1: [[50, 50]],
    2: [[27, 27], [73, 73]],
    3: [[27, 27], [50, 50], [73, 73]],
    4: [[27, 27], [73, 27], [27, 73], [73, 73]],
    5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]],
    6: [[28, 24], [28, 50], [28, 76], [72, 24], [72, 50], [72, 76]],
  };

  function pipsIn(n, bx, by, bw, bh, rot) {
    let out = '';
    SPOTS[n].forEach(function (p) {
      // a horizontal half turns its pattern a quarter, so a 6 runs along the tile like on a real set
      const ox = rot ? p[1] : p[0];
      const oy = rot ? 100 - p[0] : p[1];
      const x = r1(bx + ox / 100 * bw);
      const y = r1(by + oy / 100 * bh);
      out += '<circle class="pip" cx="' + x + '" cy="' + y + '" r="9.6"/><circle class="pip-hi" cx="' + r1(x - 2.2) + '" cy="' + r1(y - 2.6) + '" r="2.6"/>';
    });
    return out;
  }

  // one tile at (x, y), 'h' (200 x 100) or 'v' (100 x 200); a / b are the left / right (or top / bottom) numbers
  function tileMarkup(x, y, orient, a, b, cls) {
    const w = orient === 'h' ? 2 * U : U;
    const h = orient === 'h' ? U : 2 * U;
    const fh = h - EDGE;
    let s = '<g class="dm-tile' + (cls ? ' ' + cls : '') + '">';
    s += '<rect class="sh" x="' + (x + 3) + '" y="' + (y + 9) + '" width="' + w + '" height="' + (h - 4) + '" rx="15"/>';
    s += '<rect class="edge" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="15"/>';
    s += '<rect class="face" x="' + x + '" y="' + y + '" width="' + w + '" height="' + fh + '" rx="15"/>';
    s += '<rect class="gloss" x="' + (x + 5) + '" y="' + (y + 4) + '" width="' + (w - 10) + '" height="' + r1(fh * (orient === 'h' ? 0.42 : 0.22)) + '" rx="11"/>';
    if (orient === 'h') {
      s += '<line class="div" x1="' + (x + U) + '" y1="' + (y + 13) + '" x2="' + (x + U) + '" y2="' + (y + fh - 13) + '"/>';
      s += pipsIn(a, x, y, U, fh, true) + pipsIn(b, x + U, y, U, fh, true);
      s += '<circle class="pin" cx="' + (x + U) + '" cy="' + r1(y + fh / 2) + '" r="7"/><circle class="pin-hi" cx="' + (x + U - 2) + '" cy="' + r1(y + fh / 2 - 2) + '" r="2.4"/>';
    } else {
      const half = fh / 2;
      s += '<line class="div" x1="' + (x + 13) + '" y1="' + r1(y + half) + '" x2="' + (x + U - 13) + '" y2="' + r1(y + half) + '"/>';
      s += pipsIn(a, x, y, U, half, false) + pipsIn(b, x, y + half, U, half, false);
      s += '<circle class="pin" cx="' + (x + U / 2) + '" cy="' + r1(y + half) + '" r="7"/><circle class="pin-hi" cx="' + (x + U / 2 - 2) + '" cy="' + r1(y + half - 2) + '" r="2.4"/>';
    }
    return s + '</g>';
  }

  // a standalone upright tile (for the hand, the result sheet, the home page)
  function tileSVG(a, b, cls) {
    return '<svg class="dm-svgtile" viewBox="-4 -2 108 214" aria-hidden="true">' + tileMarkup(0, 0, 'v', a, b, cls) + '</svg>';
  }
  function tileSVGh(a, b, cls) {
    return '<svg class="dm-svgtile" viewBox="-4 -2 208 114" aria-hidden="true">' + tileMarkup(0, 0, 'h', a, b, cls) + '</svg>';
  }

  // shared gradients, once per page
  function ensureDefs() {
    if (document.getElementById('dm-defs')) return;
    const svg = el('svg', { id: 'dm-defs', width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0' });
    svg.innerHTML = '<defs>' +
      '<linearGradient id="dm-face-g" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" class="dm-s1"/><stop offset="1" class="dm-s2"/></linearGradient>' +
      '<radialGradient id="dm-pin-g" cx="0.35" cy="0.35" r="0.7"><stop offset="0" class="dm-p1"/><stop offset="1" class="dm-p2"/></radialGradient>' +
      '</defs>';
    document.body.append(svg);
  }

  // ---------- layout ----------

  // line: oriented tiles [[l, r], ...]; first: index of the opening tile; B: how far a row may run (units).
  // Returns, for each tile, {x, y, o, a, b}: top-left in units, orientation, numbers in screen order.
  function layout(line, first, B) {
    const out = new Array(line.length);
    if (!line.length) return out;
    const t0 = line[first];
    const d0 = t0[0] === t0[1];
    out[first] = d0 ? { x: -0.5, y: -1, o: 'v', a: t0[0], b: t0[1] } : { x: -1, y: -0.5, o: 'h', a: t0[0], b: t0[1] };
    const start = d0 ? 0.5 : 1;
    const arm = function (indexes, dir, vdir, touchOuter) {
      let x = dir * start;
      let y = 0;
      let turned = false;
      indexes.forEach(function (i) {
        const to = touchOuter(line[i]);
        const touch = to[0];
        const outer = to[1];
        const dbl = touch === outer;
        if (dbl && !turned && Math.abs(x + dir) <= B) { // a double lies across the row
          out[i] = { x: Math.min(x, x + dir), y: y - 1, o: 'v', a: touch, b: outer };
          x += dir;
          return;
        }
        if (!(dbl && !turned) && Math.abs(x + 2 * dir) <= B) {
          out[i] = { x: Math.min(x, x + 2 * dir), y: y - 0.5, o: 'h', a: dir > 0 ? touch : outer, b: dir > 0 ? outer : touch };
          x += 2 * dir;
          turned = false;
          return;
        }
        // no room: turn the corner with an upright tile, then run back the other way one row further
        out[i] = { x: Math.min(x, x + dir), y: vdir > 0 ? y - 0.5 : y - 1.5, o: 'v', a: vdir > 0 ? touch : outer, b: vdir > 0 ? outer : touch };
        x += dir;
        dir = -dir;
        y += 2 * vdir;
        turned = true;
      });
    };
    const right = [];
    for (let i = first + 1; i < line.length; i++) right.push(i);
    const left = [];
    for (let i = first - 1; i >= 0; i--) left.push(i);
    arm(right, 1, 1, function (t) { return [t[0], t[1]]; });
    arm(left, -1, -1, function (t) { return [t[1], t[0]]; });
    return out;
  }

  function bbox(places) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    places.forEach(function (p) {
      if (!p) return;
      const w = p.o === 'h' ? 2 : 1;
      const h = p.o === 'h' ? 1 : 2;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + w); y1 = Math.max(y1, p.y + h);
    });
    return x0 === Infinity ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  // the row length that fits a typical full line best in a W x H box
  function pickB(W, H) {
    const fake = [];
    for (let i = 0; i < 24; i++) fake.push([i % 6, (i + 1) % 6]);
    let best = null;
    for (let B = 3; B <= 13; B++) {
      const bb = bbox(layout(fake, 12, B));
      const bw = Math.max(bb.x1 - bb.x0, 2 * B + 2) + 0.8;
      const bh = bb.y1 - bb.y0 + 0.8;
      const sc = Math.min(W / bw, H / bh);
      if (!best || sc > best.sc + 0.01) best = { B: B, sc: sc };
    }
    return best.B;
  }

  // ---------- the table ----------

  function createTable() {
    ensureDefs();
    const svg = el('svg', { class: 'dm-svg', role: 'img', 'aria-label': 'طاولة الدومنو' });
    const ghostLayer = el('g', { class: 'dm-ghosts' }, svg);
    const tileLayer = el('g', { class: 'dm-tiles' }, svg);
    const T = {}; // tile id -> {g, x, y, o}
    let B = 5;
    let size = { w: 0, h: 0 };
    let vb = null;
    let vbTween = null;
    let last = { line: [], first: 0 };
    let ghosts = [];

    function idOf(t) { return Math.min(t[0], t[1]) + '-' + Math.max(t[0], t[1]); }

    function setVB(v) {
      vb = v;
      svg.setAttribute('viewBox', r1(v.x) + ' ' + r1(v.y) + ' ' + r1(v.w) + ' ' + r1(v.h));
    }

    // frame: the full row width so the scale stays put until the line grows past it
    function targetVB(places) {
      const W = size.w || 360;
      const H = size.h || 300;
      const all = places.concat(ghosts.map(function (g) { return g.place; }));
      const bb = bbox(all) || { x0: -1, y0: -1, x1: 1, y1: 1 };
      const pad = 0.55;
      let x0 = Math.min(bb.x0, -(B + 1)) - pad;
      let x1 = Math.max(bb.x1, B + 1) + pad;
      let y0 = bb.y0 - pad;
      let y1 = bb.y1 + pad;
      // keep the box the shape of the screen space, centred on the line
      let w = x1 - x0;
      let h = y1 - y0;
      if (w / h < W / H) { const nw = h * W / H; x0 -= (nw - w) / 2; w = nw; } else { const nh = w * H / W; const cy = (y0 + y1) / 2; y0 = cy - nh / 2; h = nh; }
      return { x: x0 * U, y: y0 * U, w: w * U, h: h * U };
    }

    function moveVB(to) {
      if (!vb || reduced() || document.hidden) { setVB(to); return; }
      const from = vb;
      const t0 = performance.now();
      if (vbTween) cancelAnimationFrame(vbTween);
      const step = function (now) {
        const k = Math.min(1, (now - t0) / 320);
        const e = 1 - Math.pow(1 - k, 3);
        setVB({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
        if (k < 1) vbTween = requestAnimationFrame(step); else vbTween = null;
      };
      vbTween = requestAnimationFrame(step);
    }

    function draw(p) {
      const g = el('g', { class: 'dm-t' });
      g.innerHTML = tileMarkup(0, 0, p.o, p.a, p.b);
      return g;
    }
    function put(rec, p) {
      rec.x = p.x; rec.y = p.y; rec.o = p.o;
      rec.g.setAttribute('transform', 'translate(' + r1(p.x * U) + ' ' + r1(p.y * U) + ')');
    }

    // fly a new tile in from a point on the screen (a hand tile, or a player's seat)
    function flyIn(rec, from) {
      if (!from || reduced() || document.hidden || !svg.getScreenCTM()) return;
      const m = svg.getScreenCTM().inverse();
      const pt = svg.createSVGPoint();
      pt.x = from.left + from.width / 2;
      pt.y = from.top + from.height / 2;
      const s = pt.matrixTransform(m);
      const w = (rec.o === 'h' ? 2 : 1) * U;
      const h = (rec.o === 'h' ? 1 : 2) * U;
      const tx = rec.x * U;
      const ty = rec.y * U;
      const dx = s.x - (tx + w / 2);
      const dy = s.y - (ty + h / 2);
      const ctm = svg.getScreenCTM();
      const pxPerUnit = ctm ? ctm.a : 1;
      const s0 = Math.max(0.5, Math.min(1.6, (from.width / pxPerUnit) / (rec.o === 'h' ? 2 * U : U) * (rec.o === 'h' ? 2 : 1)));
      const rot0 = from.height > from.width && rec.o === 'h' ? -90 : 0; // upright in the hand, lying down on the table
      const t0 = performance.now();
      const dur = 420;
      rec.g.classList.add('flying');
      tileLayer.append(rec.g);
      const step = function (now) {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        const lift = Math.sin(Math.PI * k) * 0.12;
        const sc = s0 + (1 - s0) * e + lift;
        const rot = rot0 * (1 - e);
        rec.g.setAttribute('transform', 'translate(' + r1(tx + dx * (1 - e)) + ' ' + r1(ty + dy * (1 - e)) + ') ' +
          'translate(' + w / 2 + ' ' + h / 2 + ') rotate(' + r1(rot) + ') scale(' + r1(sc * 100) / 100 + ') translate(' + (-w / 2) + ' ' + (-h / 2) + ')');
        if (k < 1) requestAnimationFrame(step);
        else { rec.g.classList.remove('flying'); put(rec, rec); rec.g.classList.add('landed'); setTimeout(function () { rec.g.classList.remove('landed'); }, 500); }
      };
      requestAnimationFrame(step);
    }

    // line changed (or the screen did): place every tile; new ones fly in from `from[id]` when given
    function update(line, first, from) {
      last = { line: line, first: first };
      if (!line.length) {
        Object.keys(T).forEach(function (id) { T[id].g.remove(); delete T[id]; });
      }
      const places = layout(line, first, B);
      const seen = {};
      line.forEach(function (t, i) {
        const id = idOf(t);
        seen[id] = true;
        const p = places[i];
        let rec = T[id];
        if (rec && (rec.o !== p.o)) { rec.g.remove(); delete T[id]; rec = null; }
        if (!rec) {
          rec = T[id] = { g: draw(p) };
          put(rec, p);
          tileLayer.append(rec.g);
          if (from && from[id]) flyIn(rec, from[id]);
          else if (vb) { rec.g.classList.add('appear'); }
        } else if (rec.x !== p.x || rec.y !== p.y) {
          put(rec, p);
        }
      });
      Object.keys(T).forEach(function (id) { if (!seen[id]) { T[id].g.remove(); delete T[id]; } });
      const to = targetVB(places);
      if (!vb) setVB(to); else moveVB(to);
    }

    // where a tile would go on each end: ghost tiles you can tap
    function showGhosts(tile, endsList, onPick) {
      clearGhosts(true);
      const p = tile.split('-').map(Number);
      endsList.forEach(function (end) {
        const line = last.line.map(function (t) { return t.slice(); });
        let first = last.first;
        let idx;
        if (end === 'left') {
          const e = line[0][0];
          line.unshift(p[1] === e ? [p[0], p[1]] : [p[1], p[0]]);
          first += 1;
          idx = 0;
        } else {
          const e = line[line.length - 1][1];
          line.push(p[0] === e ? [p[0], p[1]] : [p[1], p[0]]);
          idx = line.length - 1;
        }
        const place = layout(line, first, B)[idx];
        const g = el('g', { class: 'dm-ghost', role: 'button', tabindex: '0', 'aria-label': 'ضعها هنا' }, ghostLayer);
        g.innerHTML = tileMarkup(0, 0, place.o, place.a, place.b, 'ghost') +
          '<rect class="ring" x="-8" y="-8" width="' + ((place.o === 'h' ? 2 : 1) * U + 16) + '" height="' + ((place.o === 'h' ? 1 : 2) * U + 16) + '" rx="20"/>';
        g.setAttribute('transform', 'translate(' + r1(place.x * U) + ' ' + r1(place.y * U) + ')');
        const pick = function (ev) { ev.preventDefault(); ev.stopPropagation(); onPick(end); };
        g.addEventListener('click', pick);
        g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') pick(ev); });
        ghosts.push({ g: g, place: place });
      });
      moveVB(targetVB(layout(last.line, last.first, B)));
    }
    function clearGhosts(keepView) {
      if (!ghosts.length) return;
      ghosts.forEach(function (g) { g.g.remove(); });
      ghosts = [];
      if (!keepView) moveVB(targetVB(layout(last.line, last.first, B)));
    }

    // the space on screen changed: pick a new row length (re-lays the line) and refit
    function resize(w, h) {
      if (!w || !h) return;
      if (Math.abs(w - size.w) < 4 && Math.abs(h - size.h) < 4) return;
      size = { w: w, h: h };
      const nb = pickB(w, h);
      const changed = nb !== B;
      B = nb;
      if (changed) {
        // a new row length moves tiles: draw them again in their new places
        Object.keys(T).forEach(function (id) { T[id].g.remove(); delete T[id]; });
      }
      vb = null;
      update(last.line, last.first);
    }

    return { el: svg, update: update, resize: resize, showGhosts: showGhosts, clearGhosts: clearGhosts };
  }

  root.DominoTiles = { tileMarkup: tileMarkup, tileSVG: tileSVG, tileSVGh: tileSVGh, layout: layout, pickB: pickB, createTable: createTable, ensureDefs: ensureDefs };
})(window);
