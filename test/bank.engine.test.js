const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../server/games/bank/config');
const B = require('../server/games/bank/board');
const CARDS = require('../server/games/bank/cards');
const E = require('../server/games/bank/engine');

// ---------- helpers ----------

function game(n, seed) {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, n || 2);
  const r = E.createGame(ids, { seed: seed === undefined ? 7 : seed });
  assert.ok(r.state, r.error);
  return r.state;
}

// state is plain JSON: tests may shape it directly
function setup(s, fn) {
  const c = JSON.parse(JSON.stringify(s));
  fn(c);
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
  return r.error;
}

function rollWith(s, pid, a, b) {
  return ok(setup(s, (x) => { x.forcedDice = [a, b].concat(x.forcedDice || []); }), pid, { type: 'roll' });
}

function own(s, pid, squares, extra) {
  return setup(s, (x) => {
    squares.forEach((i) => { x.props[i].owner = pid; Object.assign(x.props[i], extra || {}); });
  });
}

const sq = (name) => B.SQUARES.findIndex((q) => q.name === name);
const types = (r) => r.events.map((e) => e.type);

// ---------- board ----------

test('board: 40 squares, 22 properties in 8 groups (2,3,3,3,3,3,3,2), 4 stations, 2 utilities', () => {
  assert.equal(B.SIZE, 40);
  const props = B.SQUARES.filter((q) => q.type === 'property');
  assert.equal(props.length, 22);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((g) => B.groupSquares(g).length), [2, 3, 3, 3, 3, 3, 3, 2]);
  assert.deepEqual(B.indicesOf('station'), [5, 15, 25, 35]);
  assert.deepEqual(B.indicesOf('utility'), [12, 28]);
  assert.equal(B.indicesOf('chance').length, 3);
  assert.equal(B.indicesOf('chest').length, 3);
  assert.equal(B.SQUARES[0].type, 'go');
  assert.equal(B.SQUARES[B.JAIL_INDEX].type, 'jail');
  assert.equal(B.SQUARES[30].type, 'gotojail');
  // prices rise around the board
  for (let i = 1; i < props.length; i++) assert.ok(props[i].price >= props[i - 1].price);
});

test('board: rents follow our formula, mortgage is half the price', () => {
  const q = B.SQUARES[sq('الكرادة')];
  const base = Math.max(CONFIG.RENT_MIN, Math.round(q.price * CONFIG.RENT_BASE_RATE));
  assert.deepEqual(q.rents, [base, base * 5, base * 15, base * 40, base * 55, base * 70]);
  assert.equal(q.mortgage, q.price / 2);
  assert.equal(q.houseCost, CONFIG.HOUSE_COST_BY_GROUP[q.group - 1]);
});

test('cards: 16 chance + 16 chest with unique ids and Arabic texts', () => {
  assert.equal(CARDS.CHANCE.length, 16);
  assert.equal(CARDS.CHEST.length, 16);
  assert.equal(Object.keys(CARDS.byId).length, 32);
  Object.values(CARDS.byId).forEach((c) => assert.match(c.text, /[؀-ۿ]/));
});

// ---------- setup ----------

test('createGame: start cash, all on GO, shuffled decks, bad player counts refused', () => {
  const s = game(4);
  ['a', 'b', 'c', 'd'].forEach((id) => {
    assert.equal(s.players[id].cash, CONFIG.START_CASH);
    assert.equal(s.players[id].pos, 0);
  });
  assert.equal(s.decks.chance.length, 16);
  assert.equal(s.decks.chest.length, 16);
  assert.equal(s.stage, 'roll');
  assert.ok(E.createGame(['a']).error);
  assert.ok(E.createGame(['a', 'b', 'c', 'd', 'e', 'f', 'g']).error);
  assert.ok(E.createGame(['a', 'a']).error);
  // same seed, same decks
  assert.deepEqual(game(2, 5).decks, game(2, 5).decks);
});

// ---------- rolling and moving ----------

test('roll moves the player by the dice total; only the current player in the right stage', () => {
  const s = game(2);
  bad(s, 'b', { type: 'roll' });
  const r = rollWith(s, 'a', 2, 1); // to square 3 (الشورجة)
  assert.equal(r.state.players.a.pos, 3);
  assert.equal(r.state.stage, 'buy');
  bad(r.state, 'a', { type: 'roll' });
});

test('passing GO pays the salary; landing exactly on GO too', () => {
  let s = setup(game(2), (x) => { x.players.a.pos = 38; });
  let r = rollWith(s, 'a', 2, 1); // 38 -> 1
  assert.equal(r.state.players.a.pos, 1);
  assert.ok(types(r).includes('salary'));
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH + CONFIG.GO_SALARY);
  s = setup(game(2), (x) => { x.players.a.pos = 37; x.props[39].owner = 'a'; });
  r = rollWith(s, 'a', 1, 2); // 37 -> 0
  assert.equal(r.state.players.a.pos, 0);
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH + CONFIG.GO_SALARY);
});

test('doubles give another roll after ending the move; three doubles in a row send to jail', () => {
  let s = game(2);
  let r = rollWith(s, 'a', 3, 3); // 6: شارع الرشيد
  s = ok(r.state, 'a', { type: 'decline' }).state;
  s = E.closeAuction(s).state;
  s = ok(s, 'a', { type: 'end_turn' }).state;
  assert.equal(s.playerIds[s.current], 'a');
  assert.equal(s.stage, 'roll');
  // force a third double
  s = setup(s, (x) => { x.doublesInRow = 2; });
  r = rollWith(s, 'a', 4, 4);
  assert.ok(types(r).includes('speeding'));
  assert.equal(r.state.players.a.inJail, true);
  assert.equal(r.state.players.a.pos, B.JAIL_INDEX);
  s = ok(r.state, 'a', { type: 'end_turn' }).state;
  assert.equal(s.playerIds[s.current], 'b'); // no extra roll from jail
});

// ---------- buying and auctions ----------

test('buy: pays the price and owns the square; refused without enough cash', () => {
  const s = rollWith(game(2), 'a', 2, 1).state; // الشورجة 60
  const r = ok(s, 'a', { type: 'buy' });
  assert.equal(r.state.props[3].owner, 'a');
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH - 60);
  assert.equal(r.state.stage, 'postRoll');
  const poor = setup(s, (x) => { x.players.a.cash = 10; });
  assert.equal(bad(poor, 'a', { type: 'buy' }), E.ERR.noCash);
});

test('decline starts an auction: anyone bids, minimum step, cash limit, highest bid wins', () => {
  let s = rollWith(game(3), 'a', 2, 1).state;
  s = ok(s, 'a', { type: 'decline' }).state;
  assert.equal(s.stage, 'auction');
  assert.equal(bad(s, 'b', { type: 'bid', amount: 5 }), E.ERR.lowBid);
  s = ok(s, 'b', { type: 'bid', amount: 10 }).state;
  assert.equal(bad(s, 'c', { type: 'bid', amount: 15 }), E.ERR.lowBid);
  assert.equal(bad(s, 'c', { type: 'bid', amount: 99999 }), E.ERR.noCash);
  s = ok(s, 'c', { type: 'bid', amount: 40 }).state;
  s = ok(s, 'a', { type: 'bid', amount: 50 }).state; // the decliner may bid too
  assert.equal(s.auction.seq, 3);
  bad(s, 'a', { type: 'build', square: 3 }); // no management during an auction
  const r = E.closeAuction(s);
  assert.equal(r.state.props[3].owner, 'a');
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH - 50);
  assert.equal(r.state.stage, 'postRoll');
});

test('auction with no bids leaves the square with the bank', () => {
  let s = rollWith(game(2), 'a', 2, 1).state;
  s = ok(s, 'a', { type: 'decline' }).state;
  const r = E.closeAuction(s);
  assert.equal(r.state.props[3].owner, null);
  assert.ok(types(r).includes('auction_none'));
});

// ---------- rent ----------

test('rent: bare land, doubled on a full set, houses, hotel, nothing if mortgaged', () => {
  const i = sq('الشورجة'); // group 1 with الباب الشرقي
  const g = B.groupSquares(1);
  const q = B.SQUARES[i];
  const land = (state) => rollWith(setup(state, (x) => { x.current = 0; x.players.a.pos = i - 3; }), 'a', 1, 2);
  let s = own(game(2), 'b', [i]);
  let r = land(s);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + q.rents[0]);
  s = own(game(2), 'b', g);
  r = land(s);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + q.rents[0] * 2);
  s = own(game(2), 'b', g, { houses: 3 });
  r = land(s);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + q.rents[3]);
  s = own(game(2), 'b', g, { houses: 5 });
  r = land(s);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + q.rents[5]);
  s = own(game(2), 'b', [i], { mortgaged: true });
  r = land(s);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH);
  // landing on your own square costs nothing
  s = own(game(2), 'a', [i]);
  r = land(s);
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH);
});

test('rent: stations by count owned; utilities by dice total x4 or x10', () => {
  let s = own(game(2), 'b', [5, 15]);
  let r = rollWith(setup(s, (x) => { x.players.a.pos = 2; }), 'a', 1, 2); // to 5
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + CONFIG.STATION_RENTS[1]);
  s = own(game(2), 'b', [12]);
  r = rollWith(setup(s, (x) => { x.players.a.pos = 7; }), 'a', 2, 3); // to 12, dice 5
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + 5 * CONFIG.UTILITY_MULTIPLIERS[0]);
  s = own(game(2), 'b', [12, 28]);
  r = rollWith(setup(s, (x) => { x.players.a.pos = 7; }), 'a', 2, 3);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + 5 * CONFIG.UTILITY_MULTIPLIERS[1]);
});

test('owner in jail still collects rent', () => {
  let s = own(game(2), 'b', [3]);
  s = setup(s, (x) => { x.players.b.inJail = true; x.players.b.pos = B.JAIL_INDEX; });
  const r = rollWith(s, 'a', 2, 1);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + B.SQUARES[3].rents[0]);
});

test('tax squares charge the bank amount', () => {
  const r = rollWith(game(2), 'a', 1, 3); // square 4 income tax
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH - B.SQUARES[4].amount);
});

// ---------- cards ----------

function drawWith(cardId, prepare) {
  const deck = CARDS.byId[cardId].id.charAt(0) === 'c' ? 'chance' : 'chest';
  const target = deck === 'chance' ? 7 : 2; // first chance / chest square
  let s = setup(game(3), (x) => {
    x.decks[deck] = [cardId].concat(x.decks[deck].filter((id) => id !== cardId));
    x.players.a.pos = target - 3;
    if (prepare) prepare(x);
  });
  return rollWith(s, 'a', 1, 2);
}

test('card advance: moves and pays GO when passing', () => {
  const r = drawWith('c2', (x) => { x.players.a.pos = 36 - 3; x.decks.chance = ['c2'].concat(x.decks.chance.filter((i) => i !== 'c2')); });
  // from 36 to شارع الرشيد (6) passes GO
  assert.equal(r.state.players.a.pos, 6);
  assert.ok(types(r).includes('salary'));
  assert.equal(r.state.stage, 'buy');
  assert.equal(r.state.decks.chance[r.state.decks.chance.length - 1], 'c2'); // back under the deck
});

test('card nearest station: pays double rent to the owner', () => {
  const r = drawWith('c6', (x) => { x.props[15].owner = 'b'; }); // from 7 the nearest is 15
  assert.equal(r.state.players.a.pos, 15);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + CONFIG.STATION_RENTS[0] * 2);
});

test('card nearest utility: new roll times 10', () => {
  const r = drawWith('c8', (x) => { x.props[12].owner = 'b'; x.forcedDice = [3, 4]; });
  // first roll 1+2 moves to chance (7); utility roll 3+4 = 7 -> 70
  assert.equal(r.state.players.a.pos, 12);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + 70);
});

test('card back 3 squares, collect, pay, pay each, collect each, repairs', () => {
  let r = drawWith('c9');
  assert.equal(r.state.players.a.pos, 4); // 7 - 3 = income tax
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH - B.SQUARES[4].amount);
  r = drawWith('c12');
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH + 50);
  r = drawWith('c14');
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH - 15);
  r = drawWith('c15');
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH - 100);
  assert.equal(r.state.players.b.cash, CONFIG.START_CASH + 50);
  r = drawWith('k7');
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH + 20);
  assert.equal(r.state.players.c.cash, CONFIG.START_CASH - 10);
  r = drawWith('c16', (x) => {
    x.props[1].owner = 'a'; x.props[1].houses = 2;
    x.props[3].owner = 'a'; x.props[3].houses = 5;
  });
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH - (2 * 25 + 100));
});

test('card go to jail; card get-out-of-jail is kept and returned to the deck when used', () => {
  let r = drawWith('c10');
  assert.equal(r.state.players.a.inJail, true);
  r = drawWith('k5');
  assert.deepEqual(r.state.players.a.jailCards, ['k5']);
  assert.ok(!r.state.decks.chest.includes('k5'));
  let s = setup(r.state, (x) => { x.players.a.inJail = true; x.current = 0; x.stage = 'roll'; });
  s = ok(s, 'a', { type: 'use_jail_card' }).state;
  assert.equal(s.players.a.inJail, false);
  assert.deepEqual(s.players.a.jailCards, []);
  assert.equal(s.decks.chest[s.decks.chest.length - 1], 'k5');
});

// ---------- jail ----------

test('go-to-jail square jails without salary; pay the fine to leave before rolling', () => {
  let s = setup(game(2), (x) => { x.players.a.pos = 27; });
  let r = rollWith(s, 'a', 1, 2); // 30
  assert.equal(r.state.players.a.pos, B.JAIL_INDEX);
  assert.equal(r.state.players.a.inJail, true);
  s = setup(r.state, (x) => { x.current = 0; x.stage = 'roll'; });
  s = ok(s, 'a', { type: 'pay_jail' }).state;
  assert.equal(s.players.a.inJail, false);
  assert.equal(s.players.a.cash, CONFIG.START_CASH - CONFIG.JAIL_FINE);
  assert.equal(s.stage, 'roll');
  bad(game(2), 'a', { type: 'pay_jail' });
});

test('jail: doubles free you (no extra roll); third failure forces the fine and moves', () => {
  const jailed = setup(game(2), (x) => { x.players.a.inJail = true; x.players.a.pos = B.JAIL_INDEX; });
  let r = rollWith(jailed, 'a', 2, 2);
  assert.equal(r.state.players.a.inJail, false);
  assert.equal(r.state.players.a.pos, 14);
  assert.equal(r.state.rolledDoubles, false);
  r = rollWith(jailed, 'a', 1, 2);
  assert.equal(r.state.players.a.inJail, true);
  assert.equal(r.state.players.a.jailTurns, 1);
  assert.equal(r.state.stage, 'postRoll');
  const third = setup(jailed, (x) => { x.players.a.jailTurns = 2; });
  r = rollWith(third, 'a', 1, 2);
  assert.equal(r.state.players.a.inJail, false);
  assert.equal(r.state.players.a.pos, 13);
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH - CONFIG.JAIL_FINE);
});

// ---------- building ----------

test('build: needs the full set, builds evenly, costs the house price, hotel after 4 houses', () => {
  const g = B.groupSquares(2); // three squares
  let s = own(game(2), 'a', [g[0], g[1]]);
  assert.equal(bad(s, 'a', { type: 'build', square: g[0] }), E.ERR.needSet);
  s = own(game(2), 'a', g);
  s = ok(s, 'a', { type: 'build', square: g[0] }).state;
  assert.equal(bad(s, 'a', { type: 'build', square: g[0] }), E.ERR.uneven);
  s = ok(s, 'a', { type: 'build', square: g[1] }).state;
  s = ok(s, 'a', { type: 'build', square: g[2] }).state;
  assert.equal(s.players.a.cash, CONFIG.START_CASH - 3 * B.SQUARES[g[0]].houseCost);
  assert.equal(s.bankHouses, CONFIG.BANK_HOUSES - 3);
  s = setup(s, (x) => { g.forEach((i) => { x.props[i].houses = 4; }); x.bankHouses = CONFIG.BANK_HOUSES - 12; });
  s = ok(s, 'a', { type: 'build', square: g[0] }).state;
  assert.equal(s.props[g[0]].houses, 5);
  assert.equal(s.bankHotels, CONFIG.BANK_HOTELS - 1);
  assert.equal(s.bankHouses, CONFIG.BANK_HOUSES - 12 + 4); // the 4 houses go back
  assert.equal(bad(setup(s, (x) => { g.forEach((i) => { x.props[i].houses = 5; }); }), 'a', { type: 'build', square: g[0] }), E.ERR.maxBuilt);
  bad(s, 'b', { type: 'build', square: g[1] }); // not the owner
});

test('build: blocked by a mortgaged square, by cash, by an empty bank', () => {
  const g = B.groupSquares(1);
  let s = own(game(2), 'a', g);
  assert.equal(bad(setup(s, (x) => { x.props[g[1]].mortgaged = true; }), 'a', { type: 'build', square: g[0] }), E.ERR.setMortgaged);
  assert.equal(bad(setup(s, (x) => { x.players.a.cash = 1; }), 'a', { type: 'build', square: g[0] }), E.ERR.noCash);
  assert.equal(bad(setup(s, (x) => { x.bankHouses = 0; }), 'a', { type: 'build', square: g[0] }), E.ERR.noHouses);
  const full = setup(s, (x) => { g.forEach((i) => { x.props[i].houses = 4; }); x.bankHotels = 0; });
  assert.equal(bad(full, 'a', { type: 'build', square: g[0] }), E.ERR.noHotels);
});

test('sell buildings: evenly, half price; a hotel needs 4 houses in the bank', () => {
  const g = B.groupSquares(1);
  let s = own(game(2), 'a', g);
  s = setup(s, (x) => { x.props[g[0]].houses = 2; x.props[g[1]].houses = 1; x.bankHouses -= 3; });
  assert.equal(bad(s, 'a', { type: 'sell_building', square: g[1] }), E.ERR.uneven);
  const r = ok(s, 'a', { type: 'sell_building', square: g[0] });
  assert.equal(r.state.props[g[0]].houses, 1);
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH + B.SQUARES[g[0]].houseCost / 2);
  let h = setup(own(game(2), 'a', g), (x) => { g.forEach((i) => { x.props[i].houses = 5; }); x.bankHotels -= 2; x.bankHouses = 2; });
  assert.equal(bad(h, 'a', { type: 'sell_building', square: g[0] }), E.ERR.housesForHotel);
  h = setup(h, (x) => { x.bankHouses = 10; });
  const r2 = ok(h, 'a', { type: 'sell_building', square: g[0] });
  assert.equal(r2.state.props[g[0]].houses, 4);
  assert.equal(r2.state.bankHouses, 6);
  assert.equal(bad(game(2), 'a', { type: 'sell_building', square: 1 }), E.ERR.notOwner);
});

// ---------- mortgage ----------

test('mortgage gives half the price; not with buildings in the group; unmortgage costs +10%', () => {
  const g = B.groupSquares(3);
  let s = own(game(2), 'a', g);
  assert.equal(bad(setup(s, (x) => { x.props[g[2]].houses = 1; }), 'a', { type: 'mortgage', square: g[0] }), E.ERR.hasBuildings);
  s = ok(s, 'a', { type: 'mortgage', square: g[0] }).state;
  assert.equal(s.players.a.cash, CONFIG.START_CASH + B.SQUARES[g[0]].mortgage);
  assert.equal(bad(s, 'a', { type: 'mortgage', square: g[0] }), E.ERR.mortgaged);
  s = ok(s, 'a', { type: 'unmortgage', square: g[0] }).state;
  assert.equal(s.players.a.cash, CONFIG.START_CASH + B.SQUARES[g[0]].mortgage - E.unmortgageCost(g[0]));
  assert.equal(E.unmortgageCost(g[0]), Math.round(B.SQUARES[g[0]].mortgage * 1.1));
  assert.equal(bad(s, 'a', { type: 'unmortgage', square: g[0] }), E.ERR.notMortgaged);
});

// ---------- trades ----------

test('trade: offer, accept moves properties, cash and jail cards both ways', () => {
  let s = own(game(2), 'a', [1, 5]);
  s = own(s, 'b', [3], { mortgaged: true });
  s = setup(s, (x) => { x.players.b.jailCards = ['c11']; });
  s = ok(s, 'a', { type: 'trade_offer', to: 'b', give: { props: [1, 5], cash: 100 }, get: { props: [3], jailCards: 1 } }).state;
  assert.ok(s.trade);
  assert.equal(bad(s, 'a', { type: 'trade_offer', to: 'b', give: { cash: 1 } }), E.ERR.tradeBusy);
  bad(s, 'a', { type: 'trade_accept' }); // only the receiver accepts
  s = ok(s, 'b', { type: 'trade_accept' }).state;
  assert.equal(s.props[1].owner, 'b');
  assert.equal(s.props[5].owner, 'b');
  assert.equal(s.props[3].owner, 'a');
  assert.equal(s.props[3].mortgaged, true); // moves mortgaged
  assert.equal(s.players.a.cash, CONFIG.START_CASH - 100);
  assert.equal(s.players.b.cash, CONFIG.START_CASH + 100);
  assert.deepEqual(s.players.a.jailCards, ['c11']);
  assert.equal(s.trade, null);
});

test('trade: reject, cancel, expire; invalid offers refused', () => {
  let s = own(game(3), 'a', [1]);
  const offer = { type: 'trade_offer', to: 'b', give: { props: [1] }, get: { cash: 50 } };
  let t = ok(s, 'a', offer).state;
  assert.equal(ok(t, 'b', { type: 'trade_reject' }).state.trade, null);
  assert.equal(ok(t, 'a', { type: 'trade_cancel' }).state.trade, null);
  bad(t, 'c', { type: 'trade_reject' });
  const ex = E.expireTrade(t);
  assert.equal(ex.state.trade, null);
  assert.ok(E.expireTrade(ex.state).error);
  assert.equal(bad(s, 'a', { type: 'trade_offer', to: 'b', give: { props: [3] } }), E.ERR.badTrade); // not mine
  assert.equal(bad(s, 'a', { type: 'trade_offer', to: 'a', give: { props: [1] } }), E.ERR.badTrade);
  assert.equal(bad(s, 'a', { type: 'trade_offer', to: 'b', give: { cash: 99999 } }), E.ERR.badTrade);
  assert.equal(bad(s, 'a', { type: 'trade_offer', to: 'b', give: {}, get: {} }), E.ERR.emptyTrade);
  assert.equal(bad(s, 'a', { type: 'trade_offer', to: 'b', give: { cash: -5 } }), E.ERR.badTrade);
  const built = setup(own(game(2), 'a', B.groupSquares(1)), (x) => { x.props[3].houses = 1; });
  assert.equal(bad(built, 'a', { type: 'trade_offer', to: 'b', give: { props: [1] } }), E.ERR.hasBuildings);
});

test('trade: an offer that became invalid is cancelled on accept, nothing moves', () => {
  let s = own(game(2), 'a', [1]);
  s = ok(s, 'a', { type: 'trade_offer', to: 'b', give: {}, get: { cash: 500 } }).state;
  s = setup(s, (x) => { x.players.b.cash = 100; });
  const r = ok(s, 'b', { type: 'trade_accept' });
  assert.ok(types(r).includes('trade_cancelled'));
  assert.equal(r.state.players.b.cash, 100);
  assert.equal(r.state.players.a.cash, CONFIG.START_CASH);
});

// ---------- debts and bankruptcy ----------

function rentDebt() {
  // b owns الشورجة with a hotel; a has only 100 and lands there
  let s = own(game(2), 'b', B.groupSquares(1), { houses: 5 });
  s = own(s, 'a', [5, 39]);
  s = setup(s, (x) => { x.players.a.cash = 100; x.players.a.jailCards = ['k5']; });
  return rollWith(s, 'a', 2, 1);
}

test('debt: rent larger than cash pauses the game for the debtor', () => {
  const r = rentDebt();
  assert.equal(r.state.stage, 'debt');
  assert.equal(r.state.debts[0].debtor, 'a');
  assert.equal(r.state.debts[0].creditor, 'b');
  bad(r.state, 'a', { type: 'end_turn' });
  assert.equal(bad(r.state, 'a', { type: 'pay_debt' }), E.ERR.noCash);
  assert.equal(bad(r.state, 'b', { type: 'pay_debt' }), E.ERR.notDebtor);
});

test('debt: raise money by mortgaging, then pay and continue the turn', () => {
  let s = rentDebt().state;
  const owed = s.debts[0].amount;
  s = setup(s, (x) => { x.players.a.cash = owed - 1; });
  s = ok(s, 'a', { type: 'mortgage', square: 39 }).state;
  s = ok(s, 'a', { type: 'pay_debt' }).state;
  assert.equal(s.stage, 'postRoll');
  assert.equal(s.debts.length, 0);
  assert.equal(s.players.b.cash, CONFIG.START_CASH + owed);
});

test('bankruptcy to a player: cash, properties (still mortgaged) and jail cards go to the creditor', () => {
  let s = setup(rentDebt().state, (x) => { x.props[39].mortgaged = true; });
  const r = ok(s, 'a', { type: 'declare_bankruptcy' });
  const t = r.state;
  assert.equal(t.players.a.bankrupt, true);
  assert.equal(t.props[5].owner, 'b');
  assert.equal(t.props[39].owner, 'b');
  assert.equal(t.props[39].mortgaged, true);
  assert.deepEqual(t.players.b.jailCards, ['k5']);
  assert.equal(t.players.b.cash, CONFIG.START_CASH + 100);
  assert.equal(t.phase, 'gameOver'); // only b left
  assert.deepEqual(t.winnerIds, ['b']);
  assert.ok(E.act(t, 'b', { type: 'roll' }).error);
});

test('bankruptcy to the bank: buildings sold, properties return free, play goes on', () => {
  let s = own(game(3), 'a', B.groupSquares(1), { houses: 2 });
  s = setup(s, (x) => { x.players.a.cash = 10; x.players.a.pos = 1; x.bankHouses -= 4; });
  let r = rollWith(s, 'a', 1, 2); // square 4 income tax 200
  assert.equal(r.state.stage, 'debt');
  r = ok(r.state, 'a', { type: 'declare_bankruptcy' });
  const t = r.state;
  assert.equal(t.players.a.bankrupt, true);
  B.groupSquares(1).forEach((i) => {
    assert.equal(t.props[i].owner, null);
    assert.equal(t.props[i].houses, 0);
  });
  assert.equal(t.bankHouses, CONFIG.BANK_HOUSES);
  assert.equal(t.phase, 'turn');
  assert.equal(t.playerIds[t.current], 'b'); // turn passes on
  assert.equal(t.stage, 'roll');
  bad(t, 'a', { type: 'trade_offer', to: 'b', give: { cash: 1 } });
});

test('debt of another player (collect each): handled, then the turn resumes', () => {
  const r = drawWith('k7', (x) => { x.players.c.cash = 5; });
  assert.equal(r.state.stage, 'debt');
  assert.equal(r.state.debts[0].debtor, 'c');
  const after = ok(r.state, 'c', { type: 'declare_bankruptcy' });
  assert.equal(after.state.players.c.bankrupt, true);
  assert.equal(after.state.players.a.cash, CONFIG.START_CASH + 10 + 5);
  assert.equal(after.state.stage, 'postRoll');
  assert.equal(after.state.playerIds[after.state.current], 'a');
});

// ---------- timers (autoPlay) ----------

test('autoPlay: rolls, declines into an auction, closes it, pays or goes bankrupt, ends the turn', () => {
  let s = setup(game(2), (x) => { x.forcedDice = [2, 1]; });
  let r = E.autoPlay(s);
  assert.equal(r.state.stage, 'buy');
  r = E.autoPlay(r.state);
  assert.equal(r.state.stage, 'auction');
  r = E.autoPlay(r.state);
  assert.equal(r.state.stage, 'postRoll');
  r = E.autoPlay(r.state);
  assert.equal(r.state.playerIds[r.state.current], 'b');
  const debt = rentDebt().state;
  assert.equal(E.autoPlay(debt).state.players.a.bankrupt, true);
  const payable = setup(debt, (x) => { x.players.a.cash = 5000; });
  assert.equal(E.autoPlay(payable).state.stage, 'postRoll');
});

test('endGameEarly: the richest by cash + property + buildings wins', () => {
  let s = own(game(3), 'b', B.groupSquares(8));
  const r = E.endGameEarly(s);
  assert.equal(r.state.phase, 'gameOver');
  assert.deepEqual(r.state.winnerIds, ['b']);
  assert.equal(E.netWorth(s, 'b'), CONFIG.START_CASH + 350 + 400);
  assert.ok(E.endGameEarly(r.state).error);
});

// ---------- safety ----------

test('viewFor hides the RNG and the order of the card decks', () => {
  const v = E.viewFor(game(2), 'a');
  assert.equal(v.rng, undefined);
  assert.deepEqual(v.decks, { chance: 16, chest: 16 });
  assert.equal(v.you, 'a');
  assert.equal(v.currentPlayerId, 'a');
  assert.equal(JSON.stringify(v).includes('"c1"'), false);
});

test('act never mutates its input; unknown actions and players are refused in Arabic', () => {
  const s = game(2);
  const before = JSON.stringify(s);
  E.act(s, 'a', { type: 'roll' });
  E.autoPlay(s);
  assert.equal(JSON.stringify(s), before);
  assert.match(bad(s, 'a', { type: 'hack' }), /[؀-ۿ]/);
  bad(s, 'zz', { type: 'roll' });
  bad(s, 'a', null);
});

// ---------- whole games with simple bots ----------

function botStep(s, rand) {
  const pid = s.playerIds[s.current];
  const me = s.players[pid];
  if (s.stage === 'buy') {
    return E.act(s, pid, { type: me.cash >= B.SQUARES[s.pending.square].price ? 'buy' : 'decline' });
  }
  if (s.stage === 'auction') {
    const bidder = s.playerIds.filter((id) => !s.players[id].bankrupt)[Math.floor(rand() * s.playerIds.length) % s.playerIds.length];
    const amt = (s.auction.bid || 0) + CONFIG.AUCTION_MIN_INCREMENT;
    if (bidder && rand() < 0.5 && s.players[bidder] && !s.players[bidder].bankrupt && s.players[bidder].cash > amt + 200 && s.auction.seq < 5) {
      const r = E.act(s, bidder, { type: 'bid', amount: amt });
      if (!r.error) return r;
    }
    return E.closeAuction(s);
  }
  if (s.stage === 'debt') {
    const d = s.debts[0];
    // try to raise money first
    for (const i of Object.keys(s.props).map(Number)) {
      if (s.players[d.debtor].cash >= d.amount) break;
      const p = s.props[i];
      if (p.owner !== d.debtor) continue;
      let r = E.act(s, d.debtor, { type: 'sell_building', square: i });
      if (!r.error) return r;
      r = E.act(s, d.debtor, { type: 'mortgage', square: i });
      if (!r.error) return r;
    }
    return E.autoPlay(s);
  }
  if (s.stage === 'postRoll') {
    // build where possible
    for (const i of Object.keys(s.props).map(Number)) {
      if (s.props[i].owner === pid && me.cash > 300 && rand() < 0.6) {
        const r = E.act(s, pid, { type: 'build', square: i });
        if (!r.error) return r;
      }
    }
  }
  return E.autoPlay(s);
}

test('bots play complete games: money never negative, buildings and cards conserved, a winner emerges', () => {
  let finished = 0;
  // without trades, sets are rare with many players, so long games are normal: test 2-3 players
  for (let seed = 1; seed <= 16; seed++) {
    let s = game(2 + (seed % 2), seed);
    let x = seed;
    const rand = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    let steps = 0;
    while (s.phase === 'turn' && steps++ < 15000) {
      const r = botStep(s, rand);
      assert.ok(r.state, 'bot got stuck: ' + r.error + ' at stage ' + s.stage);
      s = r.state;
      for (const id of s.playerIds) assert.ok(s.players[id].cash >= 0, 'negative cash');
      const props = Object.values(s.props);
      const houses = props.reduce((t, p) => t + (p.houses === 5 ? 0 : p.houses), 0);
      const hotels = props.filter((p) => p.houses === 5).length;
      assert.equal(houses + s.bankHouses, CONFIG.BANK_HOUSES);
      assert.equal(hotels + s.bankHotels, CONFIG.BANK_HOTELS);
      const held = s.playerIds.reduce((t, id) => t + s.players[id].jailCards.length, 0);
      assert.equal(s.decks.chance.length + s.decks.chest.length + held, 32);
    }
    if (s.phase === 'gameOver') {
      finished++;
      assert.equal(s.winnerIds.length, 1);
      assert.equal(s.players[s.winnerIds[0]].bankrupt, false);
    }
  }
  assert.ok(finished >= 6, 'bot games should often end in bankruptcy, got ' + finished);
});
