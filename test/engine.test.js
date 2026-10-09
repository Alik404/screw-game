const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../server/config');
const Deck = require('../server/deck');
const E = require('../server/engine');

const num = (r) => Deck.makeCard('num', r);
const sp = (t) => Deck.makeCard(t);

function newGame(ids, seed) {
  const r = E.createGame(ids, { seed: seed === undefined ? 1 : seed });
  assert.ok(r.state, r.error);
  return r.state;
}

// Move straight into the play phase.
function playing(ids, seed) {
  const r = E.forceStartPlay(newGame(ids || ['a', 'b', 'c'], seed));
  assert.ok(r.state, r.error);
  return r.state;
}

function ok(state, pid, action) {
  const r = E.act(state, pid, action);
  assert.ok(r.state, 'expected success for ' + JSON.stringify(action) + ' but got: ' + r.error);
  return r;
}

function bad(state, pid, action) {
  const r = E.act(state, pid, action);
  assert.ok(r.error, 'expected an error for ' + JSON.stringify(action));
  assert.equal(r.state, undefined);
  return r.error;
}

// Overwrite hands / piles on a plain-data state (state is JSON, so this is safe in tests).
function setup(state, o) {
  const s = JSON.parse(JSON.stringify(state));
  if (o.hands) {
    Object.keys(o.hands).forEach((id) => {
      s.hands[id] = o.hands[id];
      s.hands[id].forEach((c, i) => { if (!c.handId) c.handId = 'test-' + id + '-' + i; });
    });
  }
  if (o.deck) s.deck = o.deck;
  if (o.discard) s.discard = o.discard;
  if (o.turnCount !== undefined) s.turnCount = o.turnCount;
  if (o.current !== undefined) s.current = o.current;
  return s;
}

// ---------- deck ----------

test('deck has 58 cards with the configured counts', () => {
  const d = Deck.buildDeck();
  assert.equal(d.length, 58);
  const count = (f) => d.filter(f).length;
  assert.equal(count((c) => c.type === 'num' && c.rank === 5), 4);
  assert.equal(count((c) => c.type === 'swap'), 4);
  assert.equal(count((c) => c.type === 'peekall'), 2);
  assert.equal(count((c) => c.type === 'basra'), 2);
  assert.equal(count((c) => c.type === 'plus20'), 4);
  assert.equal(count((c) => c.type === 'screw_red'), 2);
  assert.equal(count((c) => c.type === 'screw_green'), 2);
  assert.equal(count((c) => c.type === 'minus1'), 2);
});

test('suits: each rank 1-10 has exactly one card of each of the four suits', () => {
  const d = Deck.buildDeck();
  assert.deepEqual(Deck.SUITS, ['spades', 'hearts', 'diamonds', 'clubs']);
  for (let rank = 1; rank <= 10; rank++) {
    const suits = d.filter((c) => c.type === 'num' && c.rank === rank).map((c) => c.suit).sort();
    assert.deepEqual(suits, ['clubs', 'diamonds', 'hearts', 'spades'], 'rank ' + rank);
  }
  // only number cards have suits
  assert.ok(d.filter((c) => c.type !== 'num').every((c) => c.suit === undefined));
  // 40 distinct (rank, suit) pairs
  assert.equal(new Set(d.filter((c) => c.type === 'num').map((c) => c.rank + c.suit)).size, 40);
});

test('suits never affect value, ability or matching', () => {
  const a = Deck.makeCard('num', 7, 'hearts');
  const b = Deck.makeCard('num', 7, 'clubs');
  assert.equal(a.value, b.value);
  assert.equal(Deck.abilityOf(a), Deck.abilityOf(b));
  assert.equal(Deck.kindOf(a), Deck.kindOf(b));
  assert.notEqual(Deck.kindOf(a), Deck.kindOf(Deck.makeCard('num', 8, 'hearts')));
});

test('match succeeds with the same number in a different suit', () => {
  let s = playing(['a', 'b']);
  s = setup(s, {
    hands: { a: [Deck.makeCard('num', 6, 'hearts'), num(2), num(3), num(4)] },
    discard: [Deck.makeCard('num', 6, 'spades')],
  });
  assert.equal(ok(s, 'a', { type: 'match', slot: 0 }).events.find((e) => e.type === 'match').success, true);
});

test('hidden cards expose no suit; revealed cards do', () => {
  const s = newGame(['a', 'b']);
  const v = E.viewFor(s, 'a');
  const mine = v.players.find((p) => p.id === 'a').hand;
  assert.ok(mine[0].suit);                       // opening peek
  assert.equal(mine[2].suit, undefined);          // hidden
  assert.equal(JSON.stringify(v.players.find((p) => p.id === 'b').hand).includes('suit'), false);
});

test('card values and abilities follow the spec table', () => {
  assert.equal(num(9).value, 9);
  assert.equal(sp('swap').value, 10);
  assert.equal(sp('plus20').value, 20);
  assert.equal(sp('screw_red').value, 25);
  assert.equal(sp('screw_green').value, 0);
  assert.equal(sp('minus1').value, -1);
  assert.equal(Deck.abilityOf(num(6)), null);
  assert.equal(Deck.abilityOf(num(7)), 'peek_own');
  assert.equal(Deck.abilityOf(num(8)), 'peek_own');
  assert.equal(Deck.abilityOf(num(9)), 'peek_other');
  assert.equal(Deck.abilityOf(num(10)), 'peek_other');
  assert.equal(Deck.abilityOf(sp('swap')), 'swap');
  assert.equal(Deck.abilityOf(sp('peekall')), 'peek_all');
  assert.equal(Deck.abilityOf(sp('basra')), 'throw');
  assert.equal(Deck.abilityOf(sp('plus20')), null);
});

// ---------- deal ----------

test('deal: 4 cards each, one floor card, rest in deck, no card lost', () => {
  const s = newGame(['a', 'b', 'c', 'd']);
  ['a', 'b', 'c', 'd'].forEach((id) => assert.equal(s.hands[id].length, CONFIG.CARDS_PER_PLAYER));
  assert.equal(s.discard.length, 1);
  assert.equal(s.deck.length, 58 - 16 - 1);
  assert.equal(s.phase, 'peek');
});

test('createGame rejects bad player counts', () => {
  assert.ok(E.createGame(['a']).error);
  assert.ok(E.createGame(['a', 'b', 'c', 'd', 'e', 'f', 'g']).error);
  assert.ok(E.createGame(['a', 'a']).error);
});

test('same seed gives the same deal (engine is deterministic)', () => {
  const a = E.createGame(['a', 'b'], { seed: 42, idSeed: 7 }).state;
  const b = E.createGame(['a', 'b'], { seed: 42, idSeed: 7 }).state;
  assert.deepEqual(a.hands, b.hands);
  const strip = (h) => h.map((c) => ({ type: c.type, rank: c.rank }));
  const c = E.createGame(['a', 'b'], { seed: 42, idSeed: 999 }).state;
  assert.deepEqual(strip(a.hands.a), strip(c.hands.a)); // ids never influence the deal
});

test('first player rotates each round', () => {
  let s = playing(['a', 'b', 'c']);
  assert.equal(s.playerIds[s.current], 'a');
  s = setup(s, {});
  s.phase = 'roundOver';
  s = ok(s, 'a', { type: 'next_round' }).state;
  s = E.forceStartPlay(s).state;
  assert.equal(s.playerIds[s.current], 'b');
});

// ---------- opening peek ----------

test('peek: viewFor shows only my two right-most cards, then hides them after ready', () => {
  let s = newGame(['a', 'b']);
  let v = E.viewFor(s, 'a');
  const mine = v.players.find((p) => p.id === 'a').hand;
  assert.ok(!mine[0].hidden && !mine[1].hidden);
  assert.ok(mine[2].hidden && mine[3].hidden);
  const theirs = v.players.find((p) => p.id === 'b').hand;
  assert.ok(theirs.every((c) => c.hidden));
  s = ok(s, 'a', { type: 'ready' }).state;
  v = E.viewFor(s, 'a');
  assert.ok(v.players.find((p) => p.id === 'a').hand.every((c) => c.hidden));
});

test('peek: play starts only when everyone is ready', () => {
  let s = newGame(['a', 'b']);
  s = ok(s, 'a', { type: 'ready' }).state;
  assert.equal(s.phase, 'peek');
  bad(s, 'a', { type: 'draw' });
  s = ok(s, 'b', { type: 'ready' }).state;
  assert.equal(s.phase, 'turn');
});

// ---------- view secrecy ----------

test('viewFor never leaks hidden cards, the deck or the rng', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [num(1), num(2), num(3), num(4)], b: [num(5), num(6), num(7), num(8)] } });
  s = ok(s, 'a', { type: 'draw' }).state;
  const json = JSON.stringify(E.viewFor(s, 'b'));
  assert.ok(!json.includes('"deck"'));
  assert.ok(!json.includes('"rng"'));
  const v = E.viewFor(s, 'b');
  assert.equal(v.drawn, null); // other players do not see the drawn card
  assert.equal(v.hasDrawn, true);
  assert.ok(v.players.find((p) => p.id === 'a').hand.every((c) => c.hidden));
  assert.ok(v.players.find((p) => p.id === 'b').hand.every((c) => c.hidden));
  assert.ok(E.viewFor(s, 'a').drawn);
});

test('draw event is public but carries no card value; draw private goes only to the drawer', () => {
  const s = playing(['a', 'b']);
  const r = ok(s, 'a', { type: 'draw' });
  assert.equal(r.events[0].type, 'draw');
  assert.equal(r.events[0].card, undefined);
  assert.equal(r.privates.length, 1);
  assert.equal(r.privates[0].playerId, 'a');
});

// ---------- turn moves ----------

test('only the current player can act, and only in the right stage', () => {
  const s = playing(['a', 'b']);
  bad(s, 'b', { type: 'draw' });
  bad(s, 'a', { type: 'swap_drawn', slot: 0 }); // nothing drawn yet
  bad(s, 'a', { type: 'discard_drawn' });
  bad(s, 'zzz', { type: 'draw' });
  bad(s, 'a', { type: 'hack' });
  bad(s, 'a', null);
});

test('draw then swap: new card goes face down into the slot, old card goes to floor', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [num(1), num(2), num(3), num(4)] }, deck: [num(9)], discard: [num(5)] });
  s = ok(s, 'a', { type: 'draw' }).state;
  assert.equal(s.deck.length, 0);
  const r = ok(s, 'a', { type: 'swap_drawn', slot: 2 });
  assert.equal(r.state.hands.a[2].rank, 9);
  assert.equal(r.state.discard[r.state.discard.length - 1].rank, 3);
  assert.equal(r.state.playerIds[r.state.current], 'b');
  assert.equal(r.state.ability, null); // swapped-out card has no ability even if special
});

test('swapping out a special card does not trigger its ability', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [sp('swap'), num(2), num(3), num(4)] }, deck: [num(9)] });
  s = ok(s, 'a', { type: 'draw' }).state;
  s = ok(s, 'a', { type: 'swap_drawn', slot: 0 }).state;
  assert.equal(s.stage, 'start');
  assert.equal(s.playerIds[s.current], 'b');
});

test('draw then discard a plain card ends the turn', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { deck: [num(4)] });
  s = ok(s, 'a', { type: 'draw' }).state;
  s = ok(s, 'a', { type: 'discard_drawn' }).state;
  assert.equal(s.playerIds[s.current], 'b');
  assert.equal(s.discard[s.discard.length - 1].rank, 4);
});

test('take_discard swaps the floor card in and throws the old card; invalid slot rejected', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [num(1), num(2), num(3), num(4)] }, discard: [num(8)] });
  bad(s, 'a', { type: 'take_discard', slot: 9 });
  bad(s, 'a', { type: 'take_discard' });
  const r = ok(s, 'a', { type: 'take_discard', slot: 1 });
  assert.equal(r.state.hands.a[1].rank, 8);
  assert.equal(r.state.discard[r.state.discard.length - 1].rank, 2);
  assert.equal(r.state.stage, 'start');
  assert.equal(r.state.ability, null); // no ability from taking floor card
});

test('turn passes around the table and wraps', () => {
  let s = playing(['a', 'b', 'c']);
  const order = [];
  for (let i = 0; i < 4; i++) {
    order.push(s.playerIds[s.current]);
    s = setup(s, { deck: [num(1), num(1), num(1)] });
    s = ok(s, order[i], { type: 'draw' }).state;
    s = ok(s, order[i], { type: 'discard_drawn' }).state;
  }
  assert.deepEqual(order, ['a', 'b', 'c', 'a']);
});

// ---------- abilities ----------

function withAbility(drawnCard, extra) {
  let s = playing(['a', 'b', 'c']);
  s = setup(s, Object.assign({
    hands: {
      a: [num(1), num(2), num(3), num(4)],
      b: [num(5), num(6), num(7), num(8)],
      c: [sp('plus20'), sp('minus1'), num(10), num(9)],
    },
    deck: [drawnCard],
  }, extra || {}));
  s = ok(s, 'a', { type: 'draw' }).state;
  s = ok(s, 'a', { type: 'discard_drawn' }).state;
  assert.equal(s.stage, 'ability');
  return s;
}

test('7/8 peek_own: only I get the card, others see which slot, turn ends', () => {
  const s = withAbility(num(7));
  bad(s, 'a', { type: 'use_ability', slot: 9 });
  bad(s, 'b', { type: 'use_ability', slot: 0 }); // not my turn
  const r = ok(s, 'a', { type: 'use_ability', slot: 2 });
  assert.equal(r.privates.length, 1);
  assert.equal(r.privates[0].playerId, 'a');
  assert.equal(r.privates[0].seconds, CONFIG.PEEK_SECONDS);
  assert.equal(r.privates[0].reveals[0].card.rank, 3);
  const look = r.events.find((e) => e.type === 'look');
  assert.deepEqual(look.targets.map((x) => [x.ownerId, x.slot]), [['a', 2]]);
  assert.equal(JSON.stringify(look).includes('"rank"'), false); // no value in public event
  assert.equal(r.state.playerIds[r.state.current], 'b');
});

test('9/10 peek_other: must target another player', () => {
  const s = withAbility(num(10));
  bad(s, 'a', { type: 'use_ability', targetPlayerId: 'a', targetSlot: 0 });
  bad(s, 'a', { type: 'use_ability', targetPlayerId: 'zzz', targetSlot: 0 });
  bad(s, 'a', { type: 'use_ability', targetPlayerId: 'b', targetSlot: 7 });
  const r = ok(s, 'a', { type: 'use_ability', targetPlayerId: 'b', targetSlot: 1 });
  assert.equal(r.privates[0].reveals[0].card.rank, 6);
  assert.equal(r.privates[0].playerId, 'a');
});

test('swap (خد وهات): exchanges blind, nobody gets a private reveal', () => {
  const s = withAbility(sp('swap'));
  const r = ok(s, 'a', { type: 'use_ability', slot: 0, targetPlayerId: 'b', targetSlot: 3 });
  assert.equal(r.state.hands.a[0].rank, 8);
  assert.equal(r.state.hands.b[3].rank, 1);
  assert.equal(r.privates.length, 0);
  assert.equal(r.events.find((e) => e.type === 'swap').targetPlayerId, 'b');
  bad(s, 'a', { type: 'use_ability', slot: 0, targetPlayerId: 'a', targetSlot: 1 });
});

test('swap cannot target the screw caller (locked cards)', () => {
  let s = playing(['a', 'b', 'c']);
  s = setup(s, { turnCount: 9, current: 1, deck: [sp('swap')] });
  s.screwCaller = 'a';
  s = ok(s, 'b', { type: 'draw' }).state;
  s = ok(s, 'b', { type: 'discard_drawn' }).state;
  const err = bad(s, 'b', { type: 'use_ability', slot: 0, targetPlayerId: 'a', targetSlot: 0 });
  assert.equal(err, E.ERR.locked);
  ok(s, 'b', { type: 'use_ability', slot: 0, targetPlayerId: 'c', targetSlot: 0 });
});

test('peek_all self: see exactly two of my own cards', () => {
  const s = withAbility(sp('peekall'));
  bad(s, 'a', { type: 'use_ability', mode: 'self', slots: [0] });
  bad(s, 'a', { type: 'use_ability', mode: 'self', slots: [1, 1] });
  bad(s, 'a', { type: 'use_ability', mode: 'self', slots: [0, 9] });
  bad(s, 'a', { type: 'use_ability', mode: 'nope' });
  const r = ok(s, 'a', { type: 'use_ability', mode: 'self', slots: [0, 3] });
  assert.deepEqual(r.privates[0].reveals.map((x) => x.card.rank), [1, 4]);
});

test('peek_all others: one card from each other player, all required', () => {
  const s = withAbility(sp('peekall'));
  bad(s, 'a', { type: 'use_ability', mode: 'others', picks: [{ playerId: 'b', slot: 0 }] });
  bad(s, 'a', { type: 'use_ability', mode: 'others', picks: [{ playerId: 'b', slot: 0 }, { playerId: 'b', slot: 1 }] });
  bad(s, 'a', { type: 'use_ability', mode: 'others', picks: [{ playerId: 'a', slot: 0 }, { playerId: 'b', slot: 1 }] });
  const r = ok(s, 'a', {
    type: 'use_ability', mode: 'others',
    picks: [{ playerId: 'b', slot: 0 }, { playerId: 'c', slot: 1 }],
  });
  assert.deepEqual(r.privates[0].reveals.map((x) => x.card.value), [5, -1]);
  assert.equal(r.events.find((e) => e.type === 'look').targets.length, 2);
});

test('basra: throw any own card face up, hand shrinks, thrown ability does not fire', () => {
  const s = withAbility(sp('basra'));
  bad(s, 'a', { type: 'use_ability', slot: 6 });
  const r = ok(s, 'a', { type: 'use_ability', slot: 1 });
  assert.equal(r.state.hands.a.length, 3);
  assert.equal(r.state.discard[r.state.discard.length - 1].rank, 2);
  assert.equal(r.state.stage, 'start');
  assert.equal(r.state.playerIds[r.state.current], 'b');
  // throwing a special card via basra must not start another ability
  let t = playing(['a', 'b']);
  t = setup(t, { hands: { a: [sp('swap'), num(1), num(2), num(3)] }, deck: [sp('basra')] });
  t = ok(t, 'a', { type: 'draw' }).state;
  t = ok(t, 'a', { type: 'discard_drawn' }).state;
  t = ok(t, 'a', { type: 'use_ability', slot: 0 }).state;
  assert.equal(t.stage, 'start');
  assert.equal(t.ability, null);
});

test('skip_ability ends the turn; no ability when there is none pending', () => {
  const s = withAbility(num(7));
  const r = ok(s, 'a', { type: 'skip_ability' });
  assert.equal(r.state.playerIds[r.state.current], 'b');
  bad(playing(['a', 'b']), 'a', { type: 'skip_ability' });
  bad(playing(['a', 'b']), 'a', { type: 'use_ability', slot: 0 });
});

test('ability only fires from a drawn-and-discarded card, not from swap or floor take', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [num(1), num(2), num(3), num(4)] }, deck: [num(7)], discard: [num(9)] });
  const t = ok(s, 'a', { type: 'take_discard', slot: 0 }).state;
  assert.equal(t.stage, 'start');
  const d = ok(s, 'a', { type: 'draw' }).state;
  assert.equal(ok(d, 'a', { type: 'swap_drawn', slot: 0 }).state.stage, 'start');
});

// ---------- match ("tabsir") ----------

test('match success: card removed, thrown on floor, hand shrinks, turn ends', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [num(1), num(6), num(3), num(4)] }, discard: [num(6)] });
  const r = ok(s, 'a', { type: 'match', slot: 1 });
  assert.equal(r.state.hands.a.length, 3);
  assert.equal(r.state.discard.length, 2);
  assert.equal(r.events.find((e) => e.type === 'match').success, true);
  assert.equal(r.state.playerIds[r.state.current], 'b');
});

test('match success for same special type', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [sp('plus20'), num(2), num(3), num(4)] }, discard: [sp('plus20')] });
  assert.equal(ok(s, 'a', { type: 'match', slot: 0 }).state.hands.a.length, 3);
});

test('match failure: card stays, penalty card added face down, turn ends', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [num(1), num(2), num(3), num(4)] }, discard: [num(6)], deck: [num(9)] });
  const r = ok(s, 'a', { type: 'match', slot: 0 });
  assert.equal(r.state.hands.a.length, 4 + CONFIG.WRONG_MATCH_PENALTY_CARDS);
  assert.equal(r.state.hands.a[0].rank, 1);
  assert.equal(r.state.hands.a[4].rank, 9);
  assert.equal(r.events.find((e) => e.type === 'match').success, false);
  assert.ok(r.events.find((e) => e.type === 'penalty'));
  assert.equal(r.state.playerIds[r.state.current], 'b');
  // penalty card is hidden in the view
  const v = E.viewFor(r.state, 'a');
  assert.ok(v.players.find((p) => p.id === 'a').hand[4].hidden);
});

test('match: different red/green screw cards do not match; rejected on bad slot', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [sp('screw_red'), num(2), num(3), num(4)] }, discard: [sp('screw_green')] });
  assert.equal(ok(s, 'a', { type: 'match', slot: 0 }).events.find((e) => e.type === 'match').success, false);
  bad(s, 'a', { type: 'match', slot: 8 });
});

test('player with zero cards cannot match or swap but can still draw and throw', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [] }, deck: [num(4), num(4)] });
  bad(s, 'a', { type: 'match', slot: 0 });
  bad(s, 'a', { type: 'take_discard', slot: 0 });
  s = ok(s, 'a', { type: 'draw' }).state;
  bad(s, 'a', { type: 'swap_drawn', slot: 0 });
  s = ok(s, 'a', { type: 'discard_drawn' }).state;
  assert.equal(s.playerIds[s.current], 'b');
});

// ---------- deck exhaustion ----------

test('empty deck: floor pile (except top) is reshuffled into a new draw pile', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { deck: [], discard: [num(1), num(2), num(3), num(4)] });
  const r = ok(s, 'a', { type: 'draw' });
  assert.ok(r.events.find((e) => e.type === 'reshuffle'));
  assert.equal(r.state.discard.length, 1);
  assert.equal(r.state.discard[0].rank, 4); // top stays
  assert.equal(r.state.deck.length, 2); // 3 recycled, 1 drawn
  assert.ok(r.state.drawn.rank >= 1 && r.state.drawn.rank <= 3);
});

test('empty deck and nothing to recycle: draw is refused, autoPlay skips the turn', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { deck: [], discard: [num(4)] });
  assert.equal(bad(s, 'a', { type: 'draw' }), E.ERR.deckEmpty);
  const r = E.autoPlay(s);
  assert.equal(r.state.playerIds[r.state.current], 'b');
});

// ---------- screw ----------

test('screw is refused before lap 4 and allowed from lap 4', () => {
  let s = playing(['a', 'b', 'c']);
  for (const t of [0, 5, 8]) {
    s = setup(s, { turnCount: t, current: t % 3 });
    assert.equal(E.lapOf(s) < 4, true);
    assert.equal(bad(s, s.playerIds[s.current], { type: 'call_screw' }), E.ERR.screwEarly);
  }
  s = setup(s, { turnCount: 9, current: 0 });
  assert.equal(E.lapOf(s), 4);
  assert.equal(E.viewFor(s, 'a').screwAllowed, true);
  ok(s, 'a', { type: 'call_screw' });
});

test('screw only at the start of my turn (not after drawing) and only once', () => {
  let s = playing(['a', 'b', 'c']);
  s = setup(s, { turnCount: 9, current: 0, deck: [num(1), num(1), num(1), num(1)] });
  const drawn = ok(s, 'a', { type: 'draw' }).state;
  bad(drawn, 'a', { type: 'call_screw' });
  bad(s, 'b', { type: 'call_screw' }); // not b's turn
  const called = ok(s, 'a', { type: 'call_screw' }).state;
  assert.equal(called.screwCaller, 'a');
  assert.equal(called.playerIds[called.current], 'b');
  assert.equal(E.viewFor(called, 'b').screwAllowed, false);
});

test('after screw each other player plays exactly one last turn, then the round ends', () => {
  let s = playing(['a', 'b', 'c']);
  s = setup(s, { turnCount: 9, current: 0, deck: [num(1), num(1), num(1), num(1)] });
  s = ok(s, 'a', { type: 'call_screw' }).state;
  // b: not allowed to call screw again
  s = setup(s, { deck: [num(1), num(1)] });
  bad(s, 'b', { type: 'call_screw' });
  s = ok(s, 'b', { type: 'draw' }).state;
  s = ok(s, 'b', { type: 'discard_drawn' }).state;
  assert.equal(s.phase, 'turn');
  assert.equal(s.playerIds[s.current], 'c');
  s = ok(s, 'c', { type: 'draw' }).state;
  const r = ok(s, 'c', { type: 'discard_drawn' });
  assert.equal(r.state.phase, 'roundOver');
  assert.ok(r.events.find((e) => e.type === 'round_end'));
  // all cards revealed to everyone
  const v = E.viewFor(r.state, 'b');
  assert.ok(v.players.every((p) => p.hand.every((c) => !c.hidden)));
  assert.ok(v.result);
});

test('last-turn ability still resolves before the round ends', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { turnCount: 8, current: 0, deck: [num(8)] });
  s = ok(s, 'a', { type: 'call_screw' }).state;
  s = ok(s, 'b', { type: 'draw' }).state;
  s = ok(s, 'b', { type: 'discard_drawn' }).state;
  assert.equal(s.phase, 'turn');
  assert.equal(s.stage, 'ability');
  s = ok(s, 'b', { type: 'skip_ability' }).state;
  assert.equal(s.phase, 'roundOver');
});

// ---------- scoring ----------

const hand = (...vals) => vals.map((v) => ({ type: 'num', rank: v, value: v }));

test('scoring: lowest sum scores 0, others score their sum', () => {
  const r = E.scoreRound({ a: hand(1, 2), b: hand(5, 5), c: hand(9) }, null, false);
  assert.deepEqual(r.scores, { a: 0, b: 10, c: 9 });
});

test('scoring: tie for lowest means all tied players score 0', () => {
  const r = E.scoreRound({ a: hand(3, 3), b: hand(6), c: hand(9) }, null, false);
  assert.deepEqual(r.scores, { a: 0, b: 0, c: 9 });
});

test('scoring: successful screw (lowest) scores 0 with no penalty', () => {
  const r = E.scoreRound({ a: hand(1), b: hand(5), c: hand(9) }, 'a', false);
  assert.deepEqual(r.scores, { a: 0, b: 5, c: 9 });
});

test('scoring: screw caller tied for lowest is safe', () => {
  const r = E.scoreRound({ a: hand(4), b: hand(4), c: hand(9) }, 'a', false);
  assert.deepEqual(r.scores, { a: 0, b: 0, c: 9 });
});

test('scoring: failed screw doubles the caller sum', () => {
  const r = E.scoreRound({ a: hand(8), b: hand(2), c: hand(9) }, 'a', false);
  assert.deepEqual(r.scores, { a: 16, b: 0, c: 9 });
});

test('scoring: last round doubles everything, and stacks with failed screw', () => {
  const plain = E.scoreRound({ a: hand(1), b: hand(5), c: hand(9) }, null, true);
  assert.deepEqual(plain.scores, { a: 0, b: 10, c: 18 });
  const failed = E.scoreRound({ a: hand(8), b: hand(2), c: hand(9) }, 'a', true);
  assert.deepEqual(failed.scores, { a: 32, b: 0, c: 18 });
});

test('scoring: negative cards and special values are summed correctly', () => {
  const hands = { a: [sp('minus1'), sp('screw_green'), num(1), num(1)], b: [sp('screw_red'), sp('plus20')] };
  const r = E.scoreRound(hands, null, false);
  assert.deepEqual(r.sums, { a: 1, b: 45 });
  assert.deepEqual(r.scores, { a: 0, b: 45 });
});

test('scoring: a player with no cards has sum 0', () => {
  const r = E.scoreRound({ a: [], b: hand(3) }, null, false);
  assert.deepEqual(r.scores, { a: 0, b: 3 });
});

// ---------- whole game ----------

function finishRoundQuick(s) {
  s = setup(s, { turnCount: 9, current: s.firstIndex, deck: new Array(20).fill(0).map(() => num(1)) });
  const caller = s.playerIds[s.current];
  s = ok(s, caller, { type: 'call_screw' }).state;
  while (s.phase === 'turn') {
    const pid = s.playerIds[s.current];
    s = ok(s, pid, { type: 'draw' }).state;
    s = ok(s, pid, { type: 'discard_drawn' }).state;
  }
  return s;
}

test('full game: 5 rounds, totals accumulate, last round is doubled, game_over names winners', () => {
  let s = playing(['a', 'b']);
  for (let round = 1; round <= CONFIG.ROUNDS; round++) {
    assert.equal(s.round, round);
    s = finishRoundQuick(s);
    if (round < CONFIG.ROUNDS) {
      assert.equal(s.phase, 'roundOver');
      assert.equal(s.result.multiplied, false);
      s = ok(s, 'a', { type: 'next_round' }).state;
      s = E.forceStartPlay(s).state;
    }
  }
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.result.multiplied, true);
  assert.equal(s.history.length, CONFIG.ROUNDS);
  assert.ok(s.winnerIds.length >= 1);
  const best = Math.min(...Object.values(s.totals));
  s.winnerIds.forEach((id) => assert.equal(s.totals[id], best));
  assert.deepEqual(E.viewFor(s, 'a').winnerIds, s.winnerIds);
  bad(s, 'a', { type: 'next_round' });
  const again = E.newGame(s, { seed: 3 });
  assert.equal(again.state.round, 1);
  assert.deepEqual(again.state.totals, { a: 0, b: 0 });
});

test('next_round is only valid between rounds', () => {
  bad(playing(['a', 'b']), 'a', { type: 'next_round' });
});

// ---------- timers (autoPlay / forceStartPlay) ----------

test('autoPlay: draws and discards without using an ability; turn passes on', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { deck: [num(9)] }); // a 9 would normally give an ability
  const r = E.autoPlay(s);
  assert.equal(r.state.playerIds[r.state.current], 'b');
  assert.equal(r.state.stage, 'start');
  assert.equal(r.state.discard[r.state.discard.length - 1].rank, 9);
});

test('autoPlay resumes from every stage', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { deck: [num(4), num(4)] });
  const drawn = ok(s, 'a', { type: 'draw' }).state;
  assert.equal(E.autoPlay(drawn).state.playerIds[0], 'a');
  assert.equal(E.autoPlay(drawn).state.current, 1);
  const ab = withAbility(num(7));
  assert.equal(E.autoPlay(ab).state.current, 1);
});

test('autoPlay on the last turn after screw ends the round', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { turnCount: 8, current: 0, deck: [num(1), num(1)] });
  s = ok(s, 'a', { type: 'call_screw' }).state;
  assert.equal(E.autoPlay(s).state.phase, 'roundOver');
});

test('forceStartPlay ends the opening peek; refused outside it', () => {
  const s = newGame(['a', 'b']);
  const r = E.forceStartPlay(s);
  assert.equal(r.state.phase, 'turn');
  assert.ok(E.forceStartPlay(r.state).error);
});

test('act never mutates the input state', () => {
  const s = playing(['a', 'b']);
  const before = JSON.stringify(s);
  E.act(s, 'a', { type: 'draw' });
  E.act(s, 'a', { type: 'match', slot: 0 });
  E.autoPlay(s);
  assert.equal(JSON.stringify(s), before);
});

test('errors are in Arabic', () => {
  const s = playing(['a', 'b']);
  assert.match(bad(s, 'b', { type: 'draw' }), /[؀-ۿ]/);
});

// ---------- handId ----------

const handIdsOf = (view, pid) => view.players.find((p) => p.id === pid).hand.map((c) => c.handId);
const allHandIds = (s) => [].concat(...s.playerIds.map((id) => s.hands[id].map((c) => c.handId)));

test('handId: every dealt card has a unique id, visible in viewFor even when hidden', () => {
  const s = newGame(['a', 'b', 'c']);
  const ids = allHandIds(s);
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12);
  const v = E.viewFor(s, 'b');
  v.players.forEach((p) => p.hand.forEach((c) => assert.match(c.handId, /^h[0-9a-z]+$/)));
  assert.deepEqual(handIdsOf(v, 'a'), s.hands.a.map((c) => c.handId));
  assert.ok(v.players.find((p) => p.id === 'a').hand.every((c) => c.hidden)); // still hidden
});

test('handId carries no information about card value or deck order', () => {
  // Same shuffle (seed) with different id streams: cards equal, ids different.
  const x = E.createGame(['a', 'b'], { seed: 5, idSeed: 1 }).state;
  const y = E.createGame(['a', 'b'], { seed: 5, idSeed: 2 }).state;
  assert.notDeepEqual(allHandIds(x), allHandIds(y));
  // Different shuffles with the same id stream: ids equal even though cards differ.
  const z = E.createGame(['a', 'b'], { seed: 6, idSeed: 1 }).state;
  assert.deepEqual(allHandIds(x), allHandIds(z));
  // The id stream state is separate from the shuffle stream and never exposed in views.
  assert.ok(!JSON.stringify(E.viewFor(x, 'a')).includes('idRng'));
  assert.notEqual(x.idRng, x.rng);
});

test('handId: random per game, with no repeats across many games', () => {
  const ids = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const g = newGame(['a', 'b'], seed);
    g.hands.a.concat(g.hands.b).forEach((c) => ids.add(c.handId));
  }
  assert.equal(ids.size, 30 * 8);
});

test('handId: swap_drawn gives the new card a fresh id and the old id disappears', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { deck: [num(9)] });
  const before = handIdsOf(E.viewFor(s, 'a'), 'a');
  s = ok(s, 'a', { type: 'draw' }).state;
  const r = ok(s, 'a', { type: 'swap_drawn', slot: 1 });
  const after = handIdsOf(E.viewFor(r.state, 'a'), 'a');
  assert.equal(after[0], before[0]);
  assert.equal(after[2], before[2]);
  assert.notEqual(after[1], before[1]);
  assert.ok(!allHandIds(r.state).includes(before[1]));
  assert.equal(r.events[0].handId, before[1]);
  assert.equal(r.events[0].newHandId, after[1]);
  // floor cards carry no hand id
  assert.equal(r.state.discard[r.state.discard.length - 1].handId, undefined);
});

test('handId: take_discard gives a fresh id; a card that came back never reuses an old id', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { discard: [num(8)] });
  const before = handIdsOf(E.viewFor(s, 'a'), 'a');
  const r = ok(s, 'a', { type: 'take_discard', slot: 2 });
  const after = handIdsOf(E.viewFor(r.state, 'a'), 'a');
  assert.notEqual(after[2], before[2]);
  // the card thrown at slot 2 is now the floor top; take it back at the same slot
  const t = setup(r.state, { current: 0 });
  t.stage = 'start';
  const r2 = ok(t, 'a', { type: 'take_discard', slot: 2 });
  const again = handIdsOf(E.viewFor(r2.state, 'a'), 'a')[2];
  assert.notEqual(again, after[2]);
  assert.notEqual(again, before[2]);
});

test('handId: penalty card gets a fresh unique id, other cards keep theirs', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [num(1), num(2), num(3), num(4)] }, discard: [num(6)], deck: [num(9)] });
  const before = handIdsOf(E.viewFor(s, 'a'), 'a');
  const r = ok(s, 'a', { type: 'match', slot: 0 });
  const after = handIdsOf(E.viewFor(r.state, 'a'), 'a');
  assert.deepEqual(after.slice(0, 4), before);
  assert.equal(after.length, 5);
  assert.ok(!before.includes(after[4]));
  assert.equal(r.events.find((e) => e.type === 'penalty').newHandId, after[4]);
});

test('handId: after a successful match or basra the other cards keep their ids (slots shift)', () => {
  let s = playing(['a', 'b']);
  s = setup(s, { hands: { a: [num(1), num(6), num(3), num(4)] }, discard: [num(6)] });
  const before = handIdsOf(E.viewFor(s, 'a'), 'a');
  const r = ok(s, 'a', { type: 'match', slot: 1 });
  assert.deepEqual(handIdsOf(E.viewFor(r.state, 'a'), 'a'), [before[0], before[2], before[3]]);
  assert.equal(r.events.find((e) => e.type === 'match').handId, before[1]);
  const b = withAbility(sp('basra'));
  const b0 = handIdsOf(E.viewFor(b, 'a'), 'a');
  const rb = ok(b, 'a', { type: 'use_ability', slot: 0 });
  assert.deepEqual(handIdsOf(E.viewFor(rb.state, 'a'), 'a'), b0.slice(1));
});

test('handId: swap (خد وهات) keeps both ids and they move with the cards', () => {
  const s = withAbility(sp('swap'));
  const aBefore = handIdsOf(E.viewFor(s, 'a'), 'a');
  const bBefore = handIdsOf(E.viewFor(s, 'a'), 'b');
  const r = ok(s, 'a', { type: 'use_ability', slot: 0, targetPlayerId: 'b', targetSlot: 3 });
  const v = E.viewFor(r.state, 'a');
  assert.equal(handIdsOf(v, 'a')[0], bBefore[3]);
  assert.equal(handIdsOf(v, 'b')[3], aBefore[0]);
  assert.equal(r.events.find((e) => e.type === 'swap').handId, bBefore[3]);
  assert.equal(r.events.find((e) => e.type === 'swap').targetHandId, aBefore[0]);
});

test('handId: looking at a card reports its handId and does not change any id', () => {
  const s = withAbility(num(10));
  const bIds = handIdsOf(E.viewFor(s, 'a'), 'b');
  const r = ok(s, 'a', { type: 'use_ability', targetPlayerId: 'b', targetSlot: 2 });
  assert.equal(r.privates[0].reveals[0].handId, bIds[2]);
  assert.equal(r.events.find((e) => e.type === 'look').targets[0].handId, bIds[2]);
  assert.deepEqual(handIdsOf(E.viewFor(r.state, 'a'), 'b'), bIds);
});

test('handId: ids stay unique across random play', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let s = E.forceStartPlay(newGame(['a', 'b', 'c', 'd'], seed)).state;
    for (let i = 0; i < 200 && s.phase === 'turn'; i++) {
      const pid = s.playerIds[s.current];
      let r = null;
      if (i % 3 === 0 && s.stage === 'start' && s.hands[pid].length) r = E.act(s, pid, { type: 'match', slot: 0 });
      if (!r || r.error) r = E.autoPlay(s);
      s = r.state;
      const ids = allHandIds(s);
      assert.equal(new Set(ids).size, ids.length);
      ids.forEach((id) => assert.ok(id));
    }
  }
});
