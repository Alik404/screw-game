// Card motion: flights between places, in-place flips, sliding after re-layout, dealing, shake.
// Flying cards live outside #app (which is rebuilt on every render), so a re-render never cuts a flight.
// While a card is in the air its landing spot is "held" (kept invisible) so it is never seen twice.
(function (root) {
  const K = root.ScrewCards;
  const MOVE_MS = 350;
  const FLIP_MS = 300;

  const holds = new Map(); // fx key -> number of flights still landing there

  function reduced() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function hold(key) {
    if (!key) return;
    holds.set(key, (holds.get(key) || 0) + 1);
    applyHolds();
  }

  function release(key) {
    if (!key) return;
    const n = (holds.get(key) || 1) - 1;
    if (n <= 0) holds.delete(key); else holds.set(key, n);
    applyHolds();
  }

  // Called after every render: hide the elements whose card is still flying in.
  function applyHolds() {
    document.querySelectorAll('[data-fxkey]').forEach(function (el) {
      el.style.visibility = holds.has(el.getAttribute('data-fxkey')) ? 'hidden' : '';
    });
  }

  function rectOf(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // A card-shaped rect of the given width centred inside another rect.
  function centred(r, width) {
    if (!r) return null;
    const h = width * 1.4;
    return { left: r.left + (r.width - width) / 2, top: r.top + (r.height - h) / 2, width: width, height: h };
  }

  function faceEl(card) {
    const d = document.createElement('div');
    d.className = 'pc fly-face';
    d.innerHTML = K.svg(card, false);
    return d;
  }

  // o: {from, to, card (shown at the end, or the whole time), startCard, flip:'toFace'|'toBack', hold, delay, fade, duration}
  function fly(o) {
    return new Promise(function (resolve) {
      if (!o.from || !o.to || reduced() || document.hidden) { resolve(); return; }
      hold(o.hold);
      const box = document.createElement('div');
      box.className = 'fly';
      box.style.left = o.from.left + 'px';
      box.style.top = o.from.top + 'px';
      box.style.width = o.from.width + 'px';
      box.style.height = o.from.width * 1.4 + 'px';
      const inner = document.createElement('div');
      inner.className = 'fly-inner';
      const hidden = { hidden: true };
      if (o.flip) {
        // two faces back to back; the inner box turns 180deg on the way
        const a = faceEl(o.flip === 'toFace' ? hidden : o.startCard || o.card);
        const b = faceEl(o.flip === 'toFace' ? o.card : hidden);
        b.classList.add('fly-back-side');
        inner.append(a, b);
      } else {
        inner.append(faceEl(o.card || hidden));
      }
      box.append(inner);
      document.body.append(box);
      const dx = o.to.left - o.from.left;
      const dy = o.to.top - o.from.top;
      const s = o.to.width / o.from.width;
      const duration = o.duration || MOVE_MS;
      const delay = o.delay || 0;
      const easing = 'cubic-bezier(.25,.8,.25,1)';
      const frames = [
        { transform: 'translate(0px,0px) scale(1)', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')', opacity: o.fade ? 0 : 1 },
      ];
      const anim = box.animate(frames, { duration: duration, delay: delay, easing: easing, fill: 'forwards' });
      if (o.flip) {
        inner.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
          { duration: FLIP_MS, delay: delay + Math.max(0, duration - FLIP_MS) / 2, easing: 'ease-in-out', fill: 'forwards' });
      }
      let done = false;
      const finish = function () {
        if (done) return;
        done = true;
        box.remove();
        release(o.hold);
        resolve();
      };
      anim.onfinish = finish;
      setTimeout(finish, delay + duration + 400);
    });
  }

  // Show a card face for a moment where it lies, then turn it back (failed match).
  function reveal(rect, card, ms) {
    if (!rect || reduced()) return Promise.resolve();
    return fly({ from: rect, to: rect, card: card, flip: 'toFace', duration: FLIP_MS }).then(function () {
      const box = document.createElement('div');
      box.className = 'fly';
      Object.assign(box.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.width * 1.4 + 'px' });
      const inner = document.createElement('div');
      inner.className = 'fly-inner';
      const a = faceEl(card);
      const b = faceEl({ hidden: true });
      b.classList.add('fly-back-side');
      inner.append(a, b);
      box.append(inner);
      document.body.append(box);
      return new Promise(function (resolve) {
        const an = inner.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
          { duration: FLIP_MS, delay: ms || 700, easing: 'ease-in-out', fill: 'forwards' });
        an.onfinish = function () { box.remove(); resolve(); };
      });
    });
  }

  // FLIP: cards that moved because of a re-layout (a slot removed, a card added) glide to their new place.
  function snapshot() {
    const m = {};
    document.querySelectorAll('[data-hand]').forEach(function (el) {
      const r = el.getBoundingClientRect();
      m[el.getAttribute('data-hand')] = { left: r.left, top: r.top };
    });
    return m;
  }

  function slide(prev) {
    if (!prev || reduced()) return;
    document.querySelectorAll('[data-hand]').forEach(function (el) {
      const id = el.getAttribute('data-hand');
      const p = prev[id];
      if (!p || holds.has('hand:' + id)) return;
      const r = el.getBoundingClientRect();
      const dx = p.left - r.left;
      const dy = p.top - r.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0,0)' }],
        { duration: MOVE_MS, easing: 'cubic-bezier(.25,.8,.25,1)' });
    });
  }

  // Deal: one card at a time from the deck to every seat.
  function deal(deckRect, targets, onEach) {
    if (!deckRect || reduced()) return;
    targets.forEach(function (t, i) {
      const to = rectOf(t.el);
      if (!to) return;
      fly({ from: deckRect, to: to, card: { hidden: true }, hold: t.key, delay: i * 70, duration: 320 });
      if (onEach) setTimeout(onEach, i * 70);
    });
  }

  function shake(el) {
    if (!el || reduced()) return;
    el.animate([
      { transform: 'translate(0,0)' }, { transform: 'translate(-6px,2px)' }, { transform: 'translate(6px,-2px)' },
      { transform: 'translate(-4px,1px)' }, { transform: 'translate(3px,0)' }, { transform: 'translate(0,0)' },
    ], { duration: 420, easing: 'ease-out' });
  }

  // Drop every card still in the air (the screen changed under it).
  function clear() {
    document.querySelectorAll('.fly').forEach(function (el) { el.remove(); });
    holds.clear();
    applyHolds();
  }

  root.ScrewFX = { clear, fly, reveal, snapshot, slide, deal, shake, rectOf, centred, applyHolds, reduced, MOVE_MS, FLIP_MS };
})(window);
