const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/tawla/config');
const E = require('../server/games/tawla/engine');

// a position from lists: white {point: n}, black {point: n} (black uses the real point numbers)
function pos(white, black, extra) {
  const pts = new Array(26).fill(0);
  Object.keys(white || {}).forEach((k) => { pts[+k] += white[k]; });
  Object.keys(black || {}).forEach((k) => { pts[+k] -= black[k]; });
  return Object.assign({ pts, bar: [0, 0], off: [0, 0] }, extra || {});
}

// a game where `seat` must roll, in the position given
function at(p, seat) {
  const s = E.createGame(['w', 'b'], { seed: 3 }).state;
  s.pos = p;
  s.current = seat || 0;
  s.stage = 'roll';
  s.dice = []; s.left = []; s.steps = []; s.need = 0; s.force = null;
  return s;
}
function roll(s, a, b) {
  const r = E.act(s, s.playerIds[s.current], { type: 'roll', forced: [a, b] });
  assert.ok(r.state, r.error);
  return r.state;
}
function move(s, from, d) {
  const r = E.act(s, s.playerIds[s.current], { type: 'move', from, die: d });
  assert.ok(r.state, r.error);
  return r;
}
const legal = (s) => E.viewFor(s, s.playerIds[s.current]).legal;
const count = (p, seat) => p.pts.reduce((n, v, i) => n + (i >= 1 && i <= 24 ? Math.max(0, seat === 0 ? v : -v) : 0), 0) + p.bar[seat] + p.off[seat];

test('the start: 15 checkers and 167 pips each; the opening roll picks who starts and plays both dice', () => {
  const p = E.startPos();
  assert.equal(count(p, 0), 15);
  assert.equal(count(p, 1), 15);
  assert.deepEqual([E.pips(p, 0), E.pips(p, 1)], [167, 167]);
  for (let seed = 1; seed < 30; seed++) {
    const r = E.createGame(['w', 'b'], { seed });
    const s = r.state;
    const [a, b] = s.opening;
    assert.notEqual(a, b);
    assert.equal(s.current, a > b ? 0 : 1);
    assert.equal(s.stage, 'move');
    assert.deepEqual(s.dice.slice().sort(), [a, b].sort());
    assert.equal(r.events[0].type, 'game_start');
  }
  assert.match(E.createGame(['w'], {}).error, /اثنين/);
  assert.equal(E.createGame(['w', 'b'], { target: 4 }).error, E.ERR.badOptions);
});

test('moving: a point with two or more of theirs is closed; one of theirs is hit and goes to the bar', () => {
  let s = roll(at(pos({ 13: 2 }, { 8: 2, 10: 1 })), 5, 3);
  assert.ok(!legal(s).some((m) => m.from === 13 && m.to === 8), 'closed point');
  const r = move(s, 13, 3); // 13 -> 10 hits
  assert.equal(r.events[0].hit, true);
  assert.equal(r.state.pos.bar[1], 1);
  assert.equal(r.state.pos.pts[10], 1);
  assert.equal(E.act(r.state, 'w', { type: 'move', from: 13, die: 6 }).error, E.ERR.illegal);
  assert.equal(E.act(r.state, 'b', { type: 'roll' }).error, E.ERR.notYourTurn);
});

test('the bar comes first; a closed board means no move and the turn passes', () => {
  // black on the bar enters on white's home side (points 1-6 from black's view = 1..6)
  let s = roll(at(pos({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 }, { 19: 13 }, { bar: [0, 2], off: [3, 0] }), 1), 4, 2);
  assert.equal(s.playerIds[s.current], 'w', 'black could not enter: back to white');
  s = roll(at(pos({ 1: 2, 2: 2 }, { 19: 13 }, { bar: [11, 2] }), 1), 4, 2);
  assert.ok(legal(s).length);
  assert.ok(legal(s).every((m) => m.from === 0), 'only entering moves while on the bar');
});

test('both dice must be played when they can; otherwise the higher one', () => {
  // white 7: a 6 from 7 lands on 1; a 5 then from 1 is impossible, so 5 first (7->2) then 6 is impossible too...
  // classic: one checker on 13, black holds 7 (13-6) and 2 (13-6-5): playing 5 first (13->8) then 6 (8->2 closed)
  let s = roll(at(pos({ 13: 1, 1: 14 }, { 7: 2, 2: 2, 24: 11 })), 6, 5);
  // only 13->8 (5) then 8->2? closed; 13->7 closed. Max one die: the higher (6) cannot be played, so the 5
  assert.deepEqual(legal(s).map((m) => [m.from, m.die]), [[13, 5]]);
  // both dice possible only in one order: the other order is refused
  s = roll(at(pos({ 13: 1, 1: 14 }, { 8: 2, 24: 13 })), 6, 5);
  // 13->7 (6) then 7->2 (5): fine. 13->8 (5) is closed anyway. And 1-point checkers cannot move (bearing off not allowed)
  assert.deepEqual(legal(s).map((m) => [m.from, m.die]), [[13, 6]]);
  // higher die forced: one checker, either die alone fits but not both
  s = roll(at(pos({ 13: 1, 1: 14 }, { 2: 2, 24: 13 })), 6, 5);
  const l = legal(s);
  assert.ok(l.length > 0);
  assert.ok(l.every((m) => m.die === 6), 'must use the 6');
});

test('doubles are played four times', () => {
  let s = roll(at(E.startPos()), 3, 3);
  assert.equal(s.left.length, 4);
  let r;
  for (let k = 0; k < 4; k++) { r = move(s, 13 - (k ? 0 : 0), 3); s = r.state; }
  assert.equal(s.stage, 'confirm');
  assert.equal(E.act(s, 'w', { type: 'move', from: 6, die: 3 }).error, E.ERR.wrongStage);
});

test('bearing off: only with every checker home; exact, or a bigger die from the furthest point', () => {
  let s = roll(at(pos({ 7: 1, 3: 14 }, { 24: 15 })), 4, 1);
  assert.ok(!legal(s).some((m) => m.to === 0), 'a checker outside home: no bearing off yet');
  s = roll(at(pos({ 5: 1, 3: 14 }, { 24: 15 })), 6, 3);
  const l = legal(s);
  assert.ok(l.some((m) => m.from === 5 && m.die === 6 && m.to === 0), '6 bears off the furthest (5)');
  assert.ok(!l.some((m) => m.from === 3 && m.die === 6), 'not a nearer one while the 5 is there');
  assert.ok(l.some((m) => m.from === 3 && m.die === 3 && m.to === 0), 'exact');
});

test('undo puts the checker (and a hit one) back; done passes the turn', () => {
  let s = roll(at(pos({ 13: 2 }, { 10: 1, 24: 14 })), 3, 1);
  let r = move(s, 13, 3);
  assert.equal(r.state.pos.bar[1], 1);
  r = E.act(r.state, 'w', { type: 'undo' });
  assert.equal(r.state.pos.bar[1], 0);
  assert.equal(r.state.pos.pts[10], -1);
  assert.equal(r.state.left.length, 2);
  assert.equal(r.events[0].type, 'undo');
  assert.equal(E.act(r.state, 'w', { type: 'undo' }).error, E.ERR.nothingToUndo);
  s = move(move(r.state, 13, 3).state, 13, 1).state;
  assert.equal(s.stage, 'confirm');
  r = E.act(s, 'w', { type: 'done' });
  assert.equal(r.state.playerIds[r.state.current], 'b');
  assert.equal(r.state.stage, 'roll');
  assert.equal(r.state.lastMove.steps.length, 2);
});

test('winning: single, mars (gammon) and double mars (backgammon); the match ends at the target', () => {
  const finish = (black, extra) => {
    let s = roll(at(pos({ 1: 1 }, black, Object.assign({ off: [14, 0] }, extra))), 1, 2);
    return move(s, 1, 2); // only one die can be played: the higher one is forced
  };
  let r = finish({ 24: 10 }, { off: [14, 5] });
  assert.equal(r.events.find((e) => e.type === 'game_end').result.kind, 'single');
  r = finish({ 24: 15 });
  assert.equal(r.events.find((e) => e.type === 'game_end').result.kind, 'gammon');
  assert.equal(r.state.scores.w, 2);
  r = finish({ 24: 14, 3: 1 });
  assert.equal(r.events.find((e) => e.type === 'game_end').result.kind, 'backgammon');
  assert.equal(r.state.scores.w, 3);
  assert.equal(r.state.phase, 'matchOver', 'target 3 reached');
  assert.deepEqual(r.state.winnerIds, ['w']);
  r = finish({ 24: 15 });
  assert.equal(r.state.phase, 'gameEnd');
  const n = E.nextGame(r.state);
  assert.equal(n.state.game, 2);
  assert.equal(n.state.phase, 'turn');
  assert.deepEqual(n.state.pos, E.startPos());
});

test('viewFor: the whole board, legal steps only for whoever moves, never the seed', () => {
  const s = E.createGame(['w', 'b'], { seed: 9 }).state;
  const cur = s.playerIds[s.current];
  const other = s.playerIds[1 - s.current];
  assert.ok(E.viewFor(s, cur).legal.length > 0);
  assert.equal(E.viewFor(s, other).legal.length, 0);
  assert.ok(!JSON.stringify(E.viewFor(s, other)).includes('rng'));
  assert.ok(Array.isArray(E.viewFor(s, cur).paths));
});

test('the computer beats a random player most of the time', () => {
  let wins = 0;
  const N = 30;
  for (let seed = 1; seed <= N; seed++) {
    let s = E.createGame(['bot', 'rnd'], { seed, target: 1 }).state;
    let guard = 0;
    while (s.phase === 'turn' && guard++ < 3000) {
      if (s.playerIds[s.current] === 'bot' || s.stage === 'roll') { s = E.autoPlay(s).state; continue; }
      // random: any legal step, then done
      const l = E.viewFor(s, 'rnd').legal;
      if (s.stage === 'confirm') { s = E.act(s, 'rnd', { type: 'done' }).state; continue; }
      const m = l[(seed * 7 + guard) % l.length];
      s = E.act(s, 'rnd', { type: 'move', from: m.from, die: m.die }).state;
    }
    if (s.winnerIds && s.winnerIds[0] === 'bot') wins += 1;
  }
  assert.ok(wins >= N * 0.75, 'bot won only ' + wins + ' of ' + N);
});

test('computer players: whole matches end, 15 checkers each at every step', () => {
  for (let seed = 1; seed <= 25; seed++) {
    let s = E.createGame(['w', 'b'], { seed, target: 3 }).state;
    let n = 0;
    while (s.phase !== 'matchOver') {
      const r = s.phase === 'gameEnd' ? E.nextGame(s) : E.autoPlay(s);
      assert.ok(r.state, r.error);
      s = r.state;
      assert.equal(count(s.pos, 0), 15);
      assert.equal(count(s.pos, 1), 15);
      assert.ok(++n < 5000, 'never ends');
    }
    assert.ok(Math.max(...Object.values(s.scores)) >= 3);
  }
});
