// Connection, state and screens: home, lobby, table (ui.js), sheets, final. Motion in fx.js, sound in sound.js.
(function () {
  const UI = window.ScrewUI;
  const FX = window.ScrewFX;
  const SND = window.ScrewSound;
  const D = window.ScrewDeck;
  const C = window.ScrewConfig;
  const h = UI.h;
  const appEl = document.getElementById('app');

  // ---------- storage (may throw in private mode) ----------

  function store(key, value) {
    try {
      if (value === undefined) { const v = localStorage.getItem(key); return v === null ? null : JSON.parse(v); }
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
    return null;
  }

  const params = new URLSearchParams(location.search);
  // room code from a shared link (/?room=ABCD); cleared if that room turns out to be gone
  let urlCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, C.ROOM_CODE_LENGTH);
  const pageStart = Date.now();

  const S = {
    status: 'connecting', // connecting | open | reconnecting
    name: store('screw.name') || '',
    codeInput: urlCode,
    session: store('screw.session'), // {code, playerId, name}
    autoJoining: false,
    you: null,
    room: null,
    game: null,
    gameVersion: 0,
    result: null,
    resultShown: 0, // round whose result reveal animation already ran
    final: null,
    peeks: {},
    marks: {},
    notice: null,
    toast: null,
    eventText: '',
    log: [],
    pending: null,
    sheet: null, // null | scores | menu | log | screw
    hideResult: false,
    timerEndsLocal: null,
    homeError: '',
    dealtRound: 0,
    bootId: null, // id of the server process we talk to; a new one means it restarted
    serverRestarted: false,
    lost: null, // {restarted} when our saved room no longer exists
    disconnectedAt: null,
  };

  // ---------- network ----------

  let ws = null;
  let attempts = 0;
  let retryTimer = null;

  function connect() {
    clearTimeout(retryTimer);
    if (ws && ws.readyState < 2) { ws.onclose = null; ws.close(); }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);
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
    S.pending = null;
    if (S.sheet === 'screw') S.sheet = null;
    if (!sendRaw(msg)) showToast('لا يوجد اتصال. جاري إعادة المحاولة…');
    render();
  }

  // ---------- motion planned from events ----------
  // An event arrives while the DOM still shows the old state: we read where things come FROM now,
  // and run the flight after the next game_state render, when we know where they go TO.

  let fxJobs = [];

  function later(fn) { fxJobs.push({ after: S.gameVersion, run: fn }); }

  function q(sel) { return document.querySelector(sel); }
  function handRect(id) { return id ? FX.rectOf('[data-hand="' + id + '"]') : null; }
  function pileRect(name) { return FX.rectOf('[data-pile="' + name + '"]'); }
  function seatRect(pid) {
    const r = FX.rectOf('[data-player="' + pid + '"] .minis') || FX.rectOf('[data-player="' + pid + '"]');
    return FX.centred(r, 26);
  }
  function holderRect(pid) {
    return pid === S.you ? (FX.rectOf('[data-zone="drawn"]') || pileRect('deck')) : seatRect(pid);
  }

  function planFx(e) {
    const me = e.playerId === S.you;
    switch (e.type) {
      case 'draw': {
        const from = pileRect('deck');
        SND.play('flip');
        later(function () {
          if (me) FX.fly({ from: from, to: FX.rectOf('[data-zone="drawn"]'), card: S.game.drawn, flip: 'toFace', hold: 'zone:drawn' });
          else FX.fly({ from: from, to: seatRect(e.playerId), card: { hidden: true } });
        });
        break;
      }
      case 'swap_drawn': {
        const fromDrawn = holderRect(e.playerId);
        const drawnCard = me && S.game ? S.game.drawn : null;
        const fromOld = handRect(e.handId);
        SND.play('throw');
        later(function () {
          const to = handRect(e.newHandId);
          if (me && drawnCard) FX.fly({ from: fromDrawn, to: to, card: drawnCard, flip: 'toBack', hold: 'hand:' + e.newHandId });
          else FX.fly({ from: fromDrawn, to: to, card: { hidden: true }, hold: 'hand:' + e.newHandId });
          FX.fly({ from: fromOld, to: pileRect('discard'), card: e.discarded, flip: 'toFace', hold: 'pile:discard' });
        });
        break;
      }
      case 'discard_drawn': {
        const from = holderRect(e.playerId);
        SND.play('throw');
        later(function () {
          FX.fly({ from: from, to: pileRect('discard'), card: e.card, flip: me ? null : 'toFace', hold: 'pile:discard' });
        });
        break;
      }
      case 'take_discard': {
        const fromTop = pileRect('discard');
        const fromOld = handRect(e.handId);
        SND.play('throw');
        later(function () {
          FX.fly({ from: fromTop, to: handRect(e.newHandId), card: e.taken, startCard: e.taken, flip: 'toBack', hold: 'hand:' + e.newHandId });
          FX.fly({ from: fromOld, to: pileRect('discard'), card: e.discarded, flip: 'toFace', hold: 'pile:discard', delay: 120 });
        });
        break;
      }
      case 'match': {
        const from = handRect(e.handId);
        SND.play('flip');
        if (e.success) {
          later(function () { FX.fly({ from: from, to: pileRect('discard'), card: e.card, flip: 'toFace', hold: 'pile:discard' }); });
        } else {
          later(function () { FX.reveal(from, e.card, 700); });
        }
        break;
      }
      case 'penalty': {
        const from = pileRect('deck');
        later(function () {
          FX.fly({ from: from, to: handRect(e.newHandId), card: { hidden: true }, hold: 'hand:' + e.newHandId, delay: 1100 });
        });
        break;
      }
      case 'throw': {
        const from = handRect(e.handId);
        SND.play('throw');
        later(function () { FX.fly({ from: from, to: pileRect('discard'), card: e.card, flip: 'toFace', hold: 'pile:discard' }); });
        break;
      }
      case 'swap': {
        // ids travel with the cards: targetHandId was in the actor's hand, handId in the target's
        const fromA = handRect(e.targetHandId);
        const fromB = handRect(e.handId);
        SND.play('throw');
        later(function () {
          FX.fly({ from: fromA, to: handRect(e.targetHandId), card: { hidden: true }, hold: 'hand:' + e.targetHandId });
          FX.fly({ from: fromB, to: handRect(e.handId), card: { hidden: true }, hold: 'hand:' + e.handId });
        });
        break;
      }
      case 'screw':
        screwSplash(e.playerId);
        break;
    }
  }

  function runFx() {
    const ready = fxJobs.filter(function (j) { return S.gameVersion > j.after; });
    fxJobs = fxJobs.filter(function (j) { return S.gameVersion <= j.after; });
    ready.forEach(function (j) { try { j.run(); } catch (err) { /* a missing element just means no flight */ } });
  }

  // The loudest moment of the game: big word, the caller's name, a short table shake.
  function screwSplash(pid) {
    SND.play('screw');
    const el = h('div', { class: 'screw-splash', role: 'alert' },
      h('div', { class: 'ss-word' }, 'سكرو!'),
      h('div', { class: 'ss-name' }, UI.nameOf(S, pid)));
    document.body.append(el);
    FX.shake(appEl);
    setTimeout(function () { el.classList.add('out'); }, 1250);
    setTimeout(function () { el.remove(); }, 1500);
  }

  // ---------- incoming messages ----------

  function turnKey(g) {
    return g.currentPlayerId + '|' + g.stage + '|' + g.phase + '|' + g.round;
  }

  function onMessage(m) {
    const now = Date.now();
    let snap = null;
    switch (m.type) {
      case 'hello':
        if (S.bootId && m.bootId !== S.bootId) S.serverRestarted = true;
        S.bootId = m.bootId;
        break;
      case 'joined':
        // a code that belongs to the bank game: remember the seat for that page and go there
        if (m.game && m.game !== 'screw') {
          store(m.game + '.session', { code: m.code, playerId: m.playerId, name: S.name });
          location.replace('/' + m.game + '.html?room=' + m.code);
          return;
        }
        S.lost = null;
        S.autoJoining = false;
        S.you = m.you;
        S.session = { code: m.code, playerId: m.playerId, name: S.name || (S.session && S.session.name) || '' };
        store('screw.session', S.session);
        S.homeError = '';
        try { history.replaceState(null, '', '/screw.html?room=' + m.code); } catch (e) { /* ignore */ }
        break;
      case 'room_state':
        S.room = m;
        break;
      case 'reaction':
        window.Reactions.show(m.from, m.id);
        return;
      case 'game_state': {
        const prev = S.game;
        snap = FX.snapshot();
        S.game = m;
        S.gameVersion += 1;
        // a computer player's short pause is not a countdown anyone needs to see
        S.timerEndsLocal = m.timer && m.timer.kind !== 'bot' ? m.timer.endsAt - (m.timer.now - now) : null;
        if (S.pending && S.pending.key !== turnKey(m)) S.pending = null;
        if (S.sheet === 'screw' && !m.screwAllowed) S.sheet = null;
        if (m.phase !== 'roundOver') S.hideResult = false;
        if (m.phase === 'peek' && m.round === 1) S.final = null;
        if (m.phase === 'peek' && (!prev || prev.round !== m.round || prev.phase !== 'peek')) S.log = [];
        if (m.currentPlayerId === m.you && m.phase === 'turn' &&
            (!prev || prev.currentPlayerId !== m.you || prev.round !== m.round || prev.phase !== 'turn')) {
          SND.play('turn');
          if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
        }
        break;
      }
      case 'private_card': {
        const lines = [];
        m.reveals.forEach(function (r) {
          if (r.ownerId === null || r.handId === undefined) return;
          const until = now + (m.seconds || C.PEEK_SECONDS) * 1000;
          S.peeks[r.handId] = { card: r.card, until: until, animated: false };
          const owner = r.ownerId === S.you ? 'عندك' : 'عند ' + UI.nameOf(S, r.ownerId);
          lines.push('كرت ' + (r.slot + 1) + ' ' + owner + ': ' + D.describe(r.card));
        });
        if (lines.length) {
          SND.play('flip');
          S.notice = { text: 'رأيت ' + lines.join(' · '), until: now + (m.seconds || C.PEEK_SECONDS) * 1000 };
        }
        break;
      }
      case 'event': {
        const e = m.event;
        const text = UI.eventText(S, e);
        if (text) {
          S.eventText = text;
          S.log.unshift({ text: text, mine: e.playerId === S.you });
          if (S.log.length > 80) S.log.pop();
        }
        if (e.type === 'look') {
          e.targets.forEach(function (t) { if (t.handId) S.marks[t.handId] = now + C.PEEK_SECONDS * 1000; });
        }
        planFx(e);
        break;
      }
      case 'round_result':
        S.result = m;
        S.hideResult = false;
        S.sheet = null;
        break;
      case 'game_over':
        S.final = m;
        break;
      case 'room_closed': {
        const mine = m.by === S.you;
        window.RoomEnd.dismiss();
        leaveRoom();
        if (mine) showToast('أنهيت الغرفة.', true); else S.lost = { text: m.text };
        break;
      }
      case 'left_room':
        window.RoomEnd.dismiss();
        leaveRoom();
        showToast('خرجت من الغرفة.', true);
        break;
      case 'player_left':
        showToast(m.name + ' خرج من الغرفة.');
        break;
      case 'error':
        if (S.autoJoining) {
          // the saved seat is gone (server restarted, or the room expired): explain, then start over
          S.autoJoining = false;
          leaveRoom();
          if (m.code === 'NO_ROOM' || m.code === 'ROOM_CLOSED') {
            S.lost = { restarted: S.serverRestarted, text: m.code === 'ROOM_CLOSED' ? m.message : '' };
          } else {
            S.homeError = m.message;
            showToast(m.message);
          }
        } else {
          if (!S.you) S.homeError = m.message;
          showToast(m.message);
        }
        break;
    }
    render();
    if (m.type === 'game_state') afterGameRender(snap);
  }

  function afterGameRender(snap) {
    FX.slide(snap);
    runFx();
    const g = S.game;
    // deal animation once per round
    if (g && g.phase === 'peek' && S.dealtRound !== g.round) {
      S.dealtRound = g.round;
      const order = [];
      const maxLen = Math.max.apply(null, g.players.map(function (p) { return p.hand.length; }));
      const start = g.players.findIndex(function (p) { return p.id === g.you; });
      for (let slot = 0; slot < maxLen; slot++) {
        g.players.forEach(function (p) {
          const c = p.hand[slot];
          if (c && c.handId) order.push({ el: q('[data-hand="' + c.handId + '"]'), key: 'hand:' + c.handId });
        });
      }
      if (start < 0) return;
      FX.deal(pileRect('deck'), order, function () { SND.play('deal'); });
    }
    if (g && g.phase !== 'peek' && S.dealtRound === 0) S.dealtRound = g.round; // joined mid-round: no deal
  }

  // Forget the room locally and go back to the home screen (keeps the player's name).
  function leaveRoom() {
    S.session = null;
    store('screw.session', null);
    S.you = null; S.room = null; S.game = null; S.result = null; S.final = null;
    S.sheet = null; S.pending = null; S.log = []; S.eventText = '';
    urlCode = '';
    S.codeInput = '';
    try { history.replaceState(null, '', '/screw.html'); } catch (e) { /* ignore */ }
  }

  function showToast(text, ok) {
    S.toast = { text: text, ok: !!ok, until: Date.now() + 4000 };
  }

  // ---------- api handed to the table ----------

  const api = {
    send: send,
    pick: function (prompt, valid, onPick) {
      S.pending = { prompt: prompt, valid: valid, onPick: onPick, key: S.game ? turnKey(S.game) : '' };
      render();
    },
    cancelPick: function () { S.pending = null; render(); },
    askScrew: function () { S.sheet = 'screw'; render(); },
    openSheet: function (name) { S.sheet = name; render(); },
    toggleHelp: function () { window.ScrewHelp.toggle(); },
  };

  // ---------- screens ----------

  function heroCards() {
    return h('div', { class: 'hero-cards', 'aria-hidden': 'true' },
      UI.cardEl({ hidden: true }, { size: 'herocard' }),
      UI.cardEl(D.makeCard('screw_red'), { size: 'herocard' }),
      UI.cardEl(D.makeCard('minus1'), { size: 'herocard' }));
  }

  function homeScreen() {
    const name = h('input', {
      type: 'text', placeholder: 'اسمك', maxlength: C.NAME_MAX_LENGTH, value: S.name, autocomplete: 'nickname',
      'aria-label': 'اسمك', oninput: function (e) { S.name = e.target.value; store('screw.name', S.name); },
    });
    const code = h('input', {
      type: 'text', class: 'code', placeholder: 'الكود', maxlength: C.ROOM_CODE_LENGTH, value: S.codeInput,
      autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'كود الغرفة', dir: 'ltr',
      oninput: function (e) {
        S.codeInput = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
        e.target.value = S.codeInput;
      },
    });
    const offline = S.status !== 'open';
    const join = function () {
      if (!S.name.trim()) { S.homeError = 'اكتب اسمك أولاً.'; render(); return; }
      if (S.codeInput.length !== C.ROOM_CODE_LENGTH) { S.homeError = 'اكتب كود الغرفة (' + C.ROOM_CODE_LENGTH + ' أحرف).'; render(); return; }
      S.homeError = '';
      const saved = S.session && S.session.code === S.codeInput ? S.session.playerId : undefined;
      sendRaw({ type: 'join_room', code: S.codeInput, name: S.name, playerId: saved });
    };
    const create = function () {
      if (!S.name.trim()) { S.homeError = 'اكتب اسمك أولاً.'; render(); return; }
      S.homeError = '';
      sendRaw({ type: 'create_room', name: S.name });
    };
    const lost = S.lost ? h('div', { class: 'lost', role: 'alert' },
      h('h2', null, 'انتهت الغرفة'),
      h('p', null, S.lost.text ? S.lost.text : S.lost.restarted
        ? 'أُعيد تشغيل الخادم (ربما نام بعد فترة بلا لعب)، فضاعت كل الغرف المفتوحة. أنشئ غرفة جديدة وأرسل الرابط لأصدقائك.'
        : 'هذه الغرفة لم تعد موجودة: تُحذف بعد ' + C.ROOM_IDLE_MINUTES + ' دقيقة بلا لاعبين، أو عند إعادة تشغيل الخادم. أنشئ غرفة جديدة وأرسل الرابط لأصدقائك.'),
      h('button', { class: 'primary', onclick: function () { S.lost = null; create(); }, disabled: offline }, 'إنشاء غرفة جديدة'),
      h('button', { onclick: function () { S.lost = null; render(); } }, 'إغلاق')) : null;
    const waking = S.status !== 'open' && Date.now() - pageStart > 4000
      ? h('div', { class: 'center dim small' }, 'الخادم يستيقظ… قد يأخذ حتى دقيقة إذا لم يُستخدم منذ مدة.') : null;
    return h('div', { class: 'screen home' },
      h('div', { class: 'hero' }, heroCards(), h('h1', { class: 'hero-title' }, 'سكرو')),
      lost,
      h('div', { class: 'form' },
        name,
        waking,
        urlCode
          ? [h('div', { class: 'row' }, code), h('button', { class: 'primary', onclick: join, disabled: offline }, 'دخول الغرفة'),
            h('div', { class: 'or' }, 'أو'), h('button', { onclick: create, disabled: offline }, 'إنشاء غرفة جديدة')]
          : [h('button', { class: 'primary', onclick: create, disabled: offline }, 'إنشاء غرفة'),
            h('div', { class: 'or' }, 'أو ادخل بالكود'),
            h('div', { class: 'row' }, code, h('button', { onclick: join, disabled: offline }, 'دخول'))],
        S.homeError ? h('div', { class: 'error', role: 'alert' }, S.homeError) : null,
        h('a', { class: 'all-games', href: '/' }, 'كل الألعاب')));
  }

  const AVATAR_CLASSES = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6'];

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' });
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
    const url = location.origin + '/screw.html?room=' + code;
    if (navigator.share) {
      navigator.share({ title: 'سكرو', text: 'تعال نلعب سكرو! كود الغرفة: ' + code, url: url }).catch(function () {});
      return;
    }
    copyText(url).then(function () { showToast('تم نسخ الرابط', true); render(); },
      function () { showToast('تعذر النسخ. الرابط: ' + url); render(); });
  }

  function lobbyScreen() {
    const r = S.room;
    const amHost = r.hostId === S.you;
    const present = r.players.filter(function (p) { return p.connected; }).length;
    return h('div', { class: 'screen lobby' },
      h('div', { class: 'lobby-head' },
        h('div', { class: 'dim center' }, 'كود الغرفة'),
        h('div', { class: 'code-box', dir: 'ltr', 'aria-label': 'كود الغرفة ' + r.code.split('').join(' ') }, r.code),
        h('button', { class: 'with-icon', onclick: function () { share(r.code); } }, UI.icon('share', 20), 'مشاركة الرابط'),
        h('button', { class: 'with-icon help-btn', onclick: api.toggleHelp }, UI.icon('help', 20), 'طريقة اللعب')),
      h('div', { class: 'dim' }, 'اللاعبون (' + r.players.length + '/' + C.MAX_PLAYERS + ')'),
      h('ul', { class: 'plist' }, r.players.map(function (p, i) {
        return h('li', { class: p.connected ? '' : 'off', 'data-chip': p.id },
          h('span', { class: 'avatar ' + AVATAR_CLASSES[i % AVATAR_CLASSES.length] }, p.bot ? '🤖' : (Array.from(p.name)[0] || '؟')),
          h('span', { class: 'pname' }, p.name + (p.id === S.you ? ' (أنت)' : ''), p.connected ? null : h('small', null, ' غير متصل')),
          p.isHost ? h('span', { class: 'tag' }, 'المضيف') : null,
          p.bot && amHost ? h('button', { class: 'icon-btn lob-rm', 'aria-label': 'احذف ' + p.name, onclick: function () { send({ type: 'remove_bot', id: p.id }); } }, UI.icon('close', 20)) : null);
      })),
      amHost && r.players.length < C.MAX_PLAYERS ? h('button', { class: 'with-icon', onclick: function () { send({ type: 'add_bot' }); } }, '🤖', ' أضف لاعب كمبيوتر') : null,
      h('div', { class: 'lob-row' }, window.Reactions.button()),
      h('div', { class: 'grow' }),
      amHost
        ? [present < C.MIN_PLAYERS ? h('div', { class: 'center dim' }, 'أرسل الرابط لأصدقائك أو أضف لاعب كمبيوتر.') : null,
          h('button', { class: 'primary big', disabled: present < C.MIN_PLAYERS, onclick: function () { send({ type: 'start_game' }); } }, 'ابدأ')]
        : h('div', { class: 'center dim' }, 'بانتظار المضيف ليبدأ اللعبة…'),
      window.RoomEnd.button());
  }

  function sheetWrap(title, body, onClose, extraCls) {
    return h('div', { class: 'sheet-wrap', onclick: function (e) { if (e.target === e.currentTarget && onClose) onClose(); } },
      h('div', { class: 'sheet' + (extraCls ? ' ' + extraCls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'sheet-head' }, h('h2', null, title),
          onClose ? h('button', { class: 'icon-btn', onclick: onClose, 'aria-label': 'إغلاق' }, UI.icon('close')) : null),
        body));
  }

  function closeSheet() { S.sheet = null; render(); }

  function scoresTable() {
    const g = S.game;
    const players = g.players;
    const best = Math.min.apply(null, players.map(function (p) { return g.totals[p.id]; }));
    return h('div', { class: 'table-wrap' }, h('table', { class: 'scores' },
      h('tr', null, h('th', null, 'الجولة'), players.map(function (p) { return h('th', null, p.name); })),
      g.history.map(function (row) {
        return h('tr', null, h('td', null, row.round + (row.round === g.rounds ? ' ×' + C.LAST_ROUND_MULTIPLIER : '')),
          players.map(function (p) { return h('td', null, row.scores[p.id]); }));
      }),
      h('tr', { class: 'total' }, h('td', null, 'المجموع'),
        players.map(function (p) { return h('td', { class: g.totals[p.id] === best ? 'win' : '' }, g.totals[p.id]); }))));
  }

  function scoresSheet() {
    return sheetWrap('جدول النقاط', [
      scoresTable(),
      h('div', { class: 'dim small' }, 'الأقل مجموعاً هو الفائز. الجولة ' + C.ROUNDS + ' نقاطها مضاعفة.'),
    ], closeSheet);
  }

  function menuSheet() {
    const muted = SND.isMuted();
    return sheetWrap('القائمة', h('div', { class: 'menu-list' },
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'scores'; render(); } }, UI.icon('table', 20), 'جدول النقاط'),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'log'; render(); } }, UI.icon('log', 20), 'سجل الأحداث'),
      h('button', { class: 'with-icon', 'aria-pressed': muted ? 'true' : 'false', onclick: function () { SND.setMuted(!muted); render(); } },
        UI.icon(muted ? 'mute' : 'sound', 20), muted ? 'الصوت مكتوم - اضغط للتشغيل' : 'الصوت يعمل - اضغط للكتم'),
      window.RoomEnd.button(),
      h('div', { class: 'dim small center' }, 'الغرفة ' + (S.room ? S.room.code : ''))), closeSheet);
  }

  function logSheet() {
    return sheetWrap('سجل الأحداث', S.log.length
      ? h('ol', { class: 'log' }, S.log.map(function (l) { return h('li', { class: l.mine ? 'mine' : '' }, l.text); }))
      : h('div', { class: 'dim center' }, 'لا أحداث بعد في هذه الجولة'), closeSheet);
  }

  function screwSheet() {
    return sheetWrap('إعلان سكرو', [
      h('p', { class: 'screw-q' }, 'متأكد؟ بعد الإعلان يلعب كل لاعب دوراً أخيراً واحداً، ثم تُكشف الكروت. لا يمكن التراجع.'),
      h('p', { class: 'dim small' }, 'إذا لم يكن مجموعك الأقل، تُحسب نقاطك ×' + C.FAILED_SCREW_MULTIPLIER + '.'),
      h('div', { class: 'btns' },
        h('button', { class: 'danger solid', onclick: function () { send({ type: 'call_screw' }); } }, 'نعم، سكرو!'),
        h('button', { onclick: closeSheet }, 'تراجع')),
    ], closeSheet, 'screw-sheet');
  }

  function resultSheet() {
    const g = S.game;
    const r = S.result;
    const amHost = S.room && S.room.hostId === S.you;
    const animate = S.resultShown !== r.round;
    S.resultShown = r.round;
    let k = 0;
    const body = [
      r.multiplied ? h('div', { class: 'instr' }, 'الجولة الأخيرة: النقاط مضاعفة') : null,
      g.players.map(function (p, pi) {
        const cards = r.hands[p.id] || [];
        const low = r.minIds.indexOf(p.id) >= 0;
        const failed = r.screwCaller === p.id && !low;
        const startAt = pi * 450;
        const row = h('div', { class: 'res-player' + (low ? ' low' : '') },
          h('div', { class: 'head' },
            h('span', { class: 'rp-name' }, p.name, r.screwCaller === p.id ? h('span', { class: 'screw-tag' + (failed ? ' fail' : '') }, failed ? 'سكرو فاشل' : 'سكرو') : null),
            h('span', { class: 'rp-sum' }, 'المجموع ', h('b', { class: 'num', 'data-count': animate ? r.sums[p.id] : null, 'data-delay': startAt + cards.length * 120 }, animate ? 0 : r.sums[p.id]))),
          h('div', { class: 'cards' }, cards.length ? cards.map(function (c, i) {
            k++;
            return UI.cardEl(c, { size: 'mid', flipIn: animate, delay: animate ? startAt + i * 120 : 0 });
          }) : h('span', { class: 'dim small' }, 'بلا كروت')),
          h('div', { class: 'rp-score' },
            h('span', null, 'سُجّل: ', h('b', null, r.scores[p.id])),
            h('span', { class: 'dim' }, 'المجموع الكلي: ' + r.totals[p.id])));
        return row;
      }),
      !r.multiplied
        ? (amHost ? h('button', { class: 'primary big', onclick: function () { send({ type: 'next_round' }); } }, 'الجولة التالية')
          : h('div', { class: 'center dim' }, 'بانتظار المضيف للجولة التالية…'))
        : h('div', { class: 'center dim' }, 'انتهت الجولات الخمس'),
    ];
    if (animate) {
      for (let i = 0; i < k; i++) SND.play('flip', i * 120);
      setTimeout(countUp, 0);
    }
    return sheetWrap('نتيجة الجولة ' + r.round, body, function () { S.hideResult = true; render(); }, 'result-sheet');
  }

  // sums count up once the cards have turned
  function countUp() {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      const target = Number(el.getAttribute('data-count'));
      const delay = Number(el.getAttribute('data-delay')) || 0;
      if (FX.reduced()) { el.textContent = target; return; }
      setTimeout(function () {
        const t0 = performance.now();
        const dur = 600;
        (function step(t) {
          const p = Math.min(1, (t - t0) / dur);
          el.textContent = Math.round(target * p);
          if (p < 1) requestAnimationFrame(step);
        })(t0);
      }, delay);
    });
  }

  // Shown instead of a frozen table while the server cannot be reached.
  function disconnectSheet(now) {
    const secs = Math.floor((now - S.disconnectedAt) / 1000);
    const long = secs >= 60;
    return h('div', { class: 'sheet-wrap blocking' },
      h('div', { class: 'sheet disconnect', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'انقطع الاتصال بالخادم' },
        h('div', { class: 'sheet-head' }, h('h2', null, 'انقطع الاتصال بالخادم')),
        h('p', null, long
          ? 'لم نستطع الوصول للخادم منذ ' + secs + ' ثانية. تأكد من اتصالك بالإنترنت. إذا أُعيد تشغيل الخادم فقد ضاعت الغرفة، وسنخبرك بذلك عند عودته.'
          : 'نحاول إعادة الاتصال تلقائياً… إذا كان الخادم نائماً أو يُعاد تشغيله فقد يأخذ حتى دقيقة.'),
        h('div', { class: 'dim small' }, 'مضى ' + secs + ' ثانية · المحاولة ' + Math.max(1, attempts)),
        h('div', { class: 'btns' },
          h('button', { class: 'primary', onclick: function () { attempts = 0; connect(); render(); } }, 'أعد المحاولة الآن'),
          long ? h('button', { onclick: function () { leaveRoom(); render(); } }, 'الصفحة الرئيسية') : null)));
  }

  function finalScreen() {
    const g = S.game;
    const f = S.final || { totals: g.totals, winnerIds: g.winnerIds };
    const amHost = S.room && S.room.hostId === S.you;
    const order = g.players.slice().sort(function (a, b) { return f.totals[a.id] - f.totals[b.id]; });
    const winners = order.filter(function (p) { return f.winnerIds.indexOf(p.id) >= 0; });
    const rest = order.filter(function (p) { return f.winnerIds.indexOf(p.id) < 0; });
    return h('div', { class: 'screen final' },
      h('div', { class: 'dim center' }, 'النتيجة النهائية'),
      h('div', { class: 'winner' },
        h('div', { class: 'crown' }, UI.icon('crown', 56)),
        h('div', { class: 'w-name' }, winners.map(function (p) { return p.name; }).join(' و ')),
        h('div', { class: 'w-score' }, h('span', { class: 'num' }, f.totals[winners[0].id]), ' نقطة'),
        h('div', { class: 'dim' }, winners.length > 1 ? 'تعادل على المركز الأول' : 'الفائز')),
      h('ol', { class: 'ranking', start: winners.length + 1 }, rest.map(function (p) {
        return h('li', null, h('span', null, p.name + (p.id === S.you ? ' (أنت)' : '')), h('span', { class: 'num' }, f.totals[p.id]));
      })),
      h('button', { class: 'with-icon', onclick: function () { S.sheet = 'scores'; render(); } }, UI.icon('table', 20), 'جدول النقاط'),
      h('div', { class: 'grow' }),
      amHost
        ? h('button', { class: 'primary big', onclick: function () { send({ type: 'new_game' }); } }, 'لعبة جديدة')
        : h('div', { class: 'center dim' }, 'بانتظار المضيف لبدء لعبة جديدة…'),
      window.RoomEnd.button());
  }

  // ---------- render ----------

  function render() {
    const now = Date.now();
    // expire old peeks/marks/notices/toasts first so nothing stale is drawn
    Object.keys(S.peeks).forEach(function (k) { if (S.peeks[k].until <= now) delete S.peeks[k]; });
    Object.keys(S.marks).forEach(function (k) { if (S.marks[k] <= now) delete S.marks[k]; });
    if (S.notice && S.notice.until <= now) S.notice = null;
    if (S.toast && S.toast.until <= now) S.toast = null;

    let screen;
    const overlays = [];
    const kind = !S.you || !S.room ? 'home' : S.game ? (S.game.phase === 'gameOver' ? 'final' : 'table') : 'lobby';
    if (kind !== S.screenKind) { FX.clear(); S.screenKind = kind; }
    window.ScrewHelp.setAvailable(kind === 'table' || kind === 'lobby');
    if (!S.you || !S.room) {
      screen = homeScreen();
    } else if (S.game && S.game.phase === 'gameOver') {
      screen = finalScreen();
    } else if (S.game) {
      screen = UI.renderTable(S, api);
      if (S.game.phase === 'roundOver' && S.result && S.result.round === S.game.round) {
        if (!S.hideResult) overlays.push(resultSheet());
        else screen.append(h('div', { class: 'actions' }, h('div', { class: 'btns' },
          h('button', { class: 'primary', onclick: function () { S.hideResult = false; render(); } }, 'عرض نتيجة الجولة'))));
      }
    } else {
      screen = lobbyScreen();
    }
    if (S.game && S.sheet === 'scores') overlays.push(scoresSheet());
    if (S.game && S.sheet === 'menu') overlays.push(menuSheet());
    if (S.game && S.sheet === 'log') overlays.push(logSheet());
    if (S.game && S.sheet === 'screw') overlays.push(screwSheet());
    if (S.you && S.status !== 'open' && S.disconnectedAt && now - S.disconnectedAt > 3000) overlays.push(disconnectSheet(now));

    // replaceChildren stringifies null/arrays, so build a clean node list first
    const nodes = [];
    if (S.status !== 'open') {
      nodes.push(h('div', { class: 'banner', role: 'status' }, S.status === 'connecting' ? 'جاري الاتصال…' : 'انقطع الاتصال. جاري إعادة الاتصال…'));
    }
    nodes.push(screen);
    overlays.forEach(function (o) { nodes.push(o); });
    if (S.toast) nodes.push(h('div', { class: 'toast' + (S.toast.ok ? ' ok' : ''), role: 'alert' }, S.toast.text));
    appEl.replaceChildren.apply(appEl, nodes);
    FX.applyHolds();

    let next = Infinity;
    Object.keys(S.peeks).forEach(function (k) { next = Math.min(next, S.peeks[k].until); });
    Object.keys(S.marks).forEach(function (k) { next = Math.min(next, S.marks[k]); });
    if (S.notice) next = Math.min(next, S.notice.until);
    if (S.toast) next = Math.min(next, S.toast.until);
    S.nextExpiry = next;
  }

  setInterval(function () {
    UI.tickTimer(S);
    if (Date.now() >= (S.nextExpiry || Infinity)) render();
    else if (S.status !== 'open' && Date.now() - (S.lastSlowRender || 0) > 1000) { S.lastSlowRender = Date.now(); render(); }
  }, 250);

  // Phones suspend background tabs: reconnect right away when the page becomes visible again.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect();
  });

  // Escape closes the open sheet (keyboard users).
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && (S.sheet || S.pending)) { S.sheet = null; S.pending = null; render(); }
  });

  window.Reactions.init({
    send: function (msg) { sendRaw(msg); },
    nameOf: function (id) { return id === S.you ? 'أنت' : UI.nameOf(S, id); },
    anchorFor: function (id) { return document.querySelector('[data-player="' + id + '"]') || document.querySelector('[data-chip="' + id + '"]') || (id === S.you ? document.querySelector('.mine') : null); },
  });
  window.RoomEnd.init({
    send: send,
    isHost: function () { return !!S.room && S.room.hostId === S.you; },
    stage: function () { return !S.game ? 'lobby' : S.game.phase === 'gameOver' || S.game.phase === 'matchOver' ? 'over' : 'playing'; },
  });
  render();
  connect();
})();
