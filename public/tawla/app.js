// Tawla client: connection, lobby, the board, the match.
(function () {
  const C = window.TawlaConfig;
  const SC = window.ScrewConfig; // room-code length, name length, idle minutes, reactions (shared by all games)
  const SND = window.ScrewSound;
  const TB = window.TawlaBoard;
  const rootEl = document.getElementById('tw-root');
  const GAME = 'tawla';

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
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    auto: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7"/>',
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
  function buzz(pattern) {
    if (!navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, document.hidden ? 0 : ms); }); }

  const params = new URLSearchParams(location.search);
  let urlCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, SC.ROOM_CODE_LENGTH);
  const pageStart = Date.now();

  function savedOptions() {
    const o = store(GAME + '.options') || {};
    return { target: C.TARGETS.indexOf(o.target) >= 0 ? o.target : C.DEFAULT_TARGET };
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
    sheet: null,
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
    sent: false,
    hideResult: false,
    reacts: false,
    autoRoll: store(GAME + '.autoRoll') === true,
    autoDone: store(GAME + '.autoDone') === true,
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
    S.you = null; S.room = null; S.game = null; S.sheet = null; S.eventText = ''; S.log = [];
    queue.length = 0;
    urlCode = '';
    S.codeInput = '';
    try { history.replaceState(null, '', '/tawla.html'); } catch (e) { /* ignore */ }
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
        try { history.replaceState(null, '', '/tawla.html?room=' + m.code); } catch (e) { /* ignore */ }
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
          if (S.game) sync(); // a refused move: show the real board again
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
    if (!prev || prev.seq !== m.seq || prev.phase !== m.phase) S.sent = false;
    if (m.phase === 'turn') S.hideResult = false;
    const b = boardView();
    b.setSeat(m.seat);
    if (!prev) b.setPos(m.pos);
    if (m.phase === 'turn' && m.currentPlayerId === m.you && m.stage === 'roll' && (!prev || prev.currentPlayerId !== m.you || prev.gameNo !== m.gameNo)) {
      jobs(function () { if (S.game && S.game.currentPlayerId === S.you) { SND.play('turn'); buzz(50); } return null; });
    }
    if (!queue.length && !busy) sync();
  }

  function nm(id) { return S.names[id] || '؟'; }
  function isMe(id) { return id === S.you; }
  function who(id) { return isMe(id) ? 'أنت' : nm(id); }
  const COLOR_NAME = ['الأبيض', 'الأسود'];

  function describe(e) {
    switch (e.type) {
      case 'game_start': return 'اللعبة ' + e.game + ': ' + nm(S.game ? S.game.playerIds[0] : '') + ' رمى ' + e.opening[0] + ' و' + nm(S.game ? S.game.playerIds[1] : '') + ' رمى ' + e.opening[1] + '، يبدأ ' + nm(e.firstPlayerId);
      case 'roll': return who(e.playerId) + ' رمى ' + e.dice[0] + ' و ' + e.dice[1] + (e.dice[0] === e.dice[1] ? ' (دبل)' : '');
      case 'no_moves': return who(e.playerId) + ': ما في حركة بهذا الرمي';
      case 'step': return '';
      case 'undo': return '';
      case 'game_end': {
        const r = e.result;
        return (r.kind === 'single' ? 'فاز ' : C.KIND_NAMES[r.kind] + '! فاز ') + nm(r.winnerId) + ' بـ ' + r.points + (r.points === 1 ? ' نقطة' : ' نقاط');
      }
      case 'match_over': return 'انتهت المباراة';
      default: return '';
    }
  }
  function logLine(t) {
    if (!t) return;
    S.eventText = t;
    S.log.unshift(t);
    if (S.log.length > 80) S.log.length = 80;
  }

  // ---------- the board and the animation queue ----------
  // Events arrive before the game_state that follows them; each one becomes a job, run one by one.

  let boardObj = null;
  function boardView() {
    if (!boardObj) boardObj = TB.create({ onMove: onBoardMove, onRoll: roll });
    return boardObj;
  }

  const queue = [];
  let busy = false;
  function jobs(fn) { queue.push(fn); if (!busy) setTimeout(pump, 0); }
  function pace() { return queue.length > 3 ? 0.45 : 1; }
  function pump() {
    if (busy) return;
    if (!S.game && queue.length) { setTimeout(pump, 30); return; } // the first state is still on its way
    const fn = queue.shift();
    if (!fn) { sync(); render(); return; }
    busy = true;
    boardView().setInteractive({ legal: [], paths: [], enabled: false });
    let p;
    try { p = fn(); } catch (err) { p = null; }
    Promise.resolve(p).catch(function () {}).then(function () { busy = false; pump(); });
  }

  // the board shows exactly what the server says (when nothing is animating)
  function sync() {
    const v = S.game;
    if (!v) return;
    const b = boardView();
    b.setSeat(v.seat);
    b.setPos(v.pos);
    const myTurn = v.phase === 'turn' && v.currentPlayerId === v.you;
    b.clearDice();
    if (v.phase === 'turn' && v.dice.length) {
      const total = v.dice[0] === v.dice[1] ? 4 : 2;
      b.setDice(myTurn ? 'me' : 'opp', v.dice, total - v.left.length, true);
    } else if (v.phase === 'turn' && v.lastMove && v.lastMove.playerId !== v.currentPlayerId && lastDice[v.lastMove.playerId]) {
      // between turns: the last roll stays on its side
      b.setDice(v.lastMove.playerId === v.you ? 'me' : 'opp', lastDice[v.lastMove.playerId], lastDice[v.lastMove.playerId][0] === lastDice[v.lastMove.playerId][1] ? 4 : 2, true);
    }
    b.setPrompt(myTurn && v.stage === 'roll' && !S.sent);
    b.setInteractive({ legal: v.legal, paths: v.paths, enabled: myTurn && v.stage === 'move' && !S.sent && !busy, canRoll: myTurn && v.stage === 'roll' && !S.sent });
    maybeAuto();
  }
  const lastDice = {};

  function announce(word, sub, cls) {
    const el = h('div', { class: 'tw-announce ' + (cls || ''), role: 'status' }, h('div', { class: 'w' }, word), sub ? h('div', { class: 'n' }, sub) : null);
    document.body.append(el);
    setTimeout(function () { el.classList.add('out'); }, 1100);
    setTimeout(function () { el.remove(); }, 1400);
  }
  function rectOf(sel) { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? r : null; }
  function bubble(id, text) {
    const r = rectOf('[data-seat="' + id + '"]');
    const el = h('div', { class: 'tw-bubble', 'aria-hidden': 'true' }, text);
    el.style.left = (r ? r.left + r.width / 2 : window.innerWidth / 2) + 'px';
    el.style.top = (r ? r.top + r.height / 2 : window.innerHeight / 2) + 'px';
    document.body.append(el);
    setTimeout(function () { el.remove(); }, 1600);
  }
  function showReaction(from, id) {
    if (!EMOJI[id]) return;
    const r = rectOf('[data-seat="' + from + '"]') || rectOf('[data-chip="' + from + '"]');
    const el = h('div', { class: 'tw-react', 'aria-hidden': 'true' }, h('span', null, EMOJI[id]), h('small', null, nm(from)));
    el.style.left = (r ? r.left + r.width / 2 : window.innerWidth / 2) + 'px';
    el.style.top = (r ? r.top : window.innerHeight / 2) + 'px';
    document.body.append(el);
    setTimeout(function () { el.remove(); }, 2300);
  }
  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = h('div', { class: 'tw-confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 60; i++) box.append(h('i', { class: 'c' + (i % 4), style: { left: Math.random() * 100 + '%', '--d': (Math.random() * 0.8).toFixed(2) + 's', '--x': (Math.random() * 160 - 80).toFixed(0) + 'px', '--r': (Math.random() * 720 - 360).toFixed(0) + 'deg' } }));
    document.body.append(box);
    setTimeout(function () { box.remove(); }, 3600);
  }

  function seatOf(id) { return S.game ? S.game.playerIds.indexOf(id) : 0; }

  function onEvent(e) {
    const b = boardView();
    switch (e.type) {
      case 'game_start':
        jobs(function () {
          logLine(describe(e));
          b.setSeat(S.game.seat);
          b.setPos(startPos());
          b.clearDice();
          S.hideResult = false;
          const ids = S.game.playerIds;
          const mine = S.game.seat;
          SND.play('dice');
          return Promise.all([b.rollDice('me', [e.opening[mine]], 600), b.rollDice('opp', [e.opening[1 - mine]], 600)]).then(function () {
            announce(isMe(e.firstPlayerId) ? 'أنت تبدأ' : 'يبدأ ' + nm(e.firstPlayerId), e.opening[seatOf(ids[0])] + ' ضد ' + e.opening[seatOf(ids[1])], 'start');
            lastDice[e.firstPlayerId] = [e.opening[seatOf(e.firstPlayerId)], e.opening[1 - seatOf(e.firstPlayerId)]];
            return wait(1100);
          });
        });
        break;
      case 'roll':
        jobs(function () {
          logLine(describe(e));
          lastDice[e.playerId] = e.dice.slice();
          b.clearDice();
          SND.play('dice');
          render();
          return b.rollDice(isMe(e.playerId) ? 'me' : 'opp', e.dice, 650 * pace()).then(function () { return wait(150 * pace()); });
        });
        break;
      case 'step':
        jobs(function () {
          const p = seatOf(e.playerId);
          SND.play('clack', 260 * pace());
          if (e.hit) { setTimeout(function () { SND.play('knock'); }, 100); if (pace() === 1) bubble(S.game.playerIds[1 - p], 'ضربة!'); }
          return b.step(p, e, e.hit, 380 * pace());
        });
        break;
      case 'undo':
        jobs(function () { return b.unstep(seatOf(e.playerId), e, e.hit, 260); });
        break;
      case 'no_moves':
        jobs(function () {
          logLine(describe(e));
          bubble(e.playerId, 'ما في حركة');
          SND.play('knock');
          render();
          return wait(900);
        });
        break;
      case 'game_end':
        jobs(function () {
          logLine(describe(e));
          const r = e.result;
          const mine = isMe(r.winnerId);
          announce(r.kind === 'single' ? (mine ? 'فزت!' : 'خسرت') : C.KIND_NAMES[r.kind] + '!', nm(r.winnerId) + ' +' + r.points, mine ? 'win' : (r.kind === 'single' ? '' : 'mars'));
          SND.play(mine ? 'win' : 'screw');
          if (mine) buzz([40, 60, 40]);
          render();
          return wait(1600);
        });
        break;
      case 'match_over':
        jobs(function () {
          logLine(describe(e));
          if (e.winnerIds.indexOf(S.you) >= 0) { confetti(); SND.play('win'); }
          return wait(400);
        });
        break;
      default:
        break;
    }
  }

  function startPos() {
    const pts = new Array(26).fill(0);
    Object.keys(C.START).forEach(function (k) { pts[+k] += C.START[k]; pts[25 - k] -= C.START[k]; });
    return { pts: pts, bar: [0, 0], off: [0, 0] };
  }

  // ---------- my moves ----------

  function roll() {
    const v = S.game;
    if (!v || v.currentPlayerId !== v.you || v.stage !== 'roll' || S.sent || busy || queue.length) return;
    if (send({ type: 'roll' })) { S.sent = true; boardView().setPrompt(false); render(); }
  }

  // one die, or a long move of one checker over several dice: the steps go one after another
  function onBoardMove(from, dice) {
    const v = S.game;
    if (!v || S.sent) return;
    const p = v.seat;
    let at = from;
    let ok = true;
    dice.forEach(function (d) {
      ok = ok && sendRaw({ type: 'move', from: at, die: d });
      at = p === 0 ? at - d : at + d;
    });
    if (!ok) { toast('لا يوجد اتصال. جاري إعادة المحاولة…'); return; }
    S.sent = true;
    render();
  }

  function undo() { if (!S.sent && send({ type: 'undo' })) S.sent = true; }
  function done() { if (!S.sent && send({ type: 'done' })) S.sent = true; }

  let autoTimer = null;
  function maybeAuto() {
    const v = S.game;
    if (autoTimer || !v || v.phase !== 'turn' || v.currentPlayerId !== v.you || S.sent || busy || queue.length) return;
    if (v.stage === 'roll' && S.autoRoll) autoTimer = setTimeout(function () { autoTimer = null; roll(); }, 600);
    else if (v.stage === 'confirm' && S.autoDone) autoTimer = setTimeout(function () { autoTimer = null; if (S.game && S.game.stage === 'confirm') done(); }, 500);
  }

  // ---------- home & lobby ----------

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
        ? 'أُعيد تشغيل الخادم (ربما نام بعد فترة بلا لعب)، فضاعت كل الغرف المفتوحة. أنشئ غرفة جديدة وأرسل الرابط لصديقك.'
        : 'هذه الغرفة لم تعد موجودة: تُحذف بعد ' + SC.ROOM_IDLE_MINUTES + ' دقيقة بلا لاعبين، أو عند إعادة تشغيل الخادم.'),
      h('button', { class: 'primary', onclick: function () { S.lost = null; create(); }, disabled: offline }, 'إنشاء غرفة جديدة'),
      h('button', { onclick: function () { S.lost = null; render(); } }, 'إغلاق')) : null;
    const waking = offline && Date.now() - pageStart > 4000
      ? h('div', { class: 'center dim small' }, 'الخادم يستيقظ… قد يأخذ حتى دقيقة إذا لم يُستخدم منذ مدة.') : null;
    return h('div', { class: 'screen' },
      h('div', { class: 'tw-hero' },
        h('div', { class: 'tw-hero-art', 'aria-hidden': 'true' },
          h('span', { class: 'ck c0' }), h('span', { class: 'ck c1' }),
          h('span', { class: 'd1', html: TB.dieSVG(6) }), h('span', { class: 'd2', html: TB.dieSVG(5) })),
        h('div', { class: 'tw-logo' }, 'طاولي')),
      lost,
      h('div', { class: 'form' }, name, waking,
        urlCode
          ? [h('div', { class: 'row' }, code), h('button', { class: 'primary', onclick: join, disabled: offline }, 'دخول الغرفة'),
            h('div', { class: 'or' }, 'أو'), h('button', { onclick: create, disabled: offline }, 'إنشاء غرفة جديدة')]
          : [h('button', { class: 'primary', onclick: create, disabled: offline }, 'إنشاء غرفة'),
            h('div', { class: 'or' }, 'أو ادخل بالكود'),
            h('div', { class: 'row' }, code, h('button', { onclick: join, disabled: offline }, 'دخول'))],
        S.homeError ? h('div', { class: 'error', role: 'alert' }, S.homeError) : null,
        h('div', { class: 'center dim small' }, 'وحدك؟ أنشئ غرفة والعب ضد الكمبيوتر.'),
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
    const url = location.origin + '/tawla.html?room=' + code;
    if (navigator.share) { navigator.share({ title: 'طاولي', text: 'تعال نلعب طاولي! كود الغرفة: ' + code, url: url }).catch(function () {}); return; }
    copyText(url).then(function () { toast('تم نسخ الرابط', true); }, function () { toast('تعذر النسخ. الرابط: ' + url); });
  }

  function avatar(p, i, cls) {
    return h('span', { class: 'tw-av c' + i + (cls ? ' ' + cls : '') }, p.bot ? icon('bot', 18) : (Array.from(p.name)[0] || '؟'));
  }
  function roomOpts() { return (S.room && S.room.options) || S.opts; }
  function setOpt(k, v) {
    S.opts = Object.assign({}, roomOpts());
    S.opts[k] = v;
    store(GAME + '.options', S.opts);
    send({ type: 'set_options', options: S.opts });
  }
  function reactButton(cls) {
    return h('button', { class: 'icon-btn tw-reactbtn' + (cls ? ' ' + cls : ''), 'aria-label': 'تفاعل', 'aria-expanded': S.reacts ? 'true' : 'false', onclick: function () { S.reacts = !S.reacts; render(); } }, icon('smile', 24));
  }
  function reactRow() {
    return h('div', { class: 'tw-reacts', role: 'toolbar', 'aria-label': 'تفاعلات' }, SC.REACTIONS.map(function (id) {
      return h('button', { 'aria-label': id, onclick: function () { S.reacts = false; send({ type: 'react', id: id }); } }, EMOJI[id] || '?');
    }));
  }

  function lobbyScreen() {
    const r = S.room;
    const amHost = r.hostId === S.you;
    const present = r.players.filter(function (p) { return p.connected; }).length;
    const o = roomOpts();
    return h('div', { class: 'screen lobby tw-lobby' },
      h('div', { class: 'lobby-head' },
        h('div', { class: 'dim center' }, 'كود الغرفة'),
        h('div', { class: 'code-box', dir: 'ltr' }, r.code),
        h('button', { class: 'with-icon', onclick: function () { share(r.code); } }, icon('share', 20), 'مشاركة الرابط')),
      h('div', { class: 'dim' }, 'اللاعبان (' + r.players.length + '/2)'),
      h('ul', { class: 'plist' }, r.players.map(function (p, i) {
        return h('li', { class: p.connected ? '' : 'off', 'data-chip': p.id },
          avatar(p, i),
          h('span', { class: 'pname' }, p.name + (p.id === S.you ? ' (أنت)' : ''), p.connected ? null : h('small', null, ' غير متصل')),
          h('span', { class: 'tw-colortag c' + i }, COLOR_NAME[i]),
          p.isHost ? h('span', { class: 'tag' }, 'المضيف') : null,
          p.bot && amHost ? h('button', { class: 'icon-btn tw-rm', 'aria-label': 'احذف ' + p.name, onclick: function () { send({ type: 'remove_bot', id: p.id }); } }, icon('close', 20)) : null);
      })),
      amHost && r.players.length < 2 ? h('button', { class: 'with-icon', onclick: function () { send({ type: 'add_bot' }); } }, icon('bot', 20), 'العب ضد الكمبيوتر') : null,
      amHost ? h('div', { class: 'tw-opts' },
        h('div', { class: 'dim small' }, 'المباراة إلى'),
        h('div', { class: 'tw-seg' }, C.TARGETS.map(function (t) {
          return h('button', { 'aria-pressed': o.target === t ? 'true' : 'false', onclick: function () { setOpt('target', t); } },
            h('span', null, t + (t === 1 ? ' نقطة' : ' نقاط')), h('small', null, t === 1 ? 'لعبة واحدة' : t <= 3 ? 'قصيرة' : t <= 5 ? 'عادية' : 'طويلة'));
        })))
        : h('div', { class: 'tw-rules' }, h('b', null, 'المباراة (يختارها المضيف)'), h('span', null, 'إلى ' + o.target + (o.target === 1 ? ' نقطة' : ' نقاط') + '، والمارس بنقطتين')),
      h('div', { class: 'tw-lobbyrow' },
        h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('help', 20), 'طريقة اللعب'),
        reactButton('boxed')),
      S.reacts ? reactRow() : null,
      h('div', { class: 'grow' }),
      amHost
        ? [present < 2 ? h('div', { class: 'center dim' }, 'أرسل الرابط لصديقك أو العب ضد الكمبيوتر.') : null,
          h('button', { class: 'primary big', disabled: present < 2, onclick: function () { send(r.options ? { type: 'start_game' } : { type: 'start_game', options: S.opts }); } }, 'ابدأ')]
        : h('div', { class: 'center dim' }, 'بانتظار المضيف ليبدأ…'),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  // ---------- the game screen ----------

  function secondsOf(end) { return end ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : null; }

  function strip(v, id, mine) {
    const p = v.players.find(function (x) { return x.id === id; });
    const i = v.playerIds.indexOf(id);
    const turn = v.currentPlayerId === id;
    return h('div', { class: 'tw-strip' + (mine ? ' me' : '') + (turn ? ' turn' : '') + (p.connected ? '' : ' off'), 'data-seat': id },
      avatar(p, i, 'sm'),
      h('span', { class: 'nm' }, p.name + (mine ? ' (أنت)' : ''), p.connected ? null : h('small', null, ' غير متصل')),
      turn ? h('span', { class: 'tw-turn' }, mine ? 'دورك' : 'دوره') : null,
      h('span', { class: 'grow' }),
      h('span', { class: 'tw-stat', title: 'النقاط المتبقية للتخريج' }, h('small', null, 'المتبقي'), h('b', { class: 'num' }, v.pips[i])),
      h('span', { class: 'tw-stat' }, h('small', null, 'خرّج'), h('b', { class: 'num' }, v.pos.off[i] + '/15')),
      h('span', { class: 'tw-score' }, v.scores[id]),
      mine ? reactButton() : null);
  }

  function actions(v) {
    const myTurn = v.phase === 'turn' && v.currentPlayerId === v.you;
    if (v.phase !== 'turn') return h('div', { class: 'tw-instr dim' }, S.eventText);
    if (!myTurn) {
      const cur = v.players.find(function (p) { return p.id === v.currentPlayerId; });
      return h('div', { class: 'tw-instr dim' }, cur.bot ? cur.name + ' يفكّر…' : 'دور ' + cur.name + (v.stage === 'roll' ? '' : ' يحرّك') + '…');
    }
    if (busy || queue.length) return h('div', { class: 'tw-instr dim' }, '…');
    if (v.stage === 'roll') {
      return h('div', { class: 'tw-act' }, h('button', { class: 'primary big tw-rollbtn', disabled: S.sent, onclick: roll }, S.sent ? 'يرمي…' : 'ارمِ النرد'));
    }
    const leftTxt = v.left.length ? 'حرّك: ' + v.left.join(' و ') : '';
    const canUndo = v.stepsDone > 0;
    if (v.stage === 'confirm') {
      return h('div', { class: 'tw-act' },
        h('button', { class: 'with-icon', disabled: S.sent, onclick: undo }, icon('undo', 20), 'تراجع'),
        h('button', { class: 'primary big with-icon tw-done', disabled: S.sent, onclick: done }, icon('check', 22), 'تم'));
    }
    return h('div', { class: 'tw-act' },
      canUndo ? h('button', { class: 'with-icon', disabled: S.sent, onclick: undo }, icon('undo', 20), 'تراجع') : null,
      h('div', { class: 'tw-instr' }, leftTxt, h('small', null, 'اضغط قطعة ثم مكانها، أو اسحبها')));
  }

  function gameScreen() {
    const v = S.game;
    const left = secondsOf(S.timerEnd);
    const myTurn = v.phase === 'turn' && v.currentPlayerId === v.you;
    const opp = v.playerIds[1 - v.seat];
    const top = h('header', { class: 'tw-top' },
      h('span', { class: 'brand' }, 'طاولي'),
      h('span', { class: 'tw-match' }, h('b', { class: 'num' }, v.scores[v.you] + ' – ' + v.scores[opp]), ' · إلى ' + v.options.target + ' · اللعبة ' + v.gameNo),
      h('span', { class: 'tw-timer' + (myTurn ? '' : ' other') + (myTurn && left !== null && left <= 5 ? ' low' : ''), id: 'tw-timer' },
        left === null || v.phase !== 'turn' ? null : [icon('clock', 18), h('span', { class: 'num' }, Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'))]),
      h('span', { class: 'tw-topbtns' },
        h('button', { class: 'icon-btn', 'aria-label': 'طريقة اللعب', onclick: function () { S.sheet = 'help'; render(); } }, icon('help')),
        h('button', { class: 'icon-btn', 'aria-label': 'القائمة', onclick: function () { S.sheet = 'menu'; render(); } }, icon('menu'))));
    const me = strip(v, v.you, true);
    return h('div', { class: 'tw-app' },
      top,
      strip(v, opp, false),
      h('div', { class: 'tw-boardwrap' + (myTurn ? ' tw-mine' : '') }, boardView().el),
      h('div', { class: 'tw-actions' }, actions(v)),
      h('div', { class: 'tw-mebox' }, S.reacts ? reactRow() : null, me));
  }

  function resultSheet() {
    const v = S.game;
    const r = v.result;
    const amHost = S.room && S.room.hostId === S.you;
    const secs = secondsOf(S.nextEnd);
    const opp = v.playerIds[1 - v.seat];
    const mine = r.winnerId === v.you;
    return sheet('نتيجة اللعبة ' + r.game, [
      h('div', { class: 'tw-headline' + (mine ? ' good' : '') }, (r.kind === 'single' ? '' : C.KIND_NAMES[r.kind] + '! ') + (mine ? 'فزت' : 'فاز ' + nm(r.winnerId)) + ' بـ ' + r.points + (r.points === 1 ? ' نقطة' : ' نقاط')),
      r.kind !== 'single' ? h('div', { class: 'center dim small' }, r.kind === 'gammon' ? 'المارس: الخاسر ما خرّج ولا قطعة.' : 'المارس المضاعف: الخاسر ما خرّج شي وعنده قطعة بالبار أو ببيت الفائز.') : null,
      h('div', { class: 'tw-scoreline' },
        h('div', null, h('span', null, who(v.you)), h('b', { class: 'num' }, v.scores[v.you])),
        h('i', null, '–'),
        h('div', null, h('span', null, nm(opp)), h('b', { class: 'num' }, v.scores[opp]))),
      h('div', { class: 'center dim' }, 'المباراة إلى ' + v.options.target),
      amHost ? h('button', { class: 'primary big', onclick: function () { send({ type: 'next_round' }); } }, 'اللعبة التالية' + (secs !== null ? ' (' + secs + ')' : ''))
        : h('div', { class: 'center dim', id: 'tw-next' }, secs !== null ? 'اللعبة التالية تبدأ بعد ' + secs + ' ثانية…' : 'بانتظار اللعبة التالية…'),
    ], function () { S.hideResult = true; render(); });
  }

  function finalScreen() {
    const v = S.game;
    const amHost = S.room && S.room.hostId === S.you;
    const winners = v.winnerIds || [];
    const iWon = winners.indexOf(v.you) >= 0;
    const opp = v.playerIds[1 - v.seat];
    return h('div', { class: 'screen final tw-final' },
      h('div', { class: 'dim center' }, v.endedEarly ? 'أنهى المضيف المباراة' : 'نهاية المباراة'),
      h('div', { class: 'winner' + (iWon ? ' me' : '') },
        h('div', { class: 'crown' }, icon('crown', 56)),
        h('div', { class: 'w-name' }, winners.map(nm).join(' و ')),
        h('div', { class: 'dim' }, winners.length > 1 ? 'تعادل' : (iWon ? 'مبروك! فزت بالمباراة' : 'الفائز بالمباراة'))),
      h('div', { class: 'tw-scoreline big' },
        h('div', null, h('span', null, who(v.you)), h('b', { class: 'num' }, v.scores[v.you])),
        h('i', null, '–'),
        h('div', null, h('span', null, nm(opp)), h('b', { class: 'num' }, v.scores[opp]))),
      v.history.length ? h('ol', { class: 'tw-hist' }, v.history.map(function (g) {
        return h('li', null, h('span', null, 'اللعبة ' + g.game), h('span', null, nm(g.winnerId) + (g.kind !== 'single' ? ' · ' + C.KIND_NAMES[g.kind] : '')), h('b', null, '+' + g.points));
      })) : null,
      h('div', { class: 'grow' }),
      amHost ? h('button', { class: 'primary big', onclick: function () { send({ type: 'new_game' }); } }, 'مباراة جديدة')
        : h('div', { class: 'center dim' }, 'بانتظار المضيف لبدء مباراة جديدة…'),
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
  function setFlag(key, on, text) {
    S[key] = on;
    store(GAME + '.' + key, on);
    toast(text, true);
  }

  function menuSheet() {
    const v = S.game;
    const muted = SND.isMuted();
    const amHost = S.room && S.room.hostId === S.you;
    return sheet('القائمة', h('div', { class: 'menu-list' },
      h('div', { class: 'tw-rules' }, h('span', null, 'المباراة إلى ' + v.options.target + '، اللعبة ' + v.gameNo), h('span', null, 'أنت ' + COLOR_NAME[v.seat] + '، وبيتك تحت على اليمين')),
      h('button', { class: 'with-icon', 'aria-pressed': S.autoRoll ? 'true' : 'false', onclick: function () { setFlag('autoRoll', !S.autoRoll, !S.autoRoll ? 'النرد يُرمى عنك تلقائياً' : 'ترمي النرد بنفسك'); } },
        icon('auto', 20), S.autoRoll ? 'الرمي التلقائي يعمل - اضغط للإيقاف' : 'رمي النرد تلقائياً في دوري'),
      h('button', { class: 'with-icon', 'aria-pressed': S.autoDone ? 'true' : 'false', onclick: function () { setFlag('autoDone', !S.autoDone, !S.autoDone ? 'الدور ينتهي وحده بعد آخر حركة' : 'تضغط "تم" لإنهاء الدور'); } },
        icon('check', 20), S.autoDone ? 'إنهاء الدور تلقائياً يعمل - اضغط للإيقاف' : 'إنهاء الدور تلقائياً بعد آخر حركة'),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'log'; render(); } }, icon('list', 20), 'سجل الرميات'),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('help', 20), 'طريقة اللعب'),
      h('button', { class: 'with-icon', onclick: function () { SND.setMuted(!muted); render(); } }, icon(muted ? 'mute' : 'sound', 20), muted ? 'الصوت مكتوم - اضغط للتشغيل' : 'الصوت يعمل - اضغط للكتم'),
      amHost && v.phase !== 'matchOver' ? h('button', { class: 'with-icon danger', onclick: function () { S.sheet = 'end'; render(); } }, icon('flag', 20), 'إنهاء المباراة الآن') : null,
      h('a', { class: 'tw-link', href: '/' }, 'كل الألعاب'),
      h('div', { class: 'dim small center' }, 'الغرفة ' + (S.room ? S.room.code : ''))), closeSheet);
  }
  function endSheet() {
    return sheet('إنهاء المباراة؟', h('div', { class: 'menu-list' },
      h('p', { class: 'tw-q' }, 'تنتهي المباراة الآن ويفوز صاحب أعلى نقاط.'),
      h('div', { class: 'btns' },
        h('button', { class: 'danger solid', onclick: function () { S.sheet = null; send({ type: 'end_game' }); } }, 'نعم، أنهِ المباراة'),
        h('button', { onclick: closeSheet }, 'رجوع'))), closeSheet);
  }
  function logSheet() {
    return sheet('سجل الرميات', S.log.length ? h('ol', { class: 'log' }, S.log.map(function (t) { return h('li', null, t); })) : h('div', { class: 'dim center' }, 'لا شيء بعد.'), function () { S.sheet = 'menu'; render(); });
  }
  function helpSheet() {
    const li = function (t) { return h('li', null, t); };
    return sheet('طريقة اللعب', h('div', { class: 'menu-list' },
      h('ul', { class: 'help-list' },
        li('لكل لاعب 15 قطعة. تحرّك قطعك حول اللوحة حتى تجمعها كلها في بيتك (تحت على اليمين)، ثم تخرّجها. أول من يخرّج كل قطعه يفوز.'),
        li('أول لعبة: كل لاعب يرمي زاراً واحداً، والأعلى يبدأ ويلعب الرقمين.'),
        li('في دورك ارمِ الزارين وحرّك قطعة بكل رقم (أو قطعة واحدة بالرقمين). الدبل يُلعب أربع مرات.'),
        li('لا تنزل على خانة فيها قطعتان أو أكثر للخصم. وإذا نزلت على قطعة وحدها للخصم تضربها فتروح للبار.'),
        li('القطعة المضروبة لازم تدخل من جديد قبل أي حركة ثانية، في بيت الخصم.'),
        li('لازم تلعب الرقمين إذا تقدر، وإذا ما يمشي غير رقم واحد تلعب الأكبر.'),
        li('التخريج: لما تصير كل قطعك في بيتك. بالرقم نفسه، أو برقم أكبر من أبعد قطعة.'),
        li('النقاط: الفوز نقطة، والمارس (الخاسر ما خرّج شي) نقطتان، والمارس المضاعف (وعنده قطعة بالبار أو ببيتك) ثلاث نقاط.'),
        li('حرّك بالضغط: اضغط القطعة فتضوي الأماكن الممكنة، ثم اضغط المكان. أو اسحب القطعة. "تراجع" يرجّع آخر حركة قبل "تم".'))), closeSheet);
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
    const v = S.game;
    const animating = busy || queue.length > 0;
    let screen;
    const overlays = [];
    if (!S.you || !S.room) screen = h('div', { class: 'tw-shell' }, homeScreen());
    else if (v && v.phase === 'matchOver' && !animating) screen = h('div', { class: 'tw-shell' }, finalScreen());
    else if (v) screen = gameScreen();
    else screen = h('div', { class: 'tw-shell' }, lobbyScreen());
    if (v && v.phase === 'gameEnd' && v.result && !animating) {
      if (!S.hideResult) overlays.push(resultSheet());
      else screen.append(h('div', { class: 'tw-showres' }, h('button', { class: 'primary', onclick: function () { S.hideResult = false; render(); } }, 'عرض النتيجة')));
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
    const wrap = document.querySelector('.tw-boardwrap');
    if (wrap && boardObj) boardObj.fit(wrap.clientWidth - 16, wrap.clientHeight - 16);
    maybeAuto();
  }

  setInterval(function () {
    const el = document.getElementById('tw-timer');
    if (el && S.game) {
      const s = secondsOf(S.timerEnd);
      const num = el.querySelector('.num');
      if (num && s !== null) num.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      el.classList.toggle('low', s !== null && s <= 5 && !el.classList.contains('other'));
    }
    const nx = document.getElementById('tw-next');
    if (nx && S.nextEnd) nx.textContent = 'اللعبة التالية تبدأ بعد ' + secondsOf(S.nextEnd) + ' ثانية…';
    if (S.status !== 'open' && Date.now() - (S.lastSlow || 0) > 1000) { S.lastSlow = Date.now(); render(); }
    if (S.toast && S.toast.until <= Date.now()) render();
  }, 250);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (boardObj) boardObj.deselect(); if (S.sheet || S.reacts) { S.reacts = false; closeSheet(); } return; }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || S.sheet) return;
    const v = S.game;
    if (!v || v.currentPlayerId !== v.you) return;
    if ((e.key === ' ' || e.key === 'Enter') && v.stage === 'roll' && tag !== 'BUTTON') { e.preventDefault(); roll(); }
    if ((e.key === 'Enter') && v.stage === 'confirm' && tag !== 'BUTTON') { e.preventDefault(); done(); }
    if ((e.key === 'z' || e.key === 'Backspace') && (v.stage === 'move' || v.stage === 'confirm') && v.stepsDone) { e.preventDefault(); undo(); }
  });

  render();
  connect();
})();
