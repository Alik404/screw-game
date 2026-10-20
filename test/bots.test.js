const test = require('node:test');
const assert = require('node:assert/strict');
const SCONF = require('../server/config');
const SD = require('../server/deck');
const SE = require('../server/engine');
const VCONF = require('../server/games/seven/config');
const VE = require('../server/games/seven/engine');
const BCONF = require('../server/games/bank/config');
const BB = require('../server/games/bank/board');
const BE = require('../server/games/bank/engine');
const { createRooms } = require('../server/rooms');

// ============ Screw ============

// play a screw game to the end: computer players on botPlay, the others on the safe default move
function playScrew(seed, bots, ids) {
  let s = SE.createGame(ids, { seed, idSeed: seed + 1, bots }).state;
  s = SE.forceStartPlay(s).state;
  for (let n = 0; n < 20000 && s.phase !== 'gameOver'; n++) {
    if (s.phase === 'roundOver') { s = SE.act(s, ids[0], { type: 'next_round' }).state; s = SE.forceStartPlay(s).state; continue; }
    const cur = s.playerIds[s.current];
    const r = bots.includes(cur) ? SE.botPlay(s) : SE.autoPlay(s);
    assert.ok(r.state, r.error);
    s = r.state;
  }
  assert.equal(s.phase, 'gameOver');
  return s;
}

test('screw: computer players finish whole games and never lose or duplicate a card', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let s = SE.createGame(['a', 'b', 'c'], { seed, idSeed: seed + 9, bots: ['a', 'b', 'c'] }).state;
    assert.ok(['a', 'b', 'c'].every((id) => s.ready[id]), 'computer players are ready at once');
    s = SE.forceStartPlay(s).state;
    for (let n = 0; n < 20000 && s.phase !== 'gameOver'; n++) {
      if (s.phase === 'roundOver') { s = SE.act(s, 'a', { type: 'next_round' }).state; continue; }
      if (s.phase === 'peek') { s = SE.forceStartPlay(s).state; continue; }
      const r = SE.botPlay(s);
      assert.ok(r.state, r.error);
      s = r.state;
      const all = [].concat(s.deck, s.discard, ...Object.values(s.hands)).length + (s.drawn ? 1 : 0);
      assert.equal(all, SD.buildDeck().length);
    }
    assert.equal(s.phase, 'gameOver');
  }
});

test('screw: the computer player is fair: cards it has not seen do not change what it does', () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    let s = SE.createGame(['bot', 'x'], { seed, idSeed: seed + 3, bots: ['bot'] }).state;
    s = SE.forceStartPlay(s).state;
    // play a few turns so the bot has some memory, then compare its choice with hidden cards scrambled
    for (let n = 0; n < 2 * (seed % 6) && s.phase === 'turn'; n++) s = (s.playerIds[s.current] === 'bot' ? SE.botPlay(s) : SE.autoPlay(s)).state;
    if (s.phase !== 'turn' || s.playerIds[s.current] !== 'bot' || s.stage !== 'start') continue;
    const twin = JSON.parse(JSON.stringify(s));
    const mem = twin.mem.bot;
    const swaps = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const fake = (c) => { c.type = 'num'; c.rank = 1 + ((c.rank || 3) % 9); c.value = c.rank; };
    Object.keys(twin.hands).forEach((id) => twin.hands[id].forEach((c) => { if (!mem[c.handId]) { fake(c); swaps[0] += 1; } }));
    twin.deck.forEach(fake);
    const ev = (r) => r.events.filter((e) => e.type !== 'turn')[0];
    const a = ev(SE.botPlay(s));
    const b = ev(SE.botPlay(twin));
    assert.equal(a.type, b.type, 'seed ' + seed);
    if (a.type !== 'draw') assert.equal(a.slot, b.slot, 'seed ' + seed);
    checked += 1;
  }
  assert.ok(checked >= 10, 'only ' + checked + ' positions checked');
});

test('screw: the computer player scores clearly better than the default move', () => {
  let bot = 0;
  let dumb = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const s = playScrew(seed, ['b'], ['a', 'b']);
    bot += s.totals.b;
    dumb += s.totals.a;
  }
  assert.ok(bot < dumb * 0.7, 'bot ' + bot + ' vs default ' + dumb);
});

// ============ Seven ============

function playSeven(seed, bots, ids) {
  let s = VE.createGame(ids, { seed, idSeed: seed + 1, bots }).state;
  for (let n = 0; n < 20000 && s.phase !== 'gameOver'; n++) {
    if (s.phase === 'roundOver') { s = VE.act(s, ids[0], { type: 'next_round' }).state; continue; }
    const cur = s.playerIds[s.current];
    const r = bots.includes(cur) ? VE.botPlay(s) : VE.autoPlay(s);
    assert.ok(r.state, r.error);
    s = r.state;
  }
  assert.equal(s.phase, 'gameOver');
  return s;
}

test('seven: computer players finish whole games', () => {
  for (let seed = 1; seed <= 20; seed++) playSeven(seed, ['a', 'b', 'c'], ['a', 'b', 'c']);
});

test('seven: the computer player wins more than the default move', () => {
  let wins = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = playSeven(seed, ['b'], ['a', 'b']);
    if (s.totals.b > s.totals.a) wins += 1;
  }
  assert.ok(wins >= 33, 'won ' + wins + ' of 60');
});

// ============ Bank ============

function sumCash(s) { return s.playerIds.reduce((n, id) => n + s.players[id].cash, 0); }

function playBank(seed, bots, ids, maxSteps) {
  let s = BE.createGame(ids, { seed, bots }).state;
  for (let n = 0; n < (maxSteps || 6000) && s.phase === 'turn'; n++) {
    let r;
    if (s.trade) r = bots.includes(s.trade.to) ? BE.botTrade(s) : BE.expireTrade(s);
    else if (s.stage === 'auction') r = BE.botBidFor(s) ? BE.botBid(s) : BE.closeAuction(s);
    else if (BE.botWaiting(s)) r = BE.botAct(s);
    else r = BE.autoPlay(s);
    assert.ok(r.state, r.error);
    s = r.state;
    s.playerIds.forEach((id) => assert.ok(s.players[id].cash >= 0, 'negative cash'));
    const houses = Object.values(s.props).reduce((n, p) => n + (p.houses === 5 ? 0 : p.houses), 0);
    const hotels = Object.values(s.props).filter((p) => p.houses === 5).length;
    assert.equal(houses + s.bankHouses, BCONF.BANK_HOUSES);
    assert.equal(hotels + s.bankHotels, BCONF.BANK_HOTELS);
  }
  return s;
}

test('bank: computer players buy, trade for their sets, build and bankrupt each other; every game ends', () => {
  let ended = 0;
  let built = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = playBank(seed, ['a', 'b', 'c'], ['a', 'b', 'c'], 8000);
    if (s.phase === 'gameOver') ended += 1;
    built += Object.values(s.props).filter((p) => p.houses > 0).length;
  }
  assert.equal(ended, 12, 'only ' + ended + ' of 12 games ended');
  assert.ok(built > 0);
});

test('bank: the computer player beats a player who never buys', () => {
  let wins = 0;
  for (let seed = 1; seed <= 16; seed++) {
    let s = playBank(seed, ['b'], ['a', 'b'], 6000);
    if (s.phase === 'turn') s = BE.endGameEarly(s).state;
    if (s.winnerIds.includes('b')) wins += 1;
  }
  assert.ok(wins >= 14, 'won ' + wins + ' of 16');
});

test('bank: a computer player in debt sells and mortgages before going bankrupt', () => {
  let s = BE.createGame(['a', 'bot'], { seed: 4, bots: ['bot'] }).state;
  // the bot owns a whole group with houses and little cash; a debt of 300 to a
  const g = BB.groupSquares(2);
  g.forEach((i) => { s.props[i].owner = 'bot'; s.props[i].houses = 1; });
  s.bankHouses -= g.length;
  s.props[5].owner = 'bot';
  s.players.bot.cash = 10;
  s.debts = [{ debtor: 'bot', amount: 300, creditor: 'a', reason: 'rent' }];
  s.resume = 'postRoll';
  s.stage = 'debt';
  const r = BE.botAct(s);
  assert.ok(r.state, r.error);
  const t = r.state;
  assert.equal(t.players.bot.bankrupt, false);
  assert.equal(t.debts.length, 0);
  assert.equal(t.players.a.cash, BCONF.START_CASH + 300);
  assert.ok(r.events.some((e) => e.type === 'sell_building' || e.type === 'mortgage'));
});

test('bank: a computer player accepts a good trade and refuses a bad one', () => {
  const base = () => {
    const s = BE.createGame(['a', 'bot'], { seed: 2, bots: ['bot'] }).state;
    s.props[1].owner = 'bot'; // a cheap square
    return s;
  };
  let s = base();
  s.trade = { id: 1, from: 'a', to: 'bot', give: { props: [], cash: 400, jailCards: 0 }, get: { props: [1], cash: 0, jailCards: 0 } };
  let r = BE.botTrade(s);
  assert.equal(r.events[0].type, 'trade_done');
  s = base();
  s.trade = { id: 1, from: 'a', to: 'bot', give: { props: [], cash: 5, jailCards: 0 }, get: { props: [1], cash: 0, jailCards: 0 } };
  r = BE.botTrade(s);
  assert.equal(r.events[0].type, 'trade_rejected');
});

// ============ through the rooms: one person alone with the computer ============

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


test('screw, seven and bank: one person plays against computer players through the rooms', () => {
  ['screw', 'seven', 'bank'].forEach((game) => {
    const h = harness();
    const host = h.conn().say({ type: 'create_room', name: 'أحمد', game });
    host.say({ type: 'add_bot' }).say({ type: 'add_bot' });
    host.say({ type: 'start_game' });
    const st = () => host.last('game_state');
    assert.ok(st(), game + ' started');
    if (game === 'screw') host.say({ type: 'ready' });
    const before = host.inbox.length;
    // let the clocks run for a while: the computer players (and the clock for the person) keep the game going
    for (let i = 0; i < 40; i++) h.clock.advance(5000);
    assert.ok(host.inbox.length > before + 10, game + ': the game moves on by itself');
    assert.ok(host.all('event').some((m) => m.event.playerId && m.event.playerId !== host.last('joined').you), game + ': computer players act');
  });
});

test('nobody but computer players connected: the clocks stop until someone is back', () => {
  ['screw', 'seven', 'bank'].forEach((game) => {
    const h = harness();
    const host = h.conn().say({ type: 'create_room', name: 'أحمد', game });
    host.say({ type: 'add_bot' });
    host.say({ type: 'start_game' });
    const secret = host.last('joined').playerId;
    host.drop();
    assert.equal(h.clock.pending(), 1, game + ': only the empty-room clean-up timer is left');
    const back = h.conn().say({ type: 'join_room', code: host.last('joined').code, playerId: secret });
    assert.ok(back.last('game_state').timer, game + ': the clock runs again');
  });
});
