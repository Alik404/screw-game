// Dominoes client: connection, lobby, the table, my hand, results.
(function () {
  const C = window.DominoConfig;
  const SC = window.ScrewConfig; // room-code length, name length, idle minutes, reactions (shared by all games)
  const SND = window.ScrewSound;
  const DT = window.DominoTiles;
  const rootEl = document.getElementById('dm-root');
  const GAME = 'domino';

  // ---------- tiny helpers ----------

  function h(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') {
        Object.keys(v).forEach(function (p) { if (p.slice(0, 2) === '--') el.style.setProperty(p, v[p]); else el.style[p] = v[p]; });
      } else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
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
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.8l6.6-4M8.7 13.2l6.6 4"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/><path d="M5 21h14"/>',
    sound: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16.5h6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
    team: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 19c.5-3 2.5-5 5-5s4.5 2 5 5M11 19c.5-3 2.5-5 5-5s4.5 2 5 5"/>',
  };
  function icon(name, size) {
    const s = document.createElement('span');
    s.className = 'ico';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
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
  function buzz(pattern) {
    if (!navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }

  const params = new URLSearchParams(location.search);
  let urlCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, SC.ROOM_CODE_LENGTH);
  const pageStart = Date.now();

  function savedOptions() {
    const o = store(GAME + '.options') || {};
    return {
      mode: C.MODES.indexOf(o.mode) >= 0 ? o.mode : C.DEFAULT_MODE,
      target: C.TARGETS.indexOf(o.target) >= 0 ? o.target : C.DEFAULT_TARGET,
      teams: typeof o.teams === 'boolean' ? o.teams : C.DEFAULT_TEAMS,
    };
  }

  const S = {
    status: 'connecting',
    name: store('screw.name') || '',
    codeInput: urlCode,
    session: store(GAME + '.session'),
    autoJoining: false,
    you: null,
    room: null,
    game: null,
    names: {},
    opts: savedOptions(),
    optsSent: null,
    sheet: null, // null | menu | help | log | end
    eventText: '',
    log: [],
    toast: null,
    homeError: '',
    bootId: null,
    serverRestarted: false,
    lost: null,
    disconnectedAt: null,
    timerEnd: null,
    nextEnd: null,
    selected: null, // a tile of mine that fits both ends: waiting for the end
    sent: false, // a move is on its way to the server
    from: {}, // tile id -> screen rect it flies in from
    resultAt: 0, // when the hand result may show (after the last tile lands)
    hideResult: false,
    reacts: false,
  };

  // ---------- network ----------

  let ws = null;
  let attempts = 0;
  let retryTimer = null;

  function connect() {
    clearTimeout(retryTimer);
    if (ws && ws.readyState < 2) { ws.onclose = null; ws.close(); }
    ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host);
    ws.onopen = function () {
      attempts = 0;
      S.status = 'open';
      S.disconnectedAt = null;
      if (S.session && (!urlCode || urlCode === S.session.code || S.you)) {
        S.autoJoining = true;
        sendRaw({ type: 'join_room', code: S.session.code, name: S.session.name, playerId: S.session.playerId });
      }
      render();
    };
    ws.onmessage = function (ev) {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onMessage(m);
    };
    ws.onclose = function () {
      if (!S.disconnectedAt) S.disconnectedAt = Date.now();
      S.status = 'reconnecting';
      attempts += 1;
      retryTimer = setTimeout(connect, Math.min(1000 * attempts, 5000));
      render();
    };
  }

  function sendRaw(msg) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
    return false;
  }
  function send(msg) {
    if (!sendRaw(msg)) { toast('لا يوجد اتصال. جاري إعادة المحاولة…'); return false; }
    render();
    return true;
  }
  function toast(text, ok) { S.toast = { text: text, ok: !!ok, until: Date.now() + 3500 }; render(); }

  function leaveRoom() {
    S.session = null;
    store(GAME + '.session', null);
    S.you = null; S.room = null; S.game = null; S.sheet = null; S.eventText = ''; S.log = []; S.selected = null;
    urlCode = '';
    S.codeInput = '';
    try { history.replaceState(null, '', '/domino.html'); } catch (e) { /* ignore */ }
  }

  // ---------- messages ----------

  function onMessage(m) {
    switch (m.type) {
      case 'hello':
        if (S.bootId && m.bootId !== S.bootId) S.serverRestarted = true;
        S.bootId = m.bootId;
        break;
      case 'joined':
        if (m.game && m.game !== GAME) {
          store(m.game + '.session', { code: m.code, playerId: m.playerId, name: S.name });
          location.replace('/' + m.game + '.html?room=' + m.code);
          return;
        }
        S.lost = null;
        S.autoJoining = false;
        S.you = m.you;
        S.session = { code: m.code, playerId: m.playerId, name: S.name || (S.session && S.session.name) || '' };
        store(GAME + '.session', S.session);
        S.homeError = '';
        try { history.replaceState(null, '', '/domino.html?room=' + m.code); } catch (e) { /* ignore */ }
        break;
      case 'room_state':
        S.room = m;
        m.players.forEach(function (p) { S.names[p.id] = p.name; });
        if (m.phase === 'lobby' && m.hostId === S.you && !m.options && S.optsSent !== m.code) {
          S.optsSent = m.code;
          sendRaw({ type: 'set_options', options: S.opts });
        }
        break;
      case 'game_state':
        onGameState(m);
        break;
      case 'event':
        onEvent(m.event);
        break;
      case 'reaction':
        showReaction(m.from, m.id);
        return;
      case 'error':
        S.sent = false;
        if (S.autoJoining) {
          S.autoJoining = false;
          leaveRoom();
          if (m.code === 'NO_ROOM') S.lost = { restarted: S.serverRestarted };
          else { S.homeError = m.message; toast(m.message); }
        } else {
          if (!S.you) S.homeError = m.message;
          toast(m.message);
        }
        break;
      default:
        break;
    }
    render();
  }

  function onGameState(m) {
    const prev = S.game;
    S.game = m;
    m.players.forEach(function (p) { S.names[p.id] = p.name; });
    const t = m.timer;
    const at = function (x) { return x.endsAt - (x.now - Date.now()); };
    S.timerEnd = t && (t.kind === 'turn' || t.kind === 'away') ? at(t) : null;
    S.nextEnd = t && t.kind === 'next' ? at(t) : null;
    if (!prev || prev.moveCount !== m.moveCount || prev.phase !== m.phase) S.sent = false;
    if (m.phase !== 'turn' || m.currentPlayerId !== m.you) { S.selected = null; if (table) table.clearGhosts(); }
    if (m.phase === 'turn') S.hideResult = false;
    if (m.phase === 'turn' && m.currentPlayerId === m.you && (!prev || prev.currentPlayerId !== m.you || prev.handNo !== m.handNo)) {
      SND.play('turn', 250);
      buzz(50);
    }
  }

  function nm(id) { return S.names[id] || '؟'; }
  function isMe(id) { return id === S.you; }
  function who(id) { return isMe(id) ? 'أنت' : nm(id); }
  function tileText(id) { return '‎' + id.replace('-', '|') + '‎'; }

  function seatIndex(id) { return S.game ? S.game.playerIds.indexOf(id) : (S.room ? S.room.players.findIndex(function (p) { return p.id === id; }) : 0); }
  function seatColor(id) { return 'var(--p' + ((seatIndex(id) % 4) + 1) + ')'; }

  // a side is a player, or a team ('A' / 'B') when playing in partners
  function mySide() { const v = S.game; return v && v.teams ? v.teams[v.you] : S.you; }
  function sideMembers(side) { const v = S.game; return v.teams ? v.playerIds.filter(function (id) { return v.teams[id] === side; }) : [side]; }
  function sideName(side) {
    const v = S.game;
    if (!v || !v.teams) return who(side);
    return (side === mySide() ? 'فريقنا' : 'فريقهم') + ' (' + sideMembers(side).map(nm).join(' و ') + ')';
  }
  function sideShort(side) {
    const v = S.game;
    if (!v || !v.teams) return isMe(side) ? 'أنت' : nm(side);
    return side === mySide() ? 'فريقنا' : 'فريقهم';
  }

  function describe(e) {
    switch (e.type) {
      case 'hand_start': return 'الجولة ' + e.hand + (e.must ? ': يبدأ ' + nm(e.firstPlayerId) + ' بالدبل ' + tileText(e.must) : ': يبدأ ' + nm(e.firstPlayerId));
      case 'play': return who(e.playerId) + ' ' + (isMe(e.playerId) ? 'لعبت' : 'لعب') + ' ' + tileText(e.tile);
      case 'draw': return who(e.playerId) + ' سحب ' + (e.count === 1 ? 'قطعة' : e.count + ' قطع');
      case 'pass': return who(e.playerId) + ': ما عنده، مرّر';
      case 'hand_end': {
        const r = e.result;
        if (r.reason === 'domino') return 'دومنو! ' + nm(r.winnerId) + ' خلّص قطعه وأخذ ' + r.points;
        return r.side === null ? 'قفلت بالتعادل: لا نقاط' : 'قفلت! ' + sideShort(r.side) + ' بأقل مجموع وأخذ ' + r.points;
      }
      case 'game_over': return 'انتهت اللعبة';
      default: return '';
    }
  }

  function logLine(t) {
    if (!t) return;
    S.eventText = t;
    S.log.unshift(t);
    if (S.log.length > 80) S.log.length = 80;
  }

  // ---------- motion ----------

  function rectOf(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width ? r : null;
  }

  // a face-down tile flies between two rectangles (drawing from the pile)
  function flyBack(from, to, delay) {
    if (!from || !to || reduced() || document.hidden) return;
    const box = h('div', { class: 'dm-back fly', style: { left: from.left + from.width / 2 - 12 + 'px', top: from.top + from.height / 2 - 22 + 'px' } });
    document.body.append(box);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const a = box.animate([{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(12deg)', opacity: 0.9 }],
      { duration: 380, delay: delay || 0, easing: 'cubic-bezier(.25,.8,.25,1)', fill: 'both' });
    a.onfinish = function () { box.remove(); };
    setTimeout(function () { box.remove(); }, 380 + (delay || 0) + 400);
  }

  function announce(word, sub, cls) {
    const el = h('div', { class: 'dm-announce ' + (cls || ''), role: 'status' }, h('div', { class: 'w' }, word), sub ? h('div', { class: 'n' }, sub) : null);
    document.body.append(el);
    setTimeout(function () { el.classList.add('out'); }, 1100);
    setTimeout(function () { el.remove(); }, 1400);
  }

  // a short word over a player's seat ("مرّر")
  function seatBubble(id, text) {
    const r = rectOf('[data-seat="' + id + '"]');
    const el = h('div', { class: 'dm-bubble', 'aria-hidden': 'true' }, text);
    el.style.left = (r ? r.left + r.width / 2 : window.innerWidth / 2) + 'px';
    el.style.top = (r ? r.top + r.height / 2 : window.innerHeight / 2) + 'px';
    document.body.append(el);
    setTimeout(function () { el.remove(); }, 1500);
  }

  function showReaction(from, id) {
    if (!EMOJI[id]) return;
    const r = rectOf('[data-seat="' + from + '"]') || rectOf('[data-chip="' + from + '"]');
    const el = h('div', { class: 'dm-react', 'aria-hidden': 'true' }, h('span', null, EMOJI[id]), h('small', null, nm(from)));
    el.style.left = (r ? r.left + r.width / 2 : window.innerWidth / 2) + 'px';
    el.style.top = (r ? r.top : window.innerHeight / 2) + 'px';
    document.body.append(el);
    setTimeout(function () { el.remove(); }, 2300);
  }

  function confetti() {
    if (reduced()) return;
    const box = h('div', { class: 'dm-confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 60; i++) {
      box.append(h('i', { class: 'c' + (i % 4), style: { left: Math.random() * 100 + '%', '--d': (Math.random() * 0.8).toFixed(2) + 's', '--x': (Math.random() * 160 - 80).toFixed(0) + 'px', '--r': (Math.random() * 720 - 360).toFixed(0) + 'deg' } }));
    }
    document.body.append(box);
    setTimeout(function () { box.remove(); }, 3600);
  }

  function onEvent(e) {
    logLine(describe(e));
    switch (e.type) {
      case 'hand_start':
        S.hideResult = false;
        S.dealIn = true;
        S.from = {};
        SND.play('deal');
        if (e.hand > 1 || e.must) setTimeout(function () { SND.play('deal', 120); }, 0);
        break;
      case 'play': {
        // where it comes from: my hand tile, or the player's seat
        S.from[e.tile] = isMe(e.playerId) ? rectOf('[data-tile="' + e.tile + '"]') : rectOf('[data-seat="' + e.playerId + '"] .dm-backs');
        SND.play('clack', 300);
        break;
      }
      case 'draw': {
        SND.play('flip');
        const from = rectOf('[data-yard]');
        const to = isMe(e.playerId) ? rectOf('.dm-hand') : rectOf('[data-seat="' + e.playerId + '"] .dm-backs');
        for (let i = 0; i < Math.min(e.count, 6); i++) flyBack(from, to, i * 110);
        break;
      }
      case 'pass':
        SND.play('knock');
        seatBubble(e.playerId, 'مرّر ✋');
        break;
      case 'hand_end': {
        const r = e.result;
        S.resultAt = Date.now() + 1500;
        setTimeout(render, 1550);
        const mine = r.side !== null && r.side === mySide();
        if (r.reason === 'domino') {
          announce('دومنو!', nm(r.winnerId) + (r.points ? ' +' + r.points : ''), mine ? 'win' : '');
          SND.play(mine ? 'win' : 'ladder', 350);
        } else {
          announce('قفلت!', r.side === null ? 'تعادل، لا نقاط' : sideShort(r.side) + ' +' + r.points, 'blocked');
          SND.play('screw', 300);
        }
        if (mine) buzz([40, 60, 40]);
        break;
      }
      case 'game_over':
        setTimeout(function () { confetti(); SND.play('win'); }, 1500);
        break;
      default:
        break;
    }
  }

  // ---------- home ----------

  function homeScreen() {
    const offline = S.status !== 'open';
    const name = h('input', {
      type: 'text', placeholder: 'اسمك', maxlength: SC.NAME_MAX_LENGTH, value: S.name, autocomplete: 'nickname', 'aria-label': 'اسمك',
      oninput: function (e) { S.name = e.target.value; store('screw.name', S.name); },
    });
    const code = h('input', {
      type: 'text', class: 'code', placeholder: 'الكود', maxlength: SC.ROOM_CODE_LENGTH, value: S.codeInput, dir: 'ltr',
      autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'كود الغرفة',
      oninput: function (e) { S.codeInput = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); e.target.value = S.codeInput; },
    });
    const create = function () {
      if (!S.name.trim()) { S.homeError = 'اكتب اسمك أولاً.'; render(); return; }
      S.homeError = '';
      sendRaw({ type: 'create_room', name: S.name, game: GAME });
    };
    const join = function () {
      if (!S.name.trim()) { S.homeError = 'اكتب اسمك أولاً.'; render(); return; }
      if (S.codeInput.length !== SC.ROOM_CODE_LENGTH) { S.homeError = 'اكتب كود الغرفة (' + SC.ROOM_CODE_LENGTH + ' أحرف).'; render(); return; }
      S.homeError = '';
      const saved = S.session && S.session.code === S.codeInput ? S.session.playerId : undefined;
      sendRaw({ type: 'join_room', code: S.codeInput, name: S.name, playerId: saved });
    };
    const lost = S.lost ? h('div', { class: 'lost', role: 'alert' },
      h('h2', null, 'انتهت الغرفة'),
      h('p', null, S.lost.restarted
        ? 'أُعيد تشغيل الخادم (ربما نام بعد فترة بلا لعب)، فضاعت كل الغرف المفتوحة. أنشئ غرفة جديدة وأرسل الرابط لأصدقائك.'
        : 'هذه الغرفة لم تعد موجودة: تُحذف بعد ' + SC.ROOM_IDLE_MINUTES + ' دقيقة بلا لاعبين، أو عند إعادة تشغيل الخادم.'),
      h('button', { class: 'primary', onclick: function () { S.lost = null; create(); }, disabled: offline }, 'إنشاء غرفة جديدة'),
      h('button', { onclick: function () { S.lost = null; render(); } }, 'إغلاق')) : null;
    const waking = offline && Date.now() - pageStart > 4000
      ? h('div', { class: 'center dim small' }, 'الخادم يستيقظ… قد يأخذ حتى دقيقة إذا لم يُستخدم منذ مدة.') : null;
    return h('div', { class: 'screen' },
      h('div', { class: 'dm-hero' },
        h('div', { class: 'dm-hero-tiles', 'aria-hidden': 'true' },
          h('span', { class: 't1', html: DT.tileSVG(6, 6) }), h('span', { class: 't2', html: DT.tileSVG(5, 3) }), h('span', { class: 't3', html: DT.tileSVG(1, 4) })),
        h('div', { class: 'dm-logo' }, 'دومنو')),
      lost,
      h('div', { class: 'form' }, name, waking,
        urlCode
          ? [h('div', { class: 'row' }, code), h('button', { class: 'primary', onclick: join, disabled: offline }, 'دخول الغرفة'),
            h('div', { class: 'or' }, 'أو'), h('button', { onclick: create, disabled: offline }, 'إنشاء غرفة جديدة')]
          : [h('button', { class: 'primary', onclick: create, disabled: offline }, 'إنشاء غرفة'),
            h('div', { class: 'or' }, 'أو ادخل بالكود'),
            h('div', { class: 'row' }, code, h('button', { onclick: join, disabled: offline }, 'دخول'))],
        S.homeError ? h('div', { class: 'error', role: 'alert' }, S.homeError) : null,
        h('div', { class: 'center dim small' }, 'وحدك؟ أنشئ غرفة وأضف لاعبين من الكمبيوتر.'),
        h('a', { class: 'all-games', href: '/' }, 'كل الألعاب')));
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }
  function share(code) {
    const url = location.origin + '/domino.html?room=' + code;
    if (navigator.share) { navigator.share({ title: 'دومنو', text: 'تعال نلعب دومنو! كود الغرفة: ' + code, url: url }).catch(function () {}); return; }
    copyText(url).then(function () { toast('تم نسخ الرابط', true); }, function () { toast('تعذر النسخ. الرابط: ' + url); });
  }

  // ---------- lobby ----------

  function avatar(p, i, cls) {
    return h('span', { class: 'dm-av' + (cls ? ' ' + cls : ''), style: { '--pc': 'var(--p' + ((i % 4) + 1) + ')' } }, p.bot ? icon('bot', 18) : (Array.from(p.name)[0] || '؟'));
  }

  function roomOpts() { return (S.room && S.room.options) || S.opts; }
  function setOpt(k, v) {
    S.opts = Object.assign({}, roomOpts());
    S.opts[k] = v;
    store(GAME + '.options', S.opts);
    send({ type: 'set_options', options: S.opts });
  }

  function choice(label, key, values, names, notes) {
    return h('div', { class: 'dm-opt' },
      h('div', { class: 'dim small' }, label),
      h('div', { class: 'dm-seg' }, values.map(function (v) {
        return h('button', { 'aria-pressed': roomOpts()[key] === v ? 'true' : 'false', onclick: function () { setOpt(key, v); } },
          h('span', null, names[v]), notes && notes[v] ? h('small', null, notes[v]) : null);
      })));
  }
  function toggle(label, key, note, disabled) {
    const on = roomOpts()[key];
    return h('button', { class: 'dm-toggle', role: 'switch', 'aria-checked': on ? 'true' : 'false', disabled: disabled, onclick: function () { setOpt(key, !on); } },
      h('span', { class: 'txt' }, h('span', null, label), h('small', null, note)), h('span', { class: 'sw', 'aria-hidden': 'true' }));
  }

  function rulesText(o, count) {
    return [
      'النوع: ' + C.MODE_NAMES[o.mode] + ' (' + C.MODE_NOTES[o.mode] + ')',
      'الفوز عند ' + o.target + ' نقطة',
      o.teams && (count === undefined || count === 4) ? 'شراكة: كل لاعبَين متقابلَين فريق' : 'كل لاعب لنفسه',
    ];
  }

  function reactButton(cls) {
    return h('button', { class: 'icon-btn dm-reactbtn' + (cls ? ' ' + cls : ''), 'aria-label': 'تفاعل', 'aria-expanded': S.reacts ? 'true' : 'false', onclick: function () { S.reacts = !S.reacts; render(); } }, icon('smile', 24));
  }
  function reactRow() {
    return h('div', { class: 'dm-reacts', role: 'toolbar', 'aria-label': 'تفاعلات' }, SC.REACTIONS.map(function (id) {
      return h('button', { 'aria-label': id, onclick: function () { S.reacts = false; send({ type: 'react', id: id }); } }, EMOJI[id] || '?');
    }));
  }

  function lobbyScreen() {
    const r = S.room;
    const amHost = r.hostId === S.you;
    const present = r.players.filter(function (p) { return p.connected; }).length;
    const full = r.players.length >= C.MAX_PLAYERS;
    const o = roomOpts();
    return h('div', { class: 'screen lobby dm-lobby' },
      h('div', { class: 'lobby-head' },
        h('div', { class: 'dim center' }, 'كود الغرفة'),
        h('div', { class: 'code-box', dir: 'ltr' }, r.code),
        h('button', { class: 'with-icon', onclick: function () { share(r.code); } }, icon('share', 20), 'مشاركة الرابط')),
      h('div', { class: 'dim' }, 'اللاعبون (' + r.players.length + '/' + C.MAX_PLAYERS + ')' + (o.teams && r.players.length === 4 ? ' · المتقابلان فريق' : '')),
      h('ul', { class: 'plist' }, r.players.map(function (p, i) {
        return h('li', { class: p.connected ? '' : 'off', 'data-chip': p.id },
          avatar(p, i),
          h('span', { class: 'pname' }, p.name + (p.id === S.you ? ' (أنت)' : ''), p.connected ? null : h('small', null, ' غير متصل')),
          o.teams && r.players.length === 4 ? h('span', { class: 'dm-team t' + (i % 2 ? 'B' : 'A') }, i % 2 ? 'فريق ب' : 'فريق أ') : null,
          p.isHost ? h('span', { class: 'tag' }, 'المضيف') : null,
          p.bot && amHost ? h('button', { class: 'icon-btn dm-rm', 'aria-label': 'احذف ' + p.name, onclick: function () { send({ type: 'remove_bot', id: p.id }); } }, icon('close', 20)) : null);
      })),
      amHost && !full ? h('button', { class: 'with-icon', onclick: function () { send({ type: 'add_bot' }); } }, icon('bot', 20), 'أضف لاعب كمبيوتر') : null,
      amHost ? h('div', { class: 'dm-opts' },
        choice('النوع', 'mode', C.MODES, C.MODE_NAMES, C.MODE_NOTES),
        choice('الفوز عند', 'target', C.TARGETS, { 51: '51', 101: '101', 151: '151' }, { 51: 'سريعة', 101: 'عادية', 151: 'طويلة' }),
        toggle('شراكة (2 ضد 2)', 'teams', r.players.length === 4 ? 'المتقابلان فريق واحد' : 'تعمل مع 4 لاعبين فقط'))
        : h('div', { class: 'dm-rules' }, h('b', null, 'قواعد الغرفة (يختارها المضيف)'), rulesText(o, r.players.length).map(function (t) { return h('span', null, t); })),
      h('div', { class: 'dm-lobbyrow' },
        h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('help', 20), 'طريقة اللعب'),
        reactButton('boxed')),
      S.reacts ? reactRow() : null,
      h('div', { class: 'grow' }),
      amHost
        ? [present < C.MIN_PLAYERS ? h('div', { class: 'center dim' }, 'أرسل الرابط لأصدقائك أو أضف لاعب كمبيوتر.') : null,
          h('button', { class: 'primary big', disabled: present < C.MIN_PLAYERS, onclick: function () { send(r.options ? { type: 'start_game' } : { type: 'start_game', options: S.opts }); } }, 'ابدأ')]
        : h('div', { class: 'center dim' }, 'بانتظار المضيف ليبدأ اللعبة…'),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  // ---------- the table ----------

  let table = null;
  function tableView() { if (!table) table = DT.createTable(); return table; }

  function secondsOf(end) { return end ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : null; }

  function sortedHand(hand) {
    return hand.slice().sort(function (a, b) {
      const pa = a.split('-').map(Number);
      const pb = b.split('-').map(Number);
      return (pa[0] + pa[1]) - (pb[0] + pb[1]) || pa[0] - pb[0];
    });
  }

  function myOptions(id) { return S.game.playable.find(function (o) { return o.tile === id; }); }

  function playTile(id, end) {
    if (S.sent) return;
    S.selected = null;
    tableView().clearGhosts();
    if (send({ type: 'play', tile: id, end: end })) S.sent = true;
  }

  function onTile(id) {
    const v = S.game;
    const o = myOptions(id);
    if (!o || S.sent) return;
    if (S.selected === id) { S.selected = null; tableView().clearGhosts(); render(); return; }
    const twoWays = o.ends.length > 1 && v.ends && v.ends[0] !== v.ends[1];
    if (!twoWays) { playTile(id, o.ends[0] === 'any' ? undefined : o.ends[o.ends.length - 1]); return; }
    S.selected = id;
    tableView().showGhosts(id, o.ends, function (end) { playTile(id, end); });
    render();
  }

  // seats around the table: the next player on my right, then across, then on my left
  function seatOrder(v) {
    const n = v.playerIds.length;
    const me = v.playerIds.indexOf(v.you);
    const others = [];
    for (let k = 1; k < n; k++) others.push(v.playerIds[(me + k) % n]);
    const pos = n === 2 ? ['top'] : n === 3 ? ['right', 'left'] : ['right', 'top', 'left'];
    return others.map(function (id, i) { return { id: id, pos: pos[i] }; });
  }

  function backs(count) {
    const out = [];
    for (let i = 0; i < Math.min(count, 7); i++) out.push(h('i', { class: 'dm-back' }));
    return out;
  }

  function seatEl(v, s) {
    const p = v.players.find(function (x) { return x.id === s.id; });
    const i = v.playerIds.indexOf(s.id);
    const side = p.side;
    return h('div', { class: 'dm-seat pos-' + s.pos + (v.currentPlayerId === p.id ? ' turn' : '') + (p.connected ? '' : ' off'), 'data-seat': p.id },
      h('div', { class: 'dm-seat-head' },
        avatar(p, i, 'sm'),
        h('span', { class: 'nm' }, p.name),
        v.teams ? h('span', { class: 'dm-team t' + side }, side === mySide() ? 'شريكك' : 'خصم') : null),
      h('div', { class: 'dm-seat-body' },
        h('span', { class: 'dm-backs', 'aria-label': p.count + ' قطع' }, backs(p.count)),
        h('span', { class: 'cnt' }, p.count),
        !v.teams ? h('span', { class: 'dm-score' }, v.scores[p.id]) : null),
      p.connected ? null : h('div', { class: 'dm-off' }, 'غير متصل'));
  }

  function topBar(v) {
    const left = secondsOf(S.timerEnd);
    const myTurn = v.phase === 'turn' && v.currentPlayerId === v.you;
    const scoreLine = v.teams
      ? ['A', 'B'].map(function (k) { return h('span', { class: 'dm-tscore t' + k + (k === mySide() ? ' me' : '') }, (k === mySide() ? 'فريقنا ' : 'فريقهم ') + v.scores[k]); })
      : null;
    return h('header', { class: 'dm-top' },
      h('span', { class: 'brand' }, 'دومنو'),
      h('span', { class: 'dm-info' }, 'الجولة ' + v.handNo + ' · الهدف ' + v.options.target, scoreLine),
      h('span', { class: 'dm-timer' + (myTurn ? '' : ' other') + (myTurn && left !== null && left <= 5 ? ' low' : ''), id: 'dm-timer' },
        left === null || v.phase !== 'turn' ? null : [icon('clock', 18), h('span', { class: 'num' }, '0:' + String(left).padStart(2, '0'))]),
      h('span', { class: 'dm-topbtns' },
        h('button', { class: 'icon-btn', 'aria-label': 'طريقة اللعب', onclick: function () { S.sheet = 'help'; render(); } }, icon('help')),
        h('button', { class: 'icon-btn', 'aria-label': 'القائمة', onclick: function () { S.sheet = 'menu'; render(); } }, icon('menu'))));
  }

  function instruction(v) {
    if (v.phase !== 'turn') return h('div', { class: 'dm-instr dim' }, S.eventText);
    const myTurn = v.currentPlayerId === v.you;
    if (!myTurn) {
      const cur = v.players.find(function (p) { return p.id === v.currentPlayerId; });
      return h('div', { class: 'dm-instr dim' }, cur.bot ? cur.name + ' يفكّر…' : 'دور ' + cur.name + (cur.connected ? '…' : ' (غير متصل)'));
    }
    if (S.sent) return h('div', { class: 'dm-instr' }, '…');
    if (S.selected) {
      const o = myOptions(S.selected);
      return h('div', { class: 'dm-choose' },
        h('div', { class: 'dm-instr' }, 'على أي طرف؟ اضغط المكان المضيء أو:'),
        h('div', { class: 'btns', dir: 'ltr' }, o.ends.map(function (end) {
          const num = end === 'left' ? v.ends[0] : v.ends[1];
          return h('button', { class: 'primary', onclick: function () { playTile(S.selected, end); } }, 'على الـ ' + num);
        })),
        h('button', { class: 'dm-cancel', onclick: function () { S.selected = null; tableView().clearGhosts(); render(); } }, 'إلغاء'));
    }
    if (v.must) return h('div', { class: 'dm-instr' }, 'أنت تبدأ: العب أكبر دبل عندك ' + tileText(v.must));
    if (v.playable.length) return h('div', { class: 'dm-instr' }, v.ends ? 'دورك: العب قطعة فيها ' + v.ends[0] + (v.ends[0] !== v.ends[1] ? ' أو ' + v.ends[1] : '') : 'دورك: ابدأ بأي قطعة');
    if (v.canDraw) {
      return h('div', { class: 'dm-choose' },
        h('div', { class: 'dm-instr' }, 'ما عندك قطعة تركب'),
        h('div', { class: 'btns' }, h('button', { class: 'primary big', onclick: function () { if (send({ type: 'draw' })) S.sent = true; } }, 'اسحب من الكومة (' + v.yard + ')')));
    }
    return h('div', { class: 'dm-instr dim' }, '…');
  }

  function gameScreen() {
    const v = S.game;
    const myTurn = v.phase === 'turn' && v.currentPlayerId === v.you;
    const me = v.players.find(function (p) { return p.id === v.you; });
    const t = tableView();
    const felt = h('div', { class: 'dm-felt' + (myTurn ? ' myturn' : ''), id: 'dm-felt' },
      t.el,
      v.options.mode === 'draw' && v.playerIds.length < C.MAX_PLAYERS ? h('div', { class: 'dm-yard', 'data-yard': '', 'aria-label': 'الكومة: ' + v.yard },
        h('span', { class: 'dm-stack' }, v.yard ? backs(Math.min(3, v.yard)) : h('i', { class: 'dm-back empty' })), h('b', null, v.yard)) : null,
      v.ends ? h('div', { class: 'dm-ends', 'aria-label': 'الأطراف المفتوحة' }, h('span', null, v.ends[0]), h('i', null, '·'), h('span', null, v.ends[1])) : h('div', { class: 'dm-ends empty' }, 'الطاولة فارغة'));
    const hand = sortedHand(v.hand);
    const canPlay = myTurn && !S.sent;
    const dealt = S.dealIn;
    S.dealIn = false;
    // tiles get narrower as the hand grows; a big hand (after drawing a lot) wraps onto two rows
    const cols = hand.length > 11 ? Math.ceil(hand.length / 2) : Math.max(hand.length, 7);
    const handEl = h('div', { class: 'dm-hand' + (hand.length > 11 ? ' wrap' : '') + (dealt ? ' deal' : ''), style: { '--cols': cols } }, hand.map(function (id, k) {
      const o = canPlay ? myOptions(id) : null;
      const p = id.split('-').map(Number);
      return h('button', {
        class: 'dm-htile' + (o ? ' ok' : '') + (myTurn && !o ? ' dim' : '') + (S.selected === id ? ' sel' : ''),
        'data-tile': id, style: { '--k': k },
        'aria-label': 'قطعة ' + p[0] + ' و ' + p[1] + (o ? '، تركب' : ''),
        disabled: !o, onclick: function () { onTile(id); },
        html: DT.tileSVG(p[0], p[1]),
      });
    }));
    const mine = h('div', { class: 'dm-me' + (myTurn ? ' turn' : ''), 'data-seat': v.you },
      h('div', { class: 'dm-me-head' },
        avatar(me, v.playerIds.indexOf(v.you), 'sm'),
        h('span', { class: 'nm' }, me.name + ' (أنت)'),
        myTurn ? h('span', { class: 'myturn' }, 'دورك') : null,
        h('span', { class: 'grow' }),
        !v.teams ? h('span', { class: 'dm-score' }, v.scores[v.you] + ' نقطة') : null,
        reactButton()),
      S.reacts ? reactRow() : null,
      handEl);
    return h('div', { class: 'dm-app' },
      topBar(v),
      h('div', { class: 'dm-arena n' + v.playerIds.length },
        h('div', { class: 'dm-seats' }, seatOrder(v).map(function (s) { return seatEl(v, s); })),
        felt),
      h('div', { class: 'dm-actions' }, instruction(v)),
      mine);
  }

  // ---------- results ----------

  function miniTiles(list) {
    return h('div', { class: 'dm-minis' }, list.length ? sortedHand(list).map(function (id) {
      const p = id.split('-').map(Number);
      return h('span', { class: 'dm-mini', html: DT.tileSVG(p[0], p[1]) });
    }) : h('span', { class: 'dim small' }, 'خلّص كل قطعه'));
  }

  function scoreBars(v) {
    const list = v.teams ? ['A', 'B'] : v.playerIds.slice();
    list.sort(function (a, b) { return v.scores[b] - v.scores[a]; });
    return h('div', { class: 'dm-bars' }, list.map(function (k) {
      const pct = Math.min(100, Math.round(v.scores[k] / v.options.target * 100));
      return h('div', { class: 'dm-bar' + (k === mySide() ? ' me' : '') },
        h('div', { class: 'row' }, h('span', null, sideName(k)), h('b', { class: 'num' }, v.scores[k] + ' / ' + v.options.target)),
        h('div', { class: 'track' }, h('i', { style: { width: pct + '%', '--pc': v.teams ? 'var(--dm-team-' + k.toLowerCase() + ')' : seatColor(k) } })));
    }));
  }

  function resultBody(v, r) {
    const head = r.reason === 'domino'
      ? 'دومنو! ' + who(r.winnerId) + ' ' + (isMe(r.winnerId) ? 'خلّصت' : 'خلّص') + ' قطعه' + (v.teams ? ' (' + sideShort(r.side) + ')' : '') + ' وأخذ ' + r.points + ' نقطة'
      : r.side === null ? 'قفلت بالتعادل: لا أحد أخذ نقاط' : 'قفلت! ' + sideName(r.side) + ' بأقل مجموع وأخذ ' + r.points + ' نقطة';
    return [
      h('div', { class: 'dm-headline' + (r.side !== null && r.side === mySide() ? ' good' : '') }, head),
      h('div', { class: 'dm-reshands' }, v.playerIds.map(function (id) {
        const won = r.winnerId === id;
        return h('div', { class: 'dm-reshand' + (won ? ' won' : '') },
          h('div', { class: 'row' }, h('span', { class: 'who' }, avatar(v.players.find(function (p) { return p.id === id; }), v.playerIds.indexOf(id), 'xs'), nm(id) + (won ? ' ★' : '')),
            h('span', { class: 'dim small' }, 'المجموع ' + r.pips[id])),
          miniTiles(r.hands[id]));
      })),
      scoreBars(v),
    ];
  }

  function resultSheet() {
    const v = S.game;
    const r = v.result;
    const amHost = S.room && S.room.hostId === S.you;
    const secs = secondsOf(S.nextEnd);
    const body = resultBody(v, r).concat([
      amHost ? h('button', { class: 'primary big', onclick: function () { send({ type: 'next_round' }); } }, 'الجولة التالية' + (secs !== null ? ' (' + secs + ')' : ''))
        : h('div', { class: 'center dim', id: 'dm-next' }, secs !== null ? 'الجولة التالية تبدأ بعد ' + secs + ' ثانية…' : 'بانتظار الجولة التالية…'),
    ]);
    return sheet('نتيجة الجولة ' + r.hand, body, function () { S.hideResult = true; render(); });
  }

  function finalScreen() {
    const v = S.game;
    const amHost = S.room && S.room.hostId === S.you;
    const winners = v.winnerSides || [];
    const iWon = winners.indexOf(mySide()) >= 0;
    return h('div', { class: 'screen final dm-final' },
      h('div', { class: 'dim center' }, v.endedEarly ? 'أنهى المضيف اللعبة' : 'النتيجة النهائية'),
      h('div', { class: 'winner' + (iWon ? ' me' : '') },
        h('div', { class: 'crown' }, icon('crown', 56)),
        h('div', { class: 'w-name' }, winners.map(sideName).join(' و ')),
        h('div', { class: 'dim' }, winners.length > 1 ? 'تعادل على المركز الأول' : (iWon ? 'مبروك! فزت' : 'الفائز'))),
      scoreBars(v),
      v.result ? h('details', { class: 'dm-last' }, h('summary', null, 'آخر جولة'), resultBody(v, v.result)) : null,
      h('div', { class: 'grow' }),
      amHost ? h('button', { class: 'primary big', onclick: function () { send({ type: 'new_game' }); } }, 'لعبة جديدة')
        : h('div', { class: 'center dim' }, 'بانتظار المضيف لبدء لعبة جديدة…'),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  // ---------- sheets ----------

  function sheet(title, body, onClose) {
    return h('div', { class: 'sheet-wrap', onclick: function (e) { if (e.target === e.currentTarget && onClose) onClose(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'sheet-head' }, h('h2', null, title),
          onClose ? h('button', { class: 'icon-btn', onclick: onClose, 'aria-label': 'إغلاق' }, icon('close')) : null),
        body));
  }
  function closeSheet() { S.sheet = null; render(); }

  function menuSheet() {
    const v = S.game;
    const muted = SND.isMuted();
    const amHost = S.room && S.room.hostId === S.you;
    return sheet('القائمة', h('div', { class: 'menu-list' },
      scoreBars(v),
      h('div', { class: 'dm-rules' }, rulesText(v.options).map(function (t) { return h('span', null, t); })),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'log'; render(); } }, icon('list', 20), 'سجل الحركات'),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('help', 20), 'طريقة اللعب'),
      h('button', { class: 'with-icon', onclick: function () { SND.setMuted(!muted); render(); } },
        icon(muted ? 'mute' : 'sound', 20), muted ? 'الصوت مكتوم - اضغط للتشغيل' : 'الصوت يعمل - اضغط للكتم'),
      amHost && v.phase !== 'gameOver' ? h('button', { class: 'with-icon danger', onclick: function () { S.sheet = 'end'; render(); } }, icon('flag', 20), 'إنهاء اللعبة الآن') : null,
      h('a', { class: 'dm-link', href: '/' }, 'كل الألعاب'),
      h('div', { class: 'dim small center' }, 'الغرفة ' + (S.room ? S.room.code : ''))), closeSheet);
  }

  function endSheet() {
    return sheet('إنهاء اللعبة؟', h('div', { class: 'menu-list' },
      h('p', { class: 'dm-q' }, 'تنتهي اللعبة الآن ويفوز صاحب أعلى نقاط.'),
      h('div', { class: 'btns' },
        h('button', { class: 'danger solid', onclick: function () { S.sheet = null; send({ type: 'end_game' }); } }, 'نعم، أنهِ اللعبة'),
        h('button', { onclick: closeSheet }, 'رجوع'))), closeSheet);
  }

  function logSheet() {
    return sheet('سجل الحركات', S.log.length
      ? h('ol', { class: 'log' }, S.log.map(function (t) { return h('li', null, t); }))
      : h('div', { class: 'dim center' }, 'لا حركات بعد.'), function () { S.sheet = 'menu'; render(); });
  }

  function helpSheet() {
    const li = function (t) { return h('li', null, t); };
    const o = S.game ? S.game.options : roomOpts();
    return sheet('طريقة اللعب', h('div', { class: 'menu-list' },
      h('div', { class: 'dm-helpart', html: DT.tileSVGh(6, 6) + DT.tileSVGh(6, 3) + DT.tileSVGh(3, 1) }),
      h('ul', { class: 'help-list' },
        li('دومنو 6|6: ' + 28 + ' قطعة، ولكل لاعب ' + C.HAND_SIZE + ' قطع.'),
        li('أول جولة يبدأها من عنده أكبر دبل (6|6 أو أقل) ويلعبه هو. بعدها يبدأ الفائز بالجولة السابقة بأي قطعة.'),
        li('في دورك العب قطعة فيها رقم أحد الطرفين المفتوحين. إذا ركبت على الطرفين تختار المكان.'),
        li('"سحب": ما عندك قطعة تركب؟ اسحب من الكومة حتى تطلع قطعة تركب. "بلوك": بلا سحب، تمرّر دورك.'),
        li('أول من يخلّص قطعه يقول دومنو! ويأخذ مجموع نقاط قطع الخصوم.'),
        li('إذا قفلت اللعبة (لا أحد يقدر يلعب) يفوز صاحب أقل مجموع ويأخذ نقاط الباقين. وإذا تعادلوا لا أحد يأخذ.'),
        li('"شراكة" مع 4 لاعبين: المتقابلان فريق واحد ونقاطهما مشتركة.'),
        li('أول من يوصل ' + o.target + ' نقطة يفوز باللعبة. لكل دور ' + C.TURN_SECONDS + ' ثانية، وبعدها يلعب الخادم عنك.')),
      h('div', { class: 'dm-rules' }, h('b', null, S.game ? 'قواعد هذه اللعبة' : 'القواعد المختارة'), rulesText(o).map(function (t) { return h('span', null, t); }))), closeSheet);
  }

  function disconnectSheet(now) {
    const secs = Math.floor((now - S.disconnectedAt) / 1000);
    return h('div', { class: 'sheet-wrap blocking' },
      h('div', { class: 'sheet disconnect', role: 'alertdialog', 'aria-modal': 'true' },
        h('div', { class: 'sheet-head' }, h('h2', null, 'انقطع الاتصال بالخادم')),
        h('p', null, secs >= 60
          ? 'لم نستطع الوصول للخادم منذ ' + secs + ' ثانية. تأكد من اتصالك بالإنترنت. إذا أُعيد تشغيل الخادم فقد ضاعت الغرفة، وسنخبرك بذلك عند عودته.'
          : 'نحاول إعادة الاتصال تلقائياً… إذا كان الخادم نائماً أو يُعاد تشغيله فقد يأخذ حتى دقيقة.'),
        h('div', { class: 'dim small' }, 'مضى ' + secs + ' ثانية · المحاولة ' + Math.max(1, attempts)),
        h('div', { class: 'btns' },
          h('button', { class: 'primary', onclick: function () { attempts = 0; connect(); render(); } }, 'أعد المحاولة الآن'),
          secs >= 60 ? h('button', { onclick: function () { leaveRoom(); render(); } }, 'الصفحة الرئيسية') : null)));
  }

  // ---------- render ----------

  function render() {
    const now = Date.now();
    if (S.toast && S.toast.until <= now) S.toast = null;
    let screen;
    const overlays = [];
    const v = S.game;
    // the last tile lands (and the word "دومنو!" shows) before the result covers the table
    const waiting = v && v.result && now < S.resultAt;
    if (!S.you || !S.room) screen = h('div', { class: 'dm-shell' }, homeScreen());
    else if (v && v.phase === 'gameOver' && !waiting) screen = h('div', { class: 'dm-shell' }, finalScreen());
    else if (v) screen = gameScreen();
    else screen = h('div', { class: 'dm-shell' }, lobbyScreen());
    if (v && v.phase === 'handOver' && v.result && !waiting) {
      if (!S.hideResult) overlays.push(resultSheet());
      else screen.append(h('div', { class: 'dm-showres' }, h('button', { class: 'primary', onclick: function () { S.hideResult = false; render(); } }, 'عرض نتيجة الجولة')));
    }
    if (v && S.sheet === 'menu') overlays.push(menuSheet());
    if (v && S.sheet === 'log') overlays.push(logSheet());
    if (v && S.sheet === 'end') overlays.push(endSheet());
    if (S.sheet === 'help') overlays.push(helpSheet());
    if (S.you && S.status !== 'open' && S.disconnectedAt && now - S.disconnectedAt > 3000) overlays.push(disconnectSheet(now));

    const nodes = [];
    if (S.status !== 'open') nodes.push(h('div', { class: 'banner', role: 'status' }, S.status === 'connecting' ? 'جاري الاتصال…' : 'انقطع الاتصال. جاري إعادة الاتصال…'));
    nodes.push(screen);
    overlays.forEach(function (o) { nodes.push(o); });
    if (S.toast) nodes.push(h('div', { class: 'toast' + (S.toast.ok ? ' ok' : ''), role: 'alert' }, S.toast.text));
    rootEl.replaceChildren.apply(rootEl, nodes);

    // the table is laid out once it is on screen (it needs its real size and position)
    const felt = document.getElementById('dm-felt');
    if (felt && v) {
      const t = tableView();
      t.resize(felt.clientWidth - 24, felt.clientHeight - 24); // the svg sits 12px inside the wooden rim
      t.update(v.line, v.first, S.from);
      S.from = {};
    }
  }

  setInterval(function () {
    const el = document.getElementById('dm-timer');
    if (el && S.game) {
      const s = secondsOf(S.timerEnd);
      const num = el.querySelector('.num');
      if (num && s !== null) num.textContent = '0:' + String(s).padStart(2, '0');
      el.classList.toggle('low', s !== null && s <= 5 && !el.classList.contains('other'));
    }
    const nx = document.getElementById('dm-next');
    if (nx && S.nextEnd) nx.textContent = 'الجولة التالية تبدأ بعد ' + secondsOf(S.nextEnd) + ' ثانية…';
    if (S.status !== 'open' && Date.now() - (S.lastSlow || 0) > 1000) { S.lastSlow = Date.now(); render(); }
    if (S.toast && S.toast.until <= Date.now()) render();
  }, 250);

  let resizeTimer = null;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (S.selected) { S.selected = null; tableView().clearGhosts(); render(); return; }
      if (S.sheet || S.reacts) { S.reacts = false; closeSheet(); }
    }
  });

  DT.ensureDefs(); // the tile gradients, before the first tile is drawn anywhere
  render();
  connect();
})();
