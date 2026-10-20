// Seven & Seven client: connection, rooms and the game screen (U2: simple and working).
(function () {
  const D = window.SevenDeck;
  const K = window.SevenCards;
  const C = window.SevenConfig;
  const SC = window.ScrewConfig; // room-code length, name length, idle minutes (shared by all games)
  const SND = window.ScrewSound;
  const rootEl = document.getElementById('sv-root');
  const GAME = 'seven';

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

  const params = new URLSearchParams(location.search);
  let urlCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, SC.ROOM_CODE_LENGTH);
  const pageStart = Date.now();

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
    result: null,
    hideResult: false,
    rounds: C.ROUNDS_OPTIONS.indexOf(store('seven.rounds')) >= 0 ? store('seven.rounds') : C.DEFAULT_ROUNDS,
    optsSent: null,
    sheet: null, // null | menu | color | scores
    pendingPlay: null, // {kind: 'play'|'play_drawn', card?}
    eventText: '',
    toast: null,
    homeError: '',
    bootId: null,
    serverRestarted: false,
    lost: null,
    disconnectedAt: null,
    timerEnd: null,
    hold: {}, // card ids hidden while their copy is still flying in
    holdTop: 0, // table card hidden while a played card is flying onto it
    newIds: [], // ids that just entered my hand (in order)
    dealIn: false,
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
    S.sheet = S.sheet === 'color' ? null : S.sheet;
    S.pendingPlay = null;
    if (!sendRaw(msg)) toast('لا يوجد اتصال. جاري إعادة المحاولة…');
    else render();
  }

  function toast(text, ok) { S.toast = { text: text, ok: !!ok, until: Date.now() + 4000 }; render(); }

  function leaveRoom() {
    S.session = null;
    store(GAME + '.session', null);
    S.you = null; S.room = null; S.game = null; S.result = null; S.sheet = null; S.pendingPlay = null; S.eventText = '';
    urlCode = '';
    S.codeInput = '';
    try { history.replaceState(null, '', '/seven.html'); } catch (e) { /* ignore */ }
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
        try { history.replaceState(null, '', '/seven.html?room=' + m.code); } catch (e) { /* ignore */ }
        break;
      case 'room_state':
        S.room = m;
        m.players.forEach(function (p) { S.names[p.id] = p.name; });
        // the host shares the number of rounds remembered on this device, so everyone sees it
        if (m.phase === 'lobby' && m.hostId === S.you && !m.options && S.optsSent !== m.code) {
          S.optsSent = m.code;
          sendRaw({ type: 'set_options', options: { rounds: S.rounds } });
        }
        break;
      case 'reaction':
        window.Reactions.show(m.from, m.id);
        return;
      case 'game_state':
        onGameState(m);
        break;
      case 'event':
        onEvent(m.event);
        break;
      case 'round_result':
        S.result = m;
        S.hideResult = false;
        S.sheet = null;
        SND.play('turn');
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
    if (m.type === 'game_state') runFx();
  }

  function onGameState(m) {
    const prev = S.game;
    const prevIds = prev ? prev.hand.map(function (c) { return c.id; }) : null;
    S.game = m;
    S.newIds = prevIds ? m.hand.map(function (c) { return c.id; }).filter(function (id) { return prevIds.indexOf(id) < 0; }) : [];
    S.names = {};
    m.players.forEach(function (p) { S.names[p.id] = p.name; });
    // a computer player's short pause is not a countdown anyone needs to see
    S.timerEnd = m.timer && m.timer.kind !== 'bot' ? m.timer.endsAt - (m.timer.now - Date.now()) : null;
    if (m.phase !== 'roundOver') S.hideResult = false;
    if (m.phase === 'turn' && m.currentPlayerId === m.you && (!prev || prev.currentPlayerId !== m.you || prev.round !== m.round)) {
      SND.play('turn');
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
    }
    if (m.stage !== 'play' && m.stage !== 'drawn') S.pendingPlay = null;
    if (m.currentPlayerId !== m.you) { S.pendingPlay = null; if (S.sheet === 'color') S.sheet = null; }
  }

  function nm(id) { return S.names[id] || '؟'; }

  function describe(e) {
    const p = e.playerId ? nm(e.playerId) : '';
    switch (e.type) {
      case 'round_start': return 'بدأت الجولة ' + e.round + ' والكرت الأول ' + D.describe(e.card);
      case 'play': return p + ' رمى ' + D.describe(e.card) + (e.card.color ? '' : ' واختار ' + D.COLOR_NAMES[e.color]);
      case 'draw': return p + ' سحب كرتاً';
      case 'keep': return p + ' احتفظ بالكرت المسحوب';
      case 'penalty': return p + ' سحب ' + e.count + ' كروت عقوبة';
      case 'skip': return p + ' فقد دوره';
      case 'reverse': return 'انعكس اتجاه اللعب';
      case 'color': return p + ' اختار اللون ' + D.COLOR_NAMES[e.color];
      case 'reshuffle': return 'خُلطت كومة الطاولة وصارت كومة سحب';
      case 'draw_empty': return 'لا كروت للسحب، مرّ دور ' + p;
      default: return '';
    }
  }

  // ---------- motion ----------
  // Events arrive BEFORE the new game_state, so the screen still shows the old table: we read where a card
  // comes FROM now, and the flight runs after the next render, once we know where it goes TO.

  const jobs = [];

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function rectOf(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width ? r : null;
  }

  // a card flies from one rectangle to another (350ms). card === null flies a card back.
  function flyCard(card, from, to, delay) {
    return new Promise(function (resolve) {
      if (!from || !to || reduced() || document.hidden) { resolve(); return; }
      const box = h('div', { class: K.cls(card) + ' fly', style: { '--w': from.width + 'px', left: from.left + 'px', top: from.top + 'px' } });
      box.innerHTML = K.svg(card, false);
      document.body.append(box);
      let done = false;
      const finish = function () { if (done) return; done = true; box.remove(); resolve(); };
      const dx = to.left - from.left;
      const dy = to.top - from.top;
      const sc = to.width / from.width;
      const a = box.animate([
        { transform: 'translate(0px,0px) scale(1)' },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')' },
      ], { duration: 350, delay: delay || 0, easing: 'cubic-bezier(.25,.8,.25,1)', fill: 'both' });
      a.onfinish = finish;
      setTimeout(finish, 350 + (delay || 0) + 400); // safety: a flight never outlives its time
    });
  }

  function holdId(id) {
    S.hold[id] = true;
    const el = document.querySelector('[data-id="' + id + '"]');
    if (el) el.style.visibility = 'hidden';
  }
  function releaseId(id) { delete S.hold[id]; render(); }

  function holdTop() {
    S.holdTop += 1;
    const el = document.querySelector('[data-pile="discard"]');
    if (el) el.style.visibility = 'hidden';
  }
  function releaseTop() { S.holdTop = Math.max(0, S.holdTop - 1); render(); }

  // big word in the middle of the screen: the effect of the card that was just played
  function announce(word, who) {
    const el = h('div', { class: 'sv-announce', role: 'status' }, h('div', { class: 'w' }, word), h('div', { class: 'n' }, who || ''));
    document.body.append(el);
    setTimeout(function () { el.classList.add('out'); }, 900);
    setTimeout(function () { el.remove(); }, 1200);
  }

  function runFx() {
    const list = jobs.splice(0);
    list.forEach(function (fn) { try { fn(); } catch (err) { /* a missing element just means no flight */ } });
  }

  function onEvent(e) {
    const t = describe(e);
    if (t) S.eventText = t;
    switch (e.type) {
      case 'round_start':
        S.dealIn = true;
        SND.play('deal');
        break;
      case 'play': {
        SND.play('throw');
        const from = e.playerId === S.you ? rectOf('[data-id="' + e.handId + '"]') : rectOf('[data-seat="' + e.playerId + '"] .sv-stack');
        jobs.push(function () {
          const to = rectOf('[data-pile="discard"]');
          if (!from || !to) return;
          holdTop();
          flyCard(e.card, from, to).then(releaseTop);
        });
        break;
      }
      case 'draw': {
        SND.play('flip');
        const pid = e.playerId;
        jobs.push(function () {
          const from = rectOf('[data-pile="deck"]');
          if (pid !== S.you) { flyCard(null, from, rectOf('[data-seat="' + pid + '"] .sv-stack')); return; }
          let id = null;
          let to = null;
          if (S.game.drawn) { id = S.game.drawn.id; to = rectOf('[data-zone="drawn"]'); } else { id = S.newIds.shift(); to = id ? rectOf('[data-id="' + id + '"]') : null; }
          if (!id || !to) return;
          holdId(id);
          flyCard(null, from, to).then(function () { releaseId(id); });
        });
        break;
      }
      case 'penalty': {
        SND.play(e.count >= 2 ? 'screw' : 'flip');
        if (e.count >= 2) announce('\u200E+' + e.count + '\u200E', nm(e.playerId));
        const pid = e.playerId;
        jobs.push(function () {
          const from = rectOf('[data-pile="deck"]');
          for (let i = 0; i < e.count; i++) {
            if (pid !== S.you) { flyCard(null, from, rectOf('[data-seat="' + pid + '"] .sv-stack'), i * 140); continue; }
            const id = S.newIds.shift();
            const to = id ? rectOf('[data-id="' + id + '"]') : null;
            if (!id || !to) continue;
            holdId(id);
            flyCard(null, from, to, i * 140).then(function () { releaseId(id); });
          }
        });
        break;
      }
      case 'skip':
        SND.play('turn');
        announce('منع!', nm(e.playerId));
        break;
      case 'reverse':
        SND.play('flip');
        announce('عكس!', '');
        break;
      default:
        break;
    }
  }

  // ---------- cards ----------

  const LABEL = { skip: 'منع', reverse: 'عكس', draw2: '‎+2‎', wild: 'لون', wild4: '‎+4‎' };
  const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3 };

  function labelOf(card) { return card.type === 'num' ? String(card.rank) : LABEL[card.type]; }

  // card: a card object, or null for the back. o: {size, pick, dim, hold, deal, delay, id, pile, zone, onClick}
  function cardEl(card, o) {
    o = o || {};
    const mini = o.size === 'mini' || o.size === 'res';
    const cls = [K.cls(card), o.size || ''];
    if (o.pick) cls.push('pick');
    if (o.dim) cls.push('dim');
    if (o.hold) cls.push('hold');
    if (o.deal) cls.push('dealt');
    const attrs = { class: cls.join(' '), 'aria-label': card ? D.describe(card) : 'كرت مقلوب' };
    if (o.id) attrs['data-id'] = o.id;
    if (o.pile) attrs['data-pile'] = o.pile;
    if (o.zone) attrs['data-zone'] = o.zone;
    if (o.delay) attrs.style = { '--d': o.delay + 'ms' };
    let el;
    if (o.onClick) { attrs.onclick = o.onClick; el = h('button', attrs); } else el = h('div', attrs);
    el.innerHTML = K.svg(card || null, mini);
    return el;
  }

  function sortedHand(hand) {
    return hand.slice().sort(function (a, b) {
      const ca = a.color ? COLOR_ORDER[a.color] : 9;
      const cb = b.color ? COLOR_ORDER[b.color] : 9;
      if (ca !== cb) return ca - cb;
      const ra = a.type === 'num' ? a.rank : 10 + Object.keys(LABEL).indexOf(a.type);
      const rb = b.type === 'num' ? b.rank : 10 + Object.keys(LABEL).indexOf(b.type);
      return ra - rb;
    });
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
      h('div', { class: 'sv-hero' },
        h('div', { class: 'cards', 'aria-hidden': 'true' },
          cardEl(D.makeCard('num', 'red', 7), { size: 'big' }), cardEl(D.makeCard('wild4'), { size: 'big' }), cardEl(D.makeCard('num', 'blue', 7), { size: 'big' })),
        h('div', { class: 'sv-logo' }, 'سبعة وسبعة')),
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
    const url = location.origin + '/seven.html?room=' + code;
    if (navigator.share) { navigator.share({ title: 'سبعة وسبعة', text: 'تعال نلعب سبعة وسبعة! كود الغرفة: ' + code, url: url }).catch(function () {}); return; }
    copyText(url).then(function () { toast('تم نسخ الرابط', true); }, function () { toast('تعذر النسخ. الرابط: ' + url); });
  }

  const AVATARS = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6'];

  function roomRounds() { return (S.room && S.room.options && S.room.options.rounds) || S.rounds; }
  function setRounds(n) {
    S.rounds = n;
    store('seven.rounds', n);
    send({ type: 'set_options', options: { rounds: n } });
  }

  function lobbyScreen() {
    const r = S.room;
    const amHost = r.hostId === S.you;
    const present = r.players.filter(function (p) { return p.connected; }).length;
    const rounds = roomRounds();
    return h('div', { class: 'screen lobby' },
      h('div', { class: 'lobby-head' },
        h('div', { class: 'dim center' }, 'كود الغرفة'),
        h('div', { class: 'code-box', dir: 'ltr' }, r.code),
        h('button', { class: 'with-icon', onclick: function () { share(r.code); } }, icon('share', 20), 'مشاركة الرابط')),
      h('div', { class: 'dim' }, 'اللاعبون (' + r.players.length + '/' + C.MAX_PLAYERS + ')'),
      h('ul', { class: 'plist' }, r.players.map(function (p, i) {
        return h('li', { class: p.connected ? '' : 'off', 'data-chip': p.id },
          h('span', { class: 'avatar ' + AVATARS[i % AVATARS.length] }, p.bot ? '🤖' : (Array.from(p.name)[0] || '؟')),
          h('span', { class: 'pname' }, p.name + (p.id === S.you ? ' (أنت)' : ''), p.connected ? null : h('small', null, ' غير متصل')),
          p.isHost ? h('span', { class: 'tag' }, 'المضيف') : null,
          p.bot && amHost ? h('button', { class: 'icon-btn lob-rm', 'aria-label': 'احذف ' + p.name, onclick: function () { send({ type: 'remove_bot', id: p.id }); } }, icon('close', 20)) : null);
      })),
      amHost && r.players.length < C.MAX_PLAYERS ? h('button', { class: 'with-icon', onclick: function () { send({ type: 'add_bot' }); } }, '🤖', ' أضف لاعب كمبيوتر') : null,
      amHost ? h('div', { class: 'sv-roundspick' },
        h('div', { class: 'dim small' }, 'عدد الجولات'),
        h('div', { class: 'sv-rounds' }, C.ROUNDS_OPTIONS.map(function (n) {
          return h('button', { 'aria-pressed': rounds === n ? 'true' : 'false', onclick: function () { setRounds(n); } }, n + ' جولات');
        })))
        : h('div', { class: 'sv-note' }, 'المضيف اختار ', h('b', null, rounds + ' جولات')),
      h('div', { class: 'lob-row' }, window.Reactions.button()),
      h('div', { class: 'sv-note' }, 'كل لاعب يبدأ بـ ' + C.HAND_SIZE + ' كروت. أول من يخلص كروته يفوز بالجولة، والأعلى نقاطاً في النهاية يفوز.'),
      h('div', { class: 'grow' }),
      amHost
        ? [present < C.MIN_PLAYERS ? h('div', { class: 'center dim' }, 'أرسل الرابط لأصدقائك أو أضف لاعب كمبيوتر.') : null,
          h('button', { class: 'primary big', disabled: present < C.MIN_PLAYERS, onclick: function () { send({ type: 'start_game', options: { rounds: rounds } }); } }, 'ابدأ')]
        : h('div', { class: 'center dim' }, 'بانتظار المضيف ليبدأ اللعبة…'),
      h('a', { class: 'all-games', href: '/' }, 'كل الألعاب'));
  }

  function secondsLeft() { return S.timerEnd ? Math.max(0, Math.ceil((S.timerEnd - Date.now()) / 1000)) : null; }

  function colorPicker(onPick) {
    return h('div', { class: 'sv-colors' }, C.COLORS.map(function (c) {
      return h('button', { class: c, onclick: function () { onPick(c); } }, D.COLOR_NAMES[c]);
    }));
  }

  function playCard(card) {
    if (D.isWild(card)) { S.pendingPlay = { kind: 'play', card: card.id }; S.sheet = 'color'; render(); return; }
    send({ type: 'play', card: card.id });
  }

  function gameScreen() {
    const v = S.game;
    const me = v.players.find(function (p) { return p.id === v.you; });
    const myTurn = v.currentPlayerId === v.you;
    const left = secondsLeft();
    const others = v.players.filter(function (p) { return p.id !== v.you; });
    const dealt = S.dealIn; // the deal animation plays once, on the render that follows the new round
    S.dealIn = false;

    const top = h('header', { class: 'sv-top' },
      h('span', { class: 'brand' }, 'سبعة وسبعة'),
      h('span', { class: 'sv-timer' + (left !== null && left <= 10 ? ' low' : ''), id: 'sv-timer' },
        left === null ? null : [icon('clock', 18), h('span', { class: 'num' }, '0:' + String(left).padStart(2, '0'))]),
      h('span', null, 'جولة ' + v.round + '/' + v.rounds,
        window.Reactions.button(),
        h('button', { class: 'icon-btn', 'aria-label': 'القائمة', onclick: function () { S.sheet = 'menu'; render(); } }, icon('menu'))));

    const opps = h('div', { class: 'sv-opps' }, others.map(function (p) {
      return h('div', { class: 'sv-opp' + (v.currentPlayerId === p.id ? ' turn' : '') + (p.connected ? '' : ' off'), 'data-seat': p.id },
        h('span', { class: 'nm' }, p.name + (p.connected ? '' : ' (غير متصل)')),
        h('span', { class: 'cnt' }, h('span', { class: 'sv-stack' }, cardEl(null, { size: 'mini' })), p.count));
    }));

    const center = h('div', { class: 'sv-center' },
      h('div', { class: 'sv-piles' },
        h('div', { class: 'sv-pile' }, cardEl(null, { size: 'big', pile: 'deck' }), h('span', null, 'السحب ', h('b', null, v.deckCount))),
        h('div', { class: 'sv-pile' }, v.top ? cardEl(v.top, { size: 'big', pile: 'discard', hold: S.holdTop > 0 }) : null, h('span', null, 'الطاولة'))),
      h('div', { class: 'sv-colorring' }, h('span', { class: 'dot ' + (v.color || '') }),
        v.color ? D.COLOR_NAMES[v.color] : 'اختر اللون',
        h('span', { class: 'dir' + (v.direction === 1 ? '' : ' rev'), 'aria-label': v.direction === 1 ? 'اتجاه اللعب: مع عقارب الساعة' : 'اتجاه اللعب: عكس عقارب الساعة' }, '↻')),
      h('div', { class: 'sv-line' }, S.eventText));

    const hand = sortedHand(v.hand);
    const canPlay = myTurn && v.stage === 'play';
    const mine = h('div', { class: 'sv-mine' + (myTurn ? ' turn' : '') },
      h('div', { class: 'sv-mine-head' }, h('span', null, me.name), myTurn ? h('span', { class: 'myturn' }, 'دورك') : null,
        h('span', { class: 'dim' }, v.hand.length + ' كروت')),
      h('div', { class: 'sv-hand' }, hand.map(function (c, i) {
        const ok = canPlay && v.playable.indexOf(c.id) >= 0;
        return cardEl(c, {
          size: 'hand', id: c.id, pick: ok, dim: canPlay && !ok, hold: !!S.hold[c.id], deal: dealt, delay: i * 70,
          onClick: ok ? function () { playCard(c); } : null,
        });
      })));

    const act = h('div', { class: 'sv-actions' });
    if (!myTurn) {
      act.append(h('div', { class: 'waiting' }, v.hasDrawn ? nm(v.currentPlayerId) + ' سحب كرتاً…' : 'دور ' + nm(v.currentPlayerId) + '…'));
    } else if (v.stage === 'color') {
      act.append(h('div', { class: 'instr' }, 'الكرت الأول لون: اختر اللون'), colorPicker(function (c) { send({ type: 'choose_color', color: c }); }));
    } else if (v.stage === 'drawn') {
      act.append(h('div', { class: 'instr' }, 'سحبت هذا الكرت: ترميه أو تحتفظ به؟'),
        h('div', { class: 'sv-drawn' }, cardEl(v.drawn, { size: 'big', zone: 'drawn', hold: !!S.hold[v.drawn.id] })),
        h('div', { class: 'btns' },
          h('button', { class: 'primary', onclick: function () {
            if (D.isWild(v.drawn)) { S.pendingPlay = { kind: 'play_drawn' }; S.sheet = 'color'; render(); } else send({ type: 'play_drawn' });
          } }, 'ارمه'),
          h('button', { onclick: function () { send({ type: 'keep' }); } }, 'احتفظ به')));
    } else {
      act.append(v.playable.length
        ? h('div', { class: 'instr' }, 'اضغط كرتاً مضيئاً لترميه')
        : h('div', { class: 'instr' }, 'ما عندك كرت يطابق: اسحب كرتاً'),
        h('div', { class: 'btns' }, h('button', { class: v.playable.length ? '' : 'primary', disabled: v.playable.length > 0, onclick: function () { send({ type: 'draw' }); } }, 'اسحب')));
    }
    return h('div', { class: 'sv-app' }, top, opps, center, mine, act);
  }

  function resultSheet() {
    const v = S.game;
    const r = S.result;
    const amHost = S.room && S.room.hostId === S.you;
    const body = [
      h('div', { class: 'instr' }, nm(r.winnerId) + ' فاز بالجولة ' + r.round + ' وأخذ ' + r.points + ' نقطة'),
      h('div', { class: 'sv-result' }, v.players.map(function (p) {
        const cards = (r.hands[p.id] || []);
        return h('div', null,
          h('div', { class: 'row' }, h('b', null, nm(p.id) + (p.id === r.winnerId ? ' ★' : '')),
            h('span', { class: 'dim' }, 'المجموع ' + r.totals[p.id])),
          h('div', { class: 'cards' }, cards.length ? sortedHand(cards).map(function (c) { return cardEl(c, { size: 'res' }); }) : h('span', { class: 'dim small' }, 'خلّص كروته')));
      })),
      v.phase === 'roundOver'
        ? (amHost ? h('button', { class: 'primary big', onclick: function () { send({ type: 'next_round' }); } }, 'الجولة التالية')
          : h('div', { class: 'center dim' }, 'بانتظار المضيف للجولة التالية…'))
        : null,
    ];
    return sheet('نتيجة الجولة ' + r.round, body, function () { S.hideResult = true; render(); });
  }

  function finalScreen() {
    const v = S.game;
    const amHost = S.room && S.room.hostId === S.you;
    const order = v.players.slice().sort(function (a, b) { return v.totals[b.id] - v.totals[a.id]; });
    const winners = v.winnerIds || [];
    return h('div', { class: 'screen final' },
      h('div', { class: 'dim center' }, 'النتيجة النهائية'),
      h('div', { class: 'winner' },
        h('div', { class: 'crown' }, icon('crown', 56)),
        h('div', { class: 'w-name' }, winners.map(nm).join(' و ')),
        h('div', { class: 'w-score' }, h('span', { class: 'num' }, v.totals[winners[0]]), ' نقطة'),
        h('div', { class: 'dim' }, winners.length > 1 ? 'تعادل على المركز الأول' : 'الفائز')),
      h('ol', { class: 'ranking' }, order.map(function (p) {
        return h('li', null, h('span', null, nm(p.id) + (p.id === v.you ? ' (أنت)' : '')), h('span', { class: 'num' }, v.totals[p.id]));
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
          onClose ? h('button', { class: 'icon-btn', onclick: onClose, 'aria-label': 'إغلاق' }, icon('close')) : null),
        body));
  }
  function closeSheet() { S.sheet = null; S.pendingPlay = null; render(); }

  function colorSheet() {
    const p = S.pendingPlay;
    return sheet('اختر اللون', colorPicker(function (c) {
      send(p && p.kind === 'play_drawn' ? { type: 'play_drawn', color: c } : { type: 'play', card: p.card, color: c });
    }), closeSheet);
  }

  function menuSheet() {
    const v = S.game;
    const muted = SND.isMuted();
    return sheet('القائمة', h('div', { class: 'menu-list' },
      h('table', { class: 'scores' },
        h('tr', null, h('th', null, 'اللاعب'), h('th', null, 'النقاط'), h('th', null, 'الكروت')),
        v.players.map(function (p) { return h('tr', null, h('td', null, p.name), h('td', null, v.totals[p.id]), h('td', null, p.count)); })),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'help'; render(); } }, icon('crown', 20), 'طريقة اللعب'),
      h('button', { class: 'with-icon', onclick: function () { SND.setMuted(!muted); render(); } },
        icon(muted ? 'mute' : 'sound', 20), muted ? 'الصوت مكتوم - اضغط للتشغيل' : 'الصوت يعمل - اضغط للكتم'),
      h('a', { class: 'sv-link', href: '/' }, 'كل الألعاب'),
      h('div', { class: 'dim small center' }, 'الغرفة ' + (S.room ? S.room.code : ''))), closeSheet);
  }

  function helpSheet() {
    const li = function (t) { return h('li', null, t); };
    return sheet('طريقة اللعب', h('ul', { class: 'help-list' },
      li('كل لاعب يبدأ بـ ' + C.HAND_SIZE + ' كروت. أول من يخلص كروته يفوز بالجولة ويأخذ نقاط كروت الباقين.'),
      li('في دورك ارمِ كرتاً يطابق كرت الطاولة في اللون أو الرقم أو الرمز. الجوكر (لون) يُرمى في أي وقت.'),
      li('ما عندك كرت يطابق؟ اسحب كرتاً. إن صلح تختار: ترميه أو تحتفظ به.'),
      li('منع: التالي يفقد دوره. عكس: ينعكس الاتجاه (مع لاعبَين يعمل كمنع).'),
      li('+2: التالي يسحب كرتين ويفقد دوره. +4 لون: تختار اللون والتالي يسحب 4 ويفقد دوره. ولا يُرد على أي منهما.'),
      li('+4 لون لا تُرمى إلا إذا لم يكن عندك أي كرت من لون الطاولة.'),
      li('نقاط الكروت المتبقية: الأرقام بقيمتها، والخاصة 20، واللون و+4 بـ 50. والأعلى مجموعاً بعد آخر جولة يفوز.'),
      li('لكل دور ' + C.TURN_SECONDS + ' ثانية، وبعدها يلعب الخادم عنك.')), closeSheet);
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
    if (!S.you || !S.room) screen = h('div', { class: 'sv-shell' }, homeScreen());
    else if (S.game && S.game.phase === 'gameOver') screen = h('div', { class: 'sv-shell' }, finalScreen());
    else if (S.game) screen = gameScreen();
    else screen = h('div', { class: 'sv-shell' }, lobbyScreen());
    if (S.game && S.game.phase === 'roundOver' && S.result && S.result.round === S.game.round) {
      if (!S.hideResult) overlays.push(resultSheet());
      else screen.append(h('div', { class: 'sv-actions' }, h('button', { class: 'primary', onclick: function () { S.hideResult = false; render(); } }, 'عرض نتيجة الجولة')));
    }
    if (S.game && S.sheet === 'menu') overlays.push(menuSheet());
    if (S.game && S.sheet === 'help') overlays.push(helpSheet());
    if (S.game && S.sheet === 'color' && S.pendingPlay) overlays.push(colorSheet());
    if (S.you && S.status !== 'open' && S.disconnectedAt && now - S.disconnectedAt > 3000) overlays.push(disconnectSheet(now));

    const nodes = [];
    if (S.status !== 'open') nodes.push(h('div', { class: 'banner', role: 'status' }, S.status === 'connecting' ? 'جاري الاتصال…' : 'انقطع الاتصال. جاري إعادة الاتصال…'));
    nodes.push(screen);
    overlays.forEach(function (o) { nodes.push(o); });
    if (S.toast) nodes.push(h('div', { class: 'toast' + (S.toast.ok ? ' ok' : ''), role: 'alert' }, S.toast.text));
    rootEl.replaceChildren.apply(rootEl, nodes);
  }

  setInterval(function () {
    const el = document.getElementById('sv-timer');
    if (el && S.game) {
      const s = secondsLeft();
      const num = el.querySelector('.num');
      if (num && s !== null) num.textContent = '0:' + String(s).padStart(2, '0');
      el.classList.toggle('low', s !== null && s <= 10);
    }
    if (S.status !== 'open' && Date.now() - (S.lastSlow || 0) > 1000) { S.lastSlow = Date.now(); render(); }
    if (S.toast && S.toast.until <= Date.now()) render();
  }, 250);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.sheet) closeSheet();
  });

  window.Reactions.init({
    send: function (msg) { sendRaw(msg); },
    nameOf: function (id) { return id === S.you ? 'أنت' : nm(id); },
    anchorFor: function (id) { return document.querySelector('[data-seat="' + id + '"]') || document.querySelector('[data-chip="' + id + '"]') || (id === S.you ? document.querySelector('.sv-mine') : null); },
  });
  render();
  connect();
})();
