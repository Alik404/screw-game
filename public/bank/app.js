// Bank game client: connection, rooms, and the game screen. Drawing is in bank/ui.js.
(function () {
  const U = window.BankUI;
  const B = window.BankBoard;
  const C = window.BankConfig;
  const SC = window.ScrewConfig; // room code length, name length (shared by all games)
  const SND = window.ScrewSound;
  const h = U.h;
  const rootEl = document.getElementById('bk-root');
  const SQ = B.SQUARES;

  // ---------- storage ----------

  function store(key, value) {
    try {
      if (value === undefined) { const v = localStorage.getItem(key); return v === null ? null : JSON.parse(v); }
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  const params = new URLSearchParams(location.search);
  let urlCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, SC.ROOM_CODE_LENGTH);
  const pageStart = Date.now();

  const S = {
    status: 'connecting',
    name: store('screw.name') || '',
    codeInput: urlCode,
    session: store('bank.session'),
    autoJoining: false,
    you: null,
    room: null,
    game: null,        // latest game_state
    names: {},
    tab: 'board',
    focus: null,       // square whose deed is open
    draft: { to: null, give: { props: [], cash: 0 }, get: { props: [], cash: 0 } },
    log: [],
    eventText: '',
    cardNote: null,
    sheet: null,       // null | menu | help | end
    toast: null,
    homeError: '',
    bootId: null,
    serverRestarted: false,
    lost: null,
    disconnectedAt: null,
    timerEnds: {},     // kind -> local ms
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
    if (!sendRaw(msg)) toast('لا يوجد اتصال. جاري إعادة المحاولة…');
    if (msg.type === 'trade_offer') S.draft = { to: null, give: { props: [], cash: 0 }, get: { props: [], cash: 0 } };
    S.sheet = msg.type === 'end_game' ? null : S.sheet;
  }

  function toast(text, ok) { S.toast = { text: text, ok: !!ok, until: Date.now() + 4000 }; render(); }

  function leaveRoom() {
    S.session = null;
    store('bank.session', null);
    S.you = null; S.room = null; S.game = null; S.log = []; S.eventText = ''; S.sheet = null; S.tab = 'board'; S.focus = null;
    urlCode = '';
    S.codeInput = '';
    try { history.replaceState(null, '', '/bank.html'); } catch (e) { /* ignore */ }
  }

  // ---------- messages ----------

  function onMessage(m) {
    switch (m.type) {
      case 'hello':
        if (S.bootId && m.bootId !== S.bootId) S.serverRestarted = true;
        S.bootId = m.bootId;
        break;
      case 'joined':
        S.lost = null;
        S.autoJoining = false;
        // a code that belongs to the card game: take the player there
        if (m.game && m.game !== 'bank') {
          store('screw.session', { code: m.code, playerId: m.playerId, name: S.name });
          location.replace('/screw.html?room=' + m.code);
          return;
        }
        S.you = m.you;
        S.session = { code: m.code, playerId: m.playerId, name: S.name || (S.session && S.session.name) || '' };
        store('bank.session', S.session);
        S.homeError = '';
        try { history.replaceState(null, '', '/bank.html?room=' + m.code); } catch (e) { /* ignore */ }
        break;
      case 'room_state':
        S.room = m;
        break;
      case 'game_state':
        onGameState(m);
        break;
      case 'event':
        onEvent(m.event);
        break;
      case 'error':
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
    S.names = {};
    m.roster.forEach(function (r) { S.names[r.id] = r.name; });
    const now = Date.now();
    S.timerEnds = {};
    (m.timers || []).forEach(function (t) { S.timerEnds[t.kind] = t.endsAt - (t.now - now); });
    if (m.phase === 'turn' && m.currentPlayerId === m.you && (!prev || prev.currentPlayerId !== m.you || prev.stage !== m.stage)) {
      if (!prev || prev.currentPlayerId !== m.you) {
        SND.play('turn');
        if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
      }
      S.tab = 'board';
      S.focus = null;
    }
    if (m.trade && m.trade.to === m.you && (!prev || !prev.trade || prev.trade.id !== m.trade.id)) {
      toast('وصلك عرض تبادل من ' + (S.names[m.trade.from] || ''), true);
      SND.play('turn');
    }
    if (m.phase === 'gameOver') { S.focus = null; S.sheet = null; }
  }

  // ---------- events: log line, dice, walking pieces ----------

  function nm(id) { return S.names[id] || '؟'; }
  const sqn = function (i) { return SQ[i].name; };

  function describe(e) {
    const p = e.playerId ? nm(e.playerId) : '';
    switch (e.type) {
      case 'roll': return p + ' رمى ' + e.dice[0] + ' و ' + e.dice[1] + (e.dice[0] === e.dice[1] ? ' (دبل)' : '') + (e.reason === 'utility' ? ' للمرفق' : '');
      case 'move': return p + (e.back ? ' رجع إلى ' : ' وصل إلى ') + sqn(e.to);
      case 'salary': return p + ' مرّ بانطلاق واستلم ' + U.money(e.amount);
      case 'buy': return p + ' اشترى ' + sqn(e.square) + ' بـ ' + U.money(e.price);
      case 'auction_start': return 'مزاد على ' + sqn(e.square);
      case 'bid': return p + ' زايد بـ ' + U.money(e.amount);
      case 'auction_won': return p + ' ربح ' + sqn(e.square) + ' في المزاد بـ ' + U.money(e.amount);
      case 'auction_none': return 'لم يزايد أحد على ' + sqn(e.square);
      case 'rent': return p + ' دفع إيجاراً ' + U.money(e.amount) + ' لـ ' + nm(e.to) + ' في ' + sqn(e.square);
      case 'pay': return e.reason === 'rent' ? '' : p + ' دفع ' + U.money(e.amount) + (e.to ? ' لـ ' + nm(e.to) : ' للبنك');
      case 'debt': return p + ' لا يكفي رصيده لدفع ' + U.money(e.amount);
      case 'card': return p + ' سحب (' + (e.deck === 'chance' ? 'حظ' : 'صندوق') + '): ' + e.text;
      case 'jail': return p + ' ذهب إلى السجن';
      case 'speeding': return p + ' رمى ثلاث دبلات متتالية';
      case 'jail_out': return p + ' خرج من السجن';
      case 'again': return p + ' يرمي مرة أخرى';
      case 'build': return p + ' بنى في ' + sqn(e.square) + (e.houses === 5 ? ' فندقاً' : ' (' + e.houses + ' بيوت)');
      case 'sell_building': return p + ' باع بناءً في ' + sqn(e.square);
      case 'mortgage': return p + ' رهن ' + sqn(e.square);
      case 'unmortgage': return p + ' فك رهن ' + sqn(e.square);
      case 'trade_offer': return nm(e.trade.from) + ' عرض تبادلاً على ' + nm(e.trade.to);
      case 'trade_done': return 'تم التبادل بين ' + nm(e.trade.from) + ' و ' + nm(e.trade.to);
      case 'trade_rejected': return nm(e.trade.to) + ' رفض عرض التبادل';
      case 'trade_cancelled': return 'أُلغي عرض التبادل';
      case 'trade_expired': return 'انتهت مهلة عرض التبادل';
      case 'bankrupt': return p + ' أفلس' + (e.to ? ' لصالح ' + nm(e.to) : '');
      case 'game_over': return 'انتهت اللعبة';
      default: return '';
    }
  }

  const walking = {};   // pid -> position currently drawn while a piece walks
  const queue = {};     // pid -> pending moves
  const running = {};
  const runningSince = {};
  let rollUntil = 0;

  // true only while the dice tumble or a piece is walking, never a permanent state
  function busy() {
    if (Date.now() < rollUntil) return true;
    return Object.keys(running).some(function (k) { return running[k] && Date.now() - runningSince[k] < 4000; });
  }

  function pump(pid) {
    if (running[pid]) return;
    const m = (queue[pid] || []).shift();
    if (!m) { delete walking[pid]; render(); return; }
    running[pid] = true;
    runningSince[pid] = Date.now();
    let pos = m.from;
    walking[pid] = pos;
    const dir = m.back ? -1 : 1;
    function step() {
      if (pos === m.to) { running[pid] = false; pump(pid); return; }
      pos = (pos + dir + B.SIZE) % B.SIZE;
      walking[pid] = pos;
      SND.play('deal');
      render();
      setTimeout(step, 120);
    }
    setTimeout(step, Math.max(0, rollUntil - Date.now()));
  }

  function onEvent(e) {
    const text = describe(e);
    if (text) {
      S.eventText = text;
      S.log.unshift({ text: text, mine: e.playerId === S.you });
      if (S.log.length > 100) S.log.pop();
    }
    switch (e.type) {
      case 'roll':
        rollUntil = Date.now() + 650;
        SND.play('throw');
        setTimeout(render, 700);
        rollTick();
        break;
      case 'move':
        (queue[e.playerId] = queue[e.playerId] || []).push(e);
        pump(e.playerId);
        break;
      case 'card':
        S.cardNote = { deck: e.deck, text: e.text, who: e.playerId, until: Date.now() + 6000 };
        SND.play('flip');
        setTimeout(render, 6100);
        break;
      case 'buy': case 'build': case 'auction_won': SND.play('flip'); break;
      case 'bankrupt': SND.play('screw'); break;
      case 'rent': case 'pay': SND.play('throw', 200); break;
      default: break;
    }
  }

  // dice faces flicker while rolling
  let rollTimer = null;
  function rollTick() {
    clearInterval(rollTimer);
    rollTimer = setInterval(function () {
      if (Date.now() >= rollUntil) { clearInterval(rollTimer); render(); return; }
      render();
    }, 90);
  }

  // ---------- view helpers ----------

  // the view with walking pieces and the rolling dice swapped in
  function displayView() {
    const v = S.game;
    const rolling = Date.now() < rollUntil;
    const keys = Object.keys(walking);
    if (!rolling && !keys.length) return v;
    const c = Object.assign({}, v);
    if (keys.length) {
      c.players = Object.assign({}, v.players);
      keys.forEach(function (id) { c.players[id] = Object.assign({}, v.players[id], { pos: walking[id] }); });
    }
    if (rolling) c.dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    return c;
  }

  function secondsOf(kind) {
    const t = S.timerEnds[kind];
    return t ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : null;
  }

  function primaryKind() {
    const t = S.game && S.game.timer;
    return t ? t.kind : null;
  }

  function needsMe(v) {
    if (v.phase !== 'turn') return false;
    if (v.stage === 'debt') return v.debts.length > 0 && v.debts[0].debtor === v.you;
    if (v.stage === 'auction') return !v.players[v.you].bankrupt;
    return v.currentPlayerId === v.you;
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
      sendRaw({ type: 'create_room', name: S.name, game: 'bank' });
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
    return h('div', { class: 'screen bk-home' },
      h('div', { class: 'bk-hero' },
        h('div', { class: 'bk-logo big' }, h('span', null, 'بنك'), h('b', null, 'الحظ')),
        U.dice([5, 3])),
      lost,
      h('div', { class: 'form' }, name, waking,
        urlCode
          ? [h('div', { class: 'row' }, code), h('button', { class: 'primary', onclick: join, disabled: offline }, 'دخول الغرفة'),
            h('div', { class: 'or' }, 'أو'), h('button', { onclick: create, disabled: offline }, 'إنشاء غرفة جديدة')]
          : [h('button', { class: 'primary', onclick: create, disabled: offline }, 'إنشاء غرفة'),
            h('div', { class: 'or' }, 'أو ادخل بالكود'),
            h('div', { class: 'row' }, code, h('button', { onclick: join, disabled: offline }, 'دخول'))],
        S.homeError ? h('div', { class: 'error', role: 'alert' }, S.homeError) : null,
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
    const url = location.origin + '/bank.html?room=' + code;
    if (navigator.share) { navigator.share({ title: 'بنك الحظ', text: 'تعال نلعب بنك الحظ! كود الغرفة: ' + code, url: url }).catch(function () {}); return; }
    copyText(url).then(function () { toast('تم نسخ الرابط', true); }, function () { toast('تعذر النسخ. الرابط: ' + url); });
  }

  function lobbyScreen() {
    const r = S.room;
    const amHost = r.hostId === S.you;
    const present = r.players.filter(function (p) { return p.connected; }).length;
    return h('div', { class: 'screen lobby' },
      h('div', { class: 'lobby-head' },
        h('div', { class: 'dim center' }, 'كود الغرفة'),
        h('div', { class: 'code-box', dir: 'ltr' }, r.code),
        h('button', { class: 'with-icon', onclick: function () { share(r.code); } }, U.icon('plus', 20), 'مشاركة الرابط')),
      h('div', { class: 'dim' }, 'اللاعبون (' + r.players.length + '/' + C.MAX_PLAYERS + ')'),
      h('ul', { class: 'plist' }, r.players.map(function (p, i) {
        return h('li', { class: p.connected ? '' : 'off' },
          h('span', { class: 'bk-av', style: { '--pc': 'var(--p' + (i + 1) + ')' } }, Array.from(p.name)[0] || '؟'),
          h('span', { class: 'pname' }, p.name + (p.id === S.you ? ' (أنت)' : ''), p.connected ? null : h('small', null, ' غير متصل')),
          p.isHost ? h('span', { class: 'tag' }, 'المضيف') : null);
      })),
      h('div', { class: 'bk-lobby-note dim small' },
        'كل لاعب يبدأ بـ ' + U.money(C.START_CASH) + '. اللعبة حتى يبقى لاعب واحد، أو ينهيها المضيف فيفوز الأغنى.'),
      h('div', { class: 'grow' }),
      amHost
        ? [present < C.MIN_PLAYERS ? h('div', { class: 'center dim' }, 'بانتظار لاعب واحد على الأقل…') : null,
          h('button', { class: 'primary big', disabled: present < C.MIN_PLAYERS, onclick: function () { send({ type: 'start_game' }); } }, 'ابدأ')]
        : h('div', { class: 'center dim' }, 'بانتظار المضيف ليبدأ اللعبة…'),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  function tabs(v) {
    const mine = needsMe(v);
    const incoming = v.trade && v.trade.to === v.you;
    const t = [['board', 'board', 'اللوحة', mine && S.tab !== 'board' ? '!' : null], ['props', 'home', 'ممتلكاتي', null],
      ['trade', 'trade', 'تبادل', incoming ? '1' : null], ['log', 'list', 'السجل', null]];
    return h('nav', { class: 'bk-tabs', 'aria-label': 'أقسام اللعبة' }, t.map(function (x) {
      return h('button', { class: 'bk-tab' + (S.tab === x[0] ? ' on' : ''), onclick: function () { S.tab = x[0]; S.focus = null; render(); } },
        U.icon(x[1]), x[2], x[3] ? h('span', { class: 'count' }, x[3]) : null);
    }));
  }

  function logPanel() {
    return h('div', { class: 'bk-panel' }, h('div', { class: 'bk-title' }, U.icon('list', 22), 'سجل الأحداث'),
      S.log.length ? h('ol', { class: 'log' }, S.log.map(function (l) { return h('li', { class: l.mine ? 'mine' : '' }, l.text); }))
        : h('div', { class: 'bk-note' }, 'لا أحداث بعد.'));
  }

  function cardNote() {
    if (!S.cardNote || S.cardNote.until < Date.now()) return null;
    const n = S.cardNote;
    return h('div', { class: 'bk-cardnote ' + n.deck },
      h('small', null, (n.deck === 'chance' ? 'حظ' : 'صندوق') + ' · ' + nm(n.who)),
      h('p', null, n.text));
  }

  function gameScreen() {
    const v = S.game;
    const dv = displayView();
    const ctx = {
      view: v, names: S.names, send: send, draft: S.draft, redraw: render,
      secondsLeft: v.stage === 'auction' ? secondsOf('auction') : undefined,
    };
    const boardEl = U.board(dv, {
      names: S.names, eventText: S.eventText, focus: S.focus,
      onCell: function (i) { S.tab = 'board'; S.focus = B.isOwnable(SQ[i]) ? (S.focus === i ? null : i) : null; render(); },
    });
    let content;
    if (S.tab === 'props') content = h('div', { class: 'bk-panel' }, h('div', { class: 'bk-title' }, U.icon('home', 22), 'ممتلكاتي'), U.propertiesTab(ctx));
    else if (S.tab === 'trade') content = h('div', { class: 'bk-panel' }, U.tradeTab(ctx));
    else if (S.tab === 'log') content = logPanel();
    else if (S.focus !== null) {
      content = h('div', { class: 'bk-panel' }, U.deed(S.focus, v, S.names),
        h('button', { class: 'bk-btn', onclick: function () { S.focus = null; render(); } }, 'إغلاق'));
    } else if (busy() && v.currentPlayerId === v.you) {
      content = h('div', { class: 'bk-panel' }, h('div', { class: 'bk-wait' }, U.icon('dice', 22), 'جارٍ الحركة…'));
    } else {
      content = U.actionPanel(ctx);
    }
    const left = secondsOf(primaryKind());
    const top = h('header', { class: 'bk-top' },
      h('span', { class: 'brand' }, 'بنك الحظ'),
      h('span', { class: 'timer', id: 'bk-timer' }, left === null ? null : [U.icon('clock', 18), h('span', { class: 'num' }, '0:' + String(left).padStart(2, '0'))]),
      h('span', { class: 'bk-topr' }, S.room ? 'الغرفة ' + S.room.code : '',
        h('button', { class: 'icon-btn', 'aria-label': 'القائمة', onclick: function () { S.sheet = 'menu'; render(); } }, U.icon('menu'))));
    return h('div', { class: 'bk-app' },
      top,
      h('div', { class: 'bk-boardwrap' }, boardEl),
      h('div', { class: 'bk-scroll' }, cardNote(), content, U.players(dv, S.names)),
      tabs(v));
  }

  function overScreen() {
    const v = S.game;
    const amHost = S.room && S.room.hostId === S.you;
    const order = v.playerIds.slice().sort(function (a, b) { return v.worth[b] - v.worth[a]; });
    const winners = v.winnerIds || [];
    return h('div', { class: 'screen final' },
      h('div', { class: 'dim center' }, 'انتهت اللعبة'),
      h('div', { class: 'winner' },
        h('div', { class: 'crown' }, U.icon('crown', 56)),
        h('div', { class: 'w-name' }, winners.map(nm).join(' و ')),
        h('div', { class: 'w-score' }, 'ثروته ', h('span', { class: 'num' }, U.money(v.worth[winners[0]] || 0))),
        h('div', { class: 'dim' }, winners.length > 1 ? 'تعادل على المركز الأول' : 'الفائز')),
      h('ol', { class: 'ranking' }, order.map(function (id, i) {
        const p = v.players[id];
        return h('li', null, h('span', null, (i + 1) + '. ' + nm(id) + (id === S.you ? ' (أنت)' : '') + (p.bankrupt ? ' · مفلس' : '')),
          h('span', { class: 'num' }, p.bankrupt ? '—' : U.moneyShort(v.worth[id])));
      })),
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
          onClose ? h('button', { class: 'icon-btn', onclick: onClose, 'aria-label': 'إغلاق' }, U.icon('close')) : null),
        body));
  }
  function closeSheet() { S.sheet = null; render(); }

  function menuSheet() {
    const muted = SND.isMuted();
    const amHost = S.room && S.room.hostId === S.you;
    return sheet('القائمة', h('div', { class: 'menu-list' },
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, U.icon('card', 20), 'طريقة اللعب'),
      h('button', { class: 'with-icon', onclick: function () { SND.setMuted(!muted); render(); } },
        U.icon(muted ? 'mute' : 'sound', 20), muted ? 'الصوت مكتوم - اضغط للتشغيل' : 'الصوت يعمل - اضغط للكتم'),
      amHost && S.game.phase === 'turn' ? h('button', { class: 'with-icon danger', onclick: function () { S.sheet = 'end'; render(); } }, U.icon('crown', 20), 'إنهاء اللعبة الآن (يفوز الأغنى)') : null,
      h('a', { class: 'bk-link', href: '/' }, 'كل الألعاب'),
      h('div', { class: 'dim small center' }, 'الغرفة ' + (S.room ? S.room.code : ''))), closeSheet);
  }

  function endSheet() {
    return sheet('إنهاء اللعبة؟', [
      h('p', { class: 'bk-note' }, 'ستنتهي اللعبة فوراً للجميع، ويفوز صاحب أعلى ثروة (النقد + العقارات + البناء).'),
      h('div', { class: 'btns' },
        h('button', { class: 'danger solid', onclick: function () { send({ type: 'end_game' }); } }, 'نعم، أنهِ اللعبة'),
        h('button', { onclick: closeSheet }, 'تراجع')),
    ], closeSheet);
  }

  function helpSheet() {
    const li = function (t) { return h('li', null, t); };
    return sheet('طريقة اللعب', h('div', { class: 'bk-help' },
      h('ul', { class: 'help-list' },
        li('كل لاعب يبدأ بـ ' + U.money(C.START_CASH) + '، وعند المرور على "انطلاق" تستلم ' + U.money(C.GO_SALARY) + '.'),
        li('ارمِ النرد وتحرك. إذا وقفت على عقار بلا مالك اشتره، أو ارفض فيبدأ مزاد للجميع.'),
        li('إذا وقفت على عقار غيرك تدفع الإيجار. من يملك كل عقارات لون واحد يضاعف الإيجار ويقدر يبني عليها.'),
        li('البناء بالتساوي: بيت بعد بيت حتى ' + C.HOUSES_BEFORE_HOTEL + ' بيوت ثم فندق. بيع البناء بنصف السعر.'),
        li('الرهن يعطيك نصف سعر العقار، ولا إيجار على المرهون. فكّ الرهن يكلّف +' + Math.round(C.UNMORTGAGE_INTEREST * 100) + '%.'),
        li('دبل (نردان متشابهان) يعطيك رمية إضافية، وثلاث دبلات متتالية تدخلك السجن. من السجن: ادفع ' + U.money(C.JAIL_FINE) + '، أو بطاقة خروج، أو ارمِ دبل.'),
        li('بطاقات حظ وصندوق تعطيك مالاً أو تأخذه أو تحركك.'),
        li('تبادل مع أي لاعب: عقارات ومال وبطاقة السجن، ويقبل أو يرفض خلال ' + C.TRADE_SECONDS + ' ثانية.'),
        li('إذا لم يكفِ رصيدك لدين، بع وارهن لتجمع المال خلال ' + C.DEBT_SECONDS + ' ثانية، أو أعلن الإفلاس. آخر لاعب غير مفلس يفوز.'),
        li('إذا تأخرت عن قرارك يلعب الخادم عنك: يرمي، ويرفض الشراء (مزاد)، وينهي دورك.'))), closeSheet);
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
    if (!S.you || !S.room) screen = homeScreen();
    else if (S.game && S.game.phase === 'gameOver') screen = overScreen();
    else if (S.game) screen = gameScreen();
    else screen = lobbyScreen();
    if (S.game && S.sheet === 'menu') overlays.push(menuSheet());
    if (S.game && S.sheet === 'help') overlays.push(helpSheet());
    if (S.game && S.sheet === 'end') overlays.push(endSheet());
    if (S.you && S.status !== 'open' && S.disconnectedAt && now - S.disconnectedAt > 3000) overlays.push(disconnectSheet(now));

    const nodes = [];
    if (S.status !== 'open') nodes.push(h('div', { class: 'banner', role: 'status' }, S.status === 'connecting' ? 'جاري الاتصال…' : 'انقطع الاتصال. جاري إعادة الاتصال…'));
    const shell = h('div', { class: S.game && S.you && S.room && S.game.phase !== 'gameOver' ? 'bk-gamehost' : 'bk-shell' }, screen, overlays);
    nodes.push(shell);
    if (S.toast) nodes.push(h('div', { class: 'toast' + (S.toast.ok ? ' ok' : ''), role: 'alert' }, S.toast.text));
    rootEl.replaceChildren.apply(rootEl, nodes);
  }

  setInterval(function () {
    const el = document.getElementById('bk-timer');
    if (el && S.game) {
      const s = secondsOf(primaryKind());
      const num = el.querySelector('.num');
      if (num && s !== null) num.textContent = '0:' + String(s).padStart(2, '0');
      const ring = document.querySelector('.bk-ring span');
      const a = secondsOf('auction');
      if (ring && a !== null) ring.textContent = a;
    }
    if (S.status !== 'open' && Date.now() - (S.lastSlow || 0) > 1000) { S.lastSlow = Date.now(); render(); }
    if (S.toast && S.toast.until <= Date.now()) render();
  }, 250);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); }
  });

  render();
  connect();
})();
