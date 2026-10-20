const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/minhu/config');
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
  const host = h.conn().say({ type: 'create_room', name: 'أحمد', game: 'minhu' });
  const code = host.last('joined').code;
  const others = [];
  for (let i = 1; i < n; i++) others.push(h.conn().say({ type: 'join_room', code, name: 'لاعب' + i }));
  return { h, host, others, code, all: [host, ...others] };
}
const stateOf = (c) => c.last('game_state');
const errOf = (c) => c.last('error').message;
const connOf = (L, seat) => L.all.find((c) => c.last('joined').you === seat);

test('minhu room: two players; each gets only their own secret over the wire', () => {
  const L = lobby(2);
  assert.match(errOf(L.h.conn().say({ type: 'join_room', code: L.code, name: 'ثالث' })), /ممتلئة/);
  L.host.say({ type: 'start_game' });
  const eng = L.h.R.rooms.get(L.code).engine;
  L.all.forEach((c) => {
    const me = c.last('joined').you;
    const other = eng.playerIds.find((x) => x !== me);
    assert.equal(stateOf(c).secret, eng.secrets[me]);
    assert.ok(c.all('game_state').every((m) => m.oppSecret === null && !('secrets' in m)), 'no message carries the other secret');
    assert.ok(!c.inbox.some((m) => JSON.stringify(m).includes('"secrets"')), other);
  });
});

test('asking through the protocol; questions and answers are seen by both', () => {
  const L = lobby(2);
  L.host.say({ type: 'start_game' });
  const cur = connOf(L, stateOf(L.host).currentPlayerId);
  const other = L.all.find((c) => c !== cur);
  cur.say({ type: 'ask', q: 'glasses' });
  const ev = other.events('ask').pop();
  assert.equal(ev.q, 'glasses');
  assert.equal(typeof ev.yes, 'boolean');
  cur.say({ type: 'flip', ids: [0, 5] });
  assert.equal(stateOf(other).players.find((p) => p.id === cur.last('joined').you).down, 2);
  cur.say({ type: 'end_turn' });
  assert.equal(stateOf(other).currentPlayerId, other.last('joined').you);
  assert.match(errOf(cur.say({ type: 'guess', char: 3 })), /ليس دورك/);
});

test('choosing through the protocol: picks stay secret, the round starts when both have chosen', () => {
  const L = lobby(2);
  L.host.say({ type: 'set_options', options: { pick: 'choose' } });
  L.host.say({ type: 'start_game' });
  assert.equal(stateOf(L.host).phase, 'pick');
  assert.equal(stateOf(L.host).timer.kind, 'pick');
  L.host.say({ type: 'pick', char: 5 });
  const g = L.others[0];
  assert.ok(!JSON.stringify(g.inbox).includes('"char":5'), 'the guest never sees the host\'s choice');
  assert.equal(stateOf(g).players.find((p) => p.isHost).picked, true);
  g.say({ type: 'pick', random: true });
  assert.equal(stateOf(L.host).phase, 'turn');
  assert.equal(stateOf(L.host).secret, 5);
});

test('choosing: if a player does not choose, the clock does it', () => {
  const L = lobby(1);
  L.host.say({ type: 'add_bot' });
  L.host.say({ type: 'start_game', options: { pick: 'choose' } });
  assert.equal(stateOf(L.host).phase, 'pick');
  L.h.clock.advance(C.PICK_SECONDS * 1000);
  assert.equal(stateOf(L.host).phase, 'turn');
  assert.ok(stateOf(L.host).secret !== null);
});

test('against the computer: rounds deal themselves, the match ends', () => {
  const L = lobby(1);
  L.host.say({ type: 'add_bot' });
  L.host.say({ type: 'start_game', options: { target: 2, level: 'smart' } });
  for (let i = 0; i < 800 && stateOf(L.host).phase !== 'matchOver'; i++) L.h.clock.advance(C.TURN_SECONDS * 1000);
  const s = stateOf(L.host);
  assert.equal(s.phase, 'matchOver');
  assert.ok(Math.max(...Object.values(s.scores)) >= 2);
  assert.equal(L.h.clock.pending(), 0);
});
