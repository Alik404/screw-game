const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/snakes/config');
const E = require('../server/games/snakes/engine');

function game(opts, ids) {
  const r = E.createGame(ids || ['a', 'b', 'c'], Object.assign({ seed: 7, first: 0 }, opts));
  assert.ok(r.state, r.error);
  return r.state;
}

// roll a chosen value for the current player
function roll(s, value) {
  const r = E.act(s, s.playerIds[s.current], { type: 'roll', forced: value });
  assert.ok(r.state, r.error);
  return r;
}

function at(s, id, pos) {
  s.positions[id] = pos;
  s.turnStart = pos;
  return s;
}

const types = (r) => r.events.map((e) => e.type);

test('boards: 100 squares, no jump ends on the start of another, snakes go down and ladders up', () => {
  C.BOARD_OPTIONS.forEach((name) => {
    const b = C.BOARDS[name];
    assert.ok(b && b.name, name);
    const starts = Object.keys(b.snakes).concat(Object.keys(b.ladders)).map(Number);
    assert.equal(new Set(starts).size, starts.length, name + ': a square starts two jumps');
    Object.entries(b.snakes).forEach(([h, t]) => {
      assert.ok(+h > t && t >= 1 && +h < C.SQUARES, name + ' snake ' + h);
      assert.ok(starts.indexOf(t) < 0, name + ' snake tail ' + t);
    });
    Object.entries(b.ladders).forEach(([f, t]) => {
      assert.ok(t > +f && +f >= 1 && t <= C.SQUARES, name + ' ladder ' + f);
      assert.ok(starts.indexOf(t) < 0, name + ' ladder top ' + t);
    });
  });
});

test('createGame: everyone off the board, options default, bad options and player counts refused', () => {
  const s = game();
  assert.deepEqual(s.positions, { a: 0, b: 0, c: 0 });
  assert.deepEqual(s.options, { board: 'classic', finish: 'bounce', sixAgain: true, startSix: false });
  assert.equal(s.phase, 'turn');
  assert.match(E.createGame(['a'], {}).error, /بين/);
  assert.match(E.createGame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], {}).error, /بين/);
  assert.equal(E.createGame(['a', 'a'], {}).error, E.ERR.badAction);
  assert.equal(E.createGame(['a', 'b'], { board: 'moon' }).error, E.ERR.badOptions);
  assert.equal(E.createGame(['a', 'b'], { finish: 'never' }).error, E.ERR.badOptions);
  assert.equal(E.createGame(['a', 'b'], { sixAgain: 'yes' }).error, E.ERR.badOptions);
  assert.equal(E.createGame(['a', 'b'], { startSix: 1 }).error, E.ERR.badOptions);
  const w = E.createGame(['a', 'b'], { board: 'wild', finish: 'exact', sixAgain: false, startSix: true, bots: ['b', 'zz'] }).state;
  assert.deepEqual(w.options, { board: 'wild', finish: 'exact', sixAgain: false, startSix: true });
  assert.deepEqual(w.bots, ['b']);
});

test('the first player is drawn by lot', () => {
  const firsts = new Set();
  for (let seed = 0; seed < 40; seed++) firsts.add(E.createGame(['a', 'b', 'c'], { seed }).state.current);
  assert.equal(firsts.size, 3);
});

test('a plain roll walks square by square and passes the turn', () => {
  const s = game({ board: 'kids' });
  const r = roll(s, 3);
  assert.deepEqual(types(r), ['roll', 'move', 'turn']);
  const mv = r.events[1];
  assert.deepEqual([mv.from, mv.to, mv.path], [0, 3, [1, 2, 3]]);
  assert.equal(r.state.positions.a, 3);
  assert.equal(r.state.playerIds[r.state.current], 'b');
  assert.deepEqual(r.state.lastRoll, { playerId: 'a', value: 3, seq: 1 });
});

test('a ladder climbs and a snake bites, with stats', () => {
  let s = game();
  let r = roll(s, 1); // classic: 1 -> 38
  assert.deepEqual(types(r), ['roll', 'move', 'ladder', 'turn']);
  assert.deepEqual([r.events[2].from, r.events[2].to], [1, 38]);
  assert.equal(r.state.positions.a, 38);
  assert.equal(r.state.stats.a.ladders, 1);
  assert.equal(r.state.stats.a.climbed, 37);

  s = at(game(), 'a', 12);
  r = roll(s, 4); // 16 -> 6
  assert.deepEqual(types(r), ['roll', 'move', 'snake', 'turn']);
  assert.equal(r.state.positions.a, 6);
  assert.equal(r.state.stats.a.snakes, 1);
  assert.equal(r.state.stats.a.fallen, 10);
});

test('not your turn, game over and unknown actions are refused without changing anything', () => {
  const s = game();
  assert.equal(E.act(s, 'b', { type: 'roll' }).error, E.ERR.notYourTurn);
  assert.equal(E.act(s, 'zz', { type: 'roll' }).error, E.ERR.unknownPlayer);
  assert.equal(E.act(s, 'a', { type: 'fly' }).error, E.ERR.badAction);
  assert.equal(E.act(s, 'a', null).error, E.ERR.badAction);
  const before = JSON.stringify(s);
  E.act(s, 'a', { type: 'roll' });
  assert.equal(JSON.stringify(s), before, 'the input state is never mutated');
});

test('reaching 100 wins and ends the game', () => {
  const s = at(game(), 'a', 97);
  const r = roll(s, 3);
  assert.deepEqual(types(r), ['roll', 'move', 'game_over']);
  assert.equal(r.state.phase, 'gameOver');
  assert.deepEqual(r.state.winnerIds, ['a']);
  assert.equal(E.act(r.state, 'b', { type: 'roll' }).error, E.ERR.gameOver);
  assert.equal(E.autoPlay(r.state).error, E.ERR.wrongStage);
  assert.equal(E.viewFor(r.state, 'b').ranking[0], 'a');
});

test('the classic ladder on 80 goes straight to 100 and wins', () => {
  const r = roll(at(game(), 'a', 77), 3);
  assert.deepEqual(types(r), ['roll', 'move', 'ladder', 'game_over']);
  assert.deepEqual(r.state.winnerIds, ['a']);
});

test('finish rule "bounce": the extra steps walk back, and a snake there still bites', () => {
  const r = roll(at(game({ board: 'kids' }), 'a', 97), 5);
  const mv = r.events[1];
  assert.equal(mv.bounced, true);
  assert.deepEqual(mv.path, [98, 99, 100, 99, 98]);
  assert.equal(r.state.positions.a, 98);
  // classic: 96 + 6 bounces back to 98, which is a snake head (98 -> 78)
  const r2 = roll(at(game({ sixAgain: false }), 'a', 96), 6);
  assert.equal(r2.events[1].to, 98);
  assert.equal(r2.events[2].type, 'snake');
  assert.equal(r2.state.positions.a, 78);
});

test('finish rule "exact": a roll past 100 does not move', () => {
  const r = roll(at(game({ finish: 'exact' }), 'a', 97), 5);
  assert.equal(r.events[1].blocked, true);
  assert.deepEqual(r.events[1].path, []);
  assert.equal(r.state.positions.a, 97);
  assert.equal(r.state.phase, 'turn');
});

test('finish rule "over": any roll that reaches 100 wins', () => {
  const r = roll(at(game({ finish: 'over', board: 'kids' }), 'a', 97), 5);
  assert.deepEqual(r.events[1].path, [98, 99, 100]);
  assert.deepEqual(r.state.winnerIds, ['a']);
});

test('a six rolls again; the third six in a row sends you back to where the turn began', () => {
  let s = at(game({ board: 'kids' }), 'a', 30);
  let r = roll(s, 6); // 36
  assert.deepEqual(types(r), ['roll', 'move', 'extra_roll']);
  assert.equal(r.state.playerIds[r.state.current], 'a');
  r = roll(r.state, 6); // 42
  assert.equal(r.state.positions.a, 42);
  r = roll(r.state, 6);
  assert.deepEqual(types(r), ['roll', 'three_sixes', 'turn']);
  assert.deepEqual([r.events[1].from, r.events[1].to], [42, 30]);
  assert.equal(r.state.positions.a, 30);
  assert.equal(r.state.playerIds[r.state.current], 'b');
  assert.equal(r.state.sixes, 0);
  assert.equal(r.state.stats.a.sixes, 3);
});

test('six again can be switched off', () => {
  const r = roll(game({ sixAgain: false, board: 'kids' }), 6);
  assert.deepEqual(types(r), ['roll', 'move', 'turn']);
  assert.equal(r.state.playerIds[r.state.current], 'b');
});

test('start with a six: off the board, anything but a six passes the turn', () => {
  const s = game({ startSix: true, board: 'kids' });
  let r = roll(s, 4);
  assert.deepEqual(types(r), ['roll', 'need_six', 'turn']);
  assert.equal(r.state.positions.a, 0);
  r = roll(at(s, 'a', 0), 6);
  assert.equal(r.state.positions.a, 6);
  // once on the board, any number moves
  r = roll(at(game({ startSix: true, board: 'kids' }), 'a', 3), 2);
  assert.equal(r.state.positions.a, 5);
});

test('autoPlay rolls for the current player', () => {
  const s = game();
  const r = E.autoPlay(s);
  assert.ok(r.state);
  assert.equal(r.events[0].type, 'roll');
  assert.equal(r.events[0].playerId, 'a');
});

test('the host can end the game early: the furthest player wins, ties share', () => {
  const s = game();
  s.positions = { a: 40, b: 55, c: 55 };
  const r = E.endGameEarly(s);
  assert.deepEqual(r.state.winnerIds, ['b', 'c']);
  assert.equal(r.state.endedEarly, true);
  assert.equal(r.events[0].early, true);
  assert.equal(E.endGameEarly(r.state).error, E.ERR.wrongStage);
});

test('viewFor shows the whole table but never the random seed', () => {
  const s = game({ bots: ['c'] });
  const v = E.viewFor(s, 'b');
  assert.equal(v.you, 'b');
  assert.equal(v.currentPlayerId, 'a');
  assert.equal(v.rng, undefined);
  assert.ok(!JSON.stringify(v).includes('"rng"'));
  assert.deepEqual(v.players.map((p) => p.bot), [false, false, true]);
});

test('bots: whole random games always end, positions stay on the board, stats add up', () => {
  C.BOARD_OPTIONS.forEach((board) => {
    C.FINISH_OPTIONS.forEach((finish) => {
      [true, false].forEach((startSix) => {
        for (let seed = 1; seed <= 15; seed++) {
          let s = E.createGame(['a', 'b', 'c', 'd'], { seed, board, finish, startSix }).state;
          let rolls = 0;
          while (s.phase === 'turn') {
            const r = E.autoPlay(s);
            assert.ok(r.state, r.error);
            s = r.state;
            rolls += 1;
            Object.values(s.positions).forEach((p) => assert.ok(p >= 0 && p <= C.SQUARES));
            Object.values(s.positions).forEach((p) => assert.equal(E.jumpAt(C.BOARDS[board], p), null, 'nobody rests on a jump start'));
            assert.ok(rolls < 5000, 'game never ends');
          }
          assert.equal(s.positions[s.winnerIds[0]], C.SQUARES);
          assert.equal(Object.values(s.stats).reduce((n, x) => n + x.rolls, 0), rolls);
        }
      });
    });
  });
});
