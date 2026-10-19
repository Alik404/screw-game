// Snakes & Ladders client: connection, lobby, the board screen and its animations.
(function () {
  const C = window.SnakesConfig;
  const SC = window.ScrewConfig; // room-code length, name length, idle minutes (shared by all games)
  const SND = window.ScrewSound;
  const B = window.SnakesBoard;
  const rootEl = document.getElementById('sl-root');
  const GAME = 'snakes';

  // ---------- tiny helpers ----------

  function h(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
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
    plus: '<path d="M12 5v14M5 12h14"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  };
  function icon(name, size) {
    const s = document.createElement('span');
    s.className = 'ico';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
    return s;
  }

  function store(key, value) {
    try {
      if (value === undefined) { const v = localStorage.getItem(key); return v === null ? null : JSON.parse(v); }
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  const params = new URLSearchParams(location.search);
  let urlCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, SC.ROOM_CODE_LENGTH);
  const pageStart = Date.now();

  // the host's last choices are remembered for the next room
  function savedOptions() {
    const o = store(GAME + '.options') || {};
    return {
      board: C.BOARD_OPTIONS.indexOf(o.board) >= 0 ? o.board : C.DEFAULT_BOARD,
      finish: C.FINISH_OPTIONS.indexOf(o.finish) >= 0 ? o.finish : C.DEFAULT_FINISH,
      sixAgain: typeof o.sixAgain === 'boolean' ? o.sixAgain : C.DEFAULT_SIX_AGAIN,
      startSix: typeof o.startSix === 'boolean' ? o.startSix : C.DEFAULT_START_SIX,
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
    rolled: false, // I pressed roll and wait for the server
    celebrated: false,
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

  function toast(text, ok) { S.toast = { text: text, ok: !!ok, until: Date.now() + 4000 }; render(); }

  function leaveRoom() {
    S.session = null;
    store(GAME + '.session', null);
    S.you = null; S.room = null; S.game = null; S.sheet = null; S.eventText = ''; S.log = [];
    queue.length = 0;
    urlCode = '';
    S.codeInput = '';
    try { history.replaceState(null, '', '/snakes.html'); } catch (e) { /* ignore */ }
  }

  // ---------- messages ----------

  function onMessage(m) {
    switch (m.type) {
      case 'hello':
        if (S.bootId && m.bootId !== S.bootId) S.serverRestarted = true;
        S.bootId = m.bootId;
        break;
      case 'joined':
        // a code of another game: remember the seat for that page and go there
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
        try { history.replaceState(null, '', '/snakes.html?room=' + m.code); } catch (e) { /* ignore */ }
        break;
      case 'room_state':
        S.room = m;
        m.players.forEach(function (p) { S.names[p.id] = p.name; });
        break;
      case 'game_state':
        onGameState(m);
        break;
      case 'event':
        onEvent(m.event);
        break;
      case 'error':
        S.rolled = false;
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
    S.timerEnd = m.timer && m.timer.kind === 'turn' ? m.timer.endsAt - (m.timer.now - Date.now()) : null;
    if (!prev || prev.rollCount !== m.rollCount || prev.phase !== m.phase) S.rolled = false;
    if (m.phase !== 'gameOver') S.celebrated = false;
    const board = boardView();
    board.build(m.options.board);
    board.setPlayers(m.players);
    // nothing queued: this view is simply the truth (first view, reconnect)
    if (!queue.length && !busy) { board.setPositions(m.positions, prev ? 180 : 0); board.setCurrent(m.currentPlayerId); }
    if (!prev && m.lastRoll) dieView().show(m.lastRoll.value);
    if (m.phase === 'turn' && m.currentPlayerId === m.you && (!prev || prev.currentPlayerId !== m.you || prev.rollCount !== m.rollCount)) {
      jobs(function () {
        if (!S.game || S.game.currentPlayerId !== S.you) return null;
        SND.play('turn');
        if (navigator.vibrate) { try { navigator.vibrate(50); } catch (e) { /* ignore */ } }
        return null;
      });
    }
  }

  function nm(id) { return S.names[id] || '؟'; }
  function isMe(id) { return id === S.you; }

  function describe(e) {
    const p = e.playerId ? (isMe(e.playerId) ? 'أنت' : nm(e.playerId)) : '';
    switch (e.type) {
      case 'game_start': return 'بدأت اللعبة! القرعة: يبدأ ' + nm(e.firstPlayerId);
      case 'roll': return p + ' رمى ' + e.value;
      case 'move':
        if (e.blocked) return p + ': الرمية أكبر من المطلوب، يبقى على ' + e.from;
        return p + ' إلى ' + e.to + (e.bounced ? ' (ارتد من ' + C.SQUARES + ')' : '');
      case 'ladder': return 'درج! ' + p + ' صعد من ' + e.from + ' إلى ' + e.to;
      case 'snake': return 'حية! ' + p + ' نزل من ' + e.from + ' إلى ' + e.to;
      case 'extra_roll': return p + ' رمى 6: رمية إضافية';
      case 'three_sixes': return 'ثلاث ستات! ' + p + ' رجع إلى ' + (e.to || 'البداية');
      case 'need_six': return p + ' يحتاج 6 حتى يدخل اللوحة';
      case 'game_over':
        return e.early ? 'أنهى المضيف اللعبة: فاز ' + e.winnerIds.map(nm).join(' و ') : 'فاز ' + nm(e.winnerIds[0]) + '!';
      default: return '';
    }
  }

  // ---------- the board, the die and the animation queue ----------
  // Events arrive BEFORE the game_state that follows them. Each event queues a job; the jobs run one by one,
  // so every move is seen even when a computer player rolls again before the last move has finished.

  let boardObj = null;
  let dieObj = null;
  function boardView() { if (!boardObj) boardObj = B.create(); return boardObj; }
  function dieView() { if (!dieObj) dieObj = B.die(); return dieObj; }

  const queue = [];
  let busy = false;

  function jobs(fn) {
    queue.push(fn);
    if (!busy) setTimeout(pump, 0);
  }

  // faster when moves pile up (a reconnect, or a run of computer turns)
  function pace() { return queue.length > 2 ? 0.4 : 1; }

  function pump() {
    if (busy) return;
    const fn = queue.shift();
    if (!fn) {
      // caught up: make sure the board shows exactly what the server says
      if (S.game) { boardView().setPositions(S.game.positions); boardView().setCurrent(S.game.currentPlayerId); }
      render();
      return;
    }
    busy = true;
    let p;
    try { p = fn(); } catch (err) { p = null; }
    Promise.resolve(p).catch(function () {}).then(function () { busy = false; render(); pump(); });
  }

  // big word in the middle of the screen
  function announce(word, sub, cls) {
    const el = h('div', { class: 'sl-announce ' + (cls || ''), role: 'status' }, h('div', { class: 'w' }, word), sub ? h('div', { class: 'n' }, sub) : null);
    document.body.append(el);
    setTimeout(function () { el.classList.add('out'); }, 950);
    setTimeout(function () { el.remove(); }, 1250);
  }

  function confetti() {
    if (reduced()) return;
    const box = h('div', { class: 'sl-confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 70; i++) {
      box.append(h('i', { class: 'c' + (i % 6), style: { left: Math.random() * 100 + '%', '--d': (Math.random() * 0.9).toFixed(2) + 's', '--x': (Math.random() * 160 - 80).toFixed(0) + 'px', '--r': (Math.random() * 720 - 360).toFixed(0) + 'deg' } }));
    }
    document.body.append(box);
    setTimeout(function () { box.remove(); }, 3600);
  }

  function logLine(text) {
    if (!text) return;
    S.eventText = text;
    S.log.unshift(text);
    if (S.log.length > 60) S.log.length = 60;
  }

  function onEvent(e) {
    const text = describe(e);
    const board = boardView();
    switch (e.type) {
      case 'game_start':
        S.log = [];
        S.celebrated = false;
        jobs(function () {
          logLine(text);
          board.setPositions(zeros(), 0);
          announce('يلا نلعب!', 'يبدأ ' + nm(e.firstPlayerId));
          SND.play('deal');
          render();
          return wait(700);
        });
        break;
      case 'turn':
        jobs(function () { board.setCurrent(e.playerId); render(); return null; });
        break;
      case 'roll':
        jobs(function () {
          logLine(text);
          board.setCurrent(e.playerId);
          SND.play('dice');
          render();
          return dieView().roll(e.value, 650 * pace()).then(function () { return wait(120 * pace()); });
        });
        break;
      case 'move':
        jobs(function () {
          logLine(text);
          render();
          if (e.blocked) return board.shake(e.playerId);
          return board.hop(e.playerId, e.path, 170 * pace(), function () { SND.play('step'); });
        });
        break;
      case 'ladder':
      case 'snake':
        jobs(function () {
          logLine(text);
          const up = e.type === 'ladder';
          SND.play(up ? 'ladder' : 'snake');
          if (pace() === 1) announce(up ? 'درج!' : 'حية!', (isMe(e.playerId) ? 'أنت' : nm(e.playerId)) + ' ' + e.from + ' ← ' + e.to, up ? 'up' : 'down');
          if (up && isMe(e.playerId) && navigator.vibrate) { try { navigator.vibrate([30, 40, 30]); } catch (err) { /* ignore */ } }
          if (!up && isMe(e.playerId) && navigator.vibrate) { try { navigator.vibrate(180); } catch (err) { /* ignore */ } }
          render();
          const dist = Math.abs(e.to - e.from);
          return board.slide(e.playerId, e.type, e.from, e.to, (500 + dist * 12) * pace());
        });
        break;
      case 'extra_roll':
        jobs(function () {
          logLine(text);
          if (pace() === 1) announce('ستة!', 'رمية إضافية لـ' + (isMe(e.playerId) ? 'ك' : ' ' + nm(e.playerId)), 'six');
          render();
          return wait(250);
        });
        break;
      case 'three_sixes':
        jobs(function () {
          logLine(text);
          SND.play('screw');
          announce('ثلاث ستات!', 'يرجع ' + (isMe(e.playerId) ? 'أنت' : nm(e.playerId)) + ' إلى ' + (e.to || 'البداية'), 'down');
          render();
          return board.leap(e.playerId, e.to, 700 * pace());
        });
        break;
      case 'need_six':
        jobs(function () {
          logLine(text);
          render();
          return board.shake(e.playerId);
        });
        break;
      case 'game_over':
        jobs(function () {
          logLine(text);
          S.celebrated = true;
          SND.play('win');
          confetti();
          announce(e.early ? 'انتهت اللعبة' : 'فاز!', e.winnerIds.map(nm).join(' و '), 'win');
          render();
          return wait(1600);
        });
        break;
      default:
        break;
    }
  }

  function zeros() {
    const z = {};
    (S.game ? S.game.playerIds : []).forEach(function (id) { z[id] = 0; });
    return z;
  }

  // ---------- screens ----------

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
      h('div', { class: 'sl-hero' }, heroArt(), h('div', { class: 'sl-logo' }, 'حية ودرج')),
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

  // a small die and pieces for the home screen
  function heroArt() {
    const d = B.die();
    d.show(6);
    return h('div', { class: 'sl-hero-art', 'aria-hidden': 'true' }, d.el,
      h('span', { class: 'sl-dot tok-red' }), h('span', { class: 'sl-dot tok-blue' }), h('span', { class: 'sl-dot tok-yellow' }));
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
    const url = location.origin + '/snakes.html?room=' + code;
    if (navigator.share) { navigator.share({ title: 'حية ودرج', text: 'تعال نلعب حية ودرج! كود الغرفة: ' + code, url: url }).catch(function () {}); return; }
    copyText(url).then(function () { toast('تم نسخ الرابط', true); }, function () { toast('تعذر النسخ. الرابط: ' + url); });
  }

  function avatar(p, cls) {
    return h('span', { class: 'sl-av tok-' + (p.token || 'red') + (cls ? ' ' + cls : '') }, p.bot ? icon('bot', 20) : (Array.from(p.name)[0] || '؟'));
  }

  function setOpt(k, v) {
    S.opts[k] = v;
    store(GAME + '.options', S.opts);
    render();
  }

  function choice(label, key, values, names, notes) {
    return h('div', { class: 'sl-opt' },
      h('div', { class: 'dim small' }, label),
      h('div', { class: 'sl-seg' }, values.map(function (v) {
        return h('button', { 'aria-pressed': S.opts[key] === v ? 'true' : 'false', onclick: function () { setOpt(key, v); } },
          h('span', null, names[v]), notes && notes[v] ? h('small', null, notes[v]) : null);
      })));
  }

  function toggle(label, key, note) {
    const on = S.opts[key];
    return h('button', { class: 'sl-toggle', role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: function () { setOpt(key, !on); } },
      h('span', { class: 'txt' }, h('span', null, label), h('small', null, note)), h('span', { class: 'sw', 'aria-hidden': 'true' }));
  }

  function boardNotes() {
    const out = {};
    C.BOARD_OPTIONS.forEach(function (b) {
      const x = C.BOARDS[b];
      out[b] = Object.keys(x.snakes).length + ' حيات · ' + Object.keys(x.ladders).length + ' درج';
    });
    return out;
  }
  function boardNames() {
    const out = {};
    C.BOARD_OPTIONS.forEach(function (b) { out[b] = C.BOARDS[b].name; });
    return out;
  }

  function lobbyScreen() {
    const r = S.room;
    const amHost = r.hostId === S.you;
    const present = r.players.filter(function (p) { return p.connected; }).length;
    const me = r.players.find(function (p) { return p.id === S.you; });
    const full = r.players.length >= C.MAX_PLAYERS;
    return h('div', { class: 'screen lobby sl-lobby' },
      h('div', { class: 'lobby-head' },
        h('div', { class: 'dim center' }, 'كود الغرفة'),
        h('div', { class: 'code-box', dir: 'ltr' }, r.code),
        h('button', { class: 'with-icon', onclick: function () { share(r.code); } }, icon('share', 20), 'مشاركة الرابط')),
      h('div', { class: 'dim' }, 'اللاعبون (' + r.players.length + '/' + C.MAX_PLAYERS + ')'),
      h('ul', { class: 'plist' }, r.players.map(function (p) {
        return h('li', { class: p.connected ? '' : 'off' },
          avatar(p),
          h('span', { class: 'pname' }, p.name + (p.id === S.you ? ' (أنت)' : ''), p.connected ? null : h('small', null, ' غير متصل')),
          p.isHost ? h('span', { class: 'tag' }, 'المضيف') : null,
          p.bot && amHost ? h('button', { class: 'icon-btn sl-rm', 'aria-label': 'احذف ' + p.name, onclick: function () { send({ type: 'remove_bot', id: p.id }); } }, icon('close', 20)) : null);
      })),
      amHost && !full ? h('button', { class: 'with-icon', onclick: function () { send({ type: 'add_bot' }); } }, icon('bot', 20), 'أضف لاعب كمبيوتر') : null,
      h('div', { class: 'sl-colors' },
        h('div', { class: 'dim small' }, 'لون قطعتك'),
        h('div', { class: 'sl-colgrid' }, C.COLORS.map(function (t) {
          const owner = r.players.find(function (p) { return p.token === t; });
          const mine = me && me.token === t;
          const taken = owner && !mine && !owner.bot;
          return h('button', {
            class: 'sl-colpick tok-' + t + (mine ? ' on' : ''), disabled: taken,
            'aria-pressed': mine ? 'true' : 'false',
            'aria-label': C.COLOR_NAMES[t] + (owner && !mine ? '، اختاره ' + owner.name : ''),
            onclick: mine || taken ? null : function () { send({ type: 'set_token', token: t }); },
          }, h('span', { class: 'sw' }), h('small', null, owner && !mine ? owner.name : C.COLOR_NAMES[t]));
        }))),
      amHost ? h('div', { class: 'sl-opts' },
        choice('اللوحة', 'board', C.BOARD_OPTIONS, boardNames(), boardNotes()),
        choice('الوصول إلى ' + C.SQUARES, 'finish', C.FINISH_OPTIONS, C.FINISH_NAMES),
        toggle('الستة تعطي رمية إضافية', 'sixAgain', 'وثلاث ستات متتالية ترجعك لمكانك'),
        toggle('ابدأ بستة', 'startSix', 'لا تدخل اللوحة إلا إذا رميت 6')) : h('div', { class: 'sl-note' }, 'المضيف يختار اللوحة والقواعد.'),
      h('div', { class: 'grow' }),
      amHost
        ? [present < C.MIN_PLAYERS ? h('div', { class: 'center dim' }, 'أرسل الرابط لأصدقائك أو أضف لاعب كمبيوتر.') : null,
          h('button', { class: 'primary big', disabled: present < C.MIN_PLAYERS, onclick: function () { send({ type: 'start_game', options: S.opts }); } }, 'ابدأ')]
        : h('div', { class: 'center dim' }, 'بانتظار المضيف ليبدأ اللعبة…'),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  function secondsLeft() { return S.timerEnd ? Math.max(0, Math.ceil((S.timerEnd - Date.now()) / 1000)) : null; }

  function canRoll() {
    const v = S.game;
    return !!v && v.phase === 'turn' && v.currentPlayerId === v.you && !busy && !queue.length && !S.rolled && S.status === 'open';
  }

  function roll() {
    if (!canRoll()) return;
    if (send({ type: 'roll' })) { S.rolled = true; render(); }
  }

  function playersStrip(v) {
    const shown = boardView().shown();
    return h('div', { class: 'sl-players' }, v.players.map(function (p) {
      const pos = shown[p.id] !== undefined ? shown[p.id] : p.pos;
      return h('div', { class: 'sl-chip' + (v.currentPlayerId === p.id ? ' turn' : '') + (p.connected ? '' : ' off') + (p.id === v.you ? ' me' : '') },
        avatar(p, 'sm'),
        h('span', { class: 'txt' },
          h('span', { class: 'nm' }, p.name + (p.id === v.you ? ' (أنت)' : '')),
          h('span', { class: 'pos' }, p.connected ? (pos ? 'مربع ' + pos : 'البداية') : 'غير متصل')));
    }));
  }

  function statusLine(v) {
    if (v.phase !== 'turn') return '';
    const cur = v.players.find(function (p) { return p.id === v.currentPlayerId; });
    if (busy || queue.length) return '…';
    if (cur.id === v.you) return v.sixes > 0 ? 'رمية إضافية! ارمِ مرة ثانية' : 'دورك: ارمِ النرد';
    if (cur.bot) return cur.name + ' يرمي…';
    return 'دور ' + cur.name + (cur.connected ? '…' : ' (غير متصل، يرمي الخادم عنه)');
  }

  function gameScreen() {
    const v = S.game;
    const left = secondsLeft();
    const myTurn = v.phase === 'turn' && v.currentPlayerId === v.you;
    const board = boardView();
    const die = dieView();

    const top = h('header', { class: 'sl-top' },
      h('span', { class: 'brand' }, 'حية ودرج'),
      h('span', { class: 'sl-timer' + (left !== null && left <= 5 ? ' low' : ''), id: 'sl-timer' },
        left === null || !myTurn ? null : [icon('clock', 18), h('span', { class: 'num' }, '0:' + String(left).padStart(2, '0'))]),
      h('span', { class: 'sl-topbtns' },
        h('button', { class: 'icon-btn', 'aria-label': 'طريقة اللعب', onclick: function () { S.sheet = 'help'; render(); } }, icon('help')),
        h('button', { class: 'icon-btn', 'aria-label': 'القائمة', onclick: function () { S.sheet = 'menu'; render(); } }, icon('menu'))));

    die.el.onclick = roll;
    die.el.classList.toggle('ready', canRoll());
    die.el.setAttribute('role', 'button');
    die.el.setAttribute('aria-label', 'النرد: ' + die.value());
    const dock = h('div', { class: 'sl-dock' + (myTurn ? ' turn' : '') },
      h('div', { class: 'sl-diebox' }, die.el),
      h('div', { class: 'sl-dockmain' },
        h('div', { class: 'sl-status' + (myTurn ? ' mine' : '') }, statusLine(v)),
        myTurn ? h('button', { class: 'primary big sl-roll', disabled: !canRoll(), onclick: roll }, S.rolled ? 'يرمي…' : 'ارمِ النرد') : null));

    return h('div', { class: 'sl-app' },
      top,
      h('div', { class: 'sl-main' },
        h('div', { class: 'sl-boardwrap' }, board.el),
        h('div', { class: 'sl-side' },
          playersStrip(v),
          h('div', { class: 'sl-line', 'aria-live': 'polite' }, S.eventText),
          S.log.length ? h('ol', { class: 'sl-feed', 'aria-hidden': 'true' }, S.log.slice(0, 7).map(function (t) { return h('li', null, t); })) : null,
          dock)));
  }

  function statsTable(v, order) {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'sl-stats' },
      h('tr', null, h('th', null, 'اللاعب'), h('th', null, 'المربع'), h('th', null, 'رميات'), h('th', null, 'درج'), h('th', null, 'حيات')),
      order.map(function (id) {
        const p = v.players.find(function (x) { return x.id === id; });
        const st = v.stats[id];
        return h('tr', { class: v.winnerIds && v.winnerIds.indexOf(id) >= 0 ? 'win' : '' },
          h('td', null, h('span', { class: 'sl-cell' }, avatar(p, 'xs'), p.name)),
          h('td', null, v.positions[id] || '–'), h('td', null, st.rolls), h('td', null, st.ladders), h('td', null, st.snakes));
      })));
  }

  function finalScreen() {
    const v = S.game;
    const amHost = S.room && S.room.hostId === S.you;
    const winners = v.winnerIds || [];
    const most = function (key) {
      let best = null;
      v.playerIds.forEach(function (id) { if (v.stats[id][key] > 0 && (!best || v.stats[id][key] > v.stats[best][key])) best = id; });
      return best;
    };
    const climber = most('climbed');
    const bitten = most('fallen');
    return h('div', { class: 'screen final sl-final' },
      h('div', { class: 'dim center' }, v.endedEarly ? 'أنهى المضيف اللعبة' : 'النتيجة النهائية'),
      h('div', { class: 'winner' },
        h('div', { class: 'crown' }, icon('crown', 56)),
        h('div', { class: 'w-name' }, winners.map(nm).join(' و ')),
        h('div', { class: 'dim' }, winners.length > 1 ? 'تعادل على المركز الأول' : (v.endedEarly ? 'الأبعد على اللوحة' : 'وصل أولاً إلى ' + C.SQUARES))),
      statsTable(v, v.ranking),
      h('div', { class: 'sl-facts' },
        climber ? h('div', null, 'أطول تسلّق: ', h('b', null, nm(climber)), ' (' + v.stats[climber].climbed + ' مربعاً بالدرج)') : null,
        bitten ? h('div', null, 'أكثر من عضّته الحية: ', h('b', null, nm(bitten)), ' (نزل ' + v.stats[bitten].fallen + ' مربعاً)') : null),
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

  function rulesText(o) {
    return [
      'اللوحة: ' + C.BOARDS[o.board].name,
      'الوصول إلى ' + C.SQUARES + ': ' + C.FINISH_NAMES[o.finish],
      o.sixAgain ? 'الستة تعطي رمية إضافية' : 'بدون رمية إضافية للستة',
      o.startSix ? 'تحتاج 6 حتى تدخل اللوحة' : 'تدخل اللوحة بأي رمية',
    ];
  }

  function menuSheet() {
    const v = S.game;
    const muted = SND.isMuted();
    const amHost = S.room && S.room.hostId === S.you;
    return sheet('القائمة', h('div', { class: 'menu-list' },
      statsTable(v, v.ranking),
      h('div', { class: 'sl-rules' }, rulesText(v.options).map(function (t) { return h('span', null, t); })),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'log'; render(); } }, icon('list', 20), 'سجل الحركات'),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('help', 20), 'طريقة اللعب'),
      h('button', { class: 'with-icon', onclick: function () { SND.setMuted(!muted); render(); } },
        icon(muted ? 'mute' : 'sound', 20), muted ? 'الصوت مكتوم - اضغط للتشغيل' : 'الصوت يعمل - اضغط للكتم'),
      amHost && v.phase === 'turn' ? h('button', { class: 'with-icon danger', onclick: function () { S.sheet = 'end'; render(); } }, icon('flag', 20), 'إنهاء اللعبة الآن') : null,
      h('a', { class: 'sl-link', href: '/' }, 'كل الألعاب'),
      h('div', { class: 'dim small center' }, 'الغرفة ' + (S.room ? S.room.code : ''))), closeSheet);
  }

  function endSheet() {
    return sheet('إنهاء اللعبة؟', h('div', { class: 'menu-list' },
      h('p', { class: 'sl-q' }, 'تنتهي اللعبة الآن ويفوز الأبعد على اللوحة.'),
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
    const o = S.game ? S.game.options : S.opts;
    return sheet('طريقة اللعب', h('div', { class: 'menu-list' },
      h('ul', { class: 'help-list' },
        li('كل اللاعبين يبدؤون خارج اللوحة، ومن يصل أولاً إلى المربع ' + C.SQUARES + ' يفوز.'),
        li('في دورك ارمِ النرد (اضغط الزر أو النرد نفسه) وتمشي قطعتك بعدد النقاط.'),
        li('إذا وقفت على أسفل درج تصعد إلى أعلاه. وإذا وقفت على رأس حية تنزل إلى ذيلها.'),
        li('الوصول إلى ' + C.SQUARES + ': "ترتد للوراء" تمشي الباقي رجوعاً، و"بالضبط" تبقى مكانك إذا زادت الرمية، و"أي رمية توصل" تفوز بأي رمية تكفي.'),
        li('الستة (إذا كانت مفعّلة) تعطيك رمية إضافية، لكن ثلاث ستات متتالية ترجعك إلى مكانك قبل الدور.'),
        li('"ابدأ بستة" (إذا كانت مفعّلة): لا تدخل اللوحة إلا برمية 6.'),
        li('لكل دور ' + C.TURN_SECONDS + ' ثانية، وبعدها يرمي الخادم عنك. ولاعبو الكمبيوتر يرمون وحدهم.')),
      h('div', { class: 'sl-rules' }, h('b', null, S.game ? 'قواعد هذه اللعبة' : 'القواعد المختارة'), rulesText(o).map(function (t) { return h('span', null, t); }))), closeSheet);
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
    const animating = busy || queue.length > 0;
    if (!S.you || !S.room) screen = h('div', { class: 'sl-shell' }, homeScreen());
    else if (S.game && S.game.phase === 'gameOver' && !animating) screen = h('div', { class: 'sl-shell' }, finalScreen());
    else if (S.game) screen = gameScreen();
    else screen = h('div', { class: 'sl-shell' }, lobbyScreen());
    if (S.game && S.sheet === 'menu') overlays.push(menuSheet());
    if (S.game && S.sheet === 'log') overlays.push(logSheet());
    if (S.game && S.sheet === 'end') overlays.push(endSheet());
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
    const el = document.getElementById('sl-timer');
    if (el && S.game) {
      const s = secondsLeft();
      const num = el.querySelector('.num');
      if (num && s !== null) num.textContent = '0:' + String(s).padStart(2, '0');
      el.classList.toggle('low', s !== null && s <= 5);
    }
    if (S.status !== 'open' && Date.now() - (S.lastSlow || 0) > 1000) { S.lastSlow = Date.now(); render(); }
    if (S.toast && S.toast.until <= Date.now()) render();
  }, 250);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.sheet) { closeSheet(); return; }
    // space or enter rolls on my turn (not while typing or with a button focused)
    const tag = e.target && e.target.tagName;
    if ((e.key === ' ' || e.key === 'Enter') && !S.sheet && tag !== 'INPUT' && tag !== 'BUTTON' && canRoll()) { e.preventDefault(); roll(); }
  });

  render();
  connect();
})();
