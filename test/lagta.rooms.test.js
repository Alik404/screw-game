const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/lagta/config');
const E = require('../server/games/lagta/engine');
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
  const host = h.conn().say({ type: 'create_room', name: 'أحمد', game: 'lagta' });
  const code = host.last('joined').code;
  const others = [];
  for (let i = 1; i < n; i++) others.push(h.conn().say({ type: 'join_room', code, name: 'لاعب' + i }));
  return { h, host, others, code, all: [host, ...others] };
}
const stateOf = (c) => c.last('game_state');
const errOf = (c) => c.last('error').message;

test('lagta room: up to 8 players, options, the countdown starts the first card', () => {
  const L = lobby(2);
  L.host.say({ type: 'add_bot' });
  L.host.say({ type: 'set_options', options: { size: 20, level: 'hard' } });
  L.host.say({ type: 'start_game' });
  const s = stateOf(L.others[0]);
  assert.equal(s.phase, 'countdown');
  assert.deepEqual(s.options, { size: 20, level: 'hard' });
  L.h.clock.advance(C.COUNTDOWN_SECONDS * 1000);
  assert.equal(stateOf(L.host).phase, 'play');
  assert.ok(stateOf(L.host).center !== null);
});

test('a race through the protocol: the right symbol wins the card, the next card follows', () => {
  const L = lobby(2);
  L.host.say({ type: 'start_game' });
  L.h.clock.advance(C.COUNTDOWN_SECONDS * 1000);
  const v = stateOf(L.others[0]);
  const sym = E.common(v.mine, v.center);
  L.others[0].say({ type: 'claim', symbol: sym, at: -99999 });
  assert.equal(L.host.events('claim').pop().playerId, L.others[0].last('joined').you);
  assert.match(errOf(L.host.say({ type: 'claim', symbol: sym })), /انتظر/);
  L.h.clock.advance(C.BETWEEN_SECONDS * 1000);
  assert.equal(stateOf(L.host).phase, 'play');
  assert.equal(stateOf(L.host).seq, 2);
});

test('computer players play a whole game by themselves while a human watches', () => {
  const L = lobby(1);
  L.host.say({ type: 'add_bot' }).say({ type: 'add_bot' });
  L.host.say({ type: 'start_game', options: { size: 20, level: 'easy' } });
  for (let i = 0; i < 500 && stateOf(L.host).phase !== 'gameOver'; i++) L.h.clock.advance(2000);
  const s = stateOf(L.host);
  assert.equal(s.phase, 'gameOver');
  assert.equal(Object.values(s.counts).reduce((a, b) => a + b, 0), 20);
  assert.equal(L.h.clock.pending(), 0);
  L.host.say({ type: 'new_game' });
  assert.equal(stateOf(L.host).phase, 'countdown');
});
