const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/tawla/config');
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
  const host = h.conn().say({ type: 'create_room', name: 'أحمد', game: 'tawla' });
  const code = host.last('joined').code;
  const others = [];
  for (let i = 1; i < n; i++) others.push(h.conn().say({ type: 'join_room', code, name: 'لاعب' + i }));
  return { h, host, others, code, all: [host, ...others] };
}

const stateOf = (c) => c.last('game_state');
const errOf = (c) => c.last('error').message;
const connOf = (L, seat) => L.all.find((c) => c.last('joined').you === seat);

test('tawla room: two players exactly, a computer player can be the second', () => {
  const L = lobby(2);
  assert.equal(L.host.last('joined').game, 'tawla');
  assert.match(errOf(L.h.conn().say({ type: 'join_room', code: L.code, name: 'ثالث' })), /ممتلئة/);
  assert.match(errOf(L.host.say({ type: 'add_bot' })), /ممتلئة/);
  const S = lobby(1);
  assert.match(errOf(S.host.say({ type: 'start_game' })), /لاعبَين/);
  S.host.say({ type: 'add_bot' });
  S.host.say({ type: 'set_options', options: { target: 5 } });
  S.host.say({ type: 'start_game' });
  assert.equal(stateOf(S.host).options.target, 5);
  assert.match(errOf(S.host.say({ type: 'set_options', options: { target: 2 } })), /بدأت/);
});

test('moves through the protocol: only the player to move, only legal steps; the server rolls', () => {
  const L = lobby(2);
  L.host.say({ type: 'start_game' });
  const s = stateOf(L.host);
  const cur = connOf(L, s.currentPlayerId);
  const other = L.all.find((c) => c !== cur);
  assert.equal(stateOf(cur).stage, 'move', 'the opening roll is already there');
  assert.match(errOf(other.say({ type: 'roll' })), /ليس دورك/);
  const m = stateOf(cur).legal[0];
  cur.say({ type: 'move', from: m.from, die: m.die, pos: { pts: [] } });
  assert.equal(L.host.events('step').pop().from, m.from);
  assert.match(errOf(cur.say({ type: 'move', from: 'x', die: 3 })), /غير صالحة/);
  assert.match(errOf(cur.say({ type: 'move', from: 30, die: 3 })), /غير مسموحة/);
  cur.say({ type: 'undo' });
  assert.equal(L.host.events('undo').length, 1);
  for (let k = 0; k < 4 && stateOf(cur).stage === 'move'; k++) { const x = stateOf(cur).legal[0]; cur.say({ type: 'move', from: x.from, die: x.die }); }
  cur.say({ type: 'done' });
  assert.equal(stateOf(other).currentPlayerId, other.last('joined').you);
  assert.equal(stateOf(other).stage, 'roll');
  other.say({ type: 'roll', forced: [6, 6] });
  const ev = L.host.events('roll').pop();
  assert.ok(ev.dice.every((d) => d >= 1 && d <= 6));
});

test('a whole match against the computer, with an idle human: it ends, and new_game restarts it', () => {
  const L = lobby(1);
  L.host.say({ type: 'add_bot' });
  L.host.say({ type: 'start_game', options: { target: 3 } });
  for (let i = 0; i < 6000 && stateOf(L.host).phase !== 'matchOver'; i++) L.h.clock.advance(C.MOVE_SECONDS * 1000);
  const end = stateOf(L.host);
  assert.equal(end.phase, 'matchOver');
  assert.ok(Math.max(...Object.values(end.scores)) >= 3);
  assert.ok(L.host.events('game_end').length >= 1);
  assert.equal(L.h.clock.pending(), 0);
  L.host.say({ type: 'new_game' });
  assert.equal(stateOf(L.host).phase, 'turn');
  assert.deepEqual(Object.values(stateOf(L.host).scores), [0, 0]);
});

test('timers: a short one to roll, a long one to move; steps do not restart it', () => {
  const L = lobby(2);
  L.host.say({ type: 'start_game' });
  const cur = connOf(L, stateOf(L.host).currentPlayerId);
  const t1 = stateOf(cur).timer;
  assert.equal(t1.kind, 'turn');
  L.h.clock.advance(5000);
  const m = stateOf(cur).legal[0];
  cur.say({ type: 'move', from: m.from, die: m.die });
  assert.equal(stateOf(cur).timer.endsAt, t1.endsAt);
  L.h.clock.advance(C.MOVE_SECONDS * 1000);
  const other = L.all.find((c) => c !== cur);
  assert.equal(stateOf(other).currentPlayerId, other.last('joined').you, 'the server finished the move');
  assert.equal(stateOf(other).timer.endsAt - stateOf(other).timer.now, C.ROLL_SECONDS * 1000);
});
