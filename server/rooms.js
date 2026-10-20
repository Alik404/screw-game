// Rooms, players, timers and message routing. Independent of the network layer:
// a "conn" is any object with send(obj) and close(). Timers are injectable for tests.
const crypto = require('node:crypto');
const CONFIG = require('./config');
const GAMES = require('./games');

const MSG = {
  badMessage: 'رسالة غير صالحة.',
  noRoom: 'الغرفة غير موجودة. تأكد من الكود.',
  serverFull: 'الخادم ممتلئ حالياً. حاول بعد قليل.',
  started: 'بدأت اللعبة في هذه الغرفة ولا يمكن الدخول الآن.',
  full: 'الغرفة ممتلئة.',
  nameRequired: 'اكتب اسمك أولاً.',
  nameTaken: 'هذا الاسم مستخدم في الغرفة. اختر اسماً آخر.',
  alreadyIn: 'أنت داخل غرفة بالفعل.',
  notIn: 'لست داخل غرفة.',
  hostOnly: 'هذه الحركة للمضيف فقط.',
  needPlayers: 'تحتاج إلى لاعبَين على الأقل للبدء.',
  alreadyStarted: 'اللعبة بدأت بالفعل.',
  notStarted: 'اللعبة لم تبدأ بعد.',
  wrongPhase: 'هذه الحركة غير متاحة الآن.',
  unknownGame: 'لعبة غير معروفة.',
  wrongGame: 'هذه الحركة ليست من هذه اللعبة.',
  roomOtherGame: 'هذه الغرفة للعبة أخرى.',
  badToken: 'هذا الرمز غير متاح.',
  tokenTaken: 'هذا الرمز اختاره لاعب آخر.',
  noBots: 'هذه اللعبة لا تدعم لاعبي الكمبيوتر.',
  noBot: 'لاعب الكمبيوتر غير موجود.',
  noOptions: 'هذه اللعبة ليس لها خيارات.',
  badReaction: 'تفاعل غير معروف.',
  noVoice: 'المكالمة غير متاحة في هذه اللعبة.',
};

// what everyone (and anyone who comes back later) is told when the host ends the room
function closedText(name) {
  return 'أنهى ' + name + ' (المضيف) الغرفة. أنشئ غرفة جديدة متى أردت اللعب مرة أخرى.';
}

function createRooms(opts) {
  opts = opts || {};
  const setTimer = opts.setTimer || setTimeout;
  const clearTimer = opts.clearTimer || clearTimeout;
  const now = opts.now || Date.now;
  const rooms = new Map();
  // rooms the host ended, remembered for a while: a player who was away is told why the code stopped working
  const closedRooms = new Map(); // code -> {at, text}

  function forgetOldClosed() {
    const t = now();
    closedRooms.forEach(function (c, code) { if (t - c.at > CONFIG.ROOM_IDLE_MINUTES * 60 * 1000) closedRooms.delete(code); });
  }

  // ---------- helpers ----------

  function sendTo(conn, msg) {
    if (conn) conn.send(msg);
  }

  // code: optional machine-readable reason the client can react to (e.g. NO_ROOM)
  function err(conn, text, code) {
    const msg = { type: 'error', message: text };
    if (code) msg.code = code;
    sendTo(conn, msg);
  }

  function newCode() {
    const abc = CONFIG.ROOM_CODE_ALPHABET;
    for (;;) {
      let code = '';
      for (let i = 0; i < CONFIG.ROOM_CODE_LENGTH; i++) code += abc[crypto.randomInt(abc.length)];
      if (!rooms.has(code) && !closedRooms.has(code)) return code;
    }
  }

  function cleanName(raw) {
    if (typeof raw !== 'string') return '';
    return raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, CONFIG.NAME_MAX_LENGTH);
  }

  function connected(room) {
    return room.players.filter(function (p) { return p.conn; });
  }

  function byConn(room, conn) {
    return room.players.find(function (p) { return p.conn === conn; });
  }

  function started(room) {
    return room.engine !== null;
  }

  function gameOf(room) {
    return GAMES[room.game];
  }

  function roster(room) {
    return room.players.map(function (p) {
      return { id: p.seat, name: p.name, connected: !!p.conn || !!p.bot, isHost: p.seat === room.hostSeat, token: p.token || null, bot: !!p.bot };
    });
  }

  // ---------- outgoing ----------

  function roomStateMsg(room) {
    return {
      type: 'room_state',
      code: room.code,
      hostId: room.hostSeat,
      game: room.game,
      phase: started(room) ? 'playing' : 'lobby',
      players: roster(room),
      options: room.options || null, // the host's choices so far (games with start options)
    };
  }

  function broadcastRoom(room) {
    const msg = roomStateMsg(room);
    connected(room).forEach(function (p) { sendTo(p.conn, msg); });
  }

  // the countdown the player sees (the first one) and all running ones
  function timerList(room) {
    return room.timerOrder.filter(function (k) { return room.timers[k]; }).map(function (k) {
      const t = room.timers[k];
      return { kind: t.kind, endsAt: t.endsAt, now: now() };
    });
  }

  // Each player gets their own personalised copy; the secret playerId is never included.
  function gameStateMsg(room, player) {
    const g = gameOf(room);
    const v = g.view(room.engine, player.seat);
    const ros = roster(room);
    g.decorate(v, ros);
    v.roster = ros;
    v.game = room.game;
    const list = timerList(room);
    v.timer = list[0] || null;
    v.timers = list;
    v.type = 'game_state';
    return v;
  }

  function broadcastGame(room) {
    connected(room).forEach(function (p) { sendTo(p.conn, gameStateMsg(room, p)); });
  }

  function broadcast(room, msg) {
    connected(room).forEach(function (p) { sendTo(p.conn, msg); });
  }

  // ---------- timers (server is the only clock) ----------

  function clearGameTimer(room) {
    Object.keys(room.timers).forEach(function (k) { clearTimer(room.timers[k].handle); });
    room.timers = {};
    room.timerOrder = [];
  }

  // Keep exactly the countdowns the game wants: same key = same running clock, new key = restart.
  function scheduleTimer(room) {
    if (room.dead || !room.engine) { clearGameTimer(room); return; }
    // the roster lets a game hurry the turn of someone who is away, or pause when nobody is here
    const want = gameOf(room).timers(room.engine, roster(room));
    const wantKinds = {};
    want.forEach(function (w) { wantKinds[w.kind] = w; });
    Object.keys(room.timers).forEach(function (k) {
      if (!wantKinds[k] || wantKinds[k].key !== room.timers[k].key) {
        clearTimer(room.timers[k].handle);
        delete room.timers[k];
      }
    });
    room.timerOrder = want.map(function (w) { return w.kind; });
    want.forEach(function (w) {
      if (room.timers[w.kind]) return;
      const timer = { key: w.key, kind: w.kind, endsAt: now() + w.seconds * 1000, handle: null };
      timer.handle = setTimer(function () {
        if (room.timers[w.kind] !== timer) return;
        delete room.timers[w.kind];
        const r = gameOf(room).timeout(room.engine, w.kind);
        if (r.error) { scheduleTimer(room); return; }
        commit(room, r);
      }, w.seconds * 1000);
      room.timers[w.kind] = timer;
    });
  }

  // ---------- applying an engine result ----------

  function commit(room, result) {
    const g = gameOf(room);
    room.engine = result.state;
    result.events.forEach(function (ev) { broadcast(room, g.messageFor(ev)); });
    (result.privates || []).forEach(function (pv) {
      const p = room.players.find(function (x) { return x.seat === pv.playerId; });
      if (p && p.conn) {
        sendTo(p.conn, { type: 'private_card', reason: pv.reason, seconds: pv.seconds, reveals: pv.reveals });
      }
    });
    scheduleTimer(room);
    broadcastGame(room);
  }

  // ---------- room lifecycle ----------

  function touchIdle(room) {
    if (room.dead) return;
    if (connected(room).length > 0) {
      if (room.idle) { clearTimer(room.idle); room.idle = null; }
    } else if (!room.idle) {
      room.idle = setTimer(function () { destroy(room); }, CONFIG.ROOM_IDLE_MINUTES * 60 * 1000);
    }
  }

  function destroy(room) {
    room.dead = true; // late socket-close events must not create new timers
    clearGameTimer(room);
    if (room.idle) clearTimer(room.idle);
    room.players.forEach(function (p) { if (p.graceTimer) clearTimer(p.graceTimer); });
    rooms.delete(room.code);
  }

  function migrateHost(room) {
    const cur = room.players.find(function (p) { return p.seat === room.hostSeat; });
    if (cur && cur.conn) return;
    const next = connected(room)[0]; // players[] is in join order: oldest connected player
    if (next) room.hostSeat = next.seat;
  }

  function attach(room, player, conn) {
    if (player.conn && player.conn !== conn) {
      const old = player.conn;
      player.conn = null; // detach first so the old socket's close event is ignored
      old.room = null;
      old.send({ type: 'error', message: 'تم فتح اللعبة من جهاز أو صفحة أخرى.' });
      old.close();
    }
    if (player.graceTimer) { clearTimer(player.graceTimer); player.graceTimer = null; }
    player.conn = conn;
    conn.room = room;
    touchIdle(room);
    sendTo(conn, { type: 'joined', code: room.code, playerId: player.secret, you: player.seat, game: room.game });
  }

  function addPlayer(room, name, bot) {
    room.seq += 1;
    const player = {
      seat: 'p' + room.seq, secret: crypto.randomUUID(), name: name, conn: null, graceTimer: null, bot: !!bot,
    };
    // games with pieces: everybody starts with the first free one and may change it in the lobby
    const tokens = gameOf(room).tokens;
    if (tokens) {
      const used = room.players.map(function (p) { return p.token; });
      player.token = tokens.find(function (t) { return used.indexOf(t) < 0; }) || null;
    }
    room.players.push(player);
    return player;
  }

  // ---------- message handlers ----------

  const handlers = {};

  handlers.create_room = function (conn, m) {
    if (conn.room) return err(conn, MSG.alreadyIn);
    const name = cleanName(m.name);
    if (!name) return err(conn, MSG.nameRequired);
    const game = m.game === undefined ? 'screw' : m.game;
    if (typeof game !== 'string' || !Object.prototype.hasOwnProperty.call(GAMES, game)) return err(conn, MSG.unknownGame);
    if (rooms.size >= CONFIG.MAX_ROOMS) return err(conn, MSG.serverFull, 'SERVER_FULL');
    forgetOldClosed();
    const room = {
      code: newCode(), game: game, hostSeat: null, players: [], seq: 0, engine: null,
      timers: {}, timerOrder: [], idle: null,
    };
    rooms.set(room.code, room);
    const player = addPlayer(room, name);
    room.hostSeat = player.seat;
    attach(room, player, conn);
    broadcastRoom(room);
  };

  handlers.join_room = function (conn, m) {
    if (conn.room) return err(conn, MSG.alreadyIn);
    const code = typeof m.code === 'string' ? m.code.trim().toUpperCase() : '';
    const room = rooms.get(code);
    if (!room) {
      forgetOldClosed();
      const c = closedRooms.get(code);
      return c ? err(conn, c.text, 'ROOM_CLOSED') : err(conn, MSG.noRoom, 'NO_ROOM');
    }

    // Reconnection: the secret playerId identifies a returning player.
    if (typeof m.playerId === 'string') {
      const back = room.players.find(function (p) { return p.secret === m.playerId; });
      if (back) {
        attach(room, back, conn);
        migrateHost(room);
        broadcastRoom(room);
        if (started(room)) {
          scheduleTimer(room); // back from away: the normal turn clock again
          sendTo(conn, gameStateMsg(room, back));
          broadcastGame(room); // others see "connected" again
        }
        return;
      }
    }
    if (started(room)) return err(conn, MSG.started);
    if (room.players.length >= gameOf(room).maxPlayers) return err(conn, MSG.full);
    const name = cleanName(m.name);
    if (!name) return err(conn, MSG.nameRequired);
    const taken = room.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
    if (taken) return err(conn, MSG.nameTaken);
    const player = addPlayer(room, name);
    attach(room, player, conn);
    migrateHost(room);
    broadcastRoom(room);
  };

  // lobby only: pick a piece (games that have pieces), one per player in the room
  handlers.set_token = function (conn, m) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    if (started(room)) return err(conn, MSG.alreadyStarted);
    const tokens = gameOf(room).tokens;
    if (!tokens || typeof m.token !== 'string' || tokens.indexOf(m.token) < 0) return err(conn, MSG.badToken);
    const me = byConn(room, conn);
    const holder = room.players.find(function (p) { return p !== me && p.token === m.token; });
    if (holder && !holder.bot) return err(conn, MSG.tokenTaken);
    if (holder) holder.token = me.token; // a computer player just swaps with you
    me.token = m.token;
    broadcastRoom(room);
  };

  // lobby only, host only: computer players for games that support them (they roll on a short timer)
  function hostInLobby(conn) {
    const room = conn.room;
    if (!room) { err(conn, MSG.notIn); return null; }
    if (byConn(room, conn).seat !== room.hostSeat) { err(conn, MSG.hostOnly); return null; }
    if (started(room)) { err(conn, MSG.alreadyStarted); return null; }
    if (!gameOf(room).bots) { err(conn, MSG.noBots); return null; }
    return room;
  }

  handlers.add_bot = function (conn) {
    const room = hostInLobby(conn);
    if (!room) return;
    if (room.players.length >= gameOf(room).maxPlayers) return err(conn, MSG.full);
    const base = gameOf(room).botName || 'كمبيوتر';
    let n = 1;
    const taken = function (name) { return room.players.some(function (p) { return p.name === name; }); };
    while (taken(base + ' ' + n)) n += 1;
    addPlayer(room, base + ' ' + n, true);
    broadcastRoom(room);
  };

  handlers.remove_bot = function (conn, m) {
    const room = hostInLobby(conn);
    if (!room) return;
    const bot = room.players.find(function (p) { return p.bot && p.seat === m.id; });
    if (!bot) return err(conn, MSG.noBot);
    room.players = room.players.filter(function (p) { return p !== bot; });
    broadcastRoom(room);
  };

  // lobby only, host only: the host's choices, shown to everyone before the start
  handlers.set_options = function (conn, m) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    if (byConn(room, conn).seat !== room.hostSeat) return err(conn, MSG.hostOnly);
    if (started(room)) return err(conn, MSG.alreadyStarted);
    const g = gameOf(room);
    if (!g.startOptions) return err(conn, MSG.noOptions);
    const options = g.startOptions(m);
    if (g.checkOptions) {
      const e = g.checkOptions(options);
      if (e) return err(conn, e);
    }
    room.options = options;
    broadcastRoom(room);
  };

  // a quick emoji for everyone in the room (lobby or game), at most one per player per cooldown
  handlers.react = function (conn, m) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    if (CONFIG.REACTIONS.indexOf(m.id) < 0) return err(conn, MSG.badReaction);
    const me = byConn(room, conn);
    const t = now();
    if (me.lastReact && t - me.lastReact < CONFIG.REACTION_COOLDOWN_MS) return; // too fast: silently dropped
    me.lastReact = t;
    broadcast(room, { type: 'reaction', from: me.seat, id: m.id });
  };

  // a private voice call: offers, answers and network candidates go to the other players in the room as they are;
  // the sound itself flows directly between the browsers (WebRTC), never through the server
  handlers.rtc = function (conn, m) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    if (!gameOf(room).voice) return err(conn, MSG.noVoice);
    if (!m.data || typeof m.data !== 'object' || typeof m.data.kind !== 'string') return err(conn, MSG.badMessage);
    const me = byConn(room, conn);
    const msg = { type: 'rtc', from: me.seat, data: m.data };
    room.players.forEach(function (p) { if (p !== me && p.conn) sendTo(p.conn, msg); });
  };

  handlers.start_game = function (conn, m) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    const me = byConn(room, conn);
    if (me.seat !== room.hostSeat) return err(conn, MSG.hostOnly);
    if (started(room)) return err(conn, MSG.alreadyStarted);
    // only players who are actually here take part
    room.players = room.players.filter(function (p) {
      if (!p.conn && p.graceTimer) clearTimer(p.graceTimer);
      return !!p.conn || p.bot;
    });
    if (room.players.length < gameOf(room).minPlayers) return err(conn, MSG.needPlayers);
    const game = gameOf(room);
    // host options (e.g. number of rounds): the adapter picks only what it understands.
    // Sent with start_game, or chosen earlier in the lobby with set_options.
    let options;
    if (game.startOptions) options = m.options === undefined && room.options ? room.options : game.startOptions(m);
    const bots = room.players.filter(function (p) { return p.bot; }).map(function (p) { return p.seat; });
    const g = game.create(room.players.map(function (p) { return p.seat; }), options, { bots: bots });
    if (g.error) return err(conn, g.error);
    commit(room, { state: g.state, events: g.events || [], privates: [] });
    broadcastRoom(room);
  };

  // host-only actions that belong to a particular game (next round, new game, end early)
  function hostAction(name) {
    return function (conn) {
      const room = conn.room;
      if (!room) return err(conn, MSG.notIn);
      const me = byConn(room, conn);
      if (me.seat !== room.hostSeat) return err(conn, MSG.hostOnly);
      if (!started(room)) return err(conn, MSG.notStarted);
      const fn = gameOf(room).host[name];
      if (!fn) return err(conn, MSG.wrongPhase);
      const r = fn(room.engine, me.seat);
      if (r.error) return err(conn, r.error);
      commit(room, { state: r.state, events: r.events || [], privates: r.privates || [] });
    };
  }
  handlers.next_round = hostAction('next_round');
  handlers.new_game = hostAction('new_game');
  handlers.end_game = hostAction('end_game');

  // the host ends the room for everyone (lobby or game): all go back to the home screen and the code stops working
  handlers.close_room = function (conn) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    const me = byConn(room, conn);
    if (me.seat !== room.hostSeat) return err(conn, MSG.hostOnly);
    const text = closedText(me.name);
    broadcast(room, { type: 'room_closed', by: me.seat, name: me.name, text: text });
    room.players.forEach(function (p) {
      if (p.conn) { p.conn.room = null; p.conn = null; } // their sockets stay open for a new room
    });
    forgetOldClosed();
    closedRooms.set(room.code, { at: now(), text: text });
    destroy(room);
  };

  // anyone leaves for good: in the lobby the seat is freed at once; in a game the seat stays and is played for them
  handlers.leave_room = function (conn) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    const me = byConn(room, conn);
    conn.room = null;
    me.conn = null;
    if (me.graceTimer) { clearTimer(me.graceTimer); me.graceTimer = null; }
    sendTo(conn, { type: 'left_room' });
    if (!started(room)) room.players = room.players.filter(function (p) { return p !== me; });
    migrateHost(room);
    broadcast(room, { type: 'player_left', id: me.seat, name: me.name });
    touchIdle(room);
    broadcastRoom(room);
    if (started(room)) {
      scheduleTimer(room); // their turns now come on the short "away" clock
      broadcastGame(room);
    }
  };

  // in-game actions: every game's action names are routed here, then checked against the room's game
  const allActions = {};
  Object.keys(GAMES).forEach(function (id) { GAMES[id].actions.forEach(function (t) { allActions[t] = true; }); });
  Object.keys(allActions).forEach(function (type) {
    handlers[type] = function (conn, m) {
      const room = conn.room;
      if (!room) return err(conn, MSG.notIn);
      const g = gameOf(room);
      if (g.actions.indexOf(type) < 0) return err(conn, MSG.wrongGame);
      if (!started(room)) return err(conn, MSG.notStarted);
      const me = byConn(room, conn);
      const action = {};
      g.fields.forEach(function (f) { if (m[f] !== undefined) action[f] = m[f]; });
      const r = g.act(room.engine, me.seat, action);
      if (r.error) return err(conn, r.error);
      commit(room, r);
    };
  });

  function handle(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' ||
        !Object.prototype.hasOwnProperty.call(handlers, msg.type)) {
      return err(conn, MSG.badMessage);
    }
    try {
      handlers[msg.type](conn, msg);
    } catch (e) {
      console.error('handler error', msg.type, e);
      err(conn, 'حدث خطأ غير متوقع. حاول مرة أخرى.');
    }
  }

  function close(conn) {
    const room = conn.room;
    if (!room) return;
    const p = byConn(room, conn);
    conn.room = null;
    if (!p) return;
    p.conn = null;
    migrateHost(room);
    if (!started(room)) {
      // lobby: a dropped phone gets a short grace period, then the seat is freed
      if (!room.dead) p.graceTimer = setTimer(function () {
        p.graceTimer = null;
        if (p.conn || started(room)) return;
        room.players = room.players.filter(function (x) { return x !== p; });
        migrateHost(room);
        broadcastRoom(room);
      }, CONFIG.LOBBY_GRACE_SECONDS * 1000);
    }
    touchIdle(room);
    broadcastRoom(room);
    if (started(room)) {
      scheduleTimer(room); // a game may hurry or pause turns while someone is away
      broadcastGame(room);
    }
  }

  // Stop every timer (used on server shutdown and in tests).
  function shutdown() {
    Array.from(rooms.values()).forEach(destroy);
  }

  return { handle, close, rooms, shutdown };
}

module.exports = { createRooms };
