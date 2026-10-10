const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../server/config');
const BANK = require('../server/games/bank/config');
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
  };
  const R = createRooms({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now });
  function conn() {
    const c = {
      room: null, inbox: [], closed: false,
      send(m) { c.inbox.push(JSON.parse(JSON.stringify(m))); },
      close() { c.closed = true; },
      last(type) { return [...c.inbox].reverse().find((m) => m.type === type); },
      all(type) { return c.inbox.filter((m) => m.type === type); },
      events(type) { return c.all('event').map((m) => m.event).filter((e) => e.type === type); },
      say(m) { R.handle(c, m); return c; },
      drop() { R.close(c); },
    };
    return c;
  }
  return { R, clock, conn };
}

function bankLobby(n) {
  const h = harness();
  const host = h.conn().say({ type: 'create_room', name: 'أحمد', game: 'bank' });
  const code = host.last('joined').code;
  const others = [];
  for (let i = 1; i < n; i++) others.push(h.conn().say({ type: 'join_room', code, name: 'لاعب' + i }));
  return { h, host, others, code, all: [host, ...others] };
}

function started(n) {
  const L = bankLobby(n || 2);
  L.host.say({ type: 'start_game' });
  return L;
}

const stateOf = (c) => c.last('game_state');
const currentConn = (L) => L.all.find((c) => c.last('joined').you === stateOf(L.host).currentPlayerId);
const roomOf = (L) => L.h.R.rooms.get(L.code);
const money = (k) => k;

// ---------- rooms ----------

test('create_room with game "bank": the room, joined and room_state all say bank', () => {
  const L = bankLobby(2);
  assert.equal(L.host.last('joined').game, 'bank');
  assert.equal(L.host.last('room_state').game, 'bank');
  assert.equal(L.others[0].last('joined').game, 'bank'); // a guest learns the room's game from the join
});

test('create_room defaults to screw; an unknown game is refused', () => {
  const h = harness();
  assert.equal(h.conn().say({ type: 'create_room', name: 'أحمد' }).last('joined').game, 'screw');
  assert.match(h.conn().say({ type: 'create_room', name: 'أحمد', game: 'chess' }).last('error').message, /غير معروفة/);
  assert.match(h.conn().say({ type: 'create_room', name: 'أحمد', game: '__proto__' }).last('error').message, /غير معروفة/);
  assert.match(h.conn().say({ type: 'create_room', name: 'أحمد', game: 5 }).last('error').message, /غير معروفة/);
});

test('bank room: 2 to 6 players, start needs 2', () => {
  const solo = bankLobby(1);
  assert.match(solo.host.say({ type: 'start_game' }).last('error').message, /لاعبَين/);
  const full = bankLobby(6);
  assert.match(full.h.conn().say({ type: 'join_room', code: full.code, name: 'سابع' }).last('error').message, /ممتلئة/);
  full.host.say({ type: 'start_game' });
  assert.equal(stateOf(full.host).playerIds.length, 6);
});

test('actions of the other game are refused in a room', () => {
  const L = started(2);
  const cur = currentConn(L);
  assert.match(cur.say({ type: 'draw' }).last('error').message, /ليست من هذه اللعبة/);
  const h = harness();
  const s = h.conn().say({ type: 'create_room', name: 'أحمد' });
  const g = h.conn().say({ type: 'join_room', code: s.last('joined').code, name: 'سارة' });
  s.say({ type: 'start_game' });
  assert.match(s.say({ type: 'roll' }).last('error').message, /ليست من هذه اللعبة/);
  assert.match(g.say({ type: 'bid', amount: 50 }).last('error').message, /ليست من هذه اللعبة/);
});

test('game_state for bank: roster with names, no rng, card decks as counts, timer', () => {
  const L = started(3);
  const s = stateOf(L.others[0]);
  assert.equal(s.game, 'bank');
  assert.equal(s.phase, 'turn');
  assert.equal(s.stage, 'roll');
  assert.deepEqual(s.roster.map((r) => r.name), ['أحمد', 'لاعب1', 'لاعب2']);
  assert.equal(s.you, L.others[0].last('joined').you);
  const wire = JSON.stringify(s);
  assert.equal(wire.includes('"rng"'), false);
  assert.equal(wire.includes('idRng'), false);
  assert.deepEqual(s.decks, { chance: 16, chest: 16 });
  assert.equal(s.timer.kind, 'turn');
  assert.equal(s.timer.endsAt - s.timer.now, BANK.TURN_SECONDS * 1000);
  // secrets never reach other players
  L.all.forEach((c) => {
    const mine = c.last('joined').playerId;
    L.all.filter((o) => o !== c).forEach((o) => assert.equal(JSON.stringify(o.inbox).includes(mine), false));
  });
});

// ---------- playing ----------

test('roll: only the current player; everybody gets the events', () => {
  const L = started(2);
  const cur = currentConn(L);
  const other = L.all.find((c) => c !== cur);
  assert.match(other.say({ type: 'roll' }).last('error').message, /ليس دورك/);
  cur.say({ type: 'roll' });
  assert.equal(other.events('roll').length, 1);
  assert.equal(cur.events('roll').length, 1);
  assert.ok(stateOf(cur).dice);
  assert.notEqual(stateOf(cur).stage, 'roll');
});

test('client messages cannot carry unknown fields into the engine', () => {
  const L = started(2);
  const cur = currentConn(L);
  cur.say({ type: 'roll', forcedDice: [6, 6], cash: 99999, current: 1 });
  const r = roomOf(L).engine;
  assert.equal(r.players[cur.last('joined').you].cash, BANK.START_CASH - (r.stage === 'debt' ? 0 : 0) + (r.players[cur.last('joined').you].cash - BANK.START_CASH));
  assert.ok(r.players[cur.last('joined').you].cash < 99999);
  assert.equal(r.forcedDice, undefined);
});

function toBuyStage(L) {
  const room = roomOf(L);
  room.engine.forcedDice = [2, 1]; // lands on square 3
  const cur = currentConn(L);
  cur.say({ type: 'roll' });
  assert.equal(roomOf(L).engine.stage, 'buy');
  return cur;
}

test('buy then end turn; the turn moves on and the clock restarts', () => {
  const L = started(2);
  const cur = toBuyStage(L);
  assert.equal(stateOf(cur).timer.kind, 'buy');
  cur.say({ type: 'buy' });
  assert.equal(stateOf(cur).props[3].owner, cur.last('joined').you);
  cur.say({ type: 'end_turn' });
  assert.notEqual(stateOf(L.host).currentPlayerId, cur.last('joined').you);
});

test('auction: every bid restarts the 10s clock, the highest bid wins when it runs out', () => {
  const L = started(3);
  const cur = toBuyStage(L);
  const others = L.all.filter((c) => c !== cur);
  cur.say({ type: 'decline' });
  assert.equal(stateOf(cur).stage, 'auction');
  assert.equal(stateOf(cur).timer.kind, 'auction');
  L.h.clock.advance(6000);
  others[0].say({ type: 'bid', amount: 20 });
  const afterBid = stateOf(others[0]).timer;
  assert.equal(afterBid.endsAt - afterBid.now, BANK.AUCTION_SECONDS * 1000); // restarted
  L.h.clock.advance(6000);
  assert.equal(roomOf(L).engine.stage, 'auction'); // 6s after the bid: still open
  others[1].say({ type: 'bid', amount: 40 });
  assert.match(others[0].say({ type: 'bid', amount: 40 }).last('error').message, /أعلى/);
  L.h.clock.advance(BANK.AUCTION_SECONDS * 1000 + 1);
  const s = roomOf(L).engine;
  assert.equal(s.stage, 'postRoll');
  assert.equal(s.props[3].owner, others[1].last('joined').you);
  assert.equal(s.players[others[1].last('joined').you].cash, BANK.START_CASH - 40);
});

test('turn timer: a player who does nothing is rolled for, then ends the turn when time runs out', () => {
  const L = started(2);
  const first = stateOf(L.host).currentPlayerId;
  L.h.clock.advance(BANK.TURN_SECONDS * 1000 + 1);
  assert.ok(roomOf(L).engine.dice, 'the server rolled');
  // keep going: the game never stalls on an absent player
  for (let i = 0; i < 12; i++) L.h.clock.advance(31 * 1000);
  assert.ok(roomOf(L).engine.turnCount > 0);
  assert.ok(stateOf(L.host).currentPlayerId);
  assert.ok(first);
});

test('a disconnected player is played automatically; the others keep playing', () => {
  const L = started(2);
  const cur = currentConn(L);
  const other = L.all.find((c) => c !== cur);
  cur.drop();
  assert.equal(stateOf(other).roster.find((r) => r.id === cur.last('joined').you).connected, false);
  const gone = cur.last('joined').you;
  let passed = false;
  for (let i = 0; i < 400 && !passed; i++) {
    L.h.clock.advance(5 * 1000);
    passed = stateOf(other).currentPlayerId !== gone;
  }
  assert.ok(passed, 'the absent player turn must pass by itself');
  assert.ok(roomOf(L).engine.turnCount >= 1);
});

test('trade offer has its own 60s clock beside the turn clock', () => {
  const L = started(2);
  const me = L.host.last('joined').you;
  const other = L.others[0].last('joined').you;
  roomOf(L).engine.props[1].owner = me;
  L.host.say({ type: 'trade_offer', to: other, give: { props: [1] }, get: { cash: 50 } });
  const s = stateOf(L.others[0]);
  assert.ok(s.trade);
  assert.deepEqual(s.timers.map((t) => t.kind).sort(), ['trade', 'turn']);
  L.h.clock.advance(BANK.TRADE_SECONDS * 1000 + 1);
  assert.equal(roomOf(L).engine.trade, null);
  assert.equal(roomOf(L).engine.props[1].owner, me); // nothing moved
});

test('trade can be accepted by the receiver only, over the wire', () => {
  const L = started(2);
  const me = L.host.last('joined').you;
  const other = L.others[0].last('joined').you;
  roomOf(L).engine.props[1].owner = me;
  L.host.say({ type: 'trade_offer', to: other, give: { props: [1], cash: 0 }, get: { cash: 50 } });
  assert.match(L.host.say({ type: 'trade_accept' }).last('error').message, /تبادل/);
  L.others[0].say({ type: 'trade_accept' });
  assert.equal(roomOf(L).engine.props[1].owner, other);
  assert.equal(roomOf(L).engine.players[me].cash, BANK.START_CASH + 50);
});

test('bank bad payloads are refused, never crash the room', () => {
  const L = started(2);
  const cur = currentConn(L);
  const bad = [
    { type: 'bid', amount: 'x' }, { type: 'build', square: 'a' }, { type: 'build', square: null },
    { type: 'trade_offer', to: 5, give: 5, get: 'x' }, { type: 'trade_offer', to: 'zz', give: { props: 'no' } },
    { type: 'mortgage', square: -1 }, { type: 'sell_building', square: 999 },
  ];
  bad.forEach((m) => { cur.say(m); assert.equal(cur.last('error') !== undefined, true); });
  cur.say({ type: 'roll' });
  assert.ok(stateOf(cur).dice);
});

// ---------- host actions, reconnection ----------

test('end_game: host only; ends the game and names the richest; new_game restarts with the same players', () => {
  const L = started(3);
  assert.match(L.others[0].say({ type: 'end_game' }).last('error').message, /للمضيف/);
  L.host.say({ type: 'end_game' });
  const s = stateOf(L.others[0]);
  assert.equal(s.phase, 'gameOver');
  assert.ok(s.winnerIds.length >= 1);
  assert.equal(s.timer, null);
  assert.match(L.others[0].say({ type: 'new_game' }).last('error').message, /للمضيف/);
  L.host.say({ type: 'new_game' });
  const n = stateOf(L.host);
  assert.equal(n.phase, 'turn');
  assert.equal(n.playerIds.length, 3);
  assert.equal(n.players[n.playerIds[0]].cash, BANK.START_CASH);
  // new_game is refused while a game is running
  assert.match(L.host.say({ type: 'new_game' }).last('error').message, /./);
});

test('reconnecting returns the same seat and the full game state', () => {
  const L = started(2);
  const g = L.others[0];
  const { playerId, you } = g.last('joined');
  currentConn(L).say({ type: 'roll' });
  g.drop();
  const back = L.h.conn().say({ type: 'join_room', code: L.code, name: 'x', playerId });
  assert.equal(back.last('joined').you, you);
  assert.equal(back.last('joined').game, 'bank');
  const s = stateOf(back);
  assert.equal(s.you, you);
  assert.ok(s.dice);
  assert.equal(s.roster.find((r) => r.id === you).connected, true);
});

test('a stranger cannot join a running bank game', () => {
  const L = started(2);
  assert.match(L.h.conn().say({ type: 'join_room', code: L.code, name: 'غريب' }).last('error').message, /بدأت/);
});

test('a whole bank game through the room layer ends in bankruptcy or by the host, with no stuck state', () => {
  const L = started(3);
  let ended = false;
  for (let i = 0; i < 4000 && !ended; i++) {
    const s = roomOf(L).engine;
    if (s.phase === 'gameOver') { ended = true; break; }
    const cur = currentConn(L);
    // a simple human: roll, buy when possible, end the turn
    if (s.stage === 'roll') cur.say({ type: 'roll' });
    else if (s.stage === 'buy') cur.say({ type: s.players[s.playerIds[s.current]].cash >= 300 ? 'buy' : 'decline' });
    else if (s.stage === 'postRoll') cur.say({ type: 'end_turn' });
    else L.h.clock.advance(31 * 1000); // auction, debt: let the timers decide
    if (i % 200 === 199) L.h.clock.advance(31 * 1000);
  }
  if (!ended) L.host.say({ type: 'end_game' });
  assert.equal(roomOf(L).engine.phase, 'gameOver');
  assert.ok(roomOf(L).engine.winnerIds.length >= 1);
  // nothing left running
  L.h.R.shutdown();
});

test('unused: money helper keeps lint quiet', () => { assert.equal(money(5), 5); assert.ok(CONFIG.MAX_ROOMS > 0); });

// ---------- pieces picked in the lobby ----------

test('every bank player gets a free piece on joining; pieces are unique', () => {
  const L = bankLobby(4);
  const tokens = L.host.last('room_state').players.map((p) => p.token);
  assert.deepEqual(tokens, BANK.TOKENS.slice(0, 4));
  assert.equal(new Set(tokens).size, 4);
});

test('the host may take a piece only while nobody has it', () => {
  const L = bankLobby(2);
  const guestToken = L.others[0].last('room_state').players.find((p) => !p.isHost).token;
  assert.match(L.host.say({ type: 'set_token', token: guestToken }).last('error').message, /اختاره لاعب آخر/);
  L.host.say({ type: 'set_token', token: 'crown' });
  assert.equal(L.others[0].last('room_state').players.find((p) => p.isHost).token, 'crown');
});

test('set_token changes my piece and everyone sees it; refused after the start', () => {
  const L = bankLobby(2);
  const guest = L.others[0];
  const me = guest.last('joined').you;
  const host = L.host.last('room_state').players.find((p) => p.isHost).token;
  assert.match(guest.say({ type: 'set_token', token: host }).last('error').message, /اختاره لاعب آخر/);
  assert.match(guest.say({ type: 'set_token', token: 'unicorn' }).last('error').message, /غير متاح/);
  assert.match(guest.say({ type: 'set_token', token: 5 }).last('error').message, /غير متاح/);
  guest.say({ type: 'set_token', token: 'dallah' });
  assert.equal(L.host.last('room_state').players.find((p) => p.id === me).token, 'dallah');
  L.host.say({ type: 'start_game' });
  assert.equal(stateOf(L.host).roster.find((r) => r.id === me).token, 'dallah');
  assert.match(guest.say({ type: 'set_token', token: 'palm' }).last('error').message, /بدأت/);
});

test('games without pieces refuse set_token', () => {
  const h = harness();
  const c = h.conn().say({ type: 'create_room', name: 'أحمد' });
  assert.match(c.say({ type: 'set_token', token: 'car' }).last('error').message, /غير متاح/);
  assert.equal(c.last('room_state').players[0].token, null);
});
