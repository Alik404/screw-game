const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/snakes/config');
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
  const host = h.conn().say({ type: 'create_room', name: 'أحمد', game: 'snakes' });
  const code = host.last('joined').code;
  const others = [];
  for (let i = 1; i < n; i++) others.push(h.conn().say({ type: 'join_room', code, name: 'لاعب' + i }));
  return { h, host, others, code, all: [host, ...others] };
}

const stateOf = (c) => c.last('game_state');
const roomOf = (L) => L.h.R.rooms.get(L.code);
const errOf = (c) => c.last('error').message;
const connOf = (L, seat) => L.all.find((c) => c.last('joined').you === seat);

// ---------- lobby ----------

test('snakes room: joined says snakes, everyone gets a different colour', () => {
  const L = lobby(3);
  assert.equal(L.host.last('joined').game, 'snakes');
  const r = L.host.last('room_state');
  assert.equal(r.game, 'snakes');
  assert.deepEqual(r.players.map((p) => p.token), C.COLORS.slice(0, 3));
  L.others[0].say({ type: 'set_token', token: 'pink' });
  assert.equal(L.host.last('room_state').players[1].token, 'pink');
  assert.match(errOf(L.others[1].say({ type: 'set_token', token: 'pink' })), /اختاره لاعب آخر/);
  assert.match(errOf(L.host.say({ type: 'set_token', token: 'gold' })), /غير متاح/);
});

test('computer players: host only, lobby only, unique names, up to the room size, removable', () => {
  const L = lobby(2);
  assert.match(errOf(L.others[0].say({ type: 'add_bot' })), /للمضيف/);
  L.host.say({ type: 'add_bot' }).say({ type: 'add_bot' });
  let players = L.host.last('room_state').players;
  assert.deepEqual(players.map((p) => p.name), ['أحمد', 'لاعب1', C.BOT_NAME + ' 1', C.BOT_NAME + ' 2']);
  assert.deepEqual(players.map((p) => p.bot), [false, false, true, true]);
  assert.ok(players.every((p) => p.connected));
  assert.equal(new Set(players.map((p) => p.token)).size, 4);
  // remove the first one: its name is reused by the next
  L.host.say({ type: 'remove_bot', id: players[2].id });
  assert.match(errOf(L.host.say({ type: 'remove_bot', id: players[0].id })), /غير موجود/);
  L.host.say({ type: 'add_bot' });
  players = L.host.last('room_state').players;
  assert.deepEqual(players.map((p) => p.name).slice(2), [C.BOT_NAME + ' 2', C.BOT_NAME + ' 1']);
  L.host.say({ type: 'add_bot' }).say({ type: 'add_bot' });
  assert.equal(L.host.last('room_state').players.length, C.MAX_PLAYERS);
  assert.match(errOf(L.host.say({ type: 'add_bot' })), /ممتلئة/);
  assert.match(errOf(L.h.conn().say({ type: 'join_room', code: L.code, name: 'سابع' })), /ممتلئة/);
  // a human may take a computer player's colour: they swap
  const bot = L.host.last('room_state').players.find((p) => p.bot);
  const mine = L.host.last('room_state').players[0].token;
  L.host.say({ type: 'set_token', token: bot.token });
  const after = L.host.last('room_state').players;
  assert.equal(after[0].token, bot.token);
  assert.equal(after.find((p) => p.id === bot.id).token, mine);
});

test('other games do not take computer players', () => {
  const h = harness();
  const host = h.conn().say({ type: 'create_room', name: 'أحمد', game: 'seven' });
  assert.match(errOf(host.say({ type: 'add_bot' })), /لا تدعم/);
});

test('one human and one computer player can play; start options reach the engine', () => {
  const L = lobby(1);
  assert.match(errOf(L.host.say({ type: 'start_game' })), /لاعبَين/);
  L.host.say({ type: 'add_bot' });
  L.host.say({ type: 'start_game', options: { board: 'wild', finish: 'exact', sixAgain: false, startSix: true } });
  const s = stateOf(L.host);
  assert.equal(s.game, 'snakes');
  assert.deepEqual(s.options, { board: 'wild', finish: 'exact', sixAgain: false, startSix: true });
  assert.deepEqual(s.players.map((p) => p.bot), [false, true]);
  assert.deepEqual(s.players.map((p) => p.pos), [0, 0]);
  assert.equal(L.host.events('game_start').length, 1);
  assert.match(errOf(L.host.say({ type: 'add_bot' })), /بدأت/);
});

test('bad start options are refused and the room stays in the lobby', () => {
  const L = lobby(2);
  assert.match(errOf(L.host.say({ type: 'start_game', options: { board: 'moon' } })), /غير صالحة/);
  assert.equal(roomOf(L).engine, null);
  L.host.say({ type: 'start_game', options: 'junk' });
  assert.equal(stateOf(L.host).options.board, C.DEFAULT_BOARD);
});

// ---------- play ----------

test('roll: only the current player, the die is the server\'s, everyone sees the move', () => {
  const L = lobby(3);
  L.host.say({ type: 'start_game', options: { sixAgain: false } });
  const cur = stateOf(L.host).currentPlayerId;
  const me = connOf(L, cur);
  const other = L.all.find((c) => c !== me);
  assert.match(errOf(other.say({ type: 'roll' })), /ليس دورك/);
  me.say({ type: 'roll', forced: 99, value: 99 });
  const ev = L.host.events('roll').pop();
  assert.equal(ev.playerId, cur);
  assert.ok(ev.value >= 1 && ev.value <= 6);
  L.all.forEach((c) => assert.equal(stateOf(c).positions[cur], roomOf(L).engine.positions[cur]));
  assert.ok(stateOf(L.host).lastRoll);
  assert.match(errOf(me.say({ type: 'play', card: 'x' })), /ليست من هذه اللعبة/);
});

test('the turn clock rolls for an idle player; computer players roll after a short pause', () => {
  const L = lobby(1);
  L.host.say({ type: 'add_bot' });
  L.host.say({ type: 'start_game', options: { sixAgain: false } });
  const s = stateOf(L.host);
  const human = s.players[0].id;
  const bot = s.players[1].id;
  if (s.currentPlayerId === bot) {
    assert.equal(s.timer.kind, 'bot');
    L.h.clock.advance(C.BOT_SECONDS * 1000);
    assert.equal(L.host.events('roll').pop().playerId, bot);
  }
  assert.equal(stateOf(L.host).currentPlayerId, human);
  assert.equal(stateOf(L.host).timer.kind, 'turn');
  L.h.clock.advance(C.TURN_SECONDS * 1000 - 1);
  assert.equal(L.host.events('roll').filter((e) => e.playerId === human).length, 0);
  L.h.clock.advance(1);
  assert.equal(L.host.events('roll').filter((e) => e.playerId === human).length, 1);
  assert.equal(stateOf(L.host).currentPlayerId, bot);
  assert.equal(stateOf(L.host).timer.kind, 'bot');
});

test('a whole game with computer players ends; new_game keeps the options and the computer players', () => {
  const L = lobby(1);
  L.host.say({ type: 'add_bot' }).say({ type: 'add_bot' });
  L.host.say({ type: 'start_game', options: { board: 'kids' } });
  for (let i = 0; i < 3000 && stateOf(L.host).phase === 'turn'; i++) L.h.clock.advance(C.TURN_SECONDS * 1000);
  const end = stateOf(L.host);
  assert.equal(end.phase, 'gameOver');
  assert.equal(end.positions[end.winnerIds[0]], C.SQUARES);
  assert.equal(L.host.events('game_over').length, 1);
  assert.equal(L.h.clock.pending(), 0, 'no timers left running');
  assert.match(errOf(L.host.say({ type: 'roll' })), /انتهت/);
  L.host.say({ type: 'new_game' });
  const again = stateOf(L.host);
  assert.equal(again.phase, 'turn');
  assert.equal(again.options.board, 'kids');
  assert.deepEqual(again.players.map((p) => p.bot), [false, true, true]);
  assert.ok(Object.values(again.positions).every((p) => p === 0));
});

test('end_game is host only and crowns the furthest player', () => {
  const L = lobby(2);
  L.host.say({ type: 'start_game' });
  assert.match(errOf(L.others[0].say({ type: 'end_game' })), /للمضيف/);
  assert.match(errOf(L.host.say({ type: 'new_game' })), /غير متاحة/);
  L.h.clock.advance(C.TURN_SECONDS * 1000 * 4);
  L.host.say({ type: 'end_game' });
  const s = stateOf(L.host);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.endedEarly, true);
  const best = Math.max(...Object.values(s.positions));
  assert.ok(s.winnerIds.every((id) => s.positions[id] === best));
});

test('a player who reconnects gets the current board back', () => {
  const L = lobby(2);
  L.host.say({ type: 'start_game' });
  L.h.clock.advance(C.TURN_SECONDS * 1000 * 3);
  const guest = L.others[0];
  const joined = guest.last('joined');
  guest.drop();
  assert.equal(stateOf(L.host).players.find((p) => p.id === joined.you).connected, false);
  const back = L.h.conn().say({ type: 'join_room', code: L.code, playerId: joined.playerId });
  assert.deepEqual(stateOf(back).positions, roomOf(L).engine.positions);
  assert.equal(stateOf(back).you, joined.you);
});
