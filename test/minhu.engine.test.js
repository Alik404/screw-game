const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/games/minhu/config');
const E = require('../server/games/minhu/engine');

const game = (opts) => E.createGame(['a', 'b'], Object.assign({ seed: 4 }, opts)).state;
const cur = (s) => s.playerIds[s.current];
const opp = (s, id) => (id === 'a' ? 'b' : 'a');

test('the cast: 24 characters, no two answer every question the same way, every question splits them', () => {
  assert.equal(C.CHARACTERS.length, 24);
  const sig = C.CHARACTERS.map((c, i) => C.QUESTIONS.map((q) => (E.matches(i, q) ? 1 : 0)).join(''));
  assert.equal(new Set(sig).size, 24, 'two characters cannot be told apart');
  C.QUESTIONS.forEach((q) => {
    const yes = C.CHARACTERS.filter((c, i) => E.matches(i, q)).length;
    assert.ok(yes >= 1 && yes <= 23, q.id + ' is useless (' + yes + ')');
  });
  assert.equal(new Set(C.QUESTIONS.map((q) => q.id)).size, C.QUESTIONS.length);
  // what the faces show must agree: hidden or bald hair has no colour, a beard belongs to a man, hijab to a woman
  C.CHARACTERS.forEach((c) => {
    assert.equal(c.color === null, c.hair === 'hidden' || c.hair === 'bald', c.name);
    assert.equal(c.hair === 'hidden', c.hat === 'hijab' || c.hat === 'shemagh', c.name);
    if (c.beard || c.mustache || c.hat === 'shemagh') assert.equal(c.g, 'm', c.name);
    if (c.hat === 'hijab') assert.equal(c.g, 'f', c.name);
  });
});

test('every set: 24 characters, all different by their answers, every question splits them', () => {
  assert.deepEqual(C.SET_OPTIONS.slice().sort(), Object.keys(C.SETS).sort());
  C.SET_OPTIONS.forEach((set) => {
    const S = C.SETS[set];
    assert.equal(S.characters.length, 24, set);
    assert.equal(new Set(S.characters.map((c) => c.name)).size, 24, set + ': names');
    const sig = S.characters.map((c, i) => S.questions.map((q) => (E.matches(i, q, set) ? 1 : 0)).join(''));
    assert.equal(new Set(sig).size, 24, set + ': two characters cannot be told apart');
    S.questions.forEach((q) => {
      const yes = S.characters.filter((c, i) => E.matches(i, q, set)).length;
      assert.ok(yes >= 1 && yes <= 23, set + '/' + q.id + ' is useless');
    });
    assert.equal(new Set(S.questions.map((q) => q.id)).size, S.questions.length, set + ': question ids');
  });
});

test('the set is a lobby option; questions belong to the chosen set', () => {
  assert.equal(game().options.set, 'people');
  assert.equal(E.createGame(['a', 'b'], { set: 'planets' }).error, E.ERR.badOptions);
  const s = E.createGame(['a', 'b'], { seed: 2, set: 'robots' }).state;
  const p = cur(s);
  assert.equal(E.act(s, p, { type: 'ask', q: 'beard' }).error, E.ERR.badQuestion, 'a people question on the robots board');
  const r = E.act(s, p, { type: 'ask', q: 'antenna' });
  assert.equal(r.events[0].yes, C.SETS.robots.characters[s.secrets[opp(s, p)]].top === 'antenna');
});

test('the smart computer plays every set well', () => {
  C.SET_OPTIONS.forEach((set) => {
    for (let seed = 1; seed <= 15; seed++) {
      let s = E.createGame(['x', 'y'], { seed, set, bots: ['x', 'y'], target: 1 }).state;
      let n = 0;
      while (s.phase === 'turn') { s = E.autoPlay(s).state; assert.ok(++n < 200); }
      assert.equal(s.result.reason, 'right', set);
    }
  });
});

test('a round: different secrets, ask (answered from the secret), flip, end the turn', () => {
  let s = game();
  assert.notEqual(s.secrets.a, s.secrets.b);
  const p = cur(s);
  const q = C.QUESTIONS[0];
  assert.equal(E.act(s, opp(s, p), { type: 'ask', q: q.id }).error, E.ERR.notYourTurn);
  assert.equal(E.act(s, p, { type: 'ask', q: 'tall' }).error, E.ERR.badQuestion);
  assert.equal(E.act(s, p, { type: 'end_turn' }).error, E.ERR.wrongStage);
  let r = E.act(s, p, { type: 'ask', q: q.id });
  assert.equal(r.events[0].yes, E.matches(s.secrets[opp(s, p)], q));
  s = r.state;
  assert.equal(s.stage, 'flip');
  assert.equal(E.act(s, p, { type: 'ask', q: 'old' }).error, E.ERR.wrongStage);
  s = E.act(s, p, { type: 'flip', ids: [3, 1, 3, 2] }).state;
  assert.deepEqual(s.down[p], [1, 2, 3]);
  assert.equal(E.act(s, p, { type: 'flip', ids: [99] }).error, E.ERR.badChar);
  assert.equal(E.act(s, p, { type: 'flip', ids: 'all' }).error, E.ERR.badAction);
  s = E.act(s, p, { type: 'end_turn' }).state;
  assert.equal(cur(s), opp(s, p));
  // asking the same question twice is refused (for the same asker)
  s = E.act(E.act(s, cur(s), { type: 'ask', q: 'old' }).state, cur(s), { type: 'end_turn' }).state;
  assert.equal(E.act(s, p, { type: 'ask', q: q.id }).error, E.ERR.asked);
});

test('guessing: right wins the round, wrong loses it; the match ends at the target', () => {
  let s = game({ target: 2 });
  let p = cur(s);
  let r = E.act(s, p, { type: 'guess', char: s.secrets[opp(s, p)] });
  assert.equal(r.events[0].right, true);
  assert.equal(r.state.scores[p], 1);
  assert.equal(r.state.phase, 'roundOver');
  assert.equal(E.viewFor(r.state, opp(s, p)).oppSecret, s.secrets[p]);
  s = E.nextRound(r.state).state;
  assert.equal(s.round, 2);
  assert.equal(cur(s), opp(s, p), 'the other player starts the next round');
  p = cur(s);
  const wrong = [0, 1, 2].find((i) => i !== s.secrets[opp(s, p)]);
  r = E.act(s, p, { type: 'guess', char: wrong });
  assert.equal(r.events[0].right, false);
  assert.equal(r.state.scores[opp(s, p)], 2);
  assert.equal(r.state.phase, 'matchOver');
  assert.equal(E.act(r.state, p, { type: 'ask', q: 'male' }).error, E.ERR.gameOver);
});

test('choosing: each player picks a secret (the other only sees that it is done); then the round starts', () => {
  let s = game({ pick: 'choose' });
  assert.equal(s.phase, 'pick');
  assert.deepEqual(s.secrets, { a: null, b: null });
  assert.equal(E.act(s, 'a', { type: 'ask', q: 'male' }).error, E.ERR.wrongStage);
  assert.equal(E.act(s, 'a', { type: 'pick', char: 99 }).error, E.ERR.badChar);
  let r = E.act(s, 'a', { type: 'pick', char: 7 });
  assert.deepEqual(r.events, [{ type: 'pick', playerId: 'a' }]);
  s = r.state;
  assert.equal(E.act(s, 'a', { type: 'pick', char: 3 }).error, E.ERR.picked);
  const vb = E.viewFor(s, 'b');
  assert.equal(vb.secret, null);
  assert.equal(vb.players.find((p) => p.id === 'a').picked, true);
  assert.ok(!JSON.stringify(vb).includes('"secrets"'));
  r = E.act(s, 'b', { type: 'pick', random: true });
  assert.deepEqual(r.events.map((e) => e.type), ['pick', 'picks_done']);
  assert.equal(r.state.phase, 'turn');
  assert.equal(r.state.secrets.a, 7);
  assert.ok(r.state.secrets.b !== null && r.state.secrets.b !== 7);
  assert.equal(E.viewFor(r.state, 'a').secret, 7);
});

test('choosing: a computer player picks at once; the clock picks for a slow player', () => {
  const s = E.createGame(['a', 'b'], { seed: 3, pick: 'choose', bots: ['b'] }).state;
  assert.equal(s.phase, 'pick');
  assert.notEqual(s.secrets.b, null);
  const r = E.autoPick(s);
  assert.equal(r.state.phase, 'turn');
  assert.notEqual(r.state.secrets.a, null);
  assert.equal(r.events[0].auto, true);
  assert.equal(E.createGame(['a', 'b'], { pick: 'mind' }).error, E.ERR.badOptions);
  const both = E.createGame(['x', 'y'], { seed: 1, pick: 'choose', bots: ['x', 'y'] }).state;
  assert.equal(both.phase, 'turn', 'two computer players start right away');
});

test('nobody gets the same character twice in a match', () => {
  for (let seed = 1; seed <= 30; seed++) {
    let s = E.createGame(['a', 'b'], { seed, target: 3 }).state;
    const seen = { a: [s.secrets.a], b: [s.secrets.b] };
    while (s.phase !== 'matchOver') {
      const p = cur(s);
      s = E.act(s, p, { type: 'guess', char: s.secrets[opp(s, p)] }).state;
      if (s.phase === 'roundOver') {
        s = E.nextRound(s).state;
        ['a', 'b'].forEach((id) => { assert.ok(!seen[id].includes(s.secrets[id]), 'repeat for ' + id); seen[id].push(s.secrets[id]); });
        assert.notEqual(s.secrets.a, s.secrets.b);
      }
    }
  }
});

test('secrecy: my view never holds the other secret during a round', () => {
  const s = game();
  ['a', 'b'].forEach((id) => {
    const v = E.viewFor(s, id);
    assert.equal(v.secret, s.secrets[id]);
    assert.equal(v.oppSecret, null);
    assert.ok(!JSON.stringify(v).includes('secrets'));
  });
});

test('a person whose clock runs out just loses the turn', () => {
  const s = game();
  const r = E.autoPlay(s);
  assert.equal(r.events[0].type, 'timeout');
  assert.equal(cur(r.state), opp(s, cur(s)));
});

test('the smart computer finds any character in a handful of questions; the easy one gets there too', () => {
  ['smart', 'easy'].forEach((level) => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = E.createGame(['x', 'y'], { seed, level, bots: ['x', 'y'], target: 1 }).state;
      let n = 0;
      while (s.phase === 'turn') { s = E.autoPlay(s).state; n += 1; assert.ok(n < 200); }
      total += s.result.questions;
      if (level === 'smart') assert.equal(s.result.reason, 'right', 'the smart computer never guesses wrong');
    }
    if (level === 'smart') assert.ok(total / 40 <= 12, 'average questions per round ' + total / 40);
  });
});
