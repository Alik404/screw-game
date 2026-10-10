const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../server/games/seven/config');
const Deck = require('../server/games/seven/deck');
const E = require('../server/games/seven/engine');

// ---------- helpers ----------

let nextTestId = 0;
const num = (color, rank) => Object.assign(Deck.makeCard('num', color, rank), { id: 't' + nextTestId++ });
const act = (type, color) => Object.assign(Deck.makeCard(type, color), { id: 't' + nextTestId++ });
const wild = () => act('wild');
const wild4 = () => act('wild4');

function game(n, seed, rounds) {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, n || 2);
  const r = E.createGame(ids, { seed: seed === undefined ? 5 : seed, idSeed: 9, rounds: rounds });
  assert.ok(r.state, r.error);
  return r.state;
}

// state is plain JSON: tests may shape it directly. current = 'a' unless told otherwise.
function setup(s, o) {
  const c = JSON.parse(JSON.stringify(s));
  c.phase = 'turn';
  c.stage = 'play';
  c.drawn = null;
  c.direction = 1;
  c.current = 0;
  if (o.hands) Object.keys(o.hands).forEach((id) => { c.hands[id] = o.hands[id]; });
  if (o.top) { c.discard = [o.top]; c.color = o.color || o.top.color; }
  if (o.deck) c.deck = o.deck;
  if (o.current !== undefined) c.current = o.current;
  if (o.direction !== undefined) c.direction = o.direction;
  if (o.stage) c.stage = o.stage;
  return c;
}

function ok(s, pid, action) {
  const r = E.act(s, pid, action);
  assert.ok(r.state, 'expected success for ' + JSON.stringify(action) + ' but got: ' + r.error);
  return r;
}

function bad(s, pid, action) {
  const r = E.act(s, pid, action);
  assert.ok(r.error, 'expected an error for ' + JSON.stringify(action));
  assert.equal(r.state, undefined);
  return r.error;
}

const cur = (s) => s.playerIds[s.current];
const types = (r) => r.events.map((e) => e.type);

// ---------- deck ----------

test('deck: 108 cards with the standard composition', () => {
  const d = Deck.buildDeck();
  assert.equal(d.length, 108);
  const count = (f) => d.filter(f).length;
  CONFIG.COLORS.forEach((color) => {
    assert.equal(count((c) => c.type === 'num' && c.color === color && c.rank === 0), 1);
    for (let rank = 1; rank <= 9; rank++) assert.equal(count((c) => c.type === 'num' && c.color === color && c.rank === rank), 2);
    ['skip', 'reverse', 'draw2'].forEach((t) => assert.equal(count((c) => c.type === t && c.color === color), 2));
  });
  assert.equal(count((c) => c.type === 'wild'), 4);
  assert.equal(count((c) => c.type === 'wild4'), 4);
  assert.ok(d.filter(Deck.isWild).every((c) => c.color === undefined));
});

test('deck: values are the score points', () => {
  assert.equal(num('red', 7).value, 7);
  assert.equal(act('skip', 'red').value, 20);
  assert.equal(act('reverse', 'red').value, 20);
  assert.equal(act('draw2', 'red').value, 20);
  assert.equal(wild().value, 50);
  assert.equal(wild4().value, 50);
});

test('deck: Arabic names', () => {
  assert.equal(Deck.describe(num('red', 5)), '5 أحمر');
  assert.equal(Deck.describe(act('skip', 'blue')), 'منع أزرق');
  assert.equal(Deck.describe(wild()), 'لون');
  assert.equal(Deck.describe(wild4()), '+4 لون');
});

// ---------- deal ----------

test('deal: 7 cards each, one table card, nothing lost, ids unique', () => {
  const s = game(4);
  ['a', 'b', 'c', 'd'].forEach((id) => assert.equal(s.hands[id].length, CONFIG.HAND_SIZE));
  assert.equal(s.discard.length, 1);
  assert.equal(s.deck.length + 4 * 7 + 1, 108);
  const ids = [].concat(...['a', 'b', 'c', 'd'].map((id) => s.hands[id].map((c) => c.id)));
  assert.equal(new Set(ids).size, 28);
  ids.forEach((id) => assert.match(id, /^u[0-9a-z]+$/));
});

test('createGame: bad player counts, duplicates and bad rounds are refused', () => {
  assert.ok(E.createGame(['a']).error);
  assert.ok(E.createGame(['a', 'b', 'c', 'd', 'e', 'f', 'g']).error);
  assert.ok(E.createGame(['a', 'a']).error);
  assert.equal(E.createGame(['a', 'b'], { rounds: 4 }).error, E.ERR.badRounds);
  assert.ok(E.createGame(['a', 'b'], { rounds: 5 }).state);
  assert.equal(E.createGame(['a', 'b']).state.rounds, CONFIG.DEFAULT_ROUNDS);
});

test('same seed, same deal; the id stream never changes the cards', () => {
  const strip = (h) => h.map((c) => c.type + c.color + c.rank);
  const a = E.createGame(['a', 'b'], { seed: 3, idSeed: 1 }).state;
  const b = E.createGame(['a', 'b'], { seed: 3, idSeed: 1 }).state;
  const c = E.createGame(['a', 'b'], { seed: 3, idSeed: 2 }).state;
  assert.deepEqual(a.hands, b.hands);
  assert.deepEqual(strip(a.hands.a), strip(c.hands.a));
  assert.notDeepEqual(a.hands.a.map((x) => x.id), c.hands.a.map((x) => x.id));
});

test('the first table card is never a +4', () => {
  for (let seed = 1; seed <= 400; seed++) assert.notEqual(game(3, seed).discard[0].type, 'wild4');
});

function findSeed(n, pred) {
  for (let seed = 1; seed <= 6000; seed++) {
    const s = game(n, seed);
    if (pred(s)) return { s, seed };
  }
  throw new Error('no seed found');
}

test('first card: a number card changes nothing', () => {
  const { s } = findSeed(3, (x) => x.discard[0].type === 'num');
  assert.equal(s.current, 0);
  assert.equal(s.direction, 1);
  assert.equal(s.stage, 'play');
  assert.equal(s.color, s.discard[0].color);
});

test('first card: skip passes over the first player', () => {
  const { s } = findSeed(3, (x) => x.discard[0].type === 'skip');
  assert.equal(s.current, 1);
});

test('first card: reverse flips the direction (3 players) or skips (2 players)', () => {
  assert.equal(findSeed(3, (x) => x.discard[0].type === 'reverse').s.direction, -1);
  assert.equal(findSeed(3, (x) => x.discard[0].type === 'reverse').s.current, 0);
  const two = findSeed(2, (x) => x.discard[0].type === 'reverse').s;
  assert.equal(two.current, 1);
});

test('first card: +2 makes the first player draw two and lose the turn', () => {
  const { s } = findSeed(3, (x) => x.discard[0].type === 'draw2');
  assert.equal(s.hands.a.length, CONFIG.HAND_SIZE + 2);
  assert.equal(s.current, 1);
});

test('first card: a wild makes the first player pick the colour', () => {
  const { s } = findSeed(3, (x) => x.discard[0].type === 'wild');
  assert.equal(s.stage, 'color');
  assert.equal(s.color, null);
  bad(s, 'b', { type: 'choose_color', color: 'red' });
  assert.equal(bad(s, 'a', { type: 'choose_color', color: 'purple' }), E.ERR.needColor);
  bad(s, 'a', { type: 'draw' }); // nothing else until the colour is chosen
  const r = ok(s, 'a', { type: 'choose_color', color: 'green' });
  assert.equal(r.state.color, 'green');
  assert.equal(r.state.stage, 'play');
  assert.equal(r.state.current, 0);
});

// ---------- matching ----------

function tryPlay(top, card, color) {
  const c = card;
  const s = setup(game(2), { top, color, hands: { a: [c, num('green', 9)], b: [num('red', 1)] } });
  return E.act(s, 'a', { type: 'play', card: c.id, color: 'red' });
}

test('match: same colour, same number or same action', () => {
  assert.ok(tryPlay(num('red', 3), num('red', 8)).state, 'same colour');
  assert.ok(tryPlay(num('red', 3), num('blue', 3)).state, 'same number');
  assert.ok(tryPlay(act('skip', 'red'), act('skip', 'blue')).state, 'same action');
  assert.ok(tryPlay(act('draw2', 'red'), act('draw2', 'green')).state, 'same action');
  assert.ok(tryPlay(act('reverse', 'red'), act('reverse', 'green')).state, 'same action');
});

test('match: a different colour and number does not match', () => {
  assert.equal(tryPlay(num('red', 3), num('blue', 4)).error, E.ERR.cannotPlay);
  assert.equal(tryPlay(act('skip', 'red'), num('blue', 4)).error, E.ERR.cannotPlay);
  assert.equal(tryPlay(act('skip', 'red'), act('reverse', 'blue')).error, E.ERR.cannotPlay);
  // a number never matches an action of the same colour code by value
  assert.equal(tryPlay(num('red', 3), act('skip', 'blue')).error, E.ERR.cannotPlay);
});

test('match: after a wild only the chosen colour matches (not an old number)', () => {
  const top = wild();
  const s = setup(game(2), { top, color: 'blue', hands: { a: [num('red', 5), num('blue', 2)], b: [num('red', 1)] } });
  assert.equal(bad(s, 'a', { type: 'play', card: s.hands.a[0].id }), E.ERR.cannotPlay);
  assert.ok(ok(s, 'a', { type: 'play', card: s.hands.a[1].id }).state);
});

test('a wild always plays, and needs a valid colour', () => {
  const w = wild();
  const s = setup(game(3), { top: num('red', 3), hands: { a: [w, num('green', 4)], b: [num('red', 1)], c: [num('red', 2)] } });
  assert.equal(bad(s, 'a', { type: 'play', card: w.id }), E.ERR.needColor);
  assert.equal(bad(s, 'a', { type: 'play', card: w.id, color: 'pink' }), E.ERR.needColor);
  const r = ok(s, 'a', { type: 'play', card: w.id, color: 'blue' });
  assert.equal(r.state.color, 'blue');
  assert.equal(r.state.current, 1);
  assert.equal(r.events.find((e) => e.type === 'play').color, 'blue');
});

test('+4: not allowed with a card of the table colour; allowed with only number matches', () => {
  const w = wild4();
  const top = num('red', 3);
  const blocked = setup(game(2), { top, hands: { a: [w, num('red', 9)], b: [num('red', 1), num('red', 2)] } });
  assert.equal(bad(blocked, 'a', { type: 'play', card: w.id, color: 'blue' }), E.ERR.wild4Rule);
  assert.ok(!E.viewFor(blocked, 'a').playable.includes(w.id));
  const free = setup(game(2), { top, hands: { a: [w, num('blue', 3)], b: [num('red', 1), num('red', 2)] } });
  assert.ok(E.viewFor(free, 'a').playable.includes(w.id));
  ok(free, 'a', { type: 'play', card: w.id, color: 'green' });
});

test('play errors: not your turn, unknown card, other stage, game over', () => {
  const s = setup(game(2), { top: num('red', 3), hands: { a: [num('red', 4)], b: [num('red', 5)] } });
  bad(s, 'b', { type: 'play', card: s.hands.b[0].id });
  assert.equal(bad(s, 'a', { type: 'play', card: 'nope' }), E.ERR.noCard);
  assert.equal(bad(s, 'a', { type: 'play', card: s.hands.b[0].id }), E.ERR.noCard); // cannot play someone else's card
  bad(s, 'a', { type: 'keep' });
  bad(s, 'a', { type: 'play_drawn' });
  bad(s, 'zz', { type: 'draw' });
  bad(s, 'a', { type: 'hack' });
  bad(s, 'a', null);
  assert.equal(bad(setup(s, {}), 'a', { type: 'next_round' }), E.ERR.wrongStage);
});

// ---------- action cards ----------

test('skip: the next of 3 players loses the turn', () => {
  const s = setup(game(3), { top: num('red', 3), hands: { a: [act('skip', 'red'), num('red', 1)], b: [num('red', 2)], c: [num('red', 4)] } });
  const r = ok(s, 'a', { type: 'play', card: s.hands.a[0].id });
  assert.equal(cur(r.state), 'c');
  assert.deepEqual(r.events.find((e) => e.type === 'skip'), { type: 'skip', playerId: 'b' });
});

test('skip with two players: the same player plays again', () => {
  const s = setup(game(2), { top: num('red', 3), hands: { a: [act('skip', 'red'), num('red', 1)], b: [num('red', 2)] } });
  assert.equal(cur(ok(s, 'a', { type: 'play', card: s.hands.a[0].id }).state), 'a');
});

test('reverse: direction flips for 3+ players, and the previous player is next', () => {
  const s = setup(game(4), {
    top: num('red', 3), current: 1,
    hands: { a: [num('red', 1)], b: [act('reverse', 'red'), num('red', 1)], c: [num('red', 2)], d: [num('red', 4)] },
  });
  const r = ok(s, 'b', { type: 'play', card: s.hands.b[0].id });
  assert.equal(r.state.direction, -1);
  assert.equal(cur(r.state), 'a');
  // keeps going the new way
  const back = setup(r.state, { current: 0, direction: -1, top: num('red', 3), hands: { a: [num('red', 1), num('red', 9)] } });
  assert.equal(cur(ok(back, 'a', { type: 'play', card: back.hands.a[0].id }).state), 'd');
});

test('reverse with two players acts as a skip', () => {
  const s = setup(game(2), { top: num('red', 3), hands: { a: [act('reverse', 'red'), num('red', 1)], b: [num('red', 2)] } });
  const r = ok(s, 'a', { type: 'play', card: s.hands.a[0].id });
  assert.equal(cur(r.state), 'a');
  assert.equal(r.state.direction, -1);
});

test('+2: the next player draws two and loses the turn; it cannot be answered', () => {
  const answer = act('draw2', 'blue');
  const s = setup(game(3), {
    top: num('red', 3), deck: [num('blue', 1), num('blue', 2), num('blue', 3)],
    hands: { a: [act('draw2', 'red'), num('red', 1)], b: [answer, num('green', 9)], c: [num('red', 4)] },
  });
  const r = ok(s, 'a', { type: 'play', card: s.hands.a[0].id });
  assert.equal(r.state.hands.b.length, 4);
  assert.equal(cur(r.state), 'c'); // b did not get to answer with their own +2
  assert.deepEqual(r.events.find((e) => e.type === 'penalty'), { type: 'penalty', playerId: 'b', count: 2 });
  assert.equal(r.state.hands.b.filter((c) => c.id === answer.id).length, 1); // still in hand
});

test('+4: colour set, the next player draws four and loses the turn', () => {
  const w = wild4();
  const s = setup(game(3), {
    top: num('red', 3), deck: new Array(10).fill(0).map(() => num('blue', 1)),
    hands: { a: [w, num('green', 2)], b: [num('red', 1)], c: [num('red', 4)] },
  });
  const r = ok(s, 'a', { type: 'play', card: w.id, color: 'yellow' });
  assert.equal(r.state.color, 'yellow');
  assert.equal(r.state.hands.b.length, 5);
  assert.equal(cur(r.state), 'c');
});

test('a played card goes to the table without its hand id; the event keeps it for animation', () => {
  const c = num('red', 4);
  const s = setup(game(2), { top: num('red', 3), hands: { a: [c, num('red', 1)], b: [num('red', 2)] } });
  const r = ok(s, 'a', { type: 'play', card: c.id });
  assert.equal(r.state.discard[r.state.discard.length - 1].id, undefined);
  assert.equal(r.events.find((e) => e.type === 'play').handId, c.id);
});

// ---------- drawing ----------

test('draw is refused while a card is playable', () => {
  const s = setup(game(2), { top: num('red', 3), hands: { a: [num('red', 9)], b: [num('red', 1)] } });
  assert.equal(bad(s, 'a', { type: 'draw' }), E.ERR.havePlayable);
});

test('draw a card that does not fit: it goes to the hand and the turn passes', () => {
  const s = setup(game(2), { top: num('red', 3), deck: [num('blue', 8)], hands: { a: [num('green', 9)], b: [num('red', 1)] } });
  const r = ok(s, 'a', { type: 'draw' });
  assert.equal(r.state.hands.a.length, 2);
  assert.equal(cur(r.state), 'b');
  assert.equal(r.state.stage, 'play');
  assert.equal(r.events.find((e) => e.type === 'draw').card, undefined); // the drawn card is not announced
});

test('draw a card that fits: the player chooses to play it or keep it', () => {
  const s = setup(game(3), { top: num('red', 3), deck: [num('red', 8)], hands: { a: [num('green', 9)], b: [num('red', 1)], c: [num('red', 2)] } });
  const d = ok(s, 'a', { type: 'draw' }).state;
  assert.equal(d.stage, 'drawn');
  assert.equal(cur(d), 'a');
  assert.equal(d.hands.a.length, 1);
  bad(d, 'a', { type: 'draw' });
  bad(d, 'a', { type: 'play', card: d.hands.a[0].id }); // the choice is about the drawn card only
  // the drawer sees the card, nobody else does
  assert.equal(E.viewFor(d, 'a').drawn.rank, 8);
  assert.equal(E.viewFor(d, 'b').drawn, null);
  assert.equal(E.viewFor(d, 'b').hasDrawn, true);
  // keep
  const k = ok(d, 'a', { type: 'keep' }).state;
  assert.equal(k.hands.a.length, 2);
  assert.equal(cur(k), 'b');
  // play
  const p = ok(d, 'a', { type: 'play_drawn' }).state;
  assert.equal(p.hands.a.length, 1);
  assert.equal(p.discard[p.discard.length - 1].rank, 8);
  assert.equal(cur(p), 'b');
});

test('a drawn wild needs a colour; a drawn +4 is playable only when the hand has no table colour', () => {
  const w = wild();
  const s = setup(game(2), { top: num('red', 3), deck: [w], hands: { a: [num('green', 9)], b: [num('red', 1)] } });
  const d = ok(s, 'a', { type: 'draw' }).state;
  assert.equal(bad(d, 'a', { type: 'play_drawn' }), E.ERR.needColor);
  assert.equal(ok(d, 'a', { type: 'play_drawn', color: 'blue' }).state.color, 'blue');
  // +4: no red in hand -> playable; with red in hand it is not offered, it goes to the hand
  const free = setup(game(2), { top: num('red', 3), deck: [wild4()], hands: { a: [num('green', 9)], b: [num('red', 1)] } });
  assert.equal(ok(free, 'a', { type: 'draw' }).state.stage, 'drawn');
});

test('draw pile empty: the table pile (except the top card) is shuffled back in', () => {
  const s = setup(game(2), { top: num('red', 3), deck: [], hands: { a: [num('green', 9)], b: [num('red', 1)] } });
  s.discard = [num('blue', 1), num('blue', 2), num('blue', 3), num('red', 3)];
  s.discard.forEach((c) => delete c.id);
  const r = ok(s, 'a', { type: 'draw' });
  assert.ok(types(r).includes('reshuffle'));
  assert.equal(r.state.discard.length, 1);
  assert.equal(r.state.discard[0].rank, 3);
  assert.equal(r.state.deck.length + r.state.hands.a.length + (r.state.drawn ? 1 : 0), 3 + 1);
});

test('nothing left to draw anywhere: the turn just passes', () => {
  const s = setup(game(2), { top: num('red', 3), deck: [], hands: { a: [num('green', 9)], b: [num('red', 1)] } });
  s.discard = [num('red', 3)];
  const r = ok(s, 'a', { type: 'draw' });
  assert.ok(types(r).includes('draw_empty'));
  assert.equal(cur(r.state), 'b');
});

// ---------- winning ----------

test('last card wins the round; points are the other hands (actions 20, wilds 50)', () => {
  const s = setup(game(3), {
    top: num('red', 3),
    hands: { a: [num('red', 4)], b: [num('green', 7), act('skip', 'blue'), wild()], c: [num('blue', 0), act('draw2', 'green')] },
  });
  const r = ok(s, 'a', { type: 'play', card: s.hands.a[0].id });
  assert.equal(r.state.phase, 'roundOver');
  assert.equal(r.state.result.winnerId, 'a');
  assert.equal(r.state.result.points, 7 + 20 + 50 + 0 + 20);
  assert.equal(r.state.totals.a, 97);
  assert.ok(types(r).includes('round_end'));
  // everybody's hand is revealed now
  const v = E.viewFor(r.state, 'b');
  assert.deepEqual(Object.keys(v.result.hands).sort(), ['a', 'b', 'c']);
  assert.equal(bad(r.state, 'a', { type: 'draw' }), E.ERR.wrongStage);
});

test('finishing with +2 / +4: the penalty cards count for the winner', () => {
  const s = setup(game(3), {
    top: num('red', 3), deck: [num('blue', 9), num('blue', 9)],
    hands: { a: [act('draw2', 'red')], b: [num('green', 1)], c: [num('green', 2)] },
  });
  const r = ok(s, 'a', { type: 'play', card: s.hands.a[0].id });
  assert.equal(r.state.phase, 'roundOver');
  assert.equal(r.state.result.points, 1 + 9 + 9 + 2);
  const s4 = setup(game(2), {
    top: num('red', 3), deck: [num('blue', 5), num('blue', 5), num('blue', 5), num('blue', 5)],
    hands: { a: [wild4()], b: [num('green', 1)] },
  });
  assert.equal(ok(s4, 'a', { type: 'play', card: s4.hands.a[0].id, color: 'red' }).state.result.points, 1 + 20);
});

test('rounds: next_round deals again, rotates the first player and keeps totals', () => {
  let s = setup(game(3, 5, 3), { top: num('red', 3), hands: { a: [num('red', 4)], b: [num('green', 7)], c: [num('blue', 2)] } });
  s = ok(s, 'a', { type: 'play', card: s.hands.a[0].id }).state;
  assert.equal(s.totals.a, 9);
  const n = ok(s, 'a', { type: 'next_round' });
  assert.equal(n.state.round, 2);
  assert.equal(n.state.phase, 'turn');
  assert.equal(n.state.hands.a.length >= 7, true);
  assert.equal(n.state.totals.a, 9);
  assert.ok(types(n).includes('round_start'));
  assert.equal(n.events.find((e) => e.type === 'round_start').firstPlayerId, 'b');
});

function finishRound(s, winner, pointsFrom) {
  const hands = {};
  s.playerIds.forEach((id) => { hands[id] = id === winner ? [num('red', 4)] : [num('green', pointsFrom[id] || 1)]; });
  const t = setup(s, { top: num('red', 3), hands, current: s.playerIds.indexOf(winner) });
  return ok(t, winner, { type: 'play', card: t.hands[winner][0].id }).state;
}

test('game over after the chosen number of rounds: the highest total wins, ties share', () => {
  let s = game(3, 5, 3);
  s = finishRound(s, 'a', { b: 5, c: 3 });
  assert.equal(s.phase, 'roundOver');
  s = ok(s, 'a', { type: 'next_round' }).state;
  s = finishRound(s, 'b', { a: 9, c: 9 });
  assert.equal(s.phase, 'roundOver');
  s = ok(s, 'a', { type: 'next_round' }).state;
  s = finishRound(s, 'c', { a: 2, b: 6 });
  assert.equal(s.phase, 'gameOver');
  assert.deepEqual(s.totals, { a: 8, b: 18, c: 8 });
  assert.deepEqual(s.winnerIds, ['b']);
  assert.deepEqual(E.viewFor(s, 'a').winnerIds, ['b']);
  assert.equal(bad(s, 'a', { type: 'next_round' }), E.ERR.gameOver);
  // tie
  let t = game(2, 5, 3);
  t = finishRound(t, 'a', { b: 4 });
  t = ok(t, 'a', { type: 'next_round' }).state;
  t = finishRound(t, 'b', { a: 4 });
  t = ok(t, 'a', { type: 'next_round' }).state;
  t = finishRound(t, 'a', { b: 0 + 1 });
  assert.equal(t.phase, 'gameOver');
  const best = Math.max(t.totals.a, t.totals.b);
  t.winnerIds.forEach((id) => assert.equal(t.totals[id], best));
});

test('a 5-round game is not over after 3 rounds', () => {
  let s = game(2, 5, 5);
  for (let r = 1; r <= 3; r++) {
    s = finishRound(s, 'a', { b: 1 });
    assert.equal(s.phase, 'roundOver');
    s = ok(s, 'a', { type: 'next_round' }).state;
  }
  assert.equal(s.round, 4);
});

// ---------- timers (autoPlay) ----------

test('autoPlay: plays a coloured card before a wild; picks the colour it holds most', () => {
  const s = setup(game(2), { top: num('red', 3), hands: { a: [wild(), num('red', 8), num('blue', 1), num('blue', 2)], b: [num('red', 1)] } });
  const r = E.autoPlay(s);
  assert.equal(r.state.discard[r.state.discard.length - 1].rank, 8);
  const onlyWild = setup(game(2), { top: num('red', 3), hands: { a: [wild(), num('blue', 1), num('blue', 2), num('green', 7)], b: [num('red', 1)] } });
  assert.equal(E.autoPlay(onlyWild).state.color, 'blue');
});

test('autoPlay: draws when nothing fits, plays the drawn card if it fits, and works at every stage', () => {
  const draw = setup(game(2), { top: num('red', 3), deck: [num('red', 8)], hands: { a: [num('green', 9)], b: [num('red', 1)] } });
  const r = E.autoPlay(draw);
  assert.equal(r.state.discard[r.state.discard.length - 1].rank, 8);
  assert.equal(cur(r.state), 'b');
  const miss = setup(game(2), { top: num('red', 3), deck: [num('blue', 8)], hands: { a: [num('green', 9)], b: [num('red', 1)] } });
  assert.equal(E.autoPlay(miss).state.hands.a.length, 2);
  const drawn = ok(draw, 'a', { type: 'draw' }).state; // stage 'drawn'
  assert.equal(E.autoPlay(drawn).state.discard[E.autoPlay(drawn).state.discard.length - 1].rank, 8);
  const { s: firstWild } = findSeed(3, (x) => x.discard[0].type === 'wild');
  const colored = E.autoPlay(firstWild);
  assert.equal(colored.state.stage, 'play');
  assert.ok(CONFIG.COLORS.includes(colored.state.color));
  assert.ok(E.autoPlay(setup(game(2), { top: num('red', 3), hands: { a: [num('red', 4)], b: [num('red', 1)] } }).phase === 'turn'));
});

test('autoPlay on a finished round is refused', () => {
  const s = finishRound(game(2), 'a', { b: 1 });
  assert.ok(E.autoPlay(s).error);
});

// ---------- secrecy ----------

test('viewFor: only my hand, only counts for others, no deck, no rng', () => {
  const s = game(3);
  const v = E.viewFor(s, 'b');
  assert.equal(v.hand.length, 7);
  assert.deepEqual(v.players.map((p) => p.count), [7, 7, 7]);
  const wire = JSON.stringify(v);
  assert.equal(wire.includes('"deck"'), false);
  assert.equal(wire.includes('rng'), false);
  assert.equal(wire.includes('"hands"'), false);
  // none of the other players' card ids appears anywhere in my view
  ['a', 'c'].forEach((id) => s.hands[id].forEach((c) => assert.equal(wire.includes(c.id), false)));
  assert.equal(v.deckCount, s.deck.length);
  assert.equal(v.top.type, s.discard[0].type);
});

test('viewFor: playable ids are only given to the player whose turn it is', () => {
  const s = setup(game(2), { top: num('red', 3), hands: { a: [num('red', 4), num('blue', 9)], b: [num('red', 1)] } });
  assert.deepEqual(E.viewFor(s, 'a').playable, [s.hands.a[0].id]);
  assert.deepEqual(E.viewFor(s, 'b').playable, []);
});

test('hand ids: a card entering a hand gets a fresh id; ids stay unique across the game', () => {
  let s = game(3, 7);
  const seen = new Set();
  for (let i = 0; i < 300 && s.phase === 'turn'; i++) {
    const r = E.autoPlay(s);
    s = r.state;
    const ids = [].concat(...s.playerIds.map((id) => s.hands[id].map((c) => c.id)));
    assert.equal(new Set(ids).size, ids.length);
    ids.forEach((id) => assert.ok(id));
    ids.forEach((id) => seen.add(id));
  }
  assert.ok(seen.size > 21);
});

test('act never mutates its input; errors are in Arabic', () => {
  const s = game(2);
  const before = JSON.stringify(s);
  E.act(s, 'a', { type: 'draw' });
  E.act(s, 'a', { type: 'play', card: s.hands.a[0].id, color: 'red' });
  E.autoPlay(s);
  assert.equal(JSON.stringify(s), before);
  assert.match(bad(s, 'b', { type: 'draw' }), /[؀-ۿ]/);
});

// ---------- whole games ----------

test('bots play complete games: 108 cards always accounted for, a winner emerges', () => {
  let finished = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const n = 2 + (seed % 5);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, n);
    let s = E.createGame(ids, { seed, rounds: seed % 2 ? 3 : 5 }).state;
    let guard = 0;
    while (s.phase !== 'gameOver' && guard++ < 40000) {
      if (s.phase === 'roundOver') { s = ok(s, 'a', { type: 'next_round' }).state; continue; }
      const r = E.autoPlay(s);
      assert.ok(r.state, 'stuck: ' + r.error + ' stage ' + s.stage);
      s = r.state;
      const total = ids.reduce((t, id) => t + s.hands[id].length, 0) + s.deck.length + s.discard.length + (s.drawn ? 1 : 0);
      assert.equal(total, 108);
      if (s.phase === 'turn') assert.ok(s.playerIds.every((id) => s.hands[id].length > 0), 'a player with no cards must end the round');
    }
    if (s.phase === 'gameOver') {
      finished++;
      assert.ok(s.winnerIds.length >= 1);
      assert.equal(s.history.length, s.rounds);
    }
  }
  assert.equal(finished, 60);
});
