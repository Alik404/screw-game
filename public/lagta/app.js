// "Lagta!" client: connection, lobby, the two round cards, the race.
(function () {
  const C = window.LagtaConfig;
  const SC = window.ScrewConfig;
  const SND = window.ScrewSound;
  const rootEl = document.getElementById('lg-root');
  const GAME = 'lagta';

  // ---------- helpers ----------
  function h(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (p) { if (p.slice(0, 2) === '--') el.style.setProperty(p, v[p]); else el.style[p] = v[p]; });
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(el, k); }); return; }
    el.append(kid.nodeType ? kid : String(kid));
  }
  const ICONS = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.8l6.6-4M8.7 13.2l6.6 4"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/><path d="M5 21h14"/>',
    sound: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16.5h6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  };
  function icon(name, size) {
    const s = document.createElement('span');
    s.className = 'ico';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
    return s;
  }
  const EMOJI = { laugh: '😂', wow: '😮', angry: '😡', cry: '😭', clap: '👏', pray: '🤲', fire: '🔥', snake: '🐍' };
  function store(key, value) {
    try {
      if (value === undefined) { const v = localStorage.getItem(key); return v === null ? null : JSON.parse(v); }
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable */ }
    return null;
  }
  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function buzz(p) { if (!navigator.vibrate) return; if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; try { navigator.vibrate(p); } catch (e) { /* ignore */ } }

  // the same tiny random generator as the engines, so a card always looks the same
  function seeded(n) {
    let st = (n * 2654435761) >>> 0;
    return function () {
      st = (st + 0x6d2b79f5) >>> 0;
      let t = st;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // the deck (same construction as the server): any two cards share exactly one symbol
  const DECK = (function (n) {
    const cards = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const c = []; for (let k = 0; k < n; k++) c.push(k * n + ((i * k + j) % n)); c.push(n * n + i); cards.push(c); }
    for (let j = 0; j < n; j++) { const c = []; for (let k = 0; k < n; k++) c.push(j * n + k); c.push(n * n + n); cards.push(c); }
    const inf = []; for (let i = 0; i <= n; i++) inf.push(n * n + i); cards.push(inf);
    return cards;
  })(C.ORDER);
  function common(a, b) { return DECK[a].find(function (x) { return DECK[b].indexOf(x) >= 0; }); }

  // where each symbol sits on a card: one in the middle, seven around, sizes and turns from the card's number
  function layout(card) {
    const r = seeded(card + 17);
    const syms = DECK[card].slice();
    for (let i = syms.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = syms[i]; syms[i] = syms[j]; syms[j] = t; }
    const start = r() * Math.PI * 2;
    return syms.map(function (s, i) {
      if (i === 0) return { s: s, x: 50, y: 50, k: 0.95 + r() * 0.25, rot: Math.round(r() * 60 - 30) };
      const a = start + (i - 1) * (Math.PI * 2 / 7) + (r() - 0.5) * 0.25;
      const rad = 30.5 + (r() - 0.5) * 3;
      return { s: s, x: 50 + Math.cos(a) * rad, y: 50 + Math.sin(a) * rad, k: 0.78 + r() * 0.5, rot: Math.round(r() * 90 - 45) };
    });
  }

  const params = new URLSearchParams(location.search);
  let urlCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, SC.ROOM_CODE_LENGTH);
  const pageStart = Date.now();
  function savedOptions() {
    const o = store(GAME + '.options') || {};
    return { size: C.SIZES.indexOf(o.size) >= 0 ? o.size : C.DEFAULT_SIZE, level: C.LEVELS.indexOf(o.level) >= 0 ? o.level : C.DEFAULT_LEVEL, hint: typeof o.hint === 'boolean' ? o.hint : C.DEFAULT_HINT };
  }

  const S = {
    status: 'connecting', name: store('screw.name') || '', codeInput: urlCode, session: store(GAME + '.session'), autoJoining: false,
    you: null, room: null, game: null, names: {}, opts: savedOptions(), optsSent: null, sheet: null, toast: null, homeError: '',
    bootId: null, serverRestarted: false, lost: null, disconnectedAt: null, reacts: false,
    frozenUntil: 0, countdownEnd: 0, flash: null, // flash: {symbol, by, at}
    cardSeq: 0, cardAt: 0, // when the middle card appeared (for the hint)
  };

  // ---------- network ----------
  let ws = null; let attempts = 0; let retryTimer = null;
  function connect() {
    clearTimeout(retryTimer);
    if (ws && ws.readyState < 2) { ws.onclose = null; ws.close(); }
    ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host);
    ws.onopen = function () {
      attempts = 0; S.status = 'open'; S.disconnectedAt = null;
      if (S.session && (!urlCode || urlCode === S.session.code || S.you)) { S.autoJoining = true; sendRaw({ type: 'join_room', code: S.session.code, name: S.session.name, playerId: S.session.playerId }); }
      render();
    };
    ws.onmessage = function (ev) { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMessage(m); };
    ws.onclose = function () {
      if (!S.disconnectedAt) S.disconnectedAt = Date.now();
      S.status = 'reconnecting'; attempts += 1; retryTimer = setTimeout(connect, Math.min(1000 * attempts, 5000)); render();
    };
  }
  function sendRaw(msg) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; } return false; }
  function send(msg) { if (!sendRaw(msg)) { toast('لا يوجد اتصال. جاري إعادة المحاولة…'); return false; } render(); return true; }
  function toast(text, ok) { S.toast = { text: text, ok: !!ok, until: Date.now() + 3000 }; render(); }
  function leaveRoom() {
    S.session = null; store(GAME + '.session', null);
    S.you = null; S.room = null; S.game = null; S.sheet = null; urlCode = ''; S.codeInput = '';
    try { history.replaceState(null, '', '/lagta.html'); } catch (e) { /* ignore */ }
  }

  function onMessage(m) {
    switch (m.type) {
      case 'hello': if (S.bootId && m.bootId !== S.bootId) S.serverRestarted = true; S.bootId = m.bootId; break;
      case 'joined':
        if (m.game && m.game !== GAME) { store(m.game + '.session', { code: m.code, playerId: m.playerId, name: S.name }); location.replace('/' + m.game + '.html?room=' + m.code); return; }
        S.lost = null; S.autoJoining = false; S.you = m.you;
        S.session = { code: m.code, playerId: m.playerId, name: S.name || (S.session && S.session.name) || '' };
        store(GAME + '.session', S.session); S.homeError = '';
        try { history.replaceState(null, '', '/lagta.html?room=' + m.code); } catch (e) { /* ignore */ }
        break;
      case 'room_state':
        S.room = m;
        m.players.forEach(function (p) { S.names[p.id] = p.name; });
        if (m.phase === 'lobby' && m.hostId === S.you && !m.options && S.optsSent !== m.code) { S.optsSent = m.code; sendRaw({ type: 'set_options', options: S.opts }); }
        break;
      case 'game_state':
        S.game = m;
        m.players.forEach(function (p) { S.names[p.id] = p.name; });
        if (m.phase === 'countdown' && !S.countdownEnd) S.countdownEnd = Date.now() + C.COUNTDOWN_SECONDS * 1000;
        if (m.phase !== 'countdown') S.countdownEnd = 0;
        // a new middle card: the hint clock starts again
        if (m.phase === 'play' && m.seq !== S.cardSeq) {
          S.cardSeq = m.seq;
          S.cardAt = Date.now();
          if (m.options && m.options.hint) setTimeout(render, C.HINT_SECONDS * 1000 + 30);
        }
        break;
      case 'event': onEvent(m.event); break;
      case 'reaction': showReaction(m.from, m.id); return;
      case 'room_closed': {
        const mine = m.by === S.you;
        window.RoomEnd.dismiss();
        leaveRoom();
        if (mine) toast('أنهيت الغرفة.', true); else S.lost = { text: m.text };
        break;
      }
      case 'left_room':
        window.RoomEnd.dismiss();
        leaveRoom();
        toast('خرجت من الغرفة.', true);
        break;
      case 'player_left':
        toast(m.name + ' خرج من الغرفة.');
        break;
      case 'error':
        if (S.autoJoining) {
          S.autoJoining = false; leaveRoom();
          if (m.code === 'NO_ROOM' || m.code === 'ROOM_CLOSED') S.lost = { restarted: S.serverRestarted, text: m.code === 'ROOM_CLOSED' ? m.message : '' }; else { S.homeError = m.message; toast(m.message); }
        } else if (/انتظر الكرت|مجمّد/.test(m.message)) {
          // a race lost by a hair, or a tap while frozen: nothing to tell
        } else { if (!S.you) S.homeError = m.message; toast(m.message); }
        break;
      default: break;
    }
    render();
  }

  function nm(id) { return S.names[id] || '؟'; }
  function isMe(id) { return id === S.you; }

  // ---------- effects ----------
  function rectOf(sel) { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? r : null; }
  function floatText(text, rect, cls) {
    const el = h('div', { class: 'lg-float ' + (cls || '') }, text);
    el.style.left = (rect ? rect.left + rect.width / 2 : innerWidth / 2) + 'px';
    el.style.top = (rect ? rect.top + rect.height / 2 : innerHeight / 2) + 'px';
    document.body.append(el);
    setTimeout(function () { el.remove(); }, 1300);
  }
  function showReaction(from, id) {
    if (!EMOJI[id]) return;
    const r = rectOf('[data-seat="' + from + '"]') || rectOf('[data-chip="' + from + '"]');
    const el = h('div', { class: 'lg-react', 'aria-hidden': 'true' }, h('span', null, EMOJI[id]), h('small', null, nm(from)));
    el.style.left = (r ? r.left + r.width / 2 : innerWidth / 2) + 'px';
    el.style.top = (r ? r.top : innerHeight / 2) + 'px';
    document.body.append(el);
    setTimeout(function () { el.remove(); }, 2300);
  }
  function confetti() {
    if (reduced()) return;
    const box = h('div', { class: 'lg-confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 70; i++) box.append(h('i', { class: 'c' + (i % 5), style: { left: Math.random() * 100 + '%', '--d': (Math.random() * 0.8).toFixed(2) + 's', '--x': (Math.random() * 160 - 80).toFixed(0) + 'px', '--r': (Math.random() * 720 - 360).toFixed(0) + 'deg' } }));
    document.body.append(box);
    setTimeout(function () { box.remove(); }, 3600);
  }

  function onEvent(e) {
    switch (e.type) {
      case 'countdown':
        S.countdownEnd = Date.now() + e.seconds * 1000;
        S.flash = null;
        for (let i = 0; i < e.seconds; i++) setTimeout(function () { SND.play('turn'); }, i * 1000);
        break;
      case 'card':
        S.flash = null;
        SND.play('deal');
        break;
      case 'claim':
        S.flash = { symbol: e.symbol, by: e.playerId, at: Date.now() };
        if (isMe(e.playerId)) { SND.play('ladder'); buzz(40); setTimeout(function () { floatText('+1', rectOf('.lg-card.mine'), 'good'); }, 60); } else {
          SND.play('flip');
          setTimeout(function () { floatText('+1', rectOf('[data-seat="' + e.playerId + '"]'), 'other'); }, 60);
        }
        break;
      case 'miss':
        if (isMe(e.playerId)) { S.frozenUntil = Date.now() + e.ms; SND.play('knock'); buzz([60, 40, 60]); setTimeout(function () { S.frozenUntil = 0; render(); }, e.ms + 30); } else {
          const el = document.querySelector('[data-seat="' + e.playerId + '"]');
          if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
        }
        break;
      case 'skip':
        S.flash = null;
        toast('ما أحد لقطها! الكرت انشال.', true);
        break;
      case 'game_over':
        setTimeout(function () { if (e.winnerIds.indexOf(S.you) >= 0) { confetti(); SND.play('win'); } }, 300);
        break;
      default: break;
    }
  }

  // ---------- cards ----------
  function cardEl(card, o) {
    o = o || {};
    const el = h('div', { class: 'lg-card ' + (o.cls || ''), 'data-card': card });
    const face = h('div', { class: 'lg-face' });
    el.append(face);
    if (card === null || card === undefined) { face.classList.add('back'); face.append(h('div', { class: 'lg-backmark' }, 'لقطة!')); return el; }
    layout(card).forEach(function (p) {
      const hit = o.flash !== undefined && o.flash === p.s;
      const b = h('button', {
        class: 'lg-sym' + (hit ? ' hit' : '') + (o.hint === p.s ? ' hint' : ''), 'aria-label': 'رمز', 'data-sym': p.s,
        style: { left: p.x + '%', top: p.y + '%', '--k': p.k, '--rot': p.rot + 'deg' },
        disabled: !o.tap,
      }, h('span', null, C.SYMBOLS[p.s]));
      if (o.tap) b.addEventListener('pointerdown', function (ev) { ev.preventDefault(); claim(p.s, b); });
      face.append(b);
    });
    return el;
  }

  function claim(sym, btn) {
    const v = S.game;
    if (!v || v.phase !== 'play') return;
    if (Date.now() < S.frozenUntil) return;
    if (btn) { btn.classList.remove('tap'); void btn.offsetWidth; btn.classList.add('tap'); }
    sendRaw({ type: 'claim', symbol: sym });
  }

  // ---------- screens ----------
  function homeScreen() {
    const offline = S.status !== 'open';
    const name = h('input', { type: 'text', placeholder: 'اسمك', maxlength: SC.NAME_MAX_LENGTH, value: S.name, autocomplete: 'nickname', 'aria-label': 'اسمك', oninput: function (e) { S.name = e.target.value; store('screw.name', S.name); } });
    const code = h('input', { type: 'text', class: 'code', placeholder: 'الكود', maxlength: SC.ROOM_CODE_LENGTH, value: S.codeInput, dir: 'ltr', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'كود الغرفة', oninput: function (e) { S.codeInput = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); e.target.value = S.codeInput; } });
    const create = function () { if (!S.name.trim()) { S.homeError = 'اكتب اسمك أولاً.'; render(); return; } S.homeError = ''; sendRaw({ type: 'create_room', name: S.name, game: GAME }); };
    const join = function () {
      if (!S.name.trim()) { S.homeError = 'اكتب اسمك أولاً.'; render(); return; }
      if (S.codeInput.length !== SC.ROOM_CODE_LENGTH) { S.homeError = 'اكتب كود الغرفة (' + SC.ROOM_CODE_LENGTH + ' أحرف).'; render(); return; }
      S.homeError = '';
      sendRaw({ type: 'join_room', code: S.codeInput, name: S.name, playerId: S.session && S.session.code === S.codeInput ? S.session.playerId : undefined });
    };
    const lost = S.lost ? h('div', { class: 'lost', role: 'alert' }, h('h2', null, 'انتهت الغرفة'),
      h('p', null, S.lost.text ? S.lost.text : S.lost.restarted ? 'أُعيد تشغيل الخادم فضاعت الغرف المفتوحة. أنشئ غرفة جديدة.' : 'هذه الغرفة لم تعد موجودة: تُحذف بعد ' + SC.ROOM_IDLE_MINUTES + ' دقيقة بلا لاعبين.'),
      h('button', { class: 'primary', onclick: function () { S.lost = null; create(); }, disabled: offline }, 'إنشاء غرفة جديدة'),
      h('button', { onclick: function () { S.lost = null; render(); } }, 'إغلاق')) : null;
    return h('div', { class: 'screen lg-home' },
      h('div', { class: 'lg-hero' },
        h('div', { class: 'lg-hero-cards', 'aria-hidden': 'true' }, cardEl(5, { cls: 'hero a' }), cardEl(40, { cls: 'hero b' })),
        h('div', { class: 'lg-logo' }, 'لقطة!'),
        h('div', { class: 'lg-tag' }, 'كل كرتين بينهم رمز واحد مشترك. شوفه أسرع من الكل.')),
      lost,
      h('div', { class: 'form' }, name,
        offline && Date.now() - pageStart > 4000 ? h('div', { class: 'center dim small' }, 'الخادم يستيقظ… قد يأخذ حتى دقيقة.') : null,
        urlCode
          ? [h('div', { class: 'row' }, code), h('button', { class: 'primary', onclick: join, disabled: offline }, 'دخول الغرفة'), h('div', { class: 'or' }, 'أو'), h('button', { onclick: create, disabled: offline }, 'إنشاء غرفة جديدة')]
          : [h('button', { class: 'primary', onclick: create, disabled: offline }, 'إنشاء غرفة'), h('div', { class: 'or' }, 'أو ادخل بالكود'), h('div', { class: 'row' }, code, h('button', { onclick: join, disabled: offline }, 'دخول'))],
        S.homeError ? h('div', { class: 'error', role: 'alert' }, S.homeError) : null,
        h('div', { class: 'center dim small' }, 'وحدك؟ أنشئ غرفة وتسابق ويا الكمبيوتر.'),
        h('a', { class: 'all-games', href: '/' }, 'كل الألعاب')));
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) { const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove(); if (ok) res(); else rej(new Error('copy')); });
  }
  function share(code) {
    const url = location.origin + '/lagta.html?room=' + code;
    if (navigator.share) { navigator.share({ title: 'لقطة!', text: 'تعال نلعب لقطة! كود الغرفة: ' + code, url: url }).catch(function () {}); return; }
    copyText(url).then(function () { toast('تم نسخ الرابط', true); }, function () { toast('الرابط: ' + url); });
  }
  function avatar(p, i, cls) { return h('span', { class: 'lg-av' + (cls ? ' ' + cls : ''), style: { '--pc': 'var(--lg-p' + ((i % 8) + 1) + ')' } }, p.bot ? icon('bot', 16) : (Array.from(p.name)[0] || '؟')); }
  function roomOpts() { return (S.room && S.room.options) || S.opts; }
  function setOpt(k, v) { S.opts = Object.assign({}, roomOpts()); S.opts[k] = v; store(GAME + '.options', S.opts); send({ type: 'set_options', options: S.opts }); }
  function seg(label, key, values, names, notes) {
    return h('div', { class: 'lg-opt' }, h('div', { class: 'dim small' }, label), h('div', { class: 'lg-seg' }, values.map(function (v) {
      return h('button', { 'aria-pressed': roomOpts()[key] === v ? 'true' : 'false', onclick: function () { setOpt(key, v); } }, h('span', null, names[v]), notes ? h('small', null, notes[v]) : null);
    })));
  }
  function reactButton(cls) { return h('button', { class: 'icon-btn lg-reactbtn' + (cls ? ' ' + cls : ''), 'aria-label': 'تفاعل', 'aria-expanded': S.reacts ? 'true' : 'false', onclick: function () { S.reacts = !S.reacts; render(); } }, icon('smile', 24)); }
  function reactRow() { return h('div', { class: 'lg-reacts', role: 'toolbar' }, SC.REACTIONS.map(function (id) { return h('button', { 'aria-label': id, onclick: function () { S.reacts = false; send({ type: 'react', id: id }); } }, EMOJI[id]); })); }

  function lobbyScreen() {
    const r = S.room;
    const amHost = r.hostId === S.you;
    const present = r.players.filter(function (p) { return p.connected; }).length;
    const o = roomOpts();
    return h('div', { class: 'screen lobby lg-lobby' },
      h('div', { class: 'lobby-head' }, h('div', { class: 'dim center' }, 'كود الغرفة'), h('div', { class: 'code-box', dir: 'ltr' }, r.code),
        h('button', { class: 'with-icon', onclick: function () { share(r.code); } }, icon('share', 20), 'مشاركة الرابط')),
      h('div', { class: 'dim' }, 'اللاعبون (' + r.players.length + '/' + C.MAX_PLAYERS + ')'),
      h('ul', { class: 'plist' }, r.players.map(function (p, i) {
        return h('li', { class: p.connected ? '' : 'off', 'data-chip': p.id }, avatar(p, i),
          h('span', { class: 'pname' }, p.name + (p.id === S.you ? ' (أنت)' : '')), p.isHost ? h('span', { class: 'tag' }, 'المضيف') : null,
          p.bot && amHost ? h('button', { class: 'icon-btn lg-rm', 'aria-label': 'احذف ' + p.name, onclick: function () { send({ type: 'remove_bot', id: p.id }); } }, icon('close', 20)) : null);
      })),
      amHost && r.players.length < C.MAX_PLAYERS ? h('button', { class: 'with-icon', onclick: function () { send({ type: 'add_bot' }); } }, icon('bot', 20), 'أضف لاعب كمبيوتر') : null,
      amHost ? h('div', { class: 'lg-opts' },
        seg('طول اللعبة', 'size', C.SIZES, { 20: '20 كرت', 30: '30 كرت', 50: '50 كرت' }, C.SIZE_NAMES),
        seg('سرعة الكمبيوتر', 'level', C.LEVELS, C.LEVEL_NAMES, { easy: 'يلقط ببطء', normal: 'مثل الناس', hard: 'سريع جداً' }),
        seg('التلميح', 'hint', [true, false], { true: 'يلمع', false: 'بلا تلميح' }, { true: 'بعد ' + C.HINT_SECONDS + ' ثانية', false: 'تحدّي' }))
        : h('div', { class: 'lg-rules' }, h('b', null, 'قواعد الغرفة'), h('span', null, o.size + ' كرت · الكمبيوتر ' + C.LEVEL_NAMES[o.level] + (o.hint === false ? ' · بلا تلميح' : ' · بتلميح'))),
      h('div', { class: 'lg-lobbyrow' }, h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('help', 20), 'طريقة اللعب'), reactButton('boxed')),
      S.reacts ? reactRow() : null,
      h('div', { class: 'grow' }),
      amHost ? [present < 2 ? h('div', { class: 'center dim' }, 'أرسل الرابط أو أضف لاعب كمبيوتر.') : null,
        h('button', { class: 'primary big', disabled: present < 2, onclick: function () { send(r.options ? { type: 'start_game' } : { type: 'start_game', options: S.opts }); } }, 'ابدأ')]
        : h('div', { class: 'center dim' }, 'بانتظار المضيف…'),
      window.RoomEnd.button(),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  function gameScreen() {
    const v = S.game;
    const now = Date.now();
    const order = v.players.slice().sort(function (a, b) { return b.count - a.count; });
    const lead = order[0].count;
    const flash = S.flash && v.last && S.flash.symbol === v.last.symbol ? S.flash : null;
    const frozen = now < S.frozenUntil;
    const hint = v.phase === 'play' && v.options.hint !== false && S.cardAt && now - S.cardAt >= C.HINT_SECONDS * 1000 ? common(v.mine, v.center) : -1;
    const top = h('header', { class: 'lg-top' },
      h('span', { class: 'brand' }, 'لقطة!'),
      h('div', { class: 'lg-progress', 'aria-label': 'باقي ' + v.left + ' كرت' },
        h('div', { class: 'bar' }, h('i', { style: { width: Math.round((1 - v.left / v.total) * 100) + '%' } })),
        h('span', null, 'باقي ', h('b', null, v.left + (v.phase === 'play' ? 1 : 0)))),
      h('span', { class: 'lg-topbtns' },
        h('button', { class: 'icon-btn', 'aria-label': 'طريقة اللعب', onclick: function () { S.sheet = 'help'; render(); } }, icon('help')),
        h('button', { class: 'icon-btn', 'aria-label': 'القائمة', onclick: function () { S.sheet = 'menu'; render(); } }, icon('menu'))));
    const chips = h('div', { class: 'lg-players' }, v.players.map(function (p) {
      const i = v.playerIds.indexOf(p.id);
      return h('div', { class: 'lg-chip' + (p.id === v.you ? ' me' : '') + (p.connected ? '' : ' off') + (p.count === lead && lead > 0 ? ' lead' : '') + (flash && flash.by === p.id ? ' won' : ''), 'data-seat': p.id },
        avatar(p, i, 'sm'), h('span', { class: 'nm' }, p.id === v.you ? 'أنت' : p.name), h('b', { class: 'cnt' }, p.count));
    }));

    let center;
    if (v.phase === 'countdown') {
      const left = Math.max(1, Math.ceil((S.countdownEnd - now) / 1000));
      center = h('div', { class: 'lg-slot center' }, cardEl(null, { cls: 'middle' }), h('div', { class: 'lg-count', id: 'lg-count' }, left));
    } else if (v.phase === 'between' && v.last) {
      const mine = isMe(v.last.playerId);
      center = h('div', { class: 'lg-slot center' },
        cardEl(v.last.card, { cls: 'middle leaving ' + (mine ? 'to-me' : 'to-top'), flash: v.last.symbol }),
        h('div', { class: 'lg-who' + (mine ? ' me' : '') }, mine ? 'لقطتها!' : nm(v.last.playerId) + ' لقطها'));
    } else if (v.phase === 'between') {
      center = h('div', { class: 'lg-slot center' }, cardEl(null, { cls: 'middle' }));
    } else {
      center = h('div', { class: 'lg-slot center' }, cardEl(v.center, { cls: 'middle arriving', tap: !frozen, hint: hint }));
    }
    const mineCard = h('div', { class: 'lg-slot mine' + (frozen ? ' frozen' : '') },
      cardEl(v.mine, { cls: 'mine' + (v.phase === 'between' && v.last && isMe(v.last.playerId) ? ' fresh' : ''), tap: v.phase === 'play' && !frozen, hint: hint, flash: v.phase === 'between' && v.last && isMe(v.last.playerId) ? v.last.symbol : undefined }),
      frozen ? h('div', { class: 'lg-freeze' }, h('b', null, '❄'), h('span', null, 'غلط! انتظر لحظة')) : null);
    return h('div', { class: 'lg-app' },
      top, chips,
      h('div', { class: 'lg-table' },
        h('div', { class: 'lg-col' }, h('div', { class: 'lg-label' }, 'الوسط'), center),
        h('div', { class: 'lg-col' }, h('div', { class: 'lg-label me' }, 'كرتك', reactButton()), mineCard)),
      S.reacts ? h('div', { class: 'lg-reactwrap' }, reactRow()) : null,
      h('div', { class: 'lg-hint' }, v.phase === 'play' ? 'اضغط الرمز المشترك بين الكرتين' : v.phase === 'countdown' ? 'جهّز عيونك…' : ''));
  }

  function finalScreen() {
    const v = S.game;
    const amHost = S.room && S.room.hostId === S.you;
    const order = v.players.slice().sort(function (a, b) { return b.count - a.count; });
    const winners = v.winnerIds || [];
    const iWon = winners.indexOf(v.you) >= 0;
    return h('div', { class: 'screen final lg-final' },
      h('div', { class: 'dim center' }, v.endedEarly ? 'أنهى المضيف اللعبة' : 'خلصت الكروت'),
      h('div', { class: 'winner' + (iWon ? ' me' : '') }, h('div', { class: 'crown' }, icon('crown', 56)),
        h('div', { class: 'w-name' }, winners.map(function (id) { return isMe(id) ? 'أنت' : nm(id); }).join(' و ')),
        h('div', { class: 'dim' }, winners.length > 1 ? 'تعادل' : (iWon ? 'أسرع عين بالغرفة!' : 'أسرع عين'))),
      h('ol', { class: 'lg-rank' }, order.map(function (p, k) {
        const i = v.playerIds.indexOf(p.id);
        return h('li', { class: p.id === v.you ? 'me' : '' }, h('span', { class: 'pos' }, k + 1), avatar(p, i, 'sm'),
          h('span', { class: 'nm' }, p.id === v.you ? 'أنت' : p.name), p.misses ? h('small', { class: 'dim' }, p.misses + ' غلط') : null, h('b', null, p.count));
      })),
      h('div', { class: 'grow' }),
      amHost ? h('button', { class: 'primary big', onclick: function () { send({ type: 'new_game' }); } }, 'لعبة جديدة') : h('div', { class: 'center dim' }, 'بانتظار المضيف…'),
      window.RoomEnd.button(),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  function sheet(title, body, onClose) {
    return h('div', { class: 'sheet-wrap', onclick: function (e) { if (e.target === e.currentTarget && onClose) onClose(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'sheet-head' }, h('h2', null, title), onClose ? h('button', { class: 'icon-btn', onclick: onClose, 'aria-label': 'إغلاق' }, icon('close')) : null), body));
  }
  function closeSheet() { S.sheet = null; render(); }
  function menuSheet() {
    const muted = SND.isMuted();
    const amHost = S.room && S.room.hostId === S.you;
    return sheet('القائمة', h('div', { class: 'menu-list' },
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('help', 20), 'طريقة اللعب'),
      h('button', { class: 'with-icon', onclick: function () { SND.setMuted(!muted); render(); } }, icon(muted ? 'mute' : 'sound', 20), muted ? 'الصوت مكتوم - اضغط للتشغيل' : 'الصوت يعمل - اضغط للكتم'),
      amHost && S.game.phase !== 'gameOver' ? h('button', { class: 'with-icon danger', onclick: function () { S.sheet = null; send({ type: 'end_game' }); } }, icon('flag', 20), 'إنهاء اللعبة الآن') : null,
      window.RoomEnd.button(),
      h('a', { class: 'lg-link', href: '/' }, 'كل الألعاب'),
      h('div', { class: 'dim small center' }, 'الغرفة ' + (S.room ? S.room.code : ''))), closeSheet);
  }
  function helpSheet() {
    const li = function (t) { return h('li', null, t); };
    return sheet('طريقة اللعب', h('div', { class: 'menu-list' },
      h('div', { class: 'lg-helpart' }, cardEl(12, { cls: 'help' }), cardEl(3, { cls: 'help' })),
      h('ul', { class: 'help-list' },
        li('عندك كرت، وبالوسط كرت. بين أي كرتين في اللعبة رمز واحد بس مشترك.'),
        li('أول واحد يشوف الرمز المشترك بين كرته وكرت الوسط ويضغطه، يأخذ كرت الوسط ويصير هو كرته الجديد.'),
        li('اضغط الرمز على أي كرت من الاثنين. الرموز تختلف بالحجم والميلان، فدقّق!'),
        li('ضغطة غلط تجمّدك ثانيتين.'),
        li('لما تخلص الكروت، يفوز اللي جمع أكثر كروت.'))), closeSheet);
  }
  function disconnectSheet(now) {
    const secs = Math.floor((now - S.disconnectedAt) / 1000);
    return h('div', { class: 'sheet-wrap blocking' }, h('div', { class: 'sheet disconnect', role: 'alertdialog' },
      h('div', { class: 'sheet-head' }, h('h2', null, 'انقطع الاتصال بالخادم')),
      h('p', null, 'نحاول إعادة الاتصال تلقائياً…'), h('div', { class: 'dim small' }, 'مضى ' + secs + ' ثانية'),
      h('div', { class: 'btns' }, h('button', { class: 'primary', onclick: function () { attempts = 0; connect(); render(); } }, 'أعد المحاولة الآن'),
        secs >= 60 ? h('button', { onclick: function () { leaveRoom(); render(); } }, 'الصفحة الرئيسية') : null)));
  }

  function render() {
    const now = Date.now();
    if (S.toast && S.toast.until <= now) S.toast = null;
    const v = S.game;
    let screen;
    const overlays = [];
    if (!S.you || !S.room) screen = h('div', { class: 'lg-shell' }, homeScreen());
    else if (v && v.phase === 'gameOver') screen = h('div', { class: 'lg-shell' }, finalScreen());
    else if (v) screen = gameScreen();
    else screen = h('div', { class: 'lg-shell' }, lobbyScreen());
    if (v && S.sheet === 'menu') overlays.push(menuSheet());
    if (S.sheet === 'help') overlays.push(helpSheet());
    if (S.you && S.status !== 'open' && S.disconnectedAt && now - S.disconnectedAt > 3000) overlays.push(disconnectSheet(now));
    const nodes = [];
    if (S.status !== 'open') nodes.push(h('div', { class: 'banner', role: 'status' }, S.status === 'connecting' ? 'جاري الاتصال…' : 'انقطع الاتصال. جاري إعادة الاتصال…'));
    nodes.push(screen);
    overlays.forEach(function (o) { nodes.push(o); });
    if (S.toast) nodes.push(h('div', { class: 'toast' + (S.toast.ok ? ' ok' : ''), role: 'alert' }, S.toast.text));
    rootEl.replaceChildren.apply(rootEl, nodes);
  }

  setInterval(function () {
    const c = document.getElementById('lg-count');
    if (c && S.countdownEnd) c.textContent = Math.max(1, Math.ceil((S.countdownEnd - Date.now()) / 1000));
    if (S.status !== 'open' && Date.now() - (S.lastSlow || 0) > 1000) { S.lastSlow = Date.now(); render(); }
    if (S.toast && S.toast.until <= Date.now()) render();
  }, 200);
  let resizeT = null;
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(render, 120); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && (S.sheet || S.reacts)) { S.reacts = false; closeSheet(); } });

  window.RoomEnd.init({
    send: send,
    isHost: function () { return !!S.room && S.room.hostId === S.you; },
    stage: function () { return !S.game ? 'lobby' : S.game.phase === 'gameOver' || S.game.phase === 'matchOver' ? 'over' : 'playing'; },
  });
  render();
  connect();
})();
