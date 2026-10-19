const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/domino/config');
const E = require('../server/games/domino/engine');
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
  const host = h.conn().say({ type: 'create_room', name: 'أحمد', game: 'domino' });
  const code = host.last('joined').code;
  const others = [];
  for (let i = 1; i < n; i++) others.push(h.conn().say({ type: 'join_room', code, name: 'لاعب' + i }));
  return { h, host, others, code, all: [host, ...others] };
}

const stateOf = (c) => c.last('game_state');
const roomOf = (L) => L.h.R.rooms.get(L.code);
const errOf = (c) => c.last('error').message;
const connOf = (L, seat) => L.all.find((c) => c.last('joined').you === seat);

test('domino room: 2 to 4 players, computer players allowed', () => {
  const L = lobby(3);
  assert.equal(L.host.last('joined').game, 'domino');
  L.host.say({ type: 'add_bot' });
  assert.equal(L.host.last('room_state').players.length, 4);
  assert.match(errOf(L.host.say({ type: 'add_bot' })), /ممتلئة/);
  assert.match(errOf(L.h.conn().say({ type: 'join_room', code: L.code, name: 'خامس' })), /ممتلئة/);
});

test('options from the lobby reach the game; partners with four', () => {
  const L = lobby(2);
  L.host.say({ type: 'add_bot' }).say({ type: 'add_bot' });
  L.host.say({ type: 'set_options', options: { mode: 'block', target: 51, teams: true } });
  assert.deepEqual(L.others[0].last('room_state').options, { mode: 'block', target: 51, teams: true });
  assert.match(errOf(L.host.say({ type: 'set_options', options: { target: 7 } })), /غير صالحة/);
  L.host.say({ type: 'start_game' });
  const s = stateOf(L.others[0]);
  assert.deepEqual(s.options, { mode: 'block', target: 51, teams: true });
  assert.deepEqual(Object.values(s.teams), ['A', 'B', 'A', 'B']);
  assert.equal(s.yard, 0);
});

test('secrecy: nobody ever receives a tile from another hand or from the pile', () => {
  const L = lobby(3);
  L.host.say({ type: 'start_game', options: { mode: 'draw' } });
  const eng = roomOf(L).engine;
  L.all.forEach((c) => {
    const me = c.last('joined').you;
    const text = JSON.stringify(c.inbox);
    const hidden = eng.yard.concat(...eng.playerIds.filter((id) => id !== me).map((id) => eng.hands[id])).filter((t) => t !== eng.must);
    hidden.forEach((t) => assert.ok(!text.includes('"' + t + '"'), me + ' sees ' + t));
    assert.deepEqual(stateOf(c).hand, eng.hands[me]);
  });
});

test('playing through the protocol: only the current player, only known fields', () => {
  const L = lobby(2);
  L.host.say({ type: 'start_game' });
  const s = stateOf(L.host);
  const cur = connOf(L, s.currentPlayerId);
  const other = L.all.find((c) => c !== cur);
  const mine = stateOf(cur);
  assert.match(errOf(other.say({ type: 'play', tile: stateOf(other).hand[0] })), /ليس دورك/);
  cur.say({ type: 'play', tile: mine.must, hands: {}, yard: [] });
  const ev = L.host.events('play').pop();
  assert.equal(ev.tile, mine.must);
  assert.equal(stateOf(other).line.length, 1);
  assert.equal(stateOf(other).players.find((p) => p.id === mine.you).count, 6);
  assert.match(errOf(cur.say({ type: 'roll' })), /ليست من هذه اللعبة/);
});

test('a whole game: idle players and computer players are played for, hands deal themselves', () => {
  const L = lobby(1);
  L.host.say({ type: 'add_bot' }).say({ type: 'add_bot' });
  L.host.say({ type: 'start_game', options: { target: 51 } });
  for (let i = 0; i < 4000 && stateOf(L.host).phase !== 'gameOver'; i++) L.h.clock.advance(C.TURN_SECONDS * 1000);
  const end = stateOf(L.host);
  assert.equal(end.phase, 'gameOver');
  assert.ok(Math.max(...Object.values(end.scores)) >= 51);
  assert.ok(L.host.events('hand_end').length >= 1);
  assert.equal(L.h.clock.pending(), 0, 'no timers left running');
  L.host.say({ type: 'new_game' });
  assert.equal(stateOf(L.host).phase, 'turn');
  assert.equal(stateOf(L.host).options.target, 51);
});

test('next_round is host only; after the pause it happens by itself', () => {
  const L = lobby(2);
  L.host.say({ type: 'start_game' });
  for (let i = 0; i < 400 && stateOf(L.host).phase === 'turn'; i++) L.h.clock.advance(C.TURN_SECONDS * 1000 / 5);
  if (stateOf(L.host).phase === 'gameOver') return; // one hand already reached the target
  assert.equal(stateOf(L.host).phase, 'handOver');
  assert.equal(stateOf(L.host).timer.kind, 'next');
  assert.match(errOf(L.others[0].say({ type: 'next_round' })), /للمضيف/);
  L.h.clock.advance(C.NEXT_HAND_SECONDS * 1000);
  assert.equal(stateOf(L.host).phase, 'turn');
  assert.equal(stateOf(L.host).handNo, 2);
});
