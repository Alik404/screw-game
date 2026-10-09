// Rooms, players, timers and message routing. Independent of the network layer:
// a "conn" is any object with send(obj) and close(). Timers are injectable for tests.
const crypto = require('node:crypto');
const CONFIG = require('./config');
const E = require('./engine');

const GAME_ACTIONS = [
  'ready', 'draw', 'swap_drawn', 'discard_drawn', 'take_discard', 'match',
  'use_ability', 'skip_ability', 'call_screw',
];
// The only fields copied from a client message into an engine action.
const ACTION_FIELDS = ['type', 'slot', 'targetPlayerId', 'targetSlot', 'mode', 'slots', 'picks'];

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
};

function createRooms(opts) {
  opts = opts || {};
  const setTimer = opts.setTimer || setTimeout;
  const clearTimer = opts.clearTimer || clearTimeout;
  const now = opts.now || Date.now;
  const rooms = new Map();

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
      if (!rooms.has(code)) return code;
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

  // ---------- outgoing ----------

  function roomStateMsg(room) {
    return {
      type: 'room_state',
      code: room.code,
      hostId: room.hostSeat,
      phase: started(room) ? 'playing' : 'lobby',
      players: room.players.map(function (p) {
        return { id: p.seat, name: p.name, connected: !!p.conn, isHost: p.seat === room.hostSeat };
      }),
    };
  }

  function broadcastRoom(room) {
    const msg = roomStateMsg(room);
    connected(room).forEach(function (p) { sendTo(p.conn, msg); });
  }

  function timerInfo(room) {
    if (!room.timer) return null;
    return { kind: room.timer.kind, endsAt: room.timer.endsAt, now: now() };
  }

  // Each player gets their own personalised copy; the secret playerId is never included.
  function gameStateMsg(room, player) {
    const v = E.viewFor(room.engine, player.seat);
    v.players = v.players.map(function (vp) {
      const rp = room.players.find(function (p) { return p.seat === vp.id; });
      vp.name = rp.name;
      vp.connected = !!rp.conn;
      vp.isHost = rp.seat === room.hostSeat;
      return vp;
    });
    v.timer = timerInfo(room);
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
    if (room.timer) clearTimer(room.timer.handle);
    room.timer = null;
  }

  function scheduleTimer(room) {
    const s = room.engine;
    let kind = null;
    let key = null;
    let seconds = 0;
    if (s && s.phase === 'peek') {
      kind = 'peek'; key = 'peek:' + s.round; seconds = CONFIG.INITIAL_PEEK_SECONDS;
    } else if (s && s.phase === 'turn') {
      kind = 'turn'; key = 'turn:' + s.round + ':' + s.turnCount; seconds = CONFIG.TURN_SECONDS;
    }
    if (!key || room.dead) { clearGameTimer(room); return; }
    if (room.timer && room.timer.key === key) return; // same turn: keep the running clock
    clearGameTimer(room);
    const timer = { key: key, kind: kind, endsAt: now() + seconds * 1000, handle: null };
    timer.handle = setTimer(function () {
      if (room.timer !== timer) return;
      room.timer = null;
      const r = kind === 'peek' ? E.forceStartPlay(room.engine) : E.autoPlay(room.engine);
      if (r.error) { scheduleTimer(room); return; }
      commit(room, r);
    }, seconds * 1000);
    room.timer = timer;
  }

  // ---------- applying an engine result ----------

  function commit(room, result) {
    room.engine = result.state;
    result.events.forEach(function (ev) {
      if (ev.type === 'round_end') {
        const r = ev.result;
        broadcast(room, {
          type: 'round_result', round: r.round, hands: r.hands, sums: r.sums, scores: r.scores,
          totals: r.totals, screwCaller: r.screwCaller, minIds: r.minIds, multiplied: r.multiplied,
        });
      } else if (ev.type === 'game_over') {
        broadcast(room, { type: 'game_over', totals: ev.totals, winnerIds: ev.winnerIds });
      } else {
        broadcast(room, { type: 'event', event: ev });
      }
    });
    result.privates.forEach(function (pv) {
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
    sendTo(conn, { type: 'joined', code: room.code, playerId: player.secret, you: player.seat });
  }

  function addPlayer(room, name) {
    room.seq += 1;
    const player = {
      seat: 'p' + room.seq, secret: crypto.randomUUID(), name: name, conn: null, graceTimer: null,
    };
    room.players.push(player);
    return player;
  }

  // ---------- message handlers ----------

  const handlers = {};

  handlers.create_room = function (conn, m) {
    if (conn.room) return err(conn, MSG.alreadyIn);
    const name = cleanName(m.name);
    if (!name) return err(conn, MSG.nameRequired);
    if (rooms.size >= CONFIG.MAX_ROOMS) return err(conn, MSG.serverFull, 'SERVER_FULL');
    const room = {
      code: newCode(), hostSeat: null, players: [], seq: 0, engine: null, timer: null, idle: null,
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
    if (!room) return err(conn, MSG.noRoom, 'NO_ROOM');

    // Reconnection: the secret playerId identifies a returning player.
    if (typeof m.playerId === 'string') {
      const back = room.players.find(function (p) { return p.secret === m.playerId; });
      if (back) {
        attach(room, back, conn);
        migrateHost(room);
        broadcastRoom(room);
        if (started(room)) {
          sendTo(conn, gameStateMsg(room, back));
          broadcastGame(room); // others see "connected" again
        }
        return;
      }
    }
    if (started(room)) return err(conn, MSG.started);
    if (room.players.length >= CONFIG.MAX_PLAYERS) return err(conn, MSG.full);
    const name = cleanName(m.name);
    if (!name) return err(conn, MSG.nameRequired);
    const taken = room.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
    if (taken) return err(conn, MSG.nameTaken);
    const player = addPlayer(room, name);
    attach(room, player, conn);
    migrateHost(room);
    broadcastRoom(room);
  };

  handlers.start_game = function (conn) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    const me = byConn(room, conn);
    if (me.seat !== room.hostSeat) return err(conn, MSG.hostOnly);
    if (started(room)) return err(conn, MSG.alreadyStarted);
    // only players who are actually here take part
    room.players = room.players.filter(function (p) {
      if (!p.conn && p.graceTimer) clearTimer(p.graceTimer);
      return !!p.conn;
    });
    if (room.players.length < CONFIG.MIN_PLAYERS) return err(conn, MSG.needPlayers);
    const g = E.createGame(room.players.map(function (p) { return p.seat; }));
    if (g.error) return err(conn, g.error);
    commit(room, { state: g.state, events: [], privates: [] });
    broadcastRoom(room);
  };

  handlers.next_round = function (conn) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    const me = byConn(room, conn);
    if (me.seat !== room.hostSeat) return err(conn, MSG.hostOnly);
    if (!started(room)) return err(conn, MSG.notStarted);
    const r = E.act(room.engine, me.seat, { type: 'next_round' });
    if (r.error) return err(conn, r.error);
    commit(room, r);
  };

  handlers.new_game = function (conn) {
    const room = conn.room;
    if (!room) return err(conn, MSG.notIn);
    const me = byConn(room, conn);
    if (me.seat !== room.hostSeat) return err(conn, MSG.hostOnly);
    if (!started(room) || room.engine.phase !== 'gameOver') return err(conn, E.ERR.wrongPhase);
    const g = E.newGame(room.engine);
    if (g.error) return err(conn, g.error);
    commit(room, { state: g.state, events: [], privates: [] });
  };

  GAME_ACTIONS.forEach(function (type) {
    handlers[type] = function (conn, m) {
      const room = conn.room;
      if (!room) return err(conn, MSG.notIn);
      if (!started(room)) return err(conn, MSG.notStarted);
      const me = byConn(room, conn);
      const action = {};
      ACTION_FIELDS.forEach(function (f) { if (m[f] !== undefined) action[f] = m[f]; });
      const r = E.act(room.engine, me.seat, action);
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
    if (started(room)) broadcastGame(room);
  }

  // Stop every timer (used on server shutdown and in tests).
  function shutdown() {
    Array.from(rooms.values()).forEach(destroy);
  }

  return { handle, close, rooms, shutdown };
}

module.exports = { createRooms };
