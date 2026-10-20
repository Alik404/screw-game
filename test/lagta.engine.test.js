const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/lagta/config');
const E = require('../server/games/lagta/engine');

const game = (opts, ids) => E.createGame(ids || ['a', 'b', 'c'], Object.assign({ seed: 5 }, opts)).state;
const go = (s) => E.next(s).state;
const answer = (s, id) => E.common(s.tops[id], s.center);

test('the deck: 57 cards of 8 different symbols, any two share exactly one', () => {
  assert.equal(E.DECK.length, 57);
  assert.equal(C.SYMBOLS.length, 57);
  assert.equal(new Set(C.SYMBOLS).size, 57);
  E.DECK.forEach((c) => { assert.equal(c.length, 8); assert.equal(new Set(c).size, 8); c.forEach((x) => assert.ok(x >= 0 && x < 57)); });
  for (let i = 0; i < 57; i++) {
    for (let j = i + 1; j < 57; j++) {
      const shared = E.DECK[i].filter((x) => E.DECK[j].includes(x));
      assert.equal(shared.length, 1, 'cards ' + i + ' and ' + j);
    }
  }
});

test('the start: one card each, the pile, a countdown, then the first card', () => {
  const s = game({ size: 20 });
  assert.equal(s.phase, 'countdown');
  assert.equal(s.pile.length, 20);
  const all = Object.values(s.tops).concat(s.pile);
  assert.equal(new Set(all).size, all.length, 'no card twice');
  assert.equal(E.act(s, 'a', { type: 'claim', symbol: 0 }).error, E.ERR.wrongStage);
  const r = E.next(s);
  assert.equal(r.state.phase, 'play');
  assert.equal(r.events[0].type, 'card');
  assert.equal(r.state.pile.length, 19);
  assert.equal(E.createGame(['a', 'b'], { size: 7 }).error, E.ERR.badOptions);
  assert.equal(E.createGame(['a', 'b'], { level: 'god' }).error, E.ERR.badOptions);
  assert.match(E.createGame(['a'], {}).error, /بين/);
});

test('a right claim takes the middle card; it becomes your card; others are too late', () => {
  let s = go(game());
  const sym = answer(s, 'b');
  const center = s.center;
  const r = E.act(s, 'b', { type: 'claim', symbol: sym, at: 1000 });
  assert.equal(r.events[0].type, 'claim');
  assert.equal(r.state.counts.b, 1);
  assert.equal(r.state.tops.b, center);
  assert.equal(r.state.phase, 'between');
  assert.equal(E.act(r.state, 'a', { type: 'claim', symbol: 0, at: 1001 }).error, E.ERR.wrongStage);
  assert.equal(E.next(r.state).state.phase, 'play');
});

test('a wrong claim freezes you for a moment; the others can still win it', () => {
  let s = go(game());
  const right = answer(s, 'a');
  const wrong = E.DECK[s.tops.a].find((x) => x !== right);
  let r = E.act(s, 'a', { type: 'claim', symbol: wrong, at: 5000 });
  assert.deepEqual(r.events.map((e) => e.type), ['miss']);
  s = r.state;
  assert.equal(E.act(s, 'a', { type: 'claim', symbol: right, at: 5000 + C.FREEZE_MS - 1 }).error, E.ERR.frozen);
  r = E.act(s, 'a', { type: 'claim', symbol: right, at: 5000 + C.FREEZE_MS });
  assert.equal(r.state.counts.a, 1);
});

test('the end: when the pile is empty the most cards wins (ties share)', () => {
  let s = game({ size: 20 });
  s = go(s);
  let turn = 0;
  while (s.phase !== 'gameOver') {
    if (s.phase === 'play') {
      const id = s.playerIds[turn++ % 3];
      s = E.act(s, id, { type: 'claim', symbol: answer(s, id), at: 0 }).state;
    } else s = E.next(s).state;
  }
  assert.equal(Object.values(s.counts).reduce((a, b) => a + b, 0), 20);
  assert.ok(s.winnerIds.every((id) => s.counts[id] === Math.max(...Object.values(s.counts))));
  assert.equal(E.act(s, 'a', { type: 'claim', symbol: 1 }).error, E.ERR.gameOver);
});

test('computer players claim the right symbol; a lost card can be skipped; nothing secret leaks', () => {
  let s = go(game({ bots: ['c'] }));
  assert.ok(s.botDelay.c > 0);
  const r = E.botClaim(s, 'c');
  assert.equal(r.state.counts.c, 1);
  s = go(r.state);
  const k = E.skip(s);
  assert.equal(k.events[0].type, 'skip');
  assert.equal(k.state.phase, 'between');
  const v = E.viewFor(s, 'a');
  assert.ok(!JSON.stringify(v).includes('pile'));
  assert.ok(!('rng' in v));
  assert.equal(v.left, s.pile.length);
});

test('the hint is a lobby option, on by default', () => {
  assert.equal(game().options.hint, true);
  assert.equal(game({ hint: false }).options.hint, false);
  assert.equal(E.createGame(['a', 'b'], { hint: 'yes' }).error, E.ERR.badOptions);
});
