// "Minhu?" client: connection, lobby, the board of faces, questions, guesses.
(function () {
  const C = window.MinhuConfig;
  const SC = window.ScrewConfig;
  const SND = window.ScrewSound;
  const F = window.MinhuFaces;
  const rootEl = document.getElementById('mh-root');
  const GAME = 'minhu';
  const N = C.CHARACTERS.length;

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
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
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
    ask: '<path d="M4 5h16v11H9l-5 4z"/><path d="M10 9a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6 1M12 14h.01"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    flipall: '<path d="M4 7h11M4 12h8M4 17h5"/><path d="M16 12l3 3 3-6"/>',
    next: '<path d="M5 12h12M13 6l6 6-6 6"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    hang: '<path d="M3 15.5c5-4.5 13-4.5 18 0l-2.5 2.5-3.5-1.5v-2.5a10 10 0 0 0-6 0v2.5L5.5 18z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    micoff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/>',
    send: '<path d="M4 12l16-8-6 16-3-7z"/>',
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
  // the board in play (or chosen in the lobby): its characters and questions
  function curSet() {
    if (S.game && S.game.options && S.game.options.set) return S.game.options.set;
    if (S.room && S.room.options && S.room.options.set) return S.room.options.set;
    return 'people';
  }
  function CH() { return C.SETS[curSet()].characters; }
  function QS() { return C.SETS[curSet()].questions; }
  function question(id) { return QS().find(function (q) { return q.id === id; }); }
  function matches(i, q) { return q.is.indexOf(CH()[i][q.attr]) >= 0; }

  const params = new URLSearchParams(location.search);
  let urlCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, SC.ROOM_CODE_LENGTH);
  const pageStart = Date.now();
  function savedOptions() {
    const o = store(GAME + '.options') || {};
    return { target: C.TARGETS.indexOf(o.target) >= 0 ? o.target : C.DEFAULT_TARGET, level: C.LEVELS.indexOf(o.level) >= 0 ? o.level : C.DEFAULT_LEVEL, set: C.SET_OPTIONS.indexOf(o.set) >= 0 ? o.set : C.DEFAULT_SET, pick: C.PICKS.indexOf(o.pick) >= 0 ? o.pick : C.LOBBY_PICK };
  }

  const S = {
    status: 'connecting', name: store('screw.name') || '', codeInput: urlCode, session: store(GAME + '.session'), autoJoining: false,
    you: null, room: null, game: null, names: {}, opts: savedOptions(), optsSent: null, sheet: null, toast: null, homeError: '',
    bootId: null, serverRestarted: false, lost: null, disconnectedAt: null, reacts: false, timerEnd: null, nextEnd: null,
    elec: store(GAME + '.elec') !== false, // the electronic edition (the default look)
    voice: store(GAME + '.voice') !== false, // it reads questions and answers aloud
    lcd: null, // {q, a, cls, until}: what the screen flashes for a moment
    draft: '', chatDraft: '', focus: null, unread: 0, // the question being typed, the chat
    down: null, // my board (optimistic; the server keeps the truth)
    flipTimer: null, guessMode: false, guessPick: null, sent: false, resultAt: 0, hideResult: false,
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
    ws.onclose = function () { if (!S.disconnectedAt) S.disconnectedAt = Date.now(); S.status = 'reconnecting'; attempts += 1; retryTimer = setTimeout(connect, Math.min(1000 * attempts, 5000)); render(); };
  }
  function sendRaw(msg) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; } return false; }
  function send(msg) { if (!sendRaw(msg)) { toast('لا يوجد اتصال. جاري إعادة المحاولة…'); return false; } render(); return true; }
  function toast(text, ok) { S.toast = { text: text, ok: !!ok, until: Date.now() + 3500 }; render(); }
  function leaveRoom() {
    call.end();
    S.session = null; store(GAME + '.session', null);
    S.you = null; S.room = null; S.game = null; S.sheet = null; urlCode = ''; S.codeInput = '';
    try { history.replaceState(null, '', '/minhu.html'); } catch (e) { /* ignore */ }
  }

  // the private voice call with the other player
  const call = window.MinhuCall.create({
    send: function (d) { sendRaw({ type: 'rtc', data: d }); },
    onChange: function () { render(); },
    onRing: function () { sfx('turn'); buzz([120, 80, 120]); },
  });

  function onMessage(m) {
    switch (m.type) {
      case 'hello': if (S.bootId && m.bootId !== S.bootId) S.serverRestarted = true; S.bootId = m.bootId; break;
      case 'joined':
        if (m.game && m.game !== GAME) { store(m.game + '.session', { code: m.code, playerId: m.playerId, name: S.name }); location.replace('/' + m.game + '.html?room=' + m.code); return; }
        S.lost = null; S.autoJoining = false; S.you = m.you;
        S.session = { code: m.code, playerId: m.playerId, name: S.name || (S.session && S.session.name) || '' };
        store(GAME + '.session', S.session); S.homeError = '';
        try { history.replaceState(null, '', '/minhu.html?room=' + m.code); } catch (e) { /* ignore */ }
        break;
      case 'room_state':
        S.room = m;
        m.players.forEach(function (p) { S.names[p.id] = p.name; });
        if (m.phase === 'lobby' && m.hostId === S.you && !m.options && S.optsSent !== m.code) { S.optsSent = m.code; sendRaw({ type: 'set_options', options: S.opts }); }
        break;
      case 'game_state': onGameState(m); break;
      case 'event': onEvent(m.event); break;
      case 'reaction': showReaction(m.from, m.id); return;
      case 'rtc': {
        const ids = S.game ? S.game.playerIds : (S.room ? S.room.players.map(function (p) { return p.id; }) : []);
        call.onSignal(m.data, ids.indexOf(S.you) < ids.indexOf(m.from));
        return;
      }
      case 'error':
        S.sent = false;
        if (S.autoJoining) { S.autoJoining = false; leaveRoom(); if (m.code === 'NO_ROOM') S.lost = { restarted: S.serverRestarted }; else { S.homeError = m.message; toast(m.message); } } else { if (!S.you) S.homeError = m.message; toast(m.message); }
        break;
      default: break;
    }
    render();
  }

  function onGameState(m) {
    const prev = S.game;
    S.game = m;
    m.players.forEach(function (p) { S.names[p.id] = p.name; });
    const t = m.timer;
    const at = function (x) { return x.endsAt - (x.now - Date.now()); };
    S.timerEnd = t && (t.kind === 'turn' || t.kind === 'away' || t.kind === 'pick') ? at(t) : null;
    S.nextEnd = t && t.kind === 'next' ? at(t) : null;
    if (!prev || prev.seq !== m.seq) S.sent = false;
    // my board: take the server's unless I am in the middle of flipping
    if (!S.flipTimer || !prev || prev.round !== m.round) S.down = m.down.slice();
    if (!prev || prev.round !== m.round) { S.guessMode = false; S.hideResult = false; }
    if (m.phase !== 'turn' || m.currentPlayerId !== m.you || m.stage !== 'ask') S.guessMode = false;
    if (m.phase === 'turn' && m.currentPlayerId === m.you && (!prev || prev.currentPlayerId !== m.you || prev.round !== m.round)) { sfx('turn', 300); buzz(50); }
  }

  function nm(id) { return S.names[id] || '؟'; }
  function isMe(id) { return id === S.you; }
  function other(v) { return v.playerIds[0] === v.you ? v.playerIds[1] : v.playerIds[0]; }

  // ---------- effects ----------
  function rectOf(sel) { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? r : null; }
  function showReaction(from, id) {
    if (!EMOJI[id]) return;
    const r = rectOf('[data-seat="' + from + '"]') || rectOf('[data-chip="' + from + '"]');
    const el = h('div', { class: 'mh-react', 'aria-hidden': 'true' }, h('span', null, EMOJI[id]), h('small', null, nm(from)));
    el.style.left = (r ? r.left + r.width / 2 : innerWidth / 2) + 'px';
    el.style.top = (r ? r.top : innerHeight / 2) + 'px';
    document.body.append(el);
    setTimeout(function () { el.remove(); }, 2300);
  }
  // ---------- the electronic edition: beeps, a voice, the screen ----------
  const BEEPS = { turn: 'e-beep', deal: 'e-boot', ladder: 'e-yes', knock: 'e-no', flip: 'e-tick', win: 'e-jingle', screw: 'e-no' };
  function sfx(name, delay) { SND.play(S.elec && BEEPS[name] ? BEEPS[name] : name, delay); }

  let arVoice = null;
  function pickVoice() {
    try { arVoice = window.speechSynthesis.getVoices().find(function (v) { return /^ar/i.test(v.lang); }) || null; } catch (e) { arVoice = null; }
  }
  if ('speechSynthesis' in window) { pickVoice(); window.speechSynthesis.onvoiceschanged = pickVoice; }
  // only with an Arabic voice: an English voice reading Arabic is worse than silence
  function speak(text) {
    if (!S.elec || !S.voice || !arVoice || SND.isMuted()) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = arVoice;
      u.lang = arVoice.lang;
      u.rate = 1.05;
      u.pitch = 0.85;
      window.speechSynthesis.speak(u);
    } catch (e) { /* no voice */ }
  }

  function announce(q, a, cls, sub) {
    if (S.elec) {
      // the electronic edition shows it on its screen instead of across the page
      S.lcd = { q: q, a: a, cls: cls || '', until: Date.now() + 2800 };
      setTimeout(render, 2850);
      render();
      return;
    }
    const el = h('div', { class: 'mh-announce ' + (cls || ''), role: 'status' }, h('div', { class: 'q' }, q), h('div', { class: 'a' }, a), sub ? h('div', { class: 's' }, sub) : null);
    document.body.append(el);
    setTimeout(function () { el.classList.add('out'); }, 1500);
    setTimeout(function () { el.remove(); }, 1850);
  }
  // a chat message pops up over the sender for a moment
  function chatBubble(from, text) {
    const r = rectOf('[data-seat="' + from + '"]');
    const el = h('div', { class: 'mh-chatpop', 'aria-hidden': 'true' }, h('b', null, nm(from) + ': '), text.length > 60 ? text.slice(0, 60) + '…' : text);
    el.style.left = (r ? r.left + r.width / 2 : innerWidth / 2) + 'px';
    el.style.top = (r ? r.top + r.height + 6 : 70) + 'px';
    document.body.append(el);
    setTimeout(function () { el.remove(); }, 3600);
  }
  function confetti() {
    if (reduced()) return;
    const box = h('div', { class: 'mh-confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 70; i++) box.append(h('i', { class: 'c' + (i % 5), style: { left: Math.random() * 100 + '%', '--d': (Math.random() * 0.8).toFixed(2) + 's', '--x': (Math.random() * 160 - 80).toFixed(0) + 'px', '--r': (Math.random() * 720 - 360).toFixed(0) + 'deg' } }));
    document.body.append(box);
    setTimeout(function () { box.remove(); }, 3600);
  }

  function onEvent(e) {
    switch (e.type) {
      case 'round_start':
        sfx('deal');
        if (e.pick === 'choose') {
          announce('الجولة ' + e.round, 'اختار شخصيتك', 'start');
          speak('الجولة ' + e.round + '. اختار شخصيتك السرية');
        } else {
          announce('الجولة ' + e.round, isMe(e.firstPlayerId) ? 'أنت تبدأ' : 'يبدأ ' + nm(e.firstPlayerId), 'start');
          speak('الجولة ' + e.round + '. ' + (isMe(e.firstPlayerId) ? 'أنت تبدأ' : 'يبدأ ' + nm(e.firstPlayerId)));
        }
        break;
      case 'pick':
        if (!isMe(e.playerId)) sfx('flip');
        else if (e.auto) toast('خلص الوقت، فاخترنا لك شخصية.', true);
        break;
      case 'picks_done':
        sfx('turn');
        announce('يلا نبدي!', isMe(e.firstPlayerId) ? 'أنت تبدأ' : 'يبدأ ' + nm(e.firstPlayerId), 'start');
        speak('يلا نبدي. ' + (isMe(e.firstPlayerId) ? 'أنت تبدأ' : 'يبدأ ' + nm(e.firstPlayerId)));
        break;
      case 'question': {
        if (isMe(e.playerId)) break;
        // they ask me: I answer
        sfx('turn');
        buzz([60, 40, 60]);
        announce(e.voice ? nm(e.playerId) + ' سألك بالصوت' : nm(e.playerId) + ' يسأل:', e.voice ? 'جاوب 👇' : e.text, 'theirs');
        if (!e.voice && call.state === 'idle') speak(nm(e.playerId) + ' يسأل: ' + e.text);
        break;
      }
      case 'answer': {
        const asker = S.game ? S.game.currentPlayerId : null;
        if (asker !== S.you) break;
        const word = e.yes === null ? 'ما جاوب' : e.yes ? 'نعم ✓' : 'لا ✗';
        announce(e.voice ? 'سؤالك بالصوت' : e.text, word, e.yes ? 'yes' : 'no');
        sfx(e.yes ? 'ladder' : 'knock');
        if (call.state === 'idle') speak(e.yes === null ? 'ما جاوب' : e.yes ? 'نعم' : 'لا');
        break;
      }
      case 'chat':
        if (!isMe(e.playerId)) {
          if (S.sheet !== 'chat') S.unread += 1;
          sfx('flip');
          chatBubble(e.playerId, e.text);
        }
        break;
      case 'ask': {
        const q = question(e.q);
        if (isMe(e.playerId)) {
          announce(q.text, e.yes ? 'نعم ✓' : 'لا ✗', e.yes ? 'yes' : 'no');
          sfx(e.yes ? 'ladder' : 'knock');
          speak(q.text + ' ' + (e.yes ? 'نعم' : 'لا'));
        } else {
          announce(nm(e.playerId) + ' يسأل: ' + q.text, e.yes ? 'نعم' : 'لا', 'theirs', 'عن شخصيتك، والخادم جاوب');
          sfx('flip');
          speak(nm(e.playerId) + ' يسأل: ' + q.text + ' الجواب: ' + (e.yes ? 'نعم' : 'لا'));
        }
        break;
      }
      case 'guess': {
        const c = CH()[e.char];
        announce((isMe(e.playerId) ? 'خمّنت: ' : nm(e.playerId) + ' خمّن: ') + c.name, e.right ? 'صح! 🎯' : 'غلط!', e.right ? 'yes' : 'no');
        sfx(e.right ? 'win' : 'screw');
        speak((isMe(e.playerId) ? 'خمّنت ' : nm(e.playerId) + ' خمّن ') + c.name + '. ' + (e.right ? 'صح!' : 'غلط!'));
        break;
      }
      case 'round_end':
        S.resultAt = Date.now() + 1900;
        setTimeout(render, 1950);
        if (isMe(e.result.winnerId)) buzz([40, 60, 40]);
        break;
      case 'match_over':
        setTimeout(function () { if (e.winnerIds.indexOf(S.you) >= 0) { confetti(); sfx('win'); } }, 2000);
        break;
      case 'timeout':
        if (isMe(e.playerId)) toast('خلص وقتك، راح الدور.'); else toast('خلص وقت ' + nm(e.playerId) + '.', true);
        break;
      default: break;
    }
  }

  // ---------- my board ----------
  function setDown(list) {
    S.down = list.slice().sort(function (a, b) { return a - b; });
    clearTimeout(S.flipTimer);
    S.flipTimer = setTimeout(function () { S.flipTimer = null; sendRaw({ type: 'flip', ids: S.down }); }, 350);
    render();
  }
  function toggle(i) {
    const v = S.game;
    if (v && v.phase === 'pick') {
      if (v.secret === null && !S.sent) { S.pickChoice = i; S.sheet = 'pick'; sfx('flip'); render(); }
      return;
    }
    if (!v || v.phase !== 'turn') return;
    if (S.guessMode) { S.guessPick = i; S.sheet = 'guess'; render(); return; }
    const d = S.down.slice();
    const k = d.indexOf(i);
    if (k >= 0) d.splice(k, 1); else d.push(i);
    sfx('flip');
    setDown(d);
  }
  function faceCard(i, o) {
    o = o || {};
    const set = o.set || curSet();
    const c = C.SETS[set].characters[i];
    const down = o.down;
    const el = h(o.tag || 'button', { class: 'mh-card bg-' + c.bg + (down ? ' down' : '') + (o.cls ? ' ' + o.cls : ''), 'aria-label': c.name + (down ? ' (مقلوبة)' : ''), 'data-char': i },
      h('div', { class: 'inner' },
        h('div', { class: 'front' }, h('div', { class: 'pic', html: F.face(i, set) }), h('div', { class: 'name' }, c.name)),
        h('div', { class: 'back' }, '؟')));
    if (o.onClick) el.addEventListener('click', o.onClick);
    return el;
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
      h('p', null, S.lost.restarted ? 'أُعيد تشغيل الخادم فضاعت الغرف المفتوحة. أنشئ غرفة جديدة.' : 'هذه الغرفة لم تعد موجودة.'),
      h('button', { class: 'primary', onclick: function () { S.lost = null; create(); }, disabled: offline }, 'إنشاء غرفة جديدة'),
      h('button', { onclick: function () { S.lost = null; render(); } }, 'إغلاق')) : null;
    return h('div', { class: 'screen mh-home' },
      h('div', { class: 'mh-hero' },
        h('div', { class: 'mh-hero-cards', 'aria-hidden': 'true' }, faceCard(13, { tag: 'div', cls: 'a' }), faceCard(5, { tag: 'div', cls: 'b' }), faceCard(0, { tag: 'div', cls: 'c', down: true })),
        h('div', { class: 'mh-logo' }, 'منو هو؟'),
        h('div', { class: 'mh-tag' }, 'اسأل، استبعد، وخمّن شخصية خصمك قبل ما يخمّن شخصيتك.')),
      lost,
      h('div', { class: 'form' }, name,
        offline && Date.now() - pageStart > 4000 ? h('div', { class: 'center dim small' }, 'الخادم يستيقظ… قد يأخذ حتى دقيقة.') : null,
        urlCode
          ? [h('div', { class: 'row' }, code), h('button', { class: 'primary', onclick: join, disabled: offline }, 'دخول الغرفة'), h('div', { class: 'or' }, 'أو'), h('button', { onclick: create, disabled: offline }, 'إنشاء غرفة جديدة')]
          : [h('button', { class: 'primary', onclick: create, disabled: offline }, 'إنشاء غرفة'), h('div', { class: 'or' }, 'أو ادخل بالكود'), h('div', { class: 'row' }, code, h('button', { onclick: join, disabled: offline }, 'دخول'))],
        S.homeError ? h('div', { class: 'error', role: 'alert' }, S.homeError) : null,
        h('div', { class: 'center dim small' }, 'وحدك؟ أنشئ غرفة والعب ضد الكمبيوتر.'),
        h('a', { class: 'all-games', href: '/' }, 'كل الألعاب')));
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) { const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove(); if (ok) res(); else rej(new Error('copy')); });
  }
  function share(code) {
    const url = location.origin + '/minhu.html?room=' + code;
    if (navigator.share) { navigator.share({ title: 'منو هو؟', text: 'تعال نلعب منو هو؟ كود الغرفة: ' + code, url: url }).catch(function () {}); return; }
    copyText(url).then(function () { toast('تم نسخ الرابط', true); }, function () { toast('الرابط: ' + url); });
  }
  function avatar(p, i, cls) { return h('span', { class: 'mh-av' + (cls ? ' ' + cls : ''), style: { '--pc': i ? 'var(--mh-c5)' : 'var(--mh-c1)' } }, p.bot ? icon('bot', 16) : (Array.from(p.name)[0] || '؟')); }
  function roomOpts() { return (S.room && S.room.options) || S.opts; }
  function setOpt(k, v) { S.opts = Object.assign({}, roomOpts()); S.opts[k] = v; store(GAME + '.options', S.opts); send({ type: 'set_options', options: S.opts }); }
  function seg(label, key, values, names, notes) {
    return h('div', { class: 'mh-opt' }, h('div', { class: 'dim small' }, label), h('div', { class: 'mh-seg' }, values.map(function (v) {
      return h('button', { 'aria-pressed': roomOpts()[key] === v ? 'true' : 'false', onclick: function () { setOpt(key, v); } }, h('span', null, names[v]), notes ? h('small', null, notes[v]) : null);
    })));
  }
  function reactButton(cls) { return h('button', { class: 'icon-btn mh-reactbtn' + (cls ? ' ' + cls : ''), 'aria-label': 'تفاعل', 'aria-expanded': S.reacts ? 'true' : 'false', onclick: function () { S.reacts = !S.reacts; render(); } }, icon('smile', 24)); }
  function reactRow() { return h('div', { class: 'mh-reacts', role: 'toolbar' }, SC.REACTIONS.map(function (id) { return h('button', { 'aria-label': id, onclick: function () { S.reacts = false; send({ type: 'react', id: id }); } }, EMOJI[id]); })); }

  // the boards to choose from, each with three of its faces
  const PREVIEW = { people: [13, 5, 0], animals: [0, 7, 19], monsters: [1, 10, 18], robots: [0, 8, 15] };
  function setPicker(amHost) {
    const cur = roomOpts().set || C.DEFAULT_SET;
    return h('div', { class: 'mh-opt' }, h('div', { class: 'dim small' }, amHost ? 'اختار اللوحة' : 'اللوحة (يختارها المضيف)'),
      h('div', { class: 'mh-sets' }, C.SET_OPTIONS.map(function (id) {
        const B = C.SETS[id];
        return h('button', { class: 'mh-setpick', 'aria-pressed': cur === id ? 'true' : 'false', disabled: !amHost, onclick: amHost ? function () { setOpt('set', id); } : null },
          h('div', { class: 'faces' }, PREVIEW[id].map(function (k) { return faceCard(k, { tag: 'div', set: id }); })),
          h('b', null, B.icon + ' ' + B.name),
          h('small', null, B.characters.length + ' شخصية · ' + B.questions.length + ' سؤال · ' + B.note));
      })));
  }

  function lobbyScreen() {
    const r = S.room;
    const amHost = r.hostId === S.you;
    const present = r.players.filter(function (p) { return p.connected; }).length;
    const o = roomOpts();
    return h('div', { class: 'screen lobby mh-lobby' },
      h('div', { class: 'lobby-head' }, h('div', { class: 'dim center' }, 'كود الغرفة'), h('div', { class: 'code-box', dir: 'ltr' }, r.code),
        h('button', { class: 'with-icon', onclick: function () { share(r.code); } }, icon('share', 20), 'مشاركة الرابط')),
      h('div', { class: 'dim' }, 'اللاعبان (' + r.players.length + '/2)'),
      h('ul', { class: 'plist' }, r.players.map(function (p, i) {
        return h('li', { class: p.connected ? '' : 'off', 'data-chip': p.id }, avatar(p, i),
          h('span', { class: 'pname' }, p.name + (p.id === S.you ? ' (أنت)' : '')), p.isHost ? h('span', { class: 'tag' }, 'المضيف') : null,
          p.bot && amHost ? h('button', { class: 'icon-btn mh-rm', 'aria-label': 'احذف ' + p.name, onclick: function () { send({ type: 'remove_bot', id: p.id }); } }, icon('close', 20)) : null);
      })),
      amHost && r.players.length < 2 ? h('button', { class: 'with-icon', onclick: function () { send({ type: 'add_bot' }); } }, icon('bot', 20), 'العب ضد الكمبيوتر') : null,
      setPicker(amHost),
      amHost ? h('div', { class: 'mh-opts' },
        seg('المباراة', 'target', C.TARGETS, { 1: 'جولة وحدة', 2: 'أفضل من 3', 3: 'أفضل من 5' }, { 1: 'سريعة', 2: 'تفوز بجولتين', 3: 'تفوز بثلاث' }),
        seg('اختيار الشخصية', 'pick', C.PICKS, C.PICK_NAMES, { choose: 'تختارها بنفسك', random: 'الخادم يوزّع' }),
        seg('الكمبيوتر', 'level', C.LEVELS, C.LEVEL_NAMES, { easy: 'يخمّن بسرعة', smart: 'يسأل أذكى سؤال' }))
        : h('div', { class: 'mh-rules' }, h('b', null, 'المباراة'), h('span', null, 'الفوز بـ ' + o.target + (o.target === 1 ? ' جولة' : ' جولات')), h('span', null, 'الشخصية: ' + C.PICK_NAMES[o.pick || C.DEFAULT_PICK])),
      h('div', { class: 'mh-lobbyrow' }, h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('help', 20), 'طريقة اللعب'), reactButton('boxed')),
      S.reacts ? reactRow() : null,
      h('div', { class: 'grow' }),
      amHost ? [present < 2 ? h('div', { class: 'center dim' }, 'أرسل الرابط لصديقك أو العب ضد الكمبيوتر.') : null,
        h('button', { class: 'primary big', disabled: present < 2, onclick: function () { send(r.options ? { type: 'start_game' } : { type: 'start_game', options: S.opts }); } }, 'ابدأ')]
        : h('div', { class: 'center dim' }, 'بانتظار المضيف…'),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  function secondsOf(end) { return end ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : null; }

  function qText(a) { return a.q ? question(a.q).text : a.voice ? '🎤 سؤال بالصوت' : a.text; }
  function ansText(yes) { return yes === null ? 'ما جاوب' : yes ? 'نعم' : 'لا'; }
  function ansCls(yes) { return yes === null ? 'none' : yes ? 'yes' : 'no'; }

  // the question box: what I type stays while the page redraws
  function askForm() {
    const input = h('input', {
      id: 'mh-askin', type: 'text', maxlength: C.QUESTION_MAX, placeholder: 'اكتب سؤالك… مثلاً: لابس نظارات؟', value: S.draft, autocomplete: 'off',
      oninput: function (e) { S.draft = e.target.value; },
      onfocus: function () { S.focus = 'ask'; },
      onblur: function () { if (S.focus === 'ask') S.focus = null; },
    });
    return h('form', { class: 'mh-askform', onsubmit: function (e) {
      e.preventDefault();
      const t = S.draft.trim();
      if (!t) { toast('اكتب سؤالك أولاً.'); return; }
      S.focus = null;
      if (send({ type: 'ask_free', text: t })) { S.sent = true; S.draft = ''; }
    } }, input, h('button', { class: 'primary arc-ask with-icon', type: 'submit' }, icon('send', 18), 'اسأل'));
  }

  function lastAnswer(v, by) {
    for (let k = v.asked.length - 1; k >= 0; k--) if (v.asked[k].by === by) return v.asked[k];
    return null;
  }

  function actionPanel(v) {
    const myTurn = v.phase === 'turn' && v.currentPlayerId === v.you;
    const opp = other(v);
    const free = v.options.ask === 'free';
    const panel = function () { return h('div', { class: 'mh-panel' }, Array.prototype.slice.call(arguments)); };
    const wait = function (t) { return h('div', { class: 'mh-wait' }, t); };
    if (v.phase === 'pick') {
      if (v.secret === null && !S.sent) {
        return panel(h('div', { class: 'mh-instr' }, 'اختار شخصيتك السرية: اضغط وجه من اللوحة'),
          h('div', { class: 'btns' }, h('button', { class: 'with-icon arc-flip', onclick: function () { if (send({ type: 'pick', random: true })) S.sent = true; } }, icon('target', 20), 'عشوائي')));
      }
      const oppP = v.players.find(function (p) { return p.id === opp; });
      return panel(wait(oppP.picked ? '…' : 'بانتظار ' + nm(opp) + ' يختار شخصيته…'));
    }
    if (v.phase !== 'turn') return panel(wait('…'));
    // the other player is asking me: only I know my character, so I answer
    if (free && v.stage === 'answer' && !myTurn) {
      const pq = v.pending;
      return panel(
        h('div', { class: 'mh-qa ask' }, h('span', null, pq.voice ? nm(opp) + ' سألك بالصوت 🎤' : nm(opp) + ' يسأل: ', pq.voice ? null : h('b', { class: 'qt' }, pq.text))),
        S.sent ? wait('…') : h('div', { class: 'btns' },
          h('button', { class: 'big mh-ans yes arc-done', onclick: function () { if (send({ type: 'answer', yes: true })) S.sent = true; } }, 'نعم ✓'),
          h('button', { class: 'big mh-ans no arc-guess', onclick: function () { if (send({ type: 'answer', yes: false })) S.sent = true; } }, 'لا ✗')));
    }
    if (!myTurn) {
      const la = v.stage === 'flip' ? lastAnswer(v, opp) : null;
      const bot = v.players.find(function (p) { return p.id === opp; }).bot;
      return panel(la ? h('div', { class: 'mh-qa theirs' }, h('span', null, nm(opp) + ' سأل: ' + qText(la)), h('b', { class: ansCls(la.yes) }, ansText(la.yes)))
        : wait(bot ? nm(opp) + ' يفكّر…' : free ? 'دور ' + nm(opp) + ': ينتظر سؤاله…' : 'دور ' + nm(opp) + '…'));
    }
    if (S.sent) return panel(wait('…'));
    if (free && v.stage === 'answer') return panel(h('div', { class: 'mh-qa' }, h('span', null, 'سؤالك: ' + qText(v.pending))), wait('بانتظار جواب ' + nm(opp) + '…'));
    if (v.stage === 'flip') {
      const la = lastAnswer(v, v.you);
      return panel(
        h('div', { class: 'mh-qa' }, h('span', null, qText(la)), h('b', { class: ansCls(la.yes) }, ansText(la.yes) + (la.yes === null ? '' : la.yes ? ' ✓' : ' ✗'))),
        h('div', { class: 'mh-hint' }, 'اقلب بيدك الوجوه اللي ما تنطبق، وبعدين ' + (S.elec ? 'تم' : 'إنهاء الدور')),
        h('div', { class: 'btns' }, h('button', { class: 'primary with-icon arc-done', onclick: function () { if (send({ type: 'end_turn' })) S.sent = true; } }, icon('next', 20), S.elec ? 'تم' : 'إنهاء الدور')));
    }
    if (S.guessMode) {
      return panel(h('div', { class: 'mh-instr' }, 'اضغط على الشخصية اللي تظنها هي'),
        h('div', { class: 'btns' }, h('button', { class: 'arc-cancel', onclick: function () { S.guessMode = false; render(); } }, 'إلغاء التخمين')));
    }
    if (free) {
      return panel(askForm(),
        h('div', { class: 'btns' },
          h('button', { class: 'with-icon arc-flip', onclick: function () { if (send({ type: 'ask_free', voice: true })) S.sent = true; } }, icon('mic', 20), 'سألت بالصوت'),
          h('button', { class: 'with-icon mh-guessbtn arc-guess', onclick: function () { S.guessMode = true; render(); } }, icon('target', 20), 'خمّن')));
    }
    return panel(
      h('div', { class: 'mh-instr' }, 'دورك: اسأل سؤال أو خمّن'),
      h('div', { class: 'btns' },
        h('button', { class: 'primary big with-icon arc-ask', onclick: function () { S.sheet = 'ask'; render(); } }, icon('ask', 22), 'اسأل'),
        h('button', { class: 'big with-icon mh-guessbtn arc-guess', onclick: function () { S.guessMode = true; render(); } }, icon('target', 22), 'خمّن')));
  }

  // what the screen says when it is not flashing an answer
  function lcdStatus(v) {
    const opp = other(v);
    if (v.phase === 'pick') {
      const oppPicked = v.players.find(function (p) { return p.id === opp; }).picked;
      return v.secret === null ? 'اختار شخصيتك السرية' + (oppPicked ? ' · ' + nm(opp) + ' اختار ✓' : '') : 'بانتظار ' + nm(opp) + ' يختار…';
    }
    if (v.phase !== 'turn') return 'انتهت الجولة';
    if (v.currentPlayerId === v.you) {
      if (v.stage === 'flip') { const la = lastAnswer(v, v.you); return qText(la) + ' ← ' + ansText(la.yes) + ' · اقلب بيدك وتم'; }
      if (v.stage === 'answer') return 'بانتظار جواب ' + nm(opp) + '…';
      return S.guessMode ? 'اختار الوجه اللي تظنه' : v.options.ask === 'free' ? 'دورك: اكتب سؤالك أو اسأله بالصوت' : 'دورك: اسأل أو خمّن';
    }
    if (v.stage === 'answer') return v.pending.voice ? nm(opp) + ' سألك بالصوت: جاوب' : nm(opp) + ' يسأل: ' + v.pending.text;
    if (v.stage === 'flip') { const la = lastAnswer(v, opp); if (la) return nm(opp) + ' سأل: ' + qText(la) + ' ← ' + ansText(la.yes); }
    return 'دور ' + nm(opp) + '…';
  }

  function talkButtons(oppP, size) {
    if (oppP.bot) return null;
    return [
      h('button', { class: 'icon-btn mh-talk', 'aria-label': 'الدردشة', onclick: function () { S.sheet = 'chat'; S.unread = 0; render(); } }, icon('chat', size), S.unread ? h('i', { class: 'badge' }, S.unread) : null),
      call.state === 'idle' ? h('button', { class: 'icon-btn mh-talk', 'aria-label': 'اتصال صوتي', onclick: function () { call.start(); } }, icon('phone', size)) : null,
    ];
  }

  // the call, at the top of the screen while it rings or runs
  function callBar() {
    if (call.state === 'idle') return call.error ? h('div', { class: 'mh-callbar err', role: 'status' }, h('span', null, call.error), h('button', { class: 'icon-btn', 'aria-label': 'إغلاق', onclick: function () { call.error = ''; render(); } }, icon('close', 18))) : null;
    const v = S.game;
    const opp = v ? nm(other(v)) : '';
    if (call.state === 'ringing') {
      return h('div', { class: 'mh-callbar ring', role: 'alert' }, icon('phone', 20), h('span', null, opp + ' يتصل بيك…'),
        h('button', { class: 'ok', onclick: function () { call.accept(); } }, 'رد'), h('button', { class: 'no', onclick: function () { call.decline(); } }, 'رفض'));
    }
    const secs = call.since ? Math.floor((Date.now() - call.since) / 1000) : 0;
    const label = call.state === 'calling' ? 'نتصل بـ ' + opp + '…' : call.state === 'connecting' ? 'نوصل الصوت…' : '🔊 مكالمة وية ' + opp + ' · ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    return h('div', { class: 'mh-callbar' + (call.state === 'live' ? ' live' : ''), role: 'status' }, h('span', { id: 'mh-calltime' }, label),
      call.state === 'live' ? h('button', { class: 'icon-btn' + (call.muted ? ' on' : ''), 'aria-label': call.muted ? 'شغّل المايك' : 'اكتم المايك', onclick: function () { call.mute(); } }, icon(call.muted ? 'micoff' : 'mic', 18)) : null,
      h('button', { class: 'no', onclick: function () { call.hangup(); } }, icon('hang', 18), 'إنهاء'));
  }

  function elecScreen() {
    const v = S.game;
    const now = Date.now();
    const left = secondsOf(S.timerEnd);
    const myTurn = v.phase === 'turn' && v.currentPlayerId === v.you;
    const opp = other(v);
    const oppP = v.players.find(function (p) { return p.id === opp; });
    const flash = S.lcd && S.lcd.until > now ? S.lcd : null;
    const led = function (label, on, color) { return h('span', { class: 'mh-led' }, h('i', { class: color + (on ? ' on' : '') }), h('small', null, label)); };
    const top = h('div', { class: 'mh-devtop' },
      h('div', { class: 'grille', 'aria-hidden': 'true' }),
      h('div', { class: 'plate' }, h('b', null, 'منو هو؟'), h('small', null, 'ELECTRONIC')),
      h('div', { class: 'leds' }, led('أنت', myTurn, 'g'), led(oppP.name, v.phase === 'turn' && !myTurn, 'r')),
      h('div', { class: 'devbtns' },
        talkButtons(oppP, 20),
        h('button', { class: 'icon-btn', 'aria-label': 'الأسئلة', onclick: function () { S.sheet = 'log'; render(); } }, icon('list', 20)),
        h('button', { class: 'icon-btn', 'aria-label': 'القائمة', onclick: function () { S.sheet = 'menu'; render(); } }, icon('menu', 20))));
    const lcd = h('div', { class: 'mh-lcd' + (flash ? ' flash ' + flash.cls : ''), 'aria-live': 'polite', 'data-seat': opp },
      h('div', { class: 'row' },
        h('span', null, oppP.name + (oppP.connected ? '' : ' (غير متصل)') + ' · باقي ' + (N - oppP.down)),
        h('span', { class: 'digits', id: 'mh-timer' }, left === null || (v.phase !== 'turn' && v.phase !== 'pick') ? '-:--' : h('span', { class: 'num' }, Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0')))),
      flash ? h('div', { class: 'main' }, h('div', { class: 'q' }, flash.q), h('div', { class: 'a' }, flash.a)) : h('div', { class: 'main' }, h('div', { class: 'q' }, lcdStatus(v))),
      h('div', { class: 'row' }, h('span', null, 'أنت ' + v.scores[v.you] + ' – ' + v.scores[opp] + ' ' + oppP.name), h('span', null, 'الجولة ' + v.round)));
    const board = h('div', { class: 'mh-board' + (S.guessMode ? ' guessing' : '') }, CH().map(function (c, i) {
      const down = S.down.indexOf(i) >= 0;
      return faceCard(i, { down: down, cls: S.guessMode && !down ? 'guessable' : '', onClick: function () { toggle(i); } });
    }));
    const deck = h('div', { class: 'mh-deck' + (myTurn ? ' turn' : ''), 'data-seat': v.you },
      h('button', { class: 'mh-secret', 'aria-label': 'شخصيتك', onclick: function () { S.sheet = 'secret'; render(); } },
        h('span', { class: 'window' }, secretMini(v)), h('span', { class: 'lbl' }, 'شخصيتك', h('b', null, v.secret === null ? '؟' : CH()[v.secret].name))),
      actionPanel(v),
      reactButton());
    return h('div', { class: 'mh-app mh-elec seat-' + v.playerIds.indexOf(v.you) },
      h('div', { class: 'mh-dev' }, top, lcd, callBar(), h('div', { class: 'mh-tray' }, board), deck),
      S.reacts ? h('div', { class: 'mh-reactwrap' }, reactRow()) : null);
  }

  function gameScreen() {
    if (S.elec) return elecScreen();
    const v = S.game;
    const left = secondsOf(S.timerEnd);
    const myTurn = v.phase === 'turn' && v.currentPlayerId === v.you;
    const opp = other(v);
    const oppP = v.players.find(function (p) { return p.id === opp; });
    const top = h('header', { class: 'mh-top' },
      h('span', { class: 'brand' }, 'منو هو؟'),
      h('span', { class: 'mh-score' }, h('b', null, v.scores[v.you] + ' – ' + v.scores[opp]), ' · الجولة ' + v.round),
      h('span', { class: 'mh-timer' + (myTurn ? '' : ' other') + (myTurn && left !== null && left <= 10 ? ' low' : ''), id: 'mh-timer' },
        left === null || (v.phase !== 'turn' && v.phase !== 'pick') ? null : [icon('clock', 18), h('span', { class: 'num' }, Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'))]),
      h('span', { class: 'mh-topbtns' },
        talkButtons(oppP, 22),
        h('button', { class: 'icon-btn', 'aria-label': 'الأسئلة', onclick: function () { S.sheet = 'log'; render(); } }, icon('list')),
        h('button', { class: 'icon-btn', 'aria-label': 'القائمة', onclick: function () { S.sheet = 'menu'; render(); } }, icon('menu'))));
    const oppStrip = h('div', { class: 'mh-opp' + (v.currentPlayerId === opp ? ' turn' : '') + (oppP.connected ? '' : ' off'), 'data-seat': opp },
      avatar(oppP, v.playerIds.indexOf(opp), 'sm'),
      h('span', { class: 'nm' }, oppP.name),
      v.currentPlayerId === opp ? h('span', { class: 'mh-turn' }, 'دوره') : null,
      h('span', { class: 'grow' }),
      h('span', { class: 'mh-left' }, 'باقي عنده ', h('b', null, N - oppP.down), ' وجه'));
    const board = h('div', { class: 'mh-board' + (S.guessMode ? ' guessing' : '') }, CH().map(function (c, i) {
      const down = S.down.indexOf(i) >= 0;
      return faceCard(i, { down: down, cls: S.guessMode && !down ? 'guessable' : '', onClick: function () { toggle(i); } });
    }));
    const mine = h('div', { class: 'mh-me' + (myTurn ? ' turn' : ''), 'data-seat': v.you },
      h('button', { class: 'mh-secret', 'aria-label': 'شخصيتك', onclick: function () { S.sheet = 'secret'; render(); } },
        secretMini(v), h('span', { class: 'lbl' }, 'شخصيتك', h('b', null, v.secret === null ? '؟' : CH()[v.secret].name))),
      actionPanel(v),
      reactButton());
    return h('div', { class: 'mh-app' }, top, oppStrip, callBar(), h('div', { class: 'mh-boardwrap' }, board), S.reacts ? h('div', { class: 'mh-reactwrap' }, reactRow()) : null, mine);
  }

  function resultSheet() {
    const v = S.game;
    const r = v.result;
    const amHost = S.room && S.room.hostId === S.you;
    const opp = other(v);
    const won = r.winnerId === v.you;
    const secs = secondsOf(S.nextEnd);
    const why = r.reason === 'right' ? (r.by === v.you ? 'خمّنت صح!' : nm(opp) + ' خمّن شخصيتك صح') : (r.by === v.you ? 'خمّنت غلط، فالجولة راحت لخصمك' : nm(opp) + ' خمّن غلط');
    return sheet('نتيجة الجولة ' + r.round, [
      h('div', { class: 'mh-headline' + (won ? ' good' : '') }, won ? 'فزت بالجولة!' : 'خسرت الجولة'),
      h('div', { class: 'center dim' }, why + ' · ' + r.questions + ' سؤال'),
      h('div', { class: 'mh-reveal' },
        h('div', null, h('div', { class: 'dim small center' }, 'شخصيتك'), faceCard(r.secrets[v.you], { tag: 'div', cls: 'big' })),
        h('div', { class: 'vs' }, 'ضد'),
        h('div', null, h('div', { class: 'dim small center' }, 'شخصية ' + nm(opp)), faceCard(r.secrets[opp], { tag: 'div', cls: 'big' }))),
      h('div', { class: 'mh-scoreline' }, h('span', null, 'أنت ', h('b', null, v.scores[v.you])), h('i', null, '–'), h('span', null, h('b', null, v.scores[opp]), ' ' + nm(opp))),
      amHost ? h('button', { class: 'primary big', onclick: function () { send({ type: 'next_round' }); } }, 'الجولة التالية' + (secs !== null ? ' (' + secs + ')' : ''))
        : h('div', { class: 'center dim', id: 'mh-next' }, secs !== null ? 'الجولة التالية بعد ' + secs + ' ثانية…' : 'بانتظار الجولة التالية…'),
    ], function () { S.hideResult = true; render(); });
  }

  function finalScreen() {
    const v = S.game;
    const amHost = S.room && S.room.hostId === S.you;
    const winners = v.winnerIds || [];
    const iWon = winners.indexOf(v.you) >= 0;
    const opp = other(v);
    return h('div', { class: 'screen final mh-final' },
      h('div', { class: 'dim center' }, v.endedEarly ? 'أنهى المضيف المباراة' : 'نهاية المباراة'),
      h('div', { class: 'winner' + (iWon ? ' me' : '') }, h('div', { class: 'crown' }, icon('crown', 56)),
        h('div', { class: 'w-name' }, winners.map(function (id) { return isMe(id) ? 'أنت' : nm(id); }).join(' و ')),
        h('div', { class: 'dim' }, winners.length > 1 ? 'تعادل' : (iWon ? 'أذكى محقق!' : 'الفائز'))),
      h('div', { class: 'mh-scoreline big' }, h('span', null, 'أنت ', h('b', null, v.scores[v.you])), h('i', null, '–'), h('span', null, h('b', null, v.scores[opp]), ' ' + nm(opp))),
      v.result ? h('div', { class: 'mh-reveal' },
        h('div', null, h('div', { class: 'dim small center' }, 'شخصيتك'), faceCard(v.result.secrets[v.you], { tag: 'div', cls: 'big' })),
        h('div', { class: 'vs' }, 'ضد'),
        h('div', null, h('div', { class: 'dim small center' }, 'شخصية ' + nm(opp)), faceCard(v.result.secrets[opp], { tag: 'div', cls: 'big' }))) : null,
      h('div', { class: 'grow' }),
      amHost ? h('button', { class: 'primary big', onclick: function () { send({ type: 'new_game' }); } }, 'مباراة جديدة') : h('div', { class: 'center dim' }, 'بانتظار المضيف…'),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  // ---------- sheets ----------
  function sheet(title, body, onClose) {
    return h('div', { class: 'sheet-wrap', onclick: function (e) { if (e.target === e.currentTarget && onClose) onClose(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'sheet-head' }, h('h2', null, title), onClose ? h('button', { class: 'icon-btn', onclick: onClose, 'aria-label': 'إغلاق' }, icon('close')) : null), body));
  }
  function closeSheet() { S.sheet = null; render(); }

  function askSheet() {
    const v = S.game;
    const mine = {};
    v.asked.forEach(function (a) { if (a.by === v.you) mine[a.q] = a.yes; });
    const groups = [];
    QS().forEach(function (q) { let g = groups.find(function (x) { return x.name === q.group; }); if (!g) { g = { name: q.group, list: [] }; groups.push(g); } g.list.push(q); });
    // how many faces still up would say yes: a hint of how useful the question is
    return sheet('اختار سؤالك', h('div', { class: 'mh-asklist' }, groups.map(function (g) {
      return h('div', { class: 'mh-qgroup' }, h('div', { class: 'gname' }, g.name), h('div', { class: 'chips' }, g.list.map(function (q) {
        const done = Object.prototype.hasOwnProperty.call(mine, q.id);
        return h('button', {
          class: 'mh-qchip' + (done ? ' done ' + (mine[q.id] ? 'yes' : 'no') : ''),
          disabled: done,
          onclick: function () { S.sheet = null; if (send({ type: 'ask', q: q.id })) S.sent = true; },
        }, q.text, done ? h('b', null, mine[q.id] ? ' نعم' : ' لا') : null);
      })));
    })), closeSheet);
  }

  function guessSheet() {
    const i = S.guessPick;
    return sheet('متأكد؟', h('div', { class: 'menu-list mh-guess' },
      faceCard(i, { tag: 'div', cls: 'big' }),
      h('p', { class: 'center' }, 'تخمّن إن شخصية خصمك هي ', h('b', null, CH()[i].name), '؟ إذا طلع غلط تخسر الجولة.'),
      h('div', { class: 'btns' },
        h('button', { class: 'primary big', onclick: function () { S.sheet = null; S.guessMode = false; if (send({ type: 'guess', char: i })) S.sent = true; } }, 'إي، هذا هو!'),
        h('button', { onclick: function () { S.sheet = null; render(); } }, 'رجوع'))), closeSheet);
  }

  function secretMini(v) {
    return v.secret === null ? faceCard(0, { tag: 'div', cls: 'mini', down: true }) : faceCard(v.secret, { tag: 'div', cls: 'mini' });
  }

  // confirm my choice of secret character
  function pickSheet() {
    const i = S.pickChoice;
    return sheet('هذي شخصيتك؟', h('div', { class: 'menu-list mh-guess' },
      faceCard(i, { tag: 'div', cls: 'big' }),
      h('p', { class: 'center' }, 'تختار ', h('b', null, CH()[i].name), ' شخصيتك السرية؟ خصمك لازم يخمّنها.'),
      h('div', { class: 'btns' },
        h('button', { class: 'primary big', onclick: function () { S.sheet = null; if (send({ type: 'pick', char: i })) { S.sent = true; sfx('ladder'); } } }, 'إي، أختارها'),
        h('button', { onclick: function () { S.sheet = null; render(); } }, 'رجوع'))), closeSheet);
  }

  function secretSheet() {
    const v = S.game;
    if (v.secret === null) { S.sheet = null; return null; }
    const c = CH()[v.secret];
    return sheet('شخصيتك السرية', h('div', { class: 'menu-list mh-guess' }, faceCard(v.secret, { tag: 'div', cls: 'big' }),
      h('p', { class: 'center dim' }, 'خصمك يحاول يعرف إنها ', h('b', null, c.name), '. الخادم يجاوب أسئلته عنها بالصدق.')), closeSheet);
  }

  function chatSheet() {
    const v = S.game;
    S.unread = 0;
    const input = h('input', {
      id: 'mh-chatin', type: 'text', maxlength: C.CHAT_MAX, placeholder: 'اكتب رسالة…', value: S.chatDraft, autocomplete: 'off',
      oninput: function (e) { S.chatDraft = e.target.value; },
      onfocus: function () { S.focus = 'chat'; },
      onblur: function () { if (S.focus === 'chat') S.focus = null; },
    });
    const list = (v.chat || []).slice(-40);
    return sheet('الدردشة', h('div', { class: 'mh-chat' },
      list.length ? h('ol', { class: 'msgs' }, list.map(function (m) {
        return h('li', { class: m.by === v.you ? 'mine' : '' }, h('small', null, m.by === v.you ? 'أنت' : nm(m.by)), h('span', null, m.text));
      })) : h('div', { class: 'dim center' }, 'ما في رسائل بعد. سلّم على خصمك 👋'),
      h('form', { class: 'mh-askform', onsubmit: function (e) {
        e.preventDefault();
        const t = S.chatDraft.trim();
        if (!t) return;
        if (send({ type: 'chat', text: t })) { S.chatDraft = ''; S.focus = 'chat'; }
      } }, input, h('button', { class: 'primary with-icon', type: 'submit' }, icon('send', 18), 'إرسال')),
      v.options.ask === 'free' ? h('div', { class: 'dim small center' }, 'الأسئلة تنكتب بخانة السؤال بدورك، مو هنا.') : null), closeSheet);
  }

  function logSheet() {
    const v = S.game;
    return sheet('الأسئلة', v.asked.length ? h('ol', { class: 'mh-log' }, v.asked.slice().reverse().map(function (a) {
      return h('li', { class: a.by === v.you ? 'mine' : '' }, h('span', { class: 'who' }, a.by === v.you ? 'أنت' : nm(a.by)), h('span', { class: 'q' }, qText(a)), h('b', { class: ansCls(a.yes) }, ansText(a.yes)));
    })) : h('div', { class: 'dim center' }, 'لا أسئلة بعد.'), closeSheet);
  }

  function menuSheet() {
    const muted = SND.isMuted();
    const amHost = S.room && S.room.hostId === S.you;
    return sheet('القائمة', h('div', { class: 'menu-list' },
      h('button', { class: 'with-icon', 'aria-pressed': S.elec ? 'true' : 'false', onclick: function () { S.elec = !S.elec; store(GAME + '.elec', S.elec); S.lcd = null; render(); } },
        icon('target', 20), S.elec ? 'النسخة الإلكترونية - اضغط للشكل الكلاسيكي' : 'الشكل الكلاسيكي - اضغط للنسخة الإلكترونية'),
      S.elec ? h('button', { class: 'with-icon', 'aria-pressed': S.voice ? 'true' : 'false', onclick: function () { S.voice = !S.voice; store(GAME + '.voice', S.voice); if (S.voice) speak('أهلاً، أنا أقرأ الأسئلة والأجوبة'); render(); } },
        icon('sound', 20), S.voice ? 'الصوت الناطق يعمل' : 'الصوت الناطق متوقف') : null,
      S.elec && S.voice && !arVoice ? h('div', { class: 'dim small center' }, 'ما لكينا صوت عربي بجهازك، فالأسئلة تظهر على الشاشة بس.') : null,
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'log'; render(); } }, icon('list', 20), 'الأسئلة والأجوبة'),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('help', 20), 'طريقة اللعب'),
      h('button', { class: 'with-icon', onclick: function () { SND.setMuted(!muted); render(); } }, icon(muted ? 'mute' : 'sound', 20), muted ? 'الصوت مكتوم - اضغط للتشغيل' : 'الصوت يعمل - اضغط للكتم'),
      amHost && S.game.phase !== 'matchOver' ? h('button', { class: 'with-icon danger', onclick: function () { S.sheet = null; send({ type: 'end_game' }); } }, icon('flag', 20), 'إنهاء المباراة الآن') : null,
      h('a', { class: 'mh-link', href: '/' }, 'كل الألعاب'),
      h('div', { class: 'dim small center' }, 'الغرفة ' + (S.room ? S.room.code : ''))), closeSheet);
  }
  function helpSheet() {
    const li = function (t) { return h('li', null, t); };
    return sheet('طريقة اللعب', h('div', { class: 'menu-list' }, h('ul', { class: 'help-list' },
      li('كل لاعب عنده شخصية سرية من 24 شخصية. هدفك تعرف شخصية خصمك قبل ما يعرف شخصيتك.'),
      li('ضد صديق: بدورك اكتب سؤالك بخانة السؤال، أو اتصل بيه 📞 واسأله بصوتك واضغط "سألت بالصوت". هو يجاوب بزر نعم أو لا، لأنه بس هو يعرف شخصيته.'),
      li('ضد الكمبيوتر: اختار سؤالك من القائمة، والخادم يجاوب بالصدق.'),
      li('بعد الجواب اقلب بيدك الوجوه اللي ما تنطبق (اضغط على كل وجه)، ثم "إنهاء الدور".'),
      li('بدل السؤال تقدر "تخمّن": إذا صح تفوز بالجولة، وإذا غلط تخسرها.'),
      li('الدردشة 💬 والمكالمة 📞 مفتوحة طول المباراة، والصوت يروح مباشرة بين جهازيكم.'),
      li('لكل دور ' + C.TURN_SECONDS + ' ثانية، وإذا خلص الوقت يروح الدور.'))), closeSheet);
  }
  function disconnectSheet(now) {
    const secs = Math.floor((now - S.disconnectedAt) / 1000);
    return h('div', { class: 'sheet-wrap blocking' }, h('div', { class: 'sheet disconnect', role: 'alertdialog' },
      h('div', { class: 'sheet-head' }, h('h2', null, 'انقطع الاتصال بالخادم')), h('p', null, 'نحاول إعادة الاتصال تلقائياً…'), h('div', { class: 'dim small' }, 'مضى ' + secs + ' ثانية'),
      h('div', { class: 'btns' }, h('button', { class: 'primary', onclick: function () { attempts = 0; connect(); render(); } }, 'أعد المحاولة الآن'),
        secs >= 60 ? h('button', { onclick: function () { leaveRoom(); render(); } }, 'الصفحة الرئيسية') : null)));
  }

  function render() {
    const now = Date.now();
    if (S.toast && S.toast.until <= now) S.toast = null;
    const v = S.game;
    const waiting = v && v.result && now < S.resultAt;
    let screen;
    const overlays = [];
    if (!S.you || !S.room) screen = h('div', { class: 'mh-shell' }, homeScreen());
    else if (v && v.phase === 'matchOver' && !waiting) screen = h('div', { class: 'mh-shell' }, finalScreen());
    else if (v) screen = gameScreen();
    else screen = h('div', { class: 'mh-shell' }, lobbyScreen());
    if (v && v.phase === 'roundOver' && v.result && !waiting) {
      if (!S.hideResult) overlays.push(resultSheet());
      else screen.append(h('div', { class: 'mh-showres' }, h('button', { class: 'primary', onclick: function () { S.hideResult = false; render(); } }, 'عرض النتيجة')));
    }
    if (v && v.phase === 'pick' && S.sheet === 'pick' && v.secret === null) overlays.push(pickSheet());
    if (v && v.phase === 'turn' && S.sheet === 'ask') overlays.push(askSheet());
    if (v && v.phase === 'turn' && S.sheet === 'guess') overlays.push(guessSheet());
    if (v && S.sheet === 'secret') { const ss = secretSheet(); if (ss) overlays.push(ss); }
    if (v && S.sheet === 'log') overlays.push(logSheet());
    if (v && S.sheet === 'chat') overlays.push(chatSheet());

    if (v && S.sheet === 'menu') overlays.push(menuSheet());
    if (S.sheet === 'help') overlays.push(helpSheet());
    if (S.you && S.status !== 'open' && S.disconnectedAt && now - S.disconnectedAt > 3000) overlays.push(disconnectSheet(now));
    const nodes = [];
    if (S.status !== 'open') nodes.push(h('div', { class: 'banner', role: 'status' }, S.status === 'connecting' ? 'جاري الاتصال…' : 'انقطع الاتصال. جاري إعادة الاتصال…'));
    nodes.push(screen);
    overlays.forEach(function (o) { nodes.push(o); });
    if (S.toast) nodes.push(h('div', { class: 'toast' + (S.toast.ok ? ' ok' : ''), role: 'alert' }, S.toast.text));
    rootEl.replaceChildren.apply(rootEl, nodes);
    if (S.focus) {
      const f = document.getElementById(S.focus === 'ask' ? 'mh-askin' : 'mh-chatin');
      if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) { /* ignore */ } }
    }
    const msgs = document.querySelector('.mh-chat .msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  setInterval(function () {
    const el = document.getElementById('mh-timer');
    if (el && S.game) {
      const s = secondsOf(S.timerEnd);
      const num = el.querySelector('.num');
      if (num && s !== null) num.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }
    if (S.lcd && S.lcd.until <= Date.now()) { S.lcd = null; render(); }
    const ct = document.getElementById('mh-calltime');
    if (ct && call.state === 'live' && call.since) {
      const cs = Math.floor((Date.now() - call.since) / 1000);
      ct.textContent = '🔊 مكالمة وية ' + (S.game ? nm(other(S.game)) : '') + ' · ' + Math.floor(cs / 60) + ':' + String(cs % 60).padStart(2, '0');
    }
    const nx = document.getElementById('mh-next');
    if (nx && S.nextEnd) nx.textContent = 'الجولة التالية بعد ' + secondsOf(S.nextEnd) + ' ثانية…';
    if (S.status !== 'open' && Date.now() - (S.lastSlow || 0) > 1000) { S.lastSlow = Date.now(); render(); }
    if (S.toast && S.toast.until <= Date.now()) render();
  }, 250);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (S.guessMode) { S.guessMode = false; render(); return; } if (S.sheet || S.reacts) { S.reacts = false; closeSheet(); } }
  });

  F.ensureDefs();
  render();
  connect();
})();
