// "How to play" panel on the left: docked on wide screens, a slide-in drawer on phones.
// Built once and kept outside #app, so re-renders never reset its scroll position.
// All numbers come from config.js so the text always matches the real rules.
(function (root) {
  const C = root.ScrewConfig;
  const D = root.ScrewDeck;
  const K = root.ScrewCards;

  let panel = null;
  let backdrop = null;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function cardImg(card) {
    const d = el('div', 'pc help-card');
    d.innerHTML = K.svg(card, false);
    return d;
  }

  // one row of the card guide: picture, name + value, what it does
  function cardRow(cards, name, value, effect) {
    const row = el('div', 'help-row');
    const pics = el('div', 'help-pics');
    cards.forEach(function (c) { pics.append(cardImg(c)); });
    const text = el('div', 'help-text');
    const title = el('div', 'help-name');
    title.append(document.createTextNode(name + ' '));
    const v = el('span', 'help-value');
    v.textContent = value;
    title.append(v);
    text.append(title, el('div', 'help-effect', effect));
    row.append(pics, text);
    return row;
  }

  function section(title) {
    const s = el('section', 'help-sec');
    s.append(el('h3', null, title));
    return s;
  }

  function build() {
    const num = function (r, s) { return D.makeCard('num', r, s); };
    const sp = function (t) { return D.makeCard(t); };
    // left-to-right marks keep +20 and -1 from flipping inside Arabic text (plain text, not HTML)
    const ltr = function (t) { return '‎' + t + '‎'; };

    const p = el('aside', 'help-panel');
    p.id = 'help-panel';
    p.setAttribute('aria-label', 'طريقة اللعب');
    p.setAttribute('tabindex', '-1');

    const head = el('div', 'help-head');
    head.append(el('h2', null, 'طريقة اللعب'));
    const close = el('button', 'icon-btn help-close');
    close.setAttribute('aria-label', 'إغلاق الشرح');
    close.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener('click', closePanel);
    head.append(close);
    p.append(head);

    let s = section('الهدف');
    s.append(el('p', null, 'أن يكون مجموع نقاط كروتك <b>الأقل</b>. اللعبة ' + C.ROUNDS + ' جولات، والفائز صاحب أقل مجموع كلي.'));
    p.append(s);

    s = section('بداية الجولة');
    s.append(el('p', null, 'كل لاعب يأخذ ' + C.CARDS_PER_PLAYER + ' كروت مقلوبة في صف. ترى <b>كرتيك الأيمنين</b> لمدة ' +
      C.INITIAL_PEEK_SECONDS + ' ثوانٍ فقط، ثم ينقلبان. احفظهما!'));
    p.append(s);

    s = section('في دورك: حركة واحدة');
    const ul = el('ul', 'help-list');
    [
      '<b>اسحب:</b> ترى الكرت وحدك، ثم <b>بدّله</b> بأحد كروتك (القديم يُرمى مكشوفاً) أو <b>ارمه</b>. إذا رميته وله خاصية تستخدمها أو تتخطاها.',
      '<b>خذ من الأرض:</b> تأخذ الكرت المكشوف وتبدله بأحد كروتك.',
      '<b>بصّر:</b> إذا تظن أن أحد كروتك يطابق كرت الأرض (نفس الرقم أو نفس الكرت الخاص) ارمه. صح: ينقص عدد كروتك. غلط: يرجع مقلوباً وتسحب ' +
        C.WRONG_MATCH_PENALTY_CARDS + ' كرت عقوبة.',
      '<b>سكرو:</b> من اللفة ' + C.SCREW_ALLOWED_FROM_LAP + ' (شرحه في الأسفل).',
      'لكل دور ' + C.TURN_SECONDS + ' ثانية. إذا انتهى الوقت يسحب الخادم ويرمي عنك.',
    ].forEach(function (t) { ul.append(el('li', null, t)); });
    s.append(ul);
    p.append(s);

    s = section('البطاقات');
    s.append(cardRow([num(3, 'hearts')], '1 إلى 6', 'القيمة = الرقم', 'بلا خاصية.'));
    s.append(cardRow([num(7, 'spades')], '7 و 8', 'القيمة = الرقم', '<b>بص في ورقتك:</b> شوف كرتاً من كروتك ' + C.PEEK_SECONDS + ' ثوانٍ. (عين واحدة على الكرت)'));
    s.append(cardRow([num(9, 'diamonds')], '9 و 10', 'القيمة = الرقم', '<b>بص في ورقة غيرك:</b> شوف كرتاً عند لاعب آخر ' + C.PEEK_SECONDS + ' ثوانٍ. (عينان على الكرت)'));
    s.append(cardRow([sp('swap')], 'خد وهات', '10', 'بدّل كرتاً من كروتك مع كرت عند لاعب آخر، بدون أن يرى أحد القيم.'));
    s.append(cardRow([sp('peekall')], 'كعب داير', '10', 'اختر: شوف ' + C.PEEK_ALL_SELF_COUNT + ' من كروتك، أو كرتاً واحداً عند كل لاعب.'));
    s.append(cardRow([sp('basra')], 'بصرة', '10', 'ارمِ أي كرت من كروتك مكشوفاً، فيقل عدد كروتك.'));
    s.append(cardRow([sp('screw_green')], 'سكرو أخضر', '0', 'أفضل كرت: لا يحسب شيئاً.'));
    s.append(cardRow([sp('minus1')], 'سالب واحد', ltr('−1'), 'ينقص مجموعك واحداً.'));
    s.append(cardRow([sp('plus20')], ltr('+20'), '20', 'تخلّص منه بسرعة.'));
    s.append(cardRow([sp('screw_red')], 'سكرو أحمر', '25', 'أسوأ كرت في المجموعة.'));
    s.append(el('p', 'help-note', 'الخاصية تعمل <b>فقط</b> إذا سحبت الكرت من الكومة ورميته مباشرة، وليس إذا رميته من يدك أو أخذته من الأرض. ونقشة الكرت (القلب والسباتي…) للشكل فقط، والمطابقة بالرقم وحده.'));
    p.append(s);

    s = section('سكرو');
    s.append(el('p', null, 'إذا ظننت أن مجموعك الأقل، أعلن <b>سكرو</b> في بداية دورك بدل أن تلعب (من اللفة ' + C.SCREW_ALLOWED_FROM_LAP +
      '). يلعب كل لاعب آخر دوراً أخيراً واحداً، ثم تُكشف كل الكروت. كروتك تصير مقفلة أمام "خد وهات".'));
    p.append(s);

    s = section('حساب النقاط');
    const ul2 = el('ul', 'help-list');
    [
      'صاحب <b>أقل مجموع</b> يُسجَّل له <b>0</b>. إذا تعادل أكثر من لاعب، كلهم 0.',
      'الباقون يُسجَّل لهم مجموع كروتهم.',
      'إذا أعلنت سكرو ولم يكن مجموعك الأقل: نقاطك <b>×' + C.FAILED_SCREW_MULTIPLIER + '</b>.',
      'الجولة الأخيرة: كل النقاط <b>×' + C.LAST_ROUND_MULTIPLIER + '</b>.',
      'لاعب بلا كروت مجموعه صفر.',
    ].forEach(function (t) { ul2.append(el('li', null, t)); });
    s.append(ul2);
    p.append(s);

    return p;
  }

  function ensure() {
    if (panel) return;
    panel = build();
    backdrop = el('div', 'help-backdrop');
    backdrop.addEventListener('click', closePanel);
    document.body.append(backdrop, panel);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('help-open')) closePanel();
    });
  }

  function openPanel() {
    ensure();
    document.body.classList.add('help-open');
    panel.focus();
  }

  function closePanel() {
    document.body.classList.remove('help-open');
  }

  function toggle() {
    if (document.body.classList.contains('help-open')) closePanel(); else openPanel();
  }

  // Docked on wide screens only while it makes sense (lobby and table).
  function setAvailable(on) {
    ensure();
    document.body.classList.toggle('help-available', !!on);
    if (!on) closePanel();
  }

  root.ScrewHelp = { open: openPanel, close: closePanel, toggle: toggle, setAvailable: setAvailable };
})(window);
