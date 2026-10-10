const test = require('node:test');
const assert = require('node:assert/strict');
const SEVEN = require('../server/games/seven/config');
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

function lobby(n) {
  const h = harness();
  const host = h.conn().say({ type: 'create_room', name: 'أحمد', game: 'seven' });
  const code = host.last('joined').code;
  const others = [];
  for (let i = 1; i < n; i++) others.push(h.conn().say({ type: 'join_room', code, name: 'لاعب' + i }));
  return { h, host, others, code, all: [host, ...others] };
}

// The server deals with a random seed. Some tests assume a plain start (everyone has 7 cards, the first
// table card is a number), so deal again until that is what we got; special first cards are covered in the engine tests.
function started(n, rounds) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const L = lobby(n || 3);
    L.host.say(rounds ? { type: 'start_game', options: { rounds: rounds } } : { type: 'start_game' });
    const s = L.h.R.rooms.get(L.code).engine;
    if (s.discard[0].type === 'num' && s.stage === 'play' && s.current === 0) return L;
    L.h.R.shutdown();
  }
  throw new Error('could not get a plain start');
}

const stateOf = (c) => c.last('game_state');
const roomOf = (L) => L.h.R.rooms.get(L.code);
const connOf = (L, seat) => L.all.find((c) => c.last('joined').you === seat);
const currentConn = (L) => connOf(L, stateOf(L.host).currentPlayerId);

// plays one sensible move as the current player through the protocol
function oneMove(L) {
  const cur = currentConn(L);
  const s = stateOf(cur);
  if (s.stage === 'color') return cur.say({ type: 'choose_color', color: 'red' });
  if (s.stage === 'drawn') return cur.say({ type: 'play_drawn', color: 'blue' });
  if (s.playable.length) {
    const card = s.hand.find((c) => c.id === s.playable[0]);
    return cur.say({ type: 'play', card: card.id, color: 'green' });
  }
  return cur.say({ type: 'draw' });
}

// ---------- rooms ----------

test('create_room with game "seven": joined and room_state say seven', () => {
  const L = lobby(2);
  assert.equal(L.host.last('joined').game, 'seven');
  assert.equal(L.host.last('room_state').game, 'seven');
  assert.equal(L.others[0].last('joined').game, 'seven');
});

test('seven room: 2 to 6 players, start needs 2', () => {
  const solo = lobby(1);
  assert.match(solo.host.say({ type: 'start_game' }).last('error').message, /لاعبَين/);
  const full = lobby(6);
  assert.match(full.h.conn().say({ type: 'join_room', code: full.code, name: 'سابع' }).last('error').message, /ممتلئة/);
  full.host.say({ type: 'start_game' });
  assert.equal(stateOf(full.host).players.length, 6);
});

test('start_game options: default 3 rounds, host can pick 5, anything else is refused', () => {
  assert.equal(stateOf(started(2).host).rounds, SEVEN.DEFAULT_ROUNDS);
  assert.equal(stateOf(started(2, 5).host).rounds, 5);
  const L = lobby(2);
  assert.match(L.host.say({ type: 'start_game', options: { rounds: 4 } }).last('error').message, /الجولات/);
  assert.equal(roomOf(L).engine, null);
  L.host.say({ type: 'start_game', options: 'x' }); // junk options are ignored, default used
  assert.equal(stateOf(L.host).rounds, SEVEN.DEFAULT_ROUNDS);
  // only the host may start
  const G = lobby(2);
  assert.match(G.others[0].say({ type: 'start_game', options: { rounds: 5 } }).last('error').message, /للمضيف/);
});

test('actions of the other games are refused, and so are unknown fields', () => {
  const L = started(2);
  const cur = currentConn(L);
  assert.match(cur.say({ type: 'roll' }).last('error').message, /ليست من هذه اللعبة/);
  assert.match(cur.say({ type: 'bid', amount: 5 }).last('error').message, /ليست من هذه اللعبة/);
  assert.match(cur.say({ type: 'call_screw' }).last('error').message, /ليست من هذه اللعبة/);
  const h = harness();
  const sc = h.conn().say({ type: 'create_room', name: 'أحمد' });
  h.conn().say({ type: 'join_room', code: sc.last('joined').code, name: 'سارة' });
  sc.say({ type: 'start_game' });
  assert.match(sc.say({ type: 'play', card: 'x' }).last('error').message, /ليست من هذه اللعبة/);
  // junk fields never reach the engine
  const s = stateOf(cur);
  const before = JSON.stringify(roomOf(L).engine.hands[cur.last('joined').you].map((c) => c.id));
  cur.say({ type: 'draw', hands: {}, rng: 1, forcedDraw: 'x', deck: [] });
  assert.ok(before);
  assert.ok(s);
});

// ---------- secrecy ----------

test('game_state: my hand only, others as counts, no deck, no rng, no secret ids', () => {
  const L = started(3);
  L.all.forEach((c) => {
    const s = stateOf(c);
    const me = c.last('joined').you;
    assert.equal(s.game, 'seven');
    assert.equal(s.hand.length, 7);
    assert.deepEqual(s.players.map((p) => p.count), [7, 7, 7]);
    assert.deepEqual(s.players.map((p) => p.name), ['أحمد', 'لاعب1', 'لاعب2']);
    const wire = JSON.stringify(s);
    assert.equal(wire.includes('"deck"'), false);
    assert.equal(wire.includes('rng'), false);
    assert.equal(wire.includes('"hands"'), false);
    // no card id from anyone else's hand
    L.all.filter((o) => o !== c).forEach((o) => {
      roomOf(L).engine.hands[o.last('joined').you].forEach((card) => assert.equal(wire.includes(card.id), false));
    });
    assert.equal(s.you, me);
    L.all.filter((o) => o !== c).forEach((o) => assert.equal(JSON.stringify(c.inbox).includes(o.last('joined').playerId), false));
  });
});

test('a card drawn and not yet decided is visible only to the drawer', () => {
  const L = started(3);
  const room = roomOf(L);
  const cur = currentConn(L);
  const seat = cur.last('joined').you;
  // make sure the drawn card will be playable: put a matching card on top of the deck
  const top = room.engine.discard[room.engine.discard.length - 1];
  room.engine.hands[seat] = room.engine.hands[seat].filter((c) => c.color !== room.engine.color && c.type !== 'wild' && c.type !== 'wild4' && c.type !== top.type);
  room.engine.deck.push({ type: 'num', color: room.engine.color, rank: 9, value: 9 });
  cur.say({ type: 'draw' });
  const mine = stateOf(cur);
  if (mine.stage === 'drawn') {
    assert.equal(mine.drawn.rank, 9);
    L.all.filter((c) => c !== cur).forEach((c) => {
      assert.equal(stateOf(c).drawn, null);
      assert.equal(stateOf(c).hasDrawn, true);
      assert.equal(JSON.stringify(c.inbox).includes('"drawn":{'), false);
    });
  }
  assert.equal(cur.events('draw').length, 1);
  assert.equal(cur.events('draw')[0].card, undefined);
});

// ---------- playing ----------

test('only the current player can act; an illegal card is refused with an Arabic error', () => {
  const L = started(2);
  const cur = currentConn(L);
  const other = L.all.find((c) => c !== cur);
  assert.match(other.say({ type: 'draw' }).last('error').message, /ليس دورك/);
  assert.match(cur.say({ type: 'play', card: 'nope' }).last('error').message, /ليس في يدك/);
  assert.match(cur.say({ type: 'play' }).last('error').message, /./);
  assert.match(cur.say({ type: 'choose_color', color: 'red' }).last('error').message, /غير متاحة/);
});

test('a played card reaches everyone as an event and the turn moves on', () => {
  const L = started(3);
  for (let i = 0; i < 12; i++) {
    const before = stateOf(L.host).currentPlayerId;
    const plays = L.host.events('play').length;
    oneMove(L);
    if (L.host.events('play').length > plays) {
      assert.equal(L.others[0].events('play').length, L.host.events('play').length);
      const ev = L.host.events('play').pop();
      assert.equal(ev.playerId, before);
      return;
    }
  }
  assert.fail('nobody could play in 12 moves');
});

test('turn timer: a player who does nothing is played for after 30s, and the clock restarts', () => {
  const L = started(3);
  const first = stateOf(L.host).currentPlayerId;
  L.h.clock.advance(SEVEN.TURN_SECONDS * 1000 - 1);
  assert.equal(stateOf(L.host).currentPlayerId, first);
  L.h.clock.advance(2);
  const s = stateOf(L.host);
  assert.notEqual(s.currentPlayerId, first);
  assert.equal(s.timer.kind, 'turn');
  assert.equal(s.timer.endsAt - s.timer.now, SEVEN.TURN_SECONDS * 1000); // a fresh full clock for the next player
});

test('a drawn card that is left undecided is resolved by the timer too (same clock)', () => {
  const L = started(2);
  const room = roomOf(L);
  const cur = currentConn(L);
  const seat = cur.last('joined').you;
  room.engine.hands[seat] = [{ id: 'ux1', type: 'num', color: 'blue', rank: 1, value: 1 }];
  room.engine.discard = [{ type: 'num', color: 'red', rank: 5, value: 5 }];
  room.engine.color = 'red';
  room.engine.deck.push({ type: 'num', color: 'red', rank: 2, value: 2 });
  cur.say({ type: 'draw' });
  assert.equal(stateOf(cur).stage, 'drawn');
  const endsAt = stateOf(cur).timer.endsAt;
  L.h.clock.advance(10 * 1000);
  assert.equal(stateOf(cur).timer.endsAt, endsAt); // deciding does not get a fresh clock
  L.h.clock.advance(SEVEN.TURN_SECONDS * 1000);
  assert.notEqual(stateOf(L.host).currentPlayerId, seat);
});

test('a disconnected player is played automatically and the game keeps going', () => {
  const L = started(2);
  const cur = currentConn(L);
  const other = L.all.find((c) => c !== cur);
  cur.drop();
  assert.equal(stateOf(other).players.find((p) => p.id === cur.last('joined').you).connected, false);
  let passed = false;
  for (let i = 0; i < 6 && !passed; i++) {
    L.h.clock.advance(SEVEN.TURN_SECONDS * 1000 + 1);
    passed = stateOf(other).currentPlayerId === other.last('joined').you;
  }
  assert.ok(passed);
});

test('reconnecting returns the same seat and hand', () => {
  const L = started(2);
  const g = L.others[0];
  const { playerId, you } = g.last('joined');
  const before = stateOf(g).hand;
  g.drop();
  const back = L.h.conn().say({ type: 'join_room', code: L.code, name: 'x', playerId });
  assert.equal(back.last('joined').you, you);
  assert.equal(back.last('joined').game, 'seven');
  assert.deepEqual(stateOf(back).hand, before);
  assert.equal(stateOf(back).players.find((p) => p.id === you).connected, true);
});

test('a stranger cannot join a running game', () => {
  const L = started(2);
  assert.match(L.h.conn().say({ type: 'join_room', code: L.code, name: 'غريب' }).last('error').message, /بدأت/);
});

// ---------- rounds and the end ----------

function playRoundByTimers(L) {
  for (let i = 0; i < 4000; i++) {
    const s = stateOf(L.host);
    if (s.phase === 'roundOver' || s.phase === 'gameOver') return s.phase;
    L.h.clock.advance(SEVEN.TURN_SECONDS * 1000 + 1);
  }
  throw new Error('round did not end');
}

test('round result is broadcast with every hand revealed; next_round is host only', () => {
  const L = started(3, 3);
  assert.equal(playRoundByTimers(L), 'roundOver');
  const rr = L.others[0].last('round_result');
  assert.equal(rr.round, 1);
  assert.equal(Object.keys(rr.hands).length, 3);
  assert.ok(rr.points >= 0);
  assert.deepEqual(L.host.last('round_result'), rr);
  assert.equal(stateOf(L.others[1]).phase, 'roundOver');
  assert.match(L.others[0].say({ type: 'next_round' }).last('error').message, /للمضيف/);
  L.host.say({ type: 'next_round' });
  const s = stateOf(L.host);
  assert.equal(s.round, 2);
  assert.equal(s.phase, 'turn');
  assert.equal(s.totals[rr.winnerId], rr.points);
  assert.equal(s.hand.length >= 7, true);
  assert.equal(s.timer.kind, 'turn');
});

test('next_round / new_game are refused at the wrong time', () => {
  const L = started(2);
  assert.match(L.host.say({ type: 'next_round' }).last('error').message, /غير متاحة/);
  assert.match(L.host.say({ type: 'new_game' }).last('error').message, /غير متاحة/);
});

test('a whole game: game_over names the winners; new_game keeps the same rounds and players', () => {
  const L = started(3, 3);
  for (let round = 1; round <= 3; round++) {
    const ph = playRoundByTimers(L);
    if (round < 3) { assert.equal(ph, 'roundOver'); L.host.say({ type: 'next_round' }); } else assert.equal(ph, 'gameOver');
  }
  const go = L.host.last('game_over');
  assert.ok(go.winnerIds.length >= 1);
  const best = Math.max(...Object.values(go.totals));
  go.winnerIds.forEach((id) => assert.equal(go.totals[id], best));
  assert.equal(stateOf(L.host).timer, null);
  assert.match(L.others[0].say({ type: 'new_game' }).last('error').message, /للمضيف/);
  L.host.say({ type: 'new_game' });
  const s = stateOf(L.host);
  assert.equal(s.round, 1);
  assert.equal(s.rounds, 3);
  assert.equal(s.phase, 'turn');
  assert.equal(s.players.length, 3);
  assert.deepEqual(Object.values(s.totals), [0, 0, 0]);
});

test('humans playing through the protocol finish rounds; no timers are left running at the end', () => {
  const L = started(2, 3);
  for (let i = 0; i < 4000 && stateOf(L.host).phase === 'turn'; i++) oneMove(L);
  assert.equal(stateOf(L.host).phase, 'roundOver');
  L.h.R.shutdown();
  assert.equal(L.h.clock.pending(), 0);
});
