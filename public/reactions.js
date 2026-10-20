// Quick emoji reactions for the games that redraw their whole screen on every update: the button is drawn
// with the page, while the picker and the floating bubbles live outside the app so a redraw never closes them.
(function (root) {
  const EMOJI = { laugh: '😂', wow: '😮', angry: '😡', cry: '😭', clap: '👏', pray: '🤲', fire: '🔥', snake: '🐍' };
  const SMILE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/></svg>';
  let opts = null; // {send(msg), nameOf(id), anchorFor(id) -> element | null}
  let pop = null;

  function init(o) { opts = o; }

  function close() {
    if (!pop) return;
    pop.remove();
    pop = null;
    document.removeEventListener('pointerdown', outside, true);
  }
  function outside(e) {
    if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.rx-btn'))) close();
  }

  function open(btn) {
    if (pop) { close(); return; }
    pop = document.createElement('div');
    pop.className = 'rx-pop';
    pop.setAttribute('role', 'toolbar');
    pop.setAttribute('aria-label', 'تفاعلات');
    root.ScrewConfig.REACTIONS.forEach(function (id) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = EMOJI[id];
      b.setAttribute('aria-label', id);
      b.addEventListener('click', function () { close(); if (opts) opts.send({ type: 'react', id: id }); });
      pop.append(b);
    });
    document.body.append(pop);
    // under the button (or over it near the bottom of the screen), always inside the screen
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8) + 'px';
    pop.style.top = (r.bottom + h + 16 > innerHeight ? r.top - h - 8 : r.bottom + 8) + 'px';
    setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
  }

  function button() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn rx-btn';
    b.setAttribute('aria-label', 'تفاعل');
    b.title = 'تفاعل';
    b.innerHTML = SMILE;
    b.addEventListener('click', function () { open(b); });
    return b;
  }

  // someone reacted: the emoji floats up from their seat (or the middle of the screen)
  function show(from, id) {
    if (!EMOJI[id] || !opts) return;
    const a = opts.anchorFor(from);
    const r = a ? a.getBoundingClientRect() : null;
    const el = document.createElement('div');
    el.className = 'rx-bubble';
    el.setAttribute('aria-hidden', 'true');
    const e = document.createElement('span');
    e.textContent = EMOJI[id];
    const n = document.createElement('small');
    n.textContent = opts.nameOf(from);
    el.append(e, n);
    el.style.left = (r && r.width ? r.left + r.width / 2 : innerWidth / 2) + 'px';
    el.style.top = (r && r.width ? r.top : innerHeight / 2) + 'px';
    document.body.append(el);
    setTimeout(function () { el.remove(); }, 2300);
  }

  root.Reactions = { init: init, button: button, show: show, close: close, EMOJI: EMOJI };
})(window);
