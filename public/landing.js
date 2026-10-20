// Home page: the table in the hero (pieces of every game floating over the felt, tilting with the mouse or
// the phone, tappable), the "I have a code" box, the games list (art, filters, saved rooms) and the small
// touches: reveal on scroll, tilting cards, counting numbers, dust in the lamp light.
(function () {
  // from here on the page may hide what it reveals later (without this script everything just shows)
  document.documentElement.classList.add('lp-ready');
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fine = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  const SND = window.ScrewSound;
  const SC = window.ScrewConfig;
  function $(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function play(name) { if (SND) SND.play(name); }
  function restart(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }

  // ---------- the pieces on the table ----------
  const stage = $('#lp-stage');
  function cardTap(t) { restart(t, 'lp-boop'); play('flip'); }
  function piece(kind, content, onTap) {
    const p = el('div', 'lp-piece lp-p-' + kind);
    const drop = el('div', 'lp-drop');
    const float = el('div', 'lp-float');
    const toy = el('div', 'lp-toy');
    toy.append(content);
    float.append(toy);
    drop.append(float);
    p.append(drop);
    p.addEventListener('click', function () { (onTap || function () { restart(toy, 'lp-boop'); play('clack'); })(toy); });
    stage.append(p);
    return p;
  }

  function buildTable() {
    const D = window.ScrewDeck;
    const K = window.ScrewCards;
    // lagta: a round card of symbols that spins
    const LS = window.LagtaConfig.SYMBOLS;
    const lg = el('div', 'lp-lagta');
    const spots = [[50, 50], [50, 19], [77, 34], [77, 66], [50, 81], [23, 66], [23, 34]];
    [8, 23, 45, 12, 40, 54, 32].forEach(function (s, i) {
      const e = el('span');
      e.textContent = LS[s];
      e.style.left = spots[i][0] + '%';
      e.style.top = spots[i][1] + '%';
      e.style.setProperty('--sr', ((i * 47) % 60 - 30) + 'deg');
      lg.append(e);
    });
    piece('lagta', lg, function () { restart(lg, 'spin'); play('deal'); });
    // screw: the red screw, which turns over
    const flip = el('div', 'lp-flip');
    const inner = el('div', 'lp-flip-in');
    inner.append(el('div', 'pc', K.svg(D.makeCard('screw_red'), false)), el('div', 'pc backface', K.svg({ hidden: true }, false)));
    flip.append(inner);
    piece('screw', flip, function () { flip.classList.toggle('flipped'); play('flip'); });
    piece('back', el('div', 'pc', K.svg({ hidden: true }, false)), cardTap);
    // seven and seven: a +4 and a red seven
    const SD = window.SevenDeck;
    const SV = window.SevenCards;
    const seven = function (c) { return el('div', SV.cls(c), SV.svg(c, false)); };
    piece('wild', seven(SD.makeCard('wild4')), cardTap);
    piece('seven', seven(SD.makeCard('num', 'red', 7)), cardTap);
    // minhu: a face that turns down and up
    const F = window.MinhuFaces;
    F.ensureDefs();
    const who = 13;
    const mc = el('div', 'mh-card bg-' + window.MinhuConfig.CHARACTERS[who].bg,
      '<div class="inner"><div class="front"><div class="pic">' + F.face(who) + '</div></div><div class="back">؟</div></div>');
    piece('minhu', mc, function () { mc.classList.toggle('down'); play('flip'); });
    // domino: a 6|5 tile
    const DT = window.DominoTiles;
    DT.ensureDefs();
    piece('domino', el('div', 'lp-domino', DT.tileSVG(6, 5)));
    // tawla: two dice that roll, and two checkers
    piece('dice', dice(), roll);
    piece('checkers', el('div', 'lp-checkers', '<span class="lp-ck w"></span><span class="lp-ck b"></span>'));
    // bank: a title deed and a coin
    piece('deed', el('div', 'lp-deed', '<div class="band"><small>سند ملكية</small><b>الجادرية</b></div><i class="ln"></i><i class="ln"></i><i class="ln"></i><div class="price">350</div>'), cardTap);
    // snakes: a snake
    piece('snake', el('div', null,
      '<svg class="lp-snake" viewBox="0 0 160 84" aria-hidden="true">' +
      '<path class="b1" d="M10 62 C 30 18, 56 20, 72 46 S 112 76, 128 38"/><path class="b2" d="M10 62 C 30 18, 56 20, 72 46 S 112 76, 128 38"/>' +
      '<path class="sp" d="M10 62 C 30 18, 56 20, 72 46 S 112 76, 128 38"/><path class="tg" d="M146 34 h7 l4 -4 M153 34 l4 4"/>' +
      '<ellipse class="hd" cx="134" cy="33" rx="14" ry="10.5"/><circle class="ey" cx="131" cy="28.5" r="3.4"/><circle class="pu" cx="131.8" cy="28.5" r="1.6"/>' +
      '<circle class="ey" cx="140" cy="29.5" r="3.1"/><circle class="pu" cx="140.7" cy="29.5" r="1.5"/></svg>'), function (t) { restart(t, 'lp-boop'); play('snake'); });
    piece('coin', el('div', 'lp-coin', '<span>د.ع</span>'), function (t) { restart(t, 'lp-boop'); play('knock'); });
  }

  // the dice: real cubes; faces in the order front, back, right, left, top, bottom
  const ORDER = [1, 6, 3, 4, 5, 2];
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const SHOW = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 2: [90, 0] }; // [rotateX, rotateY] that brings a face to the front
  const dies = [];
  function dice() {
    const box = el('div', 'lp-dice');
    box.append(el('span', 'lp-hint', 'ارمِ النرد!'));
    [0, 1].forEach(function () {
      const tilt = el('div', 'lp-tilt');
      const d = el('div', 'lp-die');
      ORDER.forEach(function (v) {
        const f = el('i', v === 1 ? 'one' : null);
        for (let k = 1; k <= 9; k++) f.append(el('b', PIPS[v].indexOf(k) >= 0 ? 'on' : null));
        d.append(f);
      });
      d.turn = { x: 0, y: 0 };
      setFace(d, 1 + Math.floor(Math.random() * 6), 0);
      tilt.append(d);
      box.append(tilt);
      dies.push(d);
    });
    return box;
  }
  function setFace(d, v, spins) {
    const x = (Math.floor(d.turn.x / 360) + spins) * 360 + SHOW[v][0];
    const y = (Math.floor(d.turn.y / 360) + spins) * 360 + SHOW[v][1];
    d.turn = { x: x, y: y };
    d.style.setProperty('--rx', x + 'deg');
    d.style.setProperty('--ry', y + 'deg');
  }
  function roll() {
    const hint = $('.lp-hint');
    if (hint) hint.classList.add('gone');
    dies.forEach(function (d, i) { setFace(d, 1 + Math.floor(Math.random() * 6), 2 + i); });
    play('dice');
  }

  // ---------- the table moves: the mouse, the phone's tilt, or a slow drift ----------
  function motion() {
    const hero = $('.lp-hero');
    const cv = $('.lp-dust');
    const ctx = cv.getContext && cv.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const gold = [css.getPropertyValue('--brass').trim(), css.getPropertyValue('--lp-gold-hi').trim()];
    let tx = 0, ty = 0, mx = 0, my = 0, steer = 0, visible = true, raf = 0;
    let W = 0, H = 0;
    const motes = [];
    const t0 = performance.now();
    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function spawn(m, anywhere) {
      m.x = Math.random() * W; m.y = anywhere ? Math.random() * H : H + 8;
      m.r = 0.6 + Math.random() * 1.9; m.vy = 0.1 + Math.random() * 0.32; m.vx = (Math.random() - 0.5) * 0.14;
      m.a = 0.12 + Math.random() * 0.45; m.ph = Math.random() * 6.283; m.c = gold[Math.random() < 0.3 ? 1 : 0];
    }
    size();
    const n = W < 640 ? 24 : 46;
    for (let i = 0; i < n; i++) { const m = {}; spawn(m, true); motes.push(m); }
    function tick(t) {
      raf = 0;
      if (!visible || document.hidden) return;
      if (t > steer) { // nobody steering: drift slowly
        tx = Math.sin((t - t0) / 4300) * 0.42;
        ty = Math.cos((t - t0) / 5600) * 0.32;
      }
      mx += (tx - mx) * 0.06; my += (ty - my) * 0.06;
      stage.style.setProperty('--mx', mx.toFixed(4));
      stage.style.setProperty('--my', my.toFixed(4));
      if (ctx) {
        ctx.clearRect(0, 0, W, H);
        motes.forEach(function (m) {
          m.y -= m.vy; m.x += m.vx + Math.sin(t / 2100 + m.ph) * 0.12;
          if (m.y < -8 || m.x < -8 || m.x > W + 8) spawn(m, false);
          ctx.globalAlpha = m.a * (0.55 + 0.45 * Math.sin(t / 650 + m.ph));
          ctx.fillStyle = m.c;
          ctx.beginPath(); ctx.arc(m.x - mx * m.r * 6, m.y - my * m.r * 6, m.r, 0, 6.283); ctx.fill();
        });
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(tick);
    }
    function go() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick); }
    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      const r = hero.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      steer = performance.now() + 2500;
    });
    // phones that report their tilt (Android does without asking)
    window.addEventListener('deviceorientation', function (e) {
      if (e.gamma === null || e.beta === null) return;
      tx = Math.max(-1, Math.min(1, e.gamma / 22));
      ty = Math.max(-1, Math.min(1, (e.beta - 45) / 22));
      steer = performance.now() + 1500;
    });
    window.addEventListener('resize', function () { size(); });
    document.addEventListener('visibilitychange', go);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; go(); }).observe(hero);
    }
    go();
  }

  // ---------- "I have a code" ----------
  function joinBox() {
    const form = $('.lp-join-form');
    const input = $('#join-code');
    const box = $('.lp-code');
    const slots = all('.lp-slots i', box);
    const err = $('#join-err');
    const LEN = SC.ROOM_CODE_LENGTH;
    const WHY = {
      missing: 'ما لكينا غرفة بهذا الكود. تأكد من الحروف، أو يمكن الغرفة انتهت.',
      closed: 'هاي الغرفة أنهاها المضيف. اطلب منه كود جديد.',
      busy: 'محاولات كثيرة. انتظر دقيقة وجرّب مرة ثانية.',
      short: 'الكود ' + LEN + ' أحرف إنجليزية، مثل ABCD.',
    };
    function paint() {
      const v = input.value;
      slots.forEach(function (s, i) {
        s.textContent = v[i] || '';
        s.classList.toggle('filled', !!v[i]);
        s.classList.toggle('cur', i === v.length);
      });
    }
    function bad(text) {
      err.textContent = text;
      err.hidden = false;
      restart(box, 'bad');
    }
    input.addEventListener('input', function () {
      const clean = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, LEN);
      if (clean !== input.value) input.value = clean;
      box.classList.remove('bad');
      err.hidden = true;
      paint();
    });
    input.addEventListener('focus', function () { box.classList.add('focus'); });
    input.addEventListener('blur', function () { box.classList.remove('focus'); });
    form.addEventListener('submit', function (e) {
      if (input.value.length !== LEN) { e.preventDefault(); bad(WHY.short); input.focus(); }
    });
    // "عندي كود" anywhere on the page: go to the box, ready to type
    all('a[href="#join"]').forEach(function (a) {
      a.addEventListener('click', function () { setTimeout(function () { input.focus({ preventScroll: true }); }, 500); });
    });
    // back from /join with a problem: say what, keep the letters
    const q = new URLSearchParams(location.search);
    const why = q.get('join');
    if (why) {
      input.value = (q.get('code') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, LEN);
      bad(WHY[why] || WHY.missing);
      try { history.replaceState(null, '', '/#join'); } catch (e) { /* ignore */ }
    }
    paint();
  }

  // ---------- the games list ----------
  function gameArt() {
    const D = window.ScrewDeck;
    const K = window.ScrewCards;
    // screw: back, red screw, minus one (same cards as the game)
    const art = $('#screw-art');
    [{ hidden: true }, D.makeCard('screw_red'), D.makeCard('minus1')].forEach(function (c) { art.append(el('div', 'pc', K.svg(c, false))); });
    // seven: four fanned cards in the game colours
    const sv = $('#seven-art');
    [['red', '7'], ['yellow', '+2'], ['green', 'عكس'], ['blue', '7']].forEach(function (c) { sv.append(el('div', 'pt-ucard ' + c[0], '<span>' + c[1] + '</span>')); });
    // bank: coloured bars on the border squares of a small board
    const bars = ['--g1', '--g2', '--g3', '--g4', '--g5', '--g6', '--g7', '--g8'];
    const board = $('.pt-board');
    const ring = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5];
    for (let i = 0; i < 25; i++) {
      const cell = el('i');
      const r = ring.indexOf(i);
      if (r >= 0 && r % 2 === 1) cell.style.setProperty('--bar', 'var(' + bars[(r >> 1) % bars.length] + ')');
      if ([6, 7, 8, 11, 12, 13, 16, 17, 18].indexOf(i) >= 0) cell.style.display = 'none';
      board.append(cell);
    }
    board.append(el('i', 'mid'));
    // snakes: a 5x5 checker board under the ladder and the snake
    const sq = $('#sl-squares');
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', c * 50); rect.setAttribute('y', r * 50); rect.setAttribute('width', 50); rect.setAttribute('height', 50);
        rect.setAttribute('class', (r + c) % 2 ? 'b' : 'a r' + r);
        sq.append(rect);
      }
    }
    // dice faces for bank (two) and snakes (one)
    const face = function (on) { const s = el('span'); for (let k = 1; k <= 9; k++) s.append(el('b', on.indexOf(k) >= 0 ? 'on' : null)); return s; };
    $('.pt-dice-1').append(face([1, 3, 4, 6, 7, 9]));
    const two = $('#game-bank .pt-dice');
    two.append(face([5, 9, 1, 3, 7]), face([1, 3, 5, 7, 9, 4]));
    // domino: a short line of tiles on a felt, one tile standing
    const DT = window.DominoTiles;
    DT.ensureDefs();
    const dm = $('#domino-art');
    [['h', 6, 6, 't1'], ['h', 6, 3, 't2'], ['v', 3, 1, 't3'], ['v', 5, 2, 't4']].forEach(function (t) {
      dm.append(el('span', 'pt-dt ' + t[0] + ' ' + t[3], t[0] === 'h' ? DT.tileSVGh(t[1], t[2]) : DT.tileSVG(t[1], t[2])));
    });
    // tawla: a small wooden board
    const s = $('#tawla-art');
    const NS = 'http://www.w3.org/2000/svg';
    const add = function (tag, a) { const e = document.createElementNS(NS, tag); Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); s.append(e); return e; };
    add('rect', { x: 0, y: 0, width: 220, height: 140, rx: 12, class: 'fr' });
    add('rect', { x: 8, y: 8, width: 96, height: 124, rx: 3, class: 'sf' });
    add('rect', { x: 116, y: 8, width: 96, height: 124, rx: 3, class: 'sf' });
    for (let i = 0; i < 6; i++) {
      [8, 116].forEach(function (x0) {
        const x = x0 + i * 16;
        add('path', { d: 'M' + x + ' 8 L' + (x + 16) + ' 8 L' + (x + 8) + ' 62 Z', class: i % 2 ? 'pa' : 'pb' });
        add('path', { d: 'M' + x + ' 132 L' + (x + 16) + ' 132 L' + (x + 8) + ' 78 Z', class: i % 2 ? 'pb' : 'pa' });
      });
    }
    [[124, 124, 'w'], [124, 110, 'w'], [204, 16, 'w'], [204, 30, 'w'], [16, 124, 'b'], [16, 110, 'b'], [16, 96, 'b'], [76, 16, 'b'], [76, 30, 'b'], [172, 124, 'w']].forEach(function (c) {
      add('circle', { cx: c[0], cy: c[1], r: 7, class: 'ck ' + c[2] });
    });
    [[146, 60, 5, -12], [168, 66, 3, 10]].forEach(function (d) {
      add('rect', { x: d[0], y: d[1], width: 18, height: 18, rx: 4, class: 'dz', transform: 'rotate(' + d[3] + ' ' + (d[0] + 9) + ' ' + (d[1] + 9) + ')' });
    });
    // lagta: two round cards with a few symbols each (the shared one glows)
    const LS = window.LagtaConfig.SYMBOLS;
    const lgBox = $('#lagta-art');
    [[[8, 12, 23, 45, 32], 'a'], [[8, 16, 40, 54, 26], 'b']].forEach(function (c) {
      const card = el('div', 'pt-lgc ' + c[1]);
      c[0].forEach(function (sym, i) { const e = el('span', 'p' + i + (sym === 8 ? ' hit' : '')); e.textContent = LS[sym]; card.append(e); });
      lgBox.append(card);
    });
    // minhu: three faces, one turned down
    const F = window.MinhuFaces;
    F.ensureDefs();
    const mh = $('#minhu-art');
    [[5, ''], [13, ''], [20, ' down']].forEach(function (c) {
      mh.append(el('div', 'mh-card bg-' + window.MinhuConfig.CHARACTERS[c[0]].bg + c[1],
        '<div class="inner"><div class="front"><div class="pic">' + F.face(c[0]) + '</div></div><div class="back">؟</div></div>'));
    });
  }

  // every room saved on this device gets a way back
  function resume() {
    try {
      const saved = [['screw', 'سكرو', '/screw.html'], ['seven', 'سبعة وسبعة', '/seven.html'], ['bank', 'بنك الحظ', '/bank.html'], ['snakes', 'حية ودرج', '/snakes.html'], ['domino', 'دومنو', '/domino.html'], ['tawla', 'طاولي', '/tawla.html'], ['lagta', 'لقطة!', '/lagta.html'], ['minhu', 'منو هو؟', '/minhu.html']].map(function (g) {
        const s = JSON.parse(localStorage.getItem(g[0] + '.session') || 'null');
        return s && s.code ? { code: s.code, name: g[1], url: g[2] } : null;
      }).filter(Boolean);
      if (!saved.length) return;
      const box = $('#resume');
      box.append(el('div', 'pt-rtitle', saved.length > 1 ? 'عندك غرف مفتوحة' : 'عندك غرفة مفتوحة'));
      saved.forEach(function (r) {
        const a = el('a', 'pt-back');
        a.href = r.url + '?room=' + encodeURIComponent(r.code);
        const t = el('span');
        const b1 = el('b');
        b1.textContent = r.name;
        const b2 = el('b', 'code');
        b2.textContent = r.code;
        t.append(b1, ' · الغرفة ', b2);
        a.append(t, el('span', 'go', 'ارجع'));
        box.append(a);
      });
      box.hidden = false;
    } catch (e) { /* storage unavailable: no shortcut */ }
  }

  // the filters: show one kind of game, remembered for next time
  function filters() {
    const cards = all('.pt-card');
    const chips = all('.pt-filters button');
    function show(cat) {
      chips.forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.cat === cat ? 'true' : 'false'); });
      cards.forEach(function (c) { c.hidden = cat !== 'all' && c.dataset.cat !== cat; });
      try { localStorage.setItem('portal.cat', cat); } catch (e) { /* no storage */ }
    }
    chips.forEach(function (c) { c.addEventListener('click', function () { show(c.dataset.cat); }); });
    try {
      const last = localStorage.getItem('portal.cat');
      if (last && chips.some(function (c) { return c.dataset.cat === last; })) show(last);
    } catch (e) { /* no storage */ }
  }

  // ---------- small touches ----------
  function reveal() {
    const items = all('.lp-reveal');
    if (reduce || !('IntersectionObserver' in window)) { items.forEach(function (n) { n.classList.add('in'); }); return; }
    // siblings come in one after another
    items.forEach(function (n) {
      const sibs = all(':scope > .lp-reveal', n.parentNode);
      n.style.setProperty('--rd', (sibs.indexOf(n) % 4) * 80 + 'ms');
    });
    const io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
        if (e.target.classList.contains('lp-stats')) countUp(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach(function (n) { io.observe(n); });
  }

  function countUp(box) {
    all('[data-count]', box).forEach(function (b) {
      const to = Number(b.dataset.count);
      const suffix = b.dataset.suffix || '';
      const start = performance.now();
      (function step(t) {
        const p = Math.min(1, (t - start) / 1100);
        b.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suffix;
        if (p < 1) requestAnimationFrame(step);
      })(start);
    });
  }

  // a game card leans toward the mouse, with a soft light where it points
  function tiltCards() {
    if (!fine || reduce) return;
    all('.pt-card').forEach(function (c) {
      c.addEventListener('pointermove', function (e) {
        const r = c.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        c.style.setProperty('--tx', ((px - 0.5) * 7).toFixed(2) + 'deg');
        c.style.setProperty('--ty', ((0.5 - py) * 7).toFixed(2) + 'deg');
        c.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        c.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      });
      c.addEventListener('pointerleave', function () { c.style.removeProperty('--tx'); c.style.removeProperty('--ty'); });
    });
  }

  function topBar() {
    const bar = $('#lp-top');
    const set = function () { bar.classList.toggle('scrolled', window.scrollY > 24); };
    window.addEventListener('scroll', set, { passive: true });
    set();
  }

  // each part on its own: one that fails never leaves the page hidden or dead
  [reveal, joinBox, buildTable, gameArt, resume, filters, topBar, tiltCards, reduce ? null : motion].forEach(function (fn) {
    if (!fn) return;
    try { fn(); } catch (e) { if (window.console) console.error(e); }
  });
})();
