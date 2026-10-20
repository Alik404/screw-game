const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../server/config');
const { createRooms } = require('../server/rooms');

// ---------- harness: fake clock + fake connections ----------

function harness() {
  let t = 1000000;
  const timers = [];
  let nextId = 1;
  const clock = {
    now: () => t,
    setTimer: (fn, ms) => { const x = { id: nextId++, at: t + ms, fn }; timers.push(x); return x.id; },
    clearTimer: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > end) break;
        const x = timers.shift();
        t = x.at;
        x.fn();
      }
      t = end;
    },
    pending: () => timers.length,
  };
  const R = createRooms({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now });
  function conn() {
    const c = {
      room: null, inbox: [], closed: false,
      send(m) { c.inbox.push(JSON.parse(JSON.stringify(m))); }, // like the wire: plain JSON
      close() { c.closed = true; },
      last(type) { return [...c.inbox].reverse().find((m) => m.type === type); },
      all(type) { return c.inbox.filter((m) => m.type === type); },
      say(m) { R.handle(c, m); return c; },
      drop() { R.close(c); },
    };
    return c;
  }
  return { R, clock, conn };
}

function lobby(n) {
  const h = harness();
  const host = h.conn().say({ type: 'create_room', name: 'أحمد' });
  const code = host.last('joined').code;
  const others = [];
  for (let i = 1; i < n; i++) {
    others.push(h.conn().say({ type: 'join_room', code, name: 'لاعب' + i }));
  }
  return { h, host, others, code, all: [host, ...others] };
}

function started(n) {
  const L = lobby(n);
  L.host.say({ type: 'start_game' });
  return L;
}

const currentConn = (L) => {
  const s = L.host.last('game_state');
  const id = s.currentPlayerId;
  return L.all.find((c) => c.last('joined').you === id);
};

// ---------- rooms ----------

test('create_room: 4-letter code without I/L/O, creator is host, secret id returned', () => {
  const h = harness();
  const c = h.conn().say({ type: 'create_room', name: 'أحمد' });
  const j = c.last('joined');
  assert.match(j.code, /^[A-HJKMNP-Z]{4}$/);
  assert.ok(j.playerId.length > 20);
  const rs = c.last('room_state');
  assert.equal(rs.hostId, j.you);
  assert.equal(rs.phase, 'lobby');
  assert.equal(rs.players.length, 1);
  assert.equal(JSON.stringify(rs).includes(j.playerId), false); // secret never broadcast
});

test('create_room: name is required, trimmed and length-limited', () => {
  const h = harness();
  assert.match(h.conn().say({ type: 'create_room', name: '   ' }).last('error').message, /اسمك/);
  assert.match(h.conn().say({ type: 'create_room' }).last('error').message, /اسمك/);
  const c = h.conn().say({ type: 'create_room', name: '  ' + 'ع'.repeat(50) + '  ' });
  assert.equal(c.last('room_state').players[0].name.length, CONFIG.NAME_MAX_LENGTH);
  const d = h.conn().say({ type: 'create_room', name: '<b>x</b>' });
  assert.equal(d.last('room_state').players[0].name, 'bx/b');
});

test('join_room: by code (case-insensitive), everyone sees the updated list', () => {
  const { host, others, code } = lobby(1);
  const guest = others.length ? others[0] : null;
  assert.equal(guest, null);
  const h2 = harness();
  const hs = h2.conn().say({ type: 'create_room', name: 'أحمد' });
  const g = h2.conn().say({ type: 'join_room', code: hs.last('joined').code.toLowerCase(), name: 'سارة' });
  assert.equal(g.last('room_state').players.length, 2);
  assert.equal(hs.last('room_state').players.length, 2);
  assert.ok(code);
  assert.ok(host);
});

test('join_room errors are Arabic: unknown code, duplicate name, full room, no name', () => {
  const L = lobby(CONFIG.MAX_PLAYERS);
  const h = L.h;
  assert.equal(h.conn().say({ type: 'join_room', code: 'ZZZZ', name: 'x' }).last('error').message,
    'الغرفة غير موجودة. تأكد من الكود.');
  assert.match(h.conn().say({ type: 'join_room', code: L.code, name: 'جديد' }).last('error').message, /ممتلئة/);
  const L2 = lobby(2);
  assert.match(L2.h.conn().say({ type: 'join_room', code: L2.code, name: 'أحمد' }).last('error').message, /مستخدم/);
  assert.match(L2.h.conn().say({ type: 'join_room', code: L2.code }).last('error').message, /اسمك/);
});

test('bad / unknown / oversized-shape messages are rejected without side effects', () => {
  const h = harness();
  const c = h.conn();
  ['x', null, 5, {}, { type: 5 }, { type: 'hack' }, { type: '__proto__' }, { type: 'constructor' }].forEach((m) => {
    c.say(m);
    assert.equal(c.last('error').message, 'رسالة غير صالحة.');
  });
  assert.equal(h.R.rooms.size, 0);
  assert.match(c.say({ type: 'draw' }).last('error').message, /غرفة/);
  assert.match(c.say({ type: 'start_game' }).last('error').message, /غرفة/);
});

test('start_game: host only, needs 2 players, then everybody gets a personal game_state', () => {
  const L = lobby(2);
  const guest = L.others[0];
  assert.match(guest.say({ type: 'start_game' }).last('error').message, /للمضيف/);
  const solo = lobby(1);
  assert.match(solo.host.say({ type: 'start_game' }).last('error').message, /لاعبَين/);
  L.host.say({ type: 'start_game' });
  const a = L.host.last('game_state');
  const b = guest.last('game_state');
  assert.equal(a.phase, 'peek');
  assert.equal(a.you, L.host.last('joined').you);
  assert.equal(b.you, guest.last('joined').you);
  assert.equal(L.host.last('room_state').phase, 'playing');
  assert.match(L.host.say({ type: 'start_game' }).last('error').message, /بدأت/);
});

test('join after the game started is refused, but a returning player is let back in', () => {
  const L = started(3);
  const stranger = L.h.conn().say({ type: 'join_room', code: L.code, name: 'غريب' });
  assert.match(stranger.last('error').message, /بدأت/);
  const guest = L.others[0];
  const { playerId, you } = guest.last('joined');
  guest.drop();
  assert.equal(L.host.last('game_state').players.find((p) => p.id === you).connected, false);
  const back = L.h.conn().say({ type: 'join_room', code: L.code, name: 'x', playerId });
  assert.equal(back.last('joined').you, you);
  assert.equal(back.last('game_state').you, you);
  assert.equal(L.host.last('game_state').players.find((p) => p.id === you).connected, true);
  // wrong secret does not get in
  const fake = L.h.conn().say({ type: 'join_room', code: L.code, name: 'x', playerId: 'nope' });
  assert.match(fake.last('error').message, /بدأت/);
});

test('reconnect keeps the same cards (handIds) and opening peek if still in it', () => {
  const L = started(2);
  const g = L.others[0];
  const before = g.last('game_state');
  const { playerId } = g.last('joined');
  g.drop();
  const back = L.h.conn().say({ type: 'join_room', code: L.code, name: 'x', playerId });
  const after = back.last('game_state');
  const mine = (s) => s.players.find((p) => p.id === s.you).hand;
  assert.deepEqual(mine(after), mine(before));
  assert.ok(!mine(after)[0].hidden); // still in the peek phase: sees the two right-most cards again
});

test('a second tab with the same playerId replaces the first connection', () => {
  const L = lobby(2);
  const guest = L.others[0];
  const { playerId, you } = guest.last('joined');
  const tab2 = L.h.conn().say({ type: 'join_room', code: L.code, name: 'x', playerId });
  assert.equal(tab2.last('joined').you, you);
  assert.ok(guest.closed);
  guest.drop(); // late close event of the old socket must not disconnect the new one
  assert.equal(L.host.last('room_state').players.find((p) => p.id === you).connected, true);
});

test('host leaves: host role moves to the oldest connected player', () => {
  const L = lobby(3);
  const hostId = L.host.last('joined').you;
  L.host.drop();
  const rs = L.others[0].last('room_state');
  assert.equal(rs.hostId, L.others[0].last('joined').you);
  assert.notEqual(rs.hostId, hostId);
  // the original host returning does not take the role back
  const { playerId } = L.host.last('joined');
  const back = L.h.conn().say({ type: 'join_room', code: L.code, name: 'x', playerId });
  assert.equal(back.last('room_state').hostId, L.others[0].last('joined').you);
  // new host can start
  L.others[0].say({ type: 'start_game' });
  assert.equal(L.others[0].last('game_state').phase, 'peek');
});

test('lobby: a disconnected player is removed after the grace period, not before', () => {
  const L = lobby(3);
  const gone = L.others[1];
  const goneId = gone.last('joined').you;
  gone.drop();
  L.h.clock.advance((CONFIG.LOBBY_GRACE_SECONDS - 1) * 1000);
  assert.ok(L.host.last('room_state').players.some((p) => p.id === goneId));
  L.h.clock.advance(2000);
  assert.ok(!L.host.last('room_state').players.some((p) => p.id === goneId));
});

test('start_game leaves out players who are not connected', () => {
  const L = lobby(3);
  L.others[1].drop();
  L.host.say({ type: 'start_game' });
  assert.equal(L.host.last('game_state').players.length, 2);
});

test('room is deleted 30 minutes after the last player disconnects; a return cancels it', () => {
  const L = lobby(2);
  const { playerId } = L.others[0].last('joined');
  L.host.drop();
  L.others[0].drop();
  L.h.clock.advance((CONFIG.ROOM_IDLE_MINUTES - 1) * 60 * 1000);
  assert.equal(L.h.R.rooms.size, 1);
  const back = L.h.conn().say({ type: 'join_room', code: L.code, name: 'x', playerId });
  assert.ok(back.last('joined'));
  L.h.clock.advance(CONFIG.ROOM_IDLE_MINUTES * 60 * 1000);
  assert.equal(L.h.R.rooms.size, 1);
  back.drop();
  L.h.clock.advance(CONFIG.ROOM_IDLE_MINUTES * 60 * 1000 + 1000);
  assert.equal(L.h.R.rooms.size, 0);
  assert.match(L.h.conn().say({ type: 'join_room', code: L.code, name: 'y' }).last('error').message, /غير موجودة/);
  assert.equal(L.h.clock.pending(), 0); // nothing left running
});

// ---------- game flow through rooms ----------

test('only the current player can act; errors are sent only to the sender', () => {
  const L = started(2);
  L.all.forEach((c) => c.say({ type: 'ready' }));
  const cur = currentConn(L);
  const other = L.all.find((c) => c !== cur);
  const before = cur.inbox.length;
  other.say({ type: 'draw' });
  assert.match(other.last('error').message, /ليس دورك/);
  assert.equal(cur.inbox.length, before);
  cur.say({ type: 'draw' });
  assert.equal(cur.last('game_state').stage, 'drawn');
  assert.ok(cur.last('game_state').drawn);
  assert.equal(other.last('game_state').drawn, null);
  assert.equal(cur.all('private_card').length, 1);
  assert.equal(other.all('private_card').length, 0);
});

test('client cannot smuggle engine-only fields or unknown actions', () => {
  const L = started(2);
  L.all.forEach((c) => c.say({ type: 'ready' }));
  const cur = currentConn(L);
  cur.say({ type: 'next_round' });
  assert.match(cur.last('error').message, /./);
  cur.say({ type: 'forceStartPlay' });
  assert.equal(cur.last('error').message, 'رسالة غير صالحة.');
  cur.say({ type: 'draw', slot: 0, drawn: { type: 'plus20' }, deck: [] });
  assert.equal(cur.last('game_state').stage, 'drawn');
});

test('everyone ready ends the peek early and starts the turn timer', () => {
  const L = started(2);
  assert.equal(L.host.last('game_state').timer.kind, 'peek');
  L.all.forEach((c) => c.say({ type: 'ready' }));
  const s = L.host.last('game_state');
  assert.equal(s.phase, 'turn');
  assert.equal(s.timer.kind, 'turn');
  assert.equal(s.timer.endsAt - s.timer.now, CONFIG.TURN_SECONDS * 1000);
});

test('peek timer: after INITIAL_PEEK_SECONDS the game starts without waiting for ready', () => {
  const L = started(3);
  L.h.clock.advance(CONFIG.INITIAL_PEEK_SECONDS * 1000 - 1);
  assert.equal(L.host.last('game_state').phase, 'peek');
  L.h.clock.advance(2);
  assert.equal(L.host.last('game_state').phase, 'turn');
  // the cards are hidden again for everyone
  L.all.forEach((c) => {
    const s = c.last('game_state');
    assert.ok(s.players.every((p) => p.hand.every((x) => x.hidden)));
  });
});

test('turn timer: auto-plays the current player after TURN_SECONDS and moves on', () => {
  const L = started(3);
  L.all.forEach((c) => c.say({ type: 'ready' }));
  const first = L.host.last('game_state').currentPlayerId;
  L.h.clock.advance(CONFIG.TURN_SECONDS * 1000 - 1);
  assert.equal(L.host.last('game_state').currentPlayerId, first);
  L.h.clock.advance(2);
  const s = L.host.last('game_state');
  assert.notEqual(s.currentPlayerId, first);
  assert.equal(s.timer.endsAt - s.timer.now, CONFIG.TURN_SECONDS * 1000);
  assert.ok(L.host.all('event').some((e) => e.event.type === 'discard_drawn' || e.event.type === 'draw'));
});

test('acting inside a turn does not restart that turn\'s clock', () => {
  const L = started(2);
  L.all.forEach((c) => c.say({ type: 'ready' }));
  const cur = currentConn(L);
  const t0 = cur.last('game_state').timer.endsAt;
  L.h.clock.advance(10000);
  cur.say({ type: 'draw' });
  assert.equal(cur.last('game_state').timer.endsAt, t0);
  L.h.clock.advance(CONFIG.TURN_SECONDS * 1000 - 10000 + 1);
  // time ran out mid-turn (card drawn): server finished the turn for them
  assert.notEqual(L.host.last('game_state').currentPlayerId, cur.last('joined').you);
});

test('a disconnected player is auto-played when their timer ends, game keeps going', () => {
  const L = started(2);
  L.all.forEach((c) => c.say({ type: 'ready' }));
  const cur = currentConn(L);
  const other = L.all.find((c) => c !== cur);
  cur.drop();
  assert.equal(other.last('game_state').players.find((p) => p.id === cur.last('joined').you).connected, false);
  L.h.clock.advance(CONFIG.TURN_SECONDS * 1000 + 1);
  assert.equal(other.last('game_state').currentPlayerId, other.last('joined').you);
});

// plays rounds quickly by timers alone, to reach round/game end through rooms
function playRoundByTimers(L) {
  for (let i = 0; i < 400; i++) {
    const s = L.host.last('game_state');
    if (s.phase === 'roundOver' || s.phase === 'gameOver') return s.phase;
    if (s.screwAllowed) {
      const cur = currentConn(L);
      if (cur) cur.say({ type: 'call_screw' });
      if (L.host.last('game_state').phase === 'turn' && L.host.last('game_state').screwCaller) { /* proceed */ }
    }
    L.h.clock.advance((s.timer ? CONFIG.TURN_SECONDS : 1) * 1000 + 1);
  }
  throw new Error('round did not end');
}

test('full game via rooms: next_round host-only, round_result and game_over messages, new_game', () => {
  const L = started(2);
  L.all.forEach((c) => c.say({ type: 'ready' }));
  for (let round = 1; round <= CONFIG.ROUNDS; round++) {
    const ph = playRoundByTimers(L);
    const rr = L.host.last('round_result');
    assert.equal(rr.round, round);
    assert.equal(Object.keys(rr.hands).length, 2);
    assert.deepEqual(L.others[0].last('round_result'), rr); // everyone gets the same reveal
    if (round < CONFIG.ROUNDS) {
      assert.equal(ph, 'roundOver');
      assert.match(L.others[0].say({ type: 'next_round' }).last('error').message, /للمضيف/);
      L.host.say({ type: 'next_round' });
      assert.equal(L.host.last('game_state').phase, 'peek');
      L.all.forEach((c) => c.say({ type: 'ready' }));
    } else {
      assert.equal(ph, 'gameOver');
      assert.equal(rr.multiplied, true);
    }
  }
  const go = L.host.last('game_over');
  assert.ok(go.winnerIds.length >= 1);
  assert.match(L.others[0].say({ type: 'new_game' }).last('error').message, /للمضيف/);
  L.host.say({ type: 'new_game' });
  assert.equal(L.host.last('game_state').round, 1);
  assert.equal(L.host.last('game_state').phase, 'peek');
});

test('new_game / next_round are refused at the wrong time', () => {
  const L = started(2);
  assert.match(L.host.say({ type: 'new_game' }).last('error').message, /غير متاحة/);
  assert.match(L.host.say({ type: 'next_round' }).last('error').message, /غير متاحة/);
});

// ---------- secrecy audit ----------

// Walk every message a client received and make sure it holds nothing that client may not see.
function audit(conn, L) {
  const me = conn.last('joined').you;
  const secrets = L.all.filter((c) => c !== conn).map((c) => c.last('joined').playerId);
  const wire = JSON.stringify(conn.inbox);
  secrets.forEach((sec) => assert.equal(wire.includes(sec), false, 'other player secret id leaked'));
  assert.equal(wire.includes('"deck"'), false);
  assert.equal(wire.includes('"rng"'), false);
  assert.equal(wire.includes('idRng'), false);

  for (const m of conn.inbox) {
    if (m.type === 'game_state') {
      const over = m.phase === 'roundOver' || m.phase === 'gameOver';
      m.players.forEach((p) => p.hand.forEach((c, slot) => {
        if (c.hidden) { assert.deepEqual(Object.keys(c).sort(), ['handId', 'hidden']); return; }
        const ownPeek = m.phase === 'peek' && p.id === me && slot < CONFIG.INITIAL_PEEK_COUNT;
        assert.ok(over || ownPeek, 'visible card in someone else\'s hand: phase=' + m.phase);
      }));
      if (m.drawn) assert.equal(m.currentPlayerId, me, 'drawn card shown to non-drawer');
    }
    if (m.type === 'event') {
      const e = m.event;
      if (e.type === 'draw') assert.equal(e.card, undefined);
      if (e.type === 'look') assert.equal(JSON.stringify(e).includes('"value"'), false);
      if (e.type === 'swap') assert.equal(JSON.stringify(e).includes('"value"'), false);
      if (e.type === 'penalty') assert.equal(JSON.stringify(e).includes('"value"'), false);
    }
  }
}

test('secrecy: across a whole 2-player and 4-player game, no client ever receives a forbidden card', () => {
  [2, 4].forEach((n) => {
    const L = started(n);
    L.all.forEach((c) => c.say({ type: 'ready' }));
    for (let round = 1; round <= CONFIG.ROUNDS; round++) {
      // some manual play so abilities, matches and swaps flow through the router too
      for (let k = 0; k < 24; k++) {
        const s = L.host.last('game_state');
        if (s.phase !== 'turn') break;
        const cur = currentConn(L);
        if (s.stage === 'start') cur.say({ type: k % 5 === 4 ? 'match' : 'draw', slot: 0 });
        else if (s.stage === 'drawn') cur.say({ type: k % 2 ? 'discard_drawn' : 'swap_drawn', slot: 1 });
        else if (s.stage === 'ability') cur.say({ type: 'skip_ability' });
      }
      if (playRoundByTimers(L) === 'gameOver') break;
      L.host.say({ type: 'next_round' });
      L.all.forEach((c) => c.say({ type: 'ready' }));
    }
    L.all.forEach((c) => audit(c, L));
  });
});

test('secrecy: private_card goes only to its owner and abilities show only positions to others', () => {
  // find a seed-free situation by playing until somebody gets an ability
  for (let attempt = 0; attempt < 40; attempt++) {
    const L = started(3);
    L.all.forEach((c) => c.say({ type: 'ready' }));
    for (let k = 0; k < 30; k++) {
      const s = L.host.last('game_state');
      if (s.phase !== 'turn') break;
      const cur = currentConn(L);
      const me = cur.last('joined').you;
      if (s.stage === 'start') cur.say({ type: 'draw' });
      else if (s.stage === 'drawn') cur.say({ type: 'discard_drawn' });
      else if (s.stage === 'ability') {
        const other = s.players.find((p) => p.id !== me);
        const ab = s.ability;
        const msg = ab === 'peek_own' ? { slot: 0 }
          : ab === 'peek_other' ? { targetPlayerId: other.id, targetSlot: 0 }
          : ab === 'swap' ? { slot: 0, targetPlayerId: other.id, targetSlot: 0 }
          : ab === 'throw' ? { slot: 0 }
          : { mode: 'self', slots: [0, 1] };
        const nPrivBefore = L.all.map((c) => c.all('private_card').length);
        cur.say(Object.assign({ type: 'use_ability' }, msg));
        const looked = ab === 'peek_own' || ab === 'peek_other' || ab === 'peek_all';
        L.all.forEach((c, i) => {
          const gained = c.all('private_card').length - nPrivBefore[i];
          assert.equal(gained, c === cur && looked ? 1 : 0);
        });
        L.all.forEach((c) => audit(c, L));
        if (looked) return; // verified a real look
      }
    }
  }
  assert.fail('never reached a look ability');
});

// ---------- protection limits ----------

test('MAX_ROOMS: creating one room too many is refused with an Arabic error and code', () => {
  const h = harness();
  for (let i = 0; i < CONFIG.MAX_ROOMS; i++) h.conn().say({ type: 'create_room', name: 'p' + i });
  assert.equal(h.R.rooms.size, CONFIG.MAX_ROOMS);
  const extra = h.conn().say({ type: 'create_room', name: 'زائد' });
  assert.equal(extra.last('error').code, 'SERVER_FULL');
  assert.match(extra.last('error').message, /ممتلئ/);
  assert.equal(h.R.rooms.size, CONFIG.MAX_ROOMS);
});

test('unknown room returns code NO_ROOM so the client can explain a lost room', () => {
  const h = harness();
  const e = h.conn().say({ type: 'join_room', code: 'ZZZZ', name: 'x', playerId: 'old-secret' }).last('error');
  assert.equal(e.code, 'NO_ROOM');
});

// ---------- ending and leaving a room ----------

test('close_room: host only; everyone goes home, the code stops working and says why', () => {
  const L = lobby(3);
  const secret = L.others[0].last('joined').playerId;
  L.others[0].say({ type: 'close_room' });
  assert.match(L.others[0].last('error').message, /للمضيف/);
  assert.ok(L.h.R.rooms.has(L.code));

  L.host.say({ type: 'close_room' });
  const host = L.host.last('joined').you;
  L.all.forEach((c) => {
    const m = c.last('room_closed');
    assert.equal(m.by, host);
    assert.equal(m.name, 'أحمد');
    assert.match(m.text, /أحمد/);
    assert.equal(c.room, null);
  });
  assert.equal(L.h.R.rooms.has(L.code), false);
  assert.equal(L.h.clock.pending(), 0, 'no clock left behind');

  // someone who was away comes back with the old seat: told the host ended it
  const late = L.h.conn().say({ type: 'join_room', code: L.code, name: 'لاعب1', playerId: secret }).last('error');
  assert.equal(late.code, 'ROOM_CLOSED');
  assert.match(late.message, /أحمد/);
  // much later the code is simply unknown
  L.h.clock.advance((CONFIG.ROOM_IDLE_MINUTES + 1) * 60 * 1000);
  assert.equal(L.h.conn().say({ type: 'join_room', code: L.code, name: 'x' }).last('error').code, 'NO_ROOM');

  // the same connections can start over, and a late socket close does nothing
  L.others[1].drop();
  L.host.say({ type: 'create_room', name: 'أحمد' });
  assert.notEqual(L.host.last('joined').code, L.code);
});

test('close_room during a game stops every clock, computer players and all', () => {
  const h = harness();
  const host = h.conn().say({ type: 'create_room', name: 'أحمد', game: 'bank' });
  host.say({ type: 'add_bot' }).say({ type: 'start_game' });
  assert.ok(host.last('game_state'));
  assert.ok(h.clock.pending() > 0);
  host.say({ type: 'close_room' });
  assert.equal(h.clock.pending(), 0);
  const n = host.inbox.length;
  h.clock.advance(10 * 60 * 1000);
  assert.equal(host.inbox.length, n, 'nothing arrives after the end');
});

test('leave_room: in the lobby the seat is freed at once; a leaving host hands the room on', () => {
  const L = lobby(3);
  const [a, b] = L.others;
  a.say({ type: 'leave_room' });
  assert.ok(a.last('left_room'));
  assert.equal(a.room, null);
  assert.equal(L.host.last('player_left').name, 'لاعب1');
  assert.equal(L.host.last('room_state').players.length, 2);
  // back in by code, as a new player
  a.say({ type: 'join_room', code: L.code, name: 'لاعب1' });
  assert.equal(L.host.last('room_state').players.length, 3);

  L.host.say({ type: 'leave_room' });
  const rs = b.last('room_state');
  assert.equal(rs.players.length, 2);
  assert.equal(rs.hostId, b.last('joined').you, 'the oldest player still here is the host now');
});

test('leave_room during a game: the seat stays, shown as away, and is played for them', () => {
  const L = started(2);
  const leaver = L.others[0];
  const seat = leaver.last('joined').you;
  leaver.say({ type: 'leave_room' });
  assert.ok(leaver.last('left_room'));
  const gs = L.host.last('game_state');
  assert.equal(gs.roster.find((p) => p.id === seat).connected, false);
  // their turns come on the short "away" clock, and the game moves on
  let played = 0;
  for (let i = 0; i < 200 && played < 3; i++) {
    const g = L.host.last('game_state');
    if (g.phase === 'turn' && g.currentPlayerId === seat) {
      assert.equal(g.timers[0].kind, 'away');
      L.h.clock.advance(CONFIG.AWAY_SECONDS * 1000 + 50);
      assert.notEqual(L.host.last('game_state').currentPlayerId, seat);
      played += 1;
    } else L.h.clock.advance(5 * 1000);
  }
  assert.equal(played, 3);
  // and the one who left can make a new room right away
  leaver.say({ type: 'create_room', name: 'لاعب1' });
  assert.ok(leaver.room);
});
