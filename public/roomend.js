// "End the room" for the host (everyone goes back to the home screen) and "leave the room" for everyone else,
// each behind a confirmation. Shared by every game page; the page tells it how to send and who it is:
// RoomEnd.init({ send(msg), isHost(), stage() }) where stage() is 'lobby', 'playing' or 'over',
// then puts RoomEnd.button() in its lobby, menu and final screen.
(function () {
  const ICON = {
    end: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    leave: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  };
  let opts = null;
  let box = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '20');
    s.setAttribute('height', '20');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICON[name];
    return s;
  }

  function isHost() { return !!(opts && opts.isHost()); }
  function stage() { return (opts && opts.stage && opts.stage()) || 'lobby'; }

  function init(o) { opts = o; }

  // the button for whoever is looking: the host ends the room, everyone else leaves it
  function button() {
    const host = isHost();
    const b = el('button', 'with-icon re-btn' + (host ? ' danger' : ''));
    b.type = 'button';
    b.append(icon(host ? 'end' : 'leave'), document.createTextNode(host ? 'إنهاء الغرفة' : 'الخروج من الغرفة'));
    b.addEventListener('click', ask);
    return b;
  }

  function ask() {
    dismiss();
    const host = isHost();
    const st = stage();
    const title = host ? 'إنهاء الغرفة؟' : 'الخروج من الغرفة؟';
    const text = host
      ? (st === 'playing' ? 'تتوقف اللعبة عند الجميع، ويرجع كل اللاعبين للصفحة الرئيسية، ويتوقف كود الغرفة. لا يمكن التراجع.'
        : 'يرجع كل اللاعبين للصفحة الرئيسية ويتوقف كود الغرفة.')
      : (st === 'playing' ? 'تخرج من اللعبة ويلعب الخادم أدوارك تلقائياً، ولا يمكنك الرجوع لهذه اللعبة.'
        : st === 'over' ? 'تخرج من الغرفة ولا يمكنك الرجوع إليها.'
          : 'تخرج من غرفة الانتظار، ويمكنك الدخول مرة ثانية بالكود قبل أن تبدأ اللعبة.');
    const wrap = el('div', 'sheet-wrap re-wrap');
    wrap.addEventListener('click', function (e) { if (e.target === wrap) dismiss(); });
    const sheet = el('div', 'sheet re-sheet');
    sheet.setAttribute('role', 'alertdialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', title);
    const head = el('div', 'sheet-head');
    head.append(el('h2', null, title));
    const yes = el('button', 'danger solid', host ? 'نعم، أنهِ الغرفة' : 'نعم، اخرج');
    yes.type = 'button';
    yes.addEventListener('click', function () {
      dismiss();
      if (opts) opts.send({ type: host ? 'close_room' : 'leave_room' });
    });
    const no = el('button', null, 'تراجع');
    no.type = 'button';
    no.addEventListener('click', dismiss);
    const btns = el('div', 'btns');
    btns.append(yes, no);
    sheet.append(head, el('p', 're-q', text), btns);
    wrap.append(sheet);
    document.body.append(wrap);
    box = wrap;
    no.focus();
  }

  function dismiss() {
    if (box) { box.remove(); box = null; }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && box) { e.stopPropagation(); dismiss(); }
  }, true);

  window.RoomEnd = { init: init, button: button, dismiss: dismiss };
})();
