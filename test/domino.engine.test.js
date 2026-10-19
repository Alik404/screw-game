const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/domino/config');
const E = require('../server/games/domino/engine');

function game(opts, ids) {
  const r = E.createGame(ids || ['a', 'b'], Object.assign({ seed: 11 }, opts));
  assert.ok(r.state, r.error);
  return r.state;
}

// build a position by hand: hands, pile and line are set directly
function setup(s, hands, line, yard, current) {
  s.hands = hands;
  s.line = line || [];
  s.first = 0;
  s.yard = yard || [];
  s.must = null;
  s.passes = 0;
  s.current = current || 0;
  s.phase = 'turn';
  return s;
}

const types = (r) => r.events.map((e) => e.type);
const allTiles = (s) => [].concat(...Object.values(s.hands), s.yard, s.line.map(([a, b]) => Math.min(a, b) + '-' + Math.max(a, b)));

function lineOk(s) {
  for (let i = 1; i < s.line.length; i++) assert.equal(s.line[i - 1][1], s.line[i][0], 'line breaks at ' + i);
}

test('the set: 28 different tiles, 7 each, the rest in the pile', () => {
  assert.equal(new Set(E.fullSet()).size, 28);
  const s = game({}, ['a', 'b', 'c']);
  assert.ok(Object.values(s.hands).every((h) => h.length === C.HAND_SIZE));
  assert.equal(s.yard.length, 28 - 21);
  assert.equal(new Set(allTiles(s)).size, 28);
});

test('the first hand opens with the highest double, and only with it', () => {
  for (let seed = 1; seed < 30; seed++) {
    const s = E.createGame(['a', 'b', 'c', 'd'], { seed }).state;
    const doubles = [].concat(...Object.values(s.hands)).filter((t) => t[0] === t[2]).sort();
    assert.equal(s.must, doubles[doubles.length - 1]);
    const holder = s.playerIds[s.current];
    assert.ok(s.hands[holder].includes(s.must));
    const other = s.hands[holder].find((t) => t !== s.must);
    assert.equal(E.act(s, holder, { type: 'play', tile: other }).error, E.ERR.mustOpen);
    assert.ok(E.act(s, holder, { type: 'play', tile: s.must }).state);
  }
});

test('options: defaults, invalid refused, partners only with four players', () => {
  assert.deepEqual(game().options, { mode: 'draw', target: 101, teams: false });
  assert.equal(E.createGame(['a', 'b'], { mode: 'fast' }).error, E.ERR.badOptions);
  assert.equal(E.createGame(['a', 'b'], { target: 77 }).error, E.ERR.badOptions);
  assert.equal(E.createGame(['a', 'b'], { teams: 'yes' }).error, E.ERR.badOptions);
  assert.equal(game({ teams: true }).options.teams, false);
  const t = game({ teams: true }, ['a', 'b', 'c', 'd']);
  assert.deepEqual(t.teams, { a: 'A', b: 'B', c: 'A', d: 'B' });
  assert.deepEqual(t.scores, { A: 0, B: 0 });
  assert.match(E.createGame(['a'], {}).error, /بين/);
  assert.match(E.createGame(['a', 'b', 'c', 'd', 'e'], {}).error, /بين/);
});

test('playing: matching an end, orientation, choosing an end when both fit', () => {
  const s = setup(game(), { a: ['3-5', '1-3', '0-0'], b: ['2-2', '4-6'] }, [[3, 4], [4, 1]]);
  // 3-5 fits the left end (3) only
  let r = E.act(s, 'a', { type: 'play', tile: '3-5' });
  assert.deepEqual(r.state.line[0], [5, 3]);
  assert.equal(r.state.first, 1);
  lineOk(r.state);
  // 1-3 fits both ends (3 left, 1 right) with different numbers: the end must be chosen
  assert.equal(E.act(s, 'a', { type: 'play', tile: '1-3' }).error, E.ERR.chooseEnd);
  r = E.act(s, 'a', { type: 'play', tile: '1-3', end: 'right' });
  assert.deepEqual(r.state.line[r.state.line.length - 1], [1, 3]);
  assert.equal(E.act(s, 'a', { type: 'play', tile: '0-0' }).error, E.ERR.noFit);
  assert.equal(E.act(s, 'a', { type: 'play', tile: '3-5', end: 'right' }).error, E.ERR.noFitEnd);
  assert.equal(E.act(s, 'a', { type: 'play', tile: '6-6' }).error, E.ERR.noTile);
  assert.equal(E.act(s, 'b', { type: 'play', tile: '2-2' }).error, E.ERR.notYourTurn);
  const before = JSON.stringify(s);
  E.act(s, 'a', { type: 'play', tile: '3-5' });
  assert.equal(JSON.stringify(s), before, 'never mutates its input');
});

test('drawing: only with nothing to play, until something fits; the turn stays', () => {
  const s = setup(game(), { a: ['0-0', '0-1'], b: ['2-2'] }, [[5, 6]], ['3-3', '4-5', '2-4']);
  assert.equal(E.act(s, 'b', { type: 'draw' }).error, E.ERR.notYourTurn);
  const r = E.act(s, 'a', { type: 'draw' });
  assert.deepEqual(types(r), ['draw']);
  assert.equal(r.events[0].count, 2, 'drew 2-4 (no fit) then 4-5 (fits)');
  assert.deepEqual(r.state.hands.a.sort(), ['0-0', '0-1', '2-4', '4-5']);
  assert.equal(r.state.playerIds[r.state.current], 'a');
  assert.equal(E.act(r.state, 'a', { type: 'draw' }).error, E.ERR.canPlay);
});

test('drawing the pile empty without a fit passes the turn', () => {
  const s = setup(game(), { a: ['0-0'], b: ['6-1'] }, [[5, 6]], ['2-3']);
  const r = E.act(s, 'a', { type: 'draw' });
  assert.deepEqual(types(r), ['draw', 'pass', 'turn']);
  assert.equal(r.state.playerIds[r.state.current], 'b');
});

test('block mode: no drawing, a player with nothing passes by itself', () => {
  const s = setup(game({ mode: 'block' }), { a: ['5-5', '1-2'], b: ['0-0', '0-1'], c: ['5-1'] }, [[5, 6]], [], 0);
  s.playerIds = ['a', 'b', 'c'];
  const r = E.act(s, 'a', { type: 'play', tile: '5-5' });
  // b holds nothing with a 5 or a 6: passes; c plays
  assert.deepEqual(types(r), ['play', 'pass', 'turn']);
  assert.equal(r.state.playerIds[r.state.current], 'c');
  assert.equal(E.act(r.state, 'c', { type: 'draw' }).error, E.ERR.noDraw);
});

test('domino: the last tile wins the hand and the opponents\' pips', () => {
  const s = setup(game(), { a: ['6-4'], b: ['5-5', '1-2'] }, [[3, 6]]);
  const r = E.act(s, 'a', { type: 'play', tile: '6-4' });
  assert.deepEqual(types(r), ['play', 'hand_end']);
  const res = r.events[1].result;
  assert.equal(res.reason, 'domino');
  assert.equal(res.winnerId, 'a');
  assert.equal(res.points, 13);
  assert.equal(r.state.scores.a, 13);
  assert.equal(r.state.phase, 'handOver');
  // the next hand: the winner leads with anything
  const n = E.nextHand(r.state);
  assert.equal(n.state.playerIds[n.state.current], 'a');
  assert.equal(n.state.must, null);
  assert.equal(n.state.hand, 2);
});

test('blocked: nobody can move; the lowest hand wins the others\' pips; a tie scores nothing', () => {
  let s = setup(game({ mode: 'block' }), { a: ['5-0', '6-6'], b: ['2-3', '4-4'] }, [[5, 5]]);
  let r = E.act(s, 'a', { type: 'play', tile: '5-0', end: 'right' });
  // ends 5 and 0: b has none, a has none -> blocked; a 12, b 13
  assert.deepEqual(types(r), ['play', 'pass', 'pass', 'hand_end']);
  const res = r.events[3].result;
  assert.equal(res.reason, 'blocked');
  assert.equal(res.winnerId, 'a');
  assert.equal(res.points, 13);
  s = setup(game({ mode: 'block' }), { a: ['5-0', '6-6'], b: ['3-4', '2-3'] }, [[5, 5]]); // 12 against 12
  r = E.act(s, 'a', { type: 'play', tile: '5-0', end: 'right' });
  const tie = r.events[r.events.length - 1].result;
  assert.equal(tie.side, null);
  assert.equal(tie.points, 0);
});

test('partners: the team scores the other team\'s pips', () => {
  const s = setup(game({ teams: true }, ['a', 'b', 'c', 'd']), { a: ['6-4'], b: ['1-1'], c: ['2-2'], d: ['3-3'] }, [[3, 6]]);
  const r = E.act(s, 'a', { type: 'play', tile: '6-4' });
  assert.equal(r.state.scores.A, 2 + 6);
  assert.equal(r.state.scores.B, 0);
});

test('reaching the target ends the game; end_game crowns the leader', () => {
  const s = setup(game({ target: 51 }), { a: ['6-4'], b: ['6-6', '5-5', '4-4', '6-5', '3-3'] }, [[3, 6]]);
  s.scores.a = 10;
  const r = E.act(s, 'a', { type: 'play', tile: '6-4' });
  assert.equal(r.state.phase, 'gameOver');
  assert.deepEqual(r.state.winnerSides, ['a']);
  assert.equal(types(r).pop(), 'game_over');
  assert.equal(E.act(r.state, 'b', { type: 'draw' }).error, E.ERR.gameOver);
  const g = game();
  g.scores = { a: 30, b: 40 };
  const e = E.endGameEarly(g);
  assert.deepEqual(e.state.winnerSides, ['b']);
  assert.equal(e.state.endedEarly, true);
});

test('viewFor: my hand, counts for others, no pile, no seed', () => {
  const s = game({}, ['a', 'b', 'c']);
  const v = E.viewFor(s, 'b');
  assert.deepEqual(v.hand, s.hands.b);
  assert.deepEqual(v.players.map((p) => p.count), [7, 7, 7]);
  const text = JSON.stringify(v);
  // the opening double is public on purpose (everyone sees it played first); nothing else of theirs is
  s.hands.a.concat(s.hands.c, s.yard).filter((t) => t !== s.must).forEach((t) => assert.ok(!text.includes('"' + t + '"'), 'leaks ' + t));
  assert.ok(!text.includes('rng'));
  assert.equal(v.yard, 7);
  const cur = s.playerIds[s.current];
  assert.ok(E.viewFor(s, cur).playable.length > 0);
  assert.equal(E.viewFor(s, s.playerIds[(s.current + 1) % 3]).playable.length, 0);
});

test('computer players: whole games end, tiles are never lost, the line always matches', () => {
  [2, 3, 4].forEach((n) => {
    C.MODES.forEach((mode) => {
      [false, true].forEach((teams) => {
        for (let seed = 1; seed <= 12; seed++) {
          const ids = ['a', 'b', 'c', 'd'].slice(0, n);
          let s = E.createGame(ids, { seed, mode, teams, target: 51 }).state;
          let moves = 0;
          while (s.phase !== 'gameOver') {
            const r = s.phase === 'handOver' ? E.nextHand(s) : E.autoPlay(s);
            assert.ok(r.state, r.error);
            s = r.state;
            lineOk(s);
            assert.equal(allTiles(s).length, 28);
            assert.equal(new Set(allTiles(s)).size, 28);
            assert.ok(Object.values(s.scores).every((x) => x >= 0));
            assert.ok(++moves < 4000, 'game never ends');
          }
          assert.ok(Math.max(...Object.values(s.scores)) >= 51);
        }
      });
    });
  });
});
