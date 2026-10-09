// Bank game engine: pure functions. state + action in, new state (or an Arabic error) out.
// No network, no timers: the server calls autoPlay / closeAuction / expireTrade when a countdown ends.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config'), require('./board'), require('./cards'));
  } else {
    root.BankEngine = factory(root.BankConfig, root.BankBoard, root.BankCards);
  }
})(this, function (CONFIG, B, CARDS) {
  const SQ = B.SQUARES;

  const ERR = {
    badAction: 'حركة غير صالحة.',
    unknownPlayer: 'أنت لست لاعباً في هذه اللعبة.',
    notYourTurn: 'ليس دورك الآن.',
    wrongStage: 'هذه الحركة غير متاحة الآن.',
    gameOver: 'انتهت اللعبة.',
    bankrupt: 'أنت مفلس وتشاهد اللعبة فقط.',
    noCash: 'رصيدك لا يكفي.',
    notInJail: 'أنت لست في السجن.',
    noJailCard: 'ليست عندك بطاقة خروج من السجن.',
    badSquare: 'اختر عقاراً صالحاً.',
    notOwner: 'هذا العقار ليس لك.',
    needSet: 'يجب أن تملك المجموعة كاملة للبناء.',
    setMortgaged: 'لا يمكن البناء وفي المجموعة عقار مرهون.',
    uneven: 'يجب البناء والبيع بالتساوي على عقارات المجموعة.',
    maxBuilt: 'وصل هذا العقار إلى فندق.',
    noHouses: 'لا توجد بيوت متبقية في البنك.',
    noHotels: 'لا توجد فنادق متبقية في البنك.',
    noBuildings: 'لا يوجد بناء على هذا العقار.',
    housesForHotel: 'لا توجد في البنك بيوت كافية لاستبدال الفندق.',
    hasBuildings: 'بع البيوت في هذه المجموعة أولاً.',
    mortgaged: 'العقار مرهون.',
    notMortgaged: 'العقار غير مرهون.',
    lowBid: 'المزايدة يجب أن تكون أعلى بـ ' + CONFIG.AUCTION_MIN_INCREMENT + ' على الأقل.',
    tradeBusy: 'يوجد عرض تبادل قائم. انتظر حتى ينتهي.',
    noTrade: 'لا يوجد عرض تبادل.',
    badTrade: 'عرض التبادل غير صالح.',
    emptyTrade: 'عرض التبادل فارغ.',
    notDebtor: 'ليس عليك دين الآن.',
  };

  // ---------- helpers ----------

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // Seeded PRNG (mulberry32); state lives in s.rng so the engine stays pure.
  function randOf(s) {
    return function () {
      s.rng = (s.rng + 0x6d2b79f5) >>> 0;
      let t = s.rng;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function randomSeed() {
    const c = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (c && c.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(Math.random() * 4294967296);
  }

  // Test hook: tests may preset s.forcedDice (e.g. [3, 4]); clients can never write to the state.
  function die(s) {
    if (s.forcedDice && s.forcedDice.length) return s.forcedDice.shift();
    return 1 + Math.floor(randOf(s)() * 6);
  }

  function curId(s) { return s.playerIds[s.current]; }
  function active(s) { return s.playerIds.filter(function (id) { return !s.players[id].bankrupt; }); }
  function isInt(n) { return Number.isInteger(n); }

  function ownedBy(s, pid) {
    return Object.keys(s.props).map(Number).filter(function (i) { return s.props[i].owner === pid; });
  }

  function ownsGroup(s, pid, group) {
    return B.groupSquares(group).every(function (i) { return s.props[i].owner === pid; });
  }

  function groupHasBuildings(s, group) {
    return B.groupSquares(group).some(function (i) { return s.props[i].houses > 0; });
  }

  function hasBuildingsAt(s, i) {
    return SQ[i].type === 'property' && groupHasBuildings(s, SQ[i].group);
  }

  function countOwned(s, pid, type) {
    return B.indicesOf(type).filter(function (i) { return s.props[i].owner === pid; }).length;
  }

  // ---------- money ----------

  function credit(ctx, pid, amount) {
    ctx.s.players[pid].cash += amount;
  }

  // Take money from a player. If they cannot pay now, the debt is queued and the game waits for them.
  function charge(ctx, debtor, amount, creditor, reason) {
    const s = ctx.s;
    if (amount <= 0) return;
    const p = s.players[debtor];
    if (creditor && s.players[creditor].bankrupt) creditor = null;
    if (p.cash >= amount) {
      p.cash -= amount;
      if (creditor) s.players[creditor].cash += amount;
      ctx.events.push({ type: 'pay', playerId: debtor, to: creditor, amount: amount, reason: reason });
    } else {
      s.debts.push({ debtor: debtor, amount: amount, creditor: creditor, reason: reason });
      ctx.events.push({ type: 'debt', playerId: debtor, to: creditor, amount: amount, reason: reason });
    }
  }

  // ---------- rent ----------

  function rentFor(s, i, diceTotal, opts) {
    opts = opts || {};
    const sq = SQ[i];
    const pr = s.props[i];
    if (!pr || pr.owner === null || pr.mortgaged) return 0;
    if (sq.type === 'property') {
      if (pr.houses > 0) return sq.rents[pr.houses];
      return sq.rents[0] * (ownsGroup(s, pr.owner, sq.group) ? 2 : 1);
    }
    if (sq.type === 'station') {
      const n = countOwned(s, pr.owner, 'station');
      return CONFIG.STATION_RENTS[n - 1] * (opts.double ? 2 : 1);
    }
    if (sq.type === 'utility') {
      const n = countOwned(s, pr.owner, 'utility');
      return diceTotal * (opts.times || CONFIG.UTILITY_MULTIPLIERS[n - 1]);
    }
    return 0;
  }

  // ---------- movement ----------

  function moveForward(ctx, pid, steps, collectGo) {
    const p = ctx.s.players[pid];
    const from = p.pos;
    const to = (from + steps) % B.SIZE;
    const passedGo = from + steps >= B.SIZE;
    p.pos = to;
    ctx.events.push({ type: 'move', playerId: pid, from: from, to: to, passedGo: passedGo && collectGo });
    if (passedGo && collectGo) {
      credit(ctx, pid, CONFIG.GO_SALARY);
      ctx.events.push({ type: 'salary', playerId: pid, amount: CONFIG.GO_SALARY });
    }
  }

  function moveTo(ctx, pid, target, collectGo) {
    const p = ctx.s.players[pid];
    moveForward(ctx, pid, (target - p.pos + B.SIZE) % B.SIZE, collectGo);
  }

  function sendToJail(ctx, pid) {
    const s = ctx.s;
    const p = s.players[pid];
    p.pos = B.JAIL_INDEX;
    p.inJail = true;
    p.jailTurns = 0;
    if (curId(s) === pid) { s.doublesInRow = 0; s.rolledDoubles = false; }
    ctx.events.push({ type: 'jail', playerId: pid });
  }

  // Resolve the square the player now stands on.
  function land(ctx, pid, opts) {
    const s = ctx.s;
    const i = s.players[pid].pos;
    const sq = SQ[i];
    if (B.isOwnable(sq)) {
      const pr = s.props[i];
      if (pr.owner === null) {
        s.stage = 'buy';
        s.pending = { square: i };
        ctx.events.push({ type: 'offer_buy', playerId: pid, square: i, price: sq.price });
      } else if (pr.owner !== pid && !pr.mortgaged && !s.players[pr.owner].bankrupt) {
        let dice = s.diceTotal;
        if (sq.type === 'utility' && opts && opts.times) {
          const a = die(s); const b = die(s);
          dice = a + b;
          ctx.events.push({ type: 'roll', playerId: pid, dice: [a, b], reason: 'utility' });
        }
        const rent = rentFor(s, i, dice, opts);
        ctx.events.push({ type: 'rent', playerId: pid, to: pr.owner, square: i, amount: rent });
        charge(ctx, pid, rent, pr.owner, 'rent');
      }
    } else if (sq.type === 'tax') {
      charge(ctx, pid, sq.amount, null, 'tax');
    } else if (sq.type === 'chance' || sq.type === 'chest') {
      drawCard(ctx, pid, sq.type);
    } else if (sq.type === 'gotojail') {
      sendToJail(ctx, pid);
    }
  }

  // ---------- cards ----------

  function deckOf(cardId) { return cardId.charAt(0) === 'c' ? 'chance' : 'chest'; }

  function buildingCounts(s, pid) {
    let houses = 0;
    let hotels = 0;
    ownedBy(s, pid).forEach(function (i) {
      const h = s.props[i].houses;
      if (h === CONFIG.HOUSES_BEFORE_HOTEL + 1) hotels += 1; else houses += h;
    });
    return { houses: houses, hotels: hotels };
  }

  function drawCard(ctx, pid, deck) {
    const s = ctx.s;
    const id = s.decks[deck].shift();
    const card = CARDS.byId[id];
    s.lastCard = { deck: deck, id: id, playerId: pid };
    ctx.events.push({ type: 'card', playerId: pid, deck: deck, cardId: id, text: card.text });
    if (card.effect === 'jailFree') s.players[pid].jailCards.push(id); // kept by the player, out of the deck
    else s.decks[deck].push(id);
    const others = active(s).filter(function (x) { return x !== pid; });
    switch (card.effect) {
      case 'advance':
        moveTo(ctx, pid, card.to, true);
        land(ctx, pid, {});
        break;
      case 'nearest': {
        const targets = B.indicesOf(card.kind);
        const pos = s.players[pid].pos;
        let best = targets[0];
        let bestDist = Infinity;
        targets.forEach(function (t) {
          const d = (t - pos + B.SIZE) % B.SIZE || B.SIZE;
          if (d < bestDist) { bestDist = d; best = t; }
        });
        moveTo(ctx, pid, best, true);
        land(ctx, pid, { double: card.double, times: card.times });
        break;
      }
      case 'back': {
        const p = s.players[pid];
        const from = p.pos;
        p.pos = (p.pos - card.steps + B.SIZE) % B.SIZE;
        ctx.events.push({ type: 'move', playerId: pid, from: from, to: p.pos, passedGo: false, back: true });
        land(ctx, pid, {});
        break;
      }
      case 'collect': credit(ctx, pid, card.amount); break;
      case 'pay': charge(ctx, pid, card.amount, null, 'card'); break;
      case 'payEach': others.forEach(function (o) { charge(ctx, pid, card.amount, o, 'card'); }); break;
      case 'collectEach': others.forEach(function (o) { charge(ctx, o, card.amount, pid, 'card'); }); break;
      case 'repairs': {
        const c = buildingCounts(s, pid);
        charge(ctx, pid, c.houses * card.house + c.hotels * card.hotel, null, 'card');
        break;
      }
      case 'jail': sendToJail(ctx, pid); break;
      case 'jailFree': break;
    }
  }

  // ---------- turn flow ----------

  function nextPlayer(ctx) {
    const s = ctx.s;
    s.doublesInRow = 0;
    s.rolledDoubles = false;
    s.pending = null;
    let n = s.current;
    for (let k = 0; k < s.playerIds.length; k++) {
      n = (n + 1) % s.playerIds.length;
      if (!s.players[s.playerIds[n]].bankrupt) break;
    }
    s.current = n;
    s.stage = 'roll';
    s.turnCount += 1;
    ctx.events.push({ type: 'turn', playerId: curId(s) });
  }

  // After any action: queued debts take over the game until they are settled.
  function settle(ctx) {
    const s = ctx.s;
    if (s.phase !== 'turn') return;
    if (s.debts.length && s.stage !== 'debt') {
      s.resume = s.stage;
      s.stage = 'debt';
    }
  }

  function checkGameOver(ctx) {
    const s = ctx.s;
    const left = active(s);
    if (left.length <= 1 && s.phase !== 'gameOver') {
      s.phase = 'gameOver';
      s.stage = null;
      s.winnerIds = left.slice();
      s.trade = null;
      s.auction = null;
      ctx.events.push({ type: 'game_over', winnerIds: s.winnerIds, reason: 'bankruptcy' });
    }
  }

  function netWorth(s, pid) {
    const p = s.players[pid];
    let w = p.cash;
    ownedBy(s, pid).forEach(function (i) {
      const sq = SQ[i];
      const pr = s.props[i];
      w += pr.mortgaged ? sq.price - sq.mortgage : sq.price;
      if (pr.houses) w += pr.houses * sq.houseCost;
    });
    return w;
  }

  // ---------- bankruptcy ----------

  function goBankrupt(ctx, pid, creditor) {
    const s = ctx.s;
    const p = s.players[pid];
    if (creditor && s.players[creditor].bankrupt) creditor = null;
    // buildings go back to the bank at the sell price first
    ownedBy(s, pid).forEach(function (i) {
      const pr = s.props[i];
      if (!pr.houses) return;
      if (pr.houses === CONFIG.HOUSES_BEFORE_HOTEL + 1) s.bankHotels += 1; else s.bankHouses += pr.houses;
      p.cash += Math.floor(pr.houses * SQ[i].houseCost * CONFIG.HOUSE_SELL_RATE);
      pr.houses = 0;
    });
    ownedBy(s, pid).forEach(function (i) {
      const pr = s.props[i];
      if (creditor) {
        pr.owner = creditor; // stays mortgaged if it was
      } else {
        pr.owner = null;
        pr.mortgaged = false;
      }
    });
    if (creditor) {
      s.players[creditor].cash += p.cash;
      s.players[creditor].jailCards = s.players[creditor].jailCards.concat(p.jailCards);
    } else {
      p.jailCards.forEach(function (id) { s.decks[deckOf(id)].push(id); });
    }
    p.jailCards = [];
    p.cash = 0;
    p.bankrupt = true;
    p.inJail = false;
    // their remaining debts disappear; debts owed TO them now go to the bank
    s.debts = s.debts.filter(function (d) { return d.debtor !== pid; });
    s.debts.forEach(function (d) { if (d.creditor === pid) d.creditor = null; });
    if (s.trade && (s.trade.from === pid || s.trade.to === pid)) {
      s.trade = null;
      ctx.events.push({ type: 'trade_cancelled', reason: 'bankrupt' });
    }
    ctx.events.push({ type: 'bankrupt', playerId: pid, to: creditor });
    checkGameOver(ctx);
  }

  // ---------- guards ----------

  function needTurn(s, pid, stage) {
    if (curId(s) !== pid) return ERR.notYourTurn;
    if (s.stage !== stage) return ERR.wrongStage;
    return null;
  }

  function validSquare(i) {
    return isInt(i) && i >= 0 && i < B.SIZE && B.isOwnable(SQ[i]);
  }

  // ---------- handlers: each returns an Arabic error string, or undefined ----------

  const H = {};

  H.roll = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'roll');
    if (err) return err;
    const p = s.players[pid];
    const a = die(s);
    const b = die(s);
    const doubles = a === b;
    s.dice = [a, b];
    s.diceTotal = a + b;
    ctx.events.push({ type: 'roll', playerId: pid, dice: [a, b] });
    s.stage = 'postRoll';
    if (p.inJail) {
      s.rolledDoubles = false; // leaving jail by doubles never gives another roll
      if (doubles) {
        p.inJail = false;
        p.jailTurns = 0;
        ctx.events.push({ type: 'jail_out', playerId: pid, how: 'doubles' });
        moveForward(ctx, pid, a + b, true);
        land(ctx, pid, {});
      } else {
        p.jailTurns += 1;
        if (p.jailTurns >= CONFIG.MAX_JAIL_TURNS) {
          p.inJail = false;
          p.jailTurns = 0;
          ctx.events.push({ type: 'jail_out', playerId: pid, how: 'forced' });
          charge(ctx, pid, CONFIG.JAIL_FINE, null, 'jail');
          moveForward(ctx, pid, a + b, true);
          land(ctx, pid, {});
        }
      }
      return;
    }
    s.doublesInRow = doubles ? s.doublesInRow + 1 : 0;
    if (s.doublesInRow >= CONFIG.DOUBLES_TO_JAIL) {
      ctx.events.push({ type: 'speeding', playerId: pid });
      sendToJail(ctx, pid);
      return;
    }
    s.rolledDoubles = doubles;
    moveForward(ctx, pid, a + b, true);
    land(ctx, pid, {});
  };

  H.pay_jail = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'roll');
    if (err) return err;
    const p = s.players[pid];
    if (!p.inJail) return ERR.notInJail;
    if (p.cash < CONFIG.JAIL_FINE) return ERR.noCash;
    p.cash -= CONFIG.JAIL_FINE;
    p.inJail = false;
    p.jailTurns = 0;
    ctx.events.push({ type: 'jail_out', playerId: pid, how: 'paid' });
  };

  H.use_jail_card = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'roll');
    if (err) return err;
    const p = s.players[pid];
    if (!p.inJail) return ERR.notInJail;
    if (!p.jailCards.length) return ERR.noJailCard;
    const id = p.jailCards.shift();
    s.decks[deckOf(id)].push(id); // back to the bottom of its deck
    p.inJail = false;
    p.jailTurns = 0;
    ctx.events.push({ type: 'jail_out', playerId: pid, how: 'card' });
  };

  H.buy = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'buy');
    if (err) return err;
    const i = s.pending.square;
    if (s.players[pid].cash < SQ[i].price) return ERR.noCash;
    s.players[pid].cash -= SQ[i].price;
    s.props[i].owner = pid;
    s.pending = null;
    s.stage = 'postRoll';
    ctx.events.push({ type: 'buy', playerId: pid, square: i, price: SQ[i].price });
  };

  function startAuction(ctx, i) {
    const s = ctx.s;
    s.auction = { square: i, bid: 0, bidder: null, seq: 0 };
    s.pending = null;
    s.stage = 'auction';
    ctx.events.push({ type: 'auction_start', square: i });
  }

  H.decline = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'buy');
    if (err) return err;
    startAuction(ctx, s.pending.square);
  };

  H.bid = function (ctx, pid, a) {
    const s = ctx.s;
    if (s.stage !== 'auction') return ERR.wrongStage;
    const min = s.auction.bid ? s.auction.bid + CONFIG.AUCTION_MIN_INCREMENT : CONFIG.AUCTION_MIN_INCREMENT;
    if (!isInt(a.amount) || a.amount < min) return ERR.lowBid;
    if (a.amount > s.players[pid].cash) return ERR.noCash;
    s.auction.bid = a.amount;
    s.auction.bidder = pid;
    s.auction.seq += 1; // the server restarts the auction clock on every new bid
    ctx.events.push({ type: 'bid', playerId: pid, amount: a.amount, square: s.auction.square });
  };

  H.end_turn = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'postRoll');
    if (err) return err;
    if (s.rolledDoubles && !s.players[pid].inJail) {
      s.rolledDoubles = false;
      s.stage = 'roll';
      ctx.events.push({ type: 'again', playerId: pid });
      return;
    }
    nextPlayer(ctx);
  };

  // ----- property management: any player who is still in, any time except during an auction -----

  function manageGuard(s, i, pid) {
    if (s.stage === 'auction') return ERR.wrongStage;
    if (!validSquare(i)) return ERR.badSquare;
    if (s.props[i].owner !== pid) return ERR.notOwner;
    return null;
  }

  H.build = function (ctx, pid, a) {
    const s = ctx.s;
    const i = a.square;
    const err = manageGuard(s, i, pid);
    if (err) return err;
    const sq = SQ[i];
    const pr = s.props[i];
    if (sq.type !== 'property') return ERR.badSquare;
    if (!ownsGroup(s, pid, sq.group)) return ERR.needSet;
    const group = B.groupSquares(sq.group);
    if (group.some(function (g) { return s.props[g].mortgaged; })) return ERR.setMortgaged;
    if (pr.houses >= CONFIG.HOUSES_BEFORE_HOTEL + 1) return ERR.maxBuilt;
    const minH = Math.min.apply(null, group.map(function (g) { return s.props[g].houses; }));
    if (pr.houses > minH) return ERR.uneven;
    if (s.players[pid].cash < sq.houseCost) return ERR.noCash;
    if (pr.houses === CONFIG.HOUSES_BEFORE_HOTEL) {
      if (s.bankHotels < 1) return ERR.noHotels;
      s.bankHotels -= 1;
      s.bankHouses += CONFIG.HOUSES_BEFORE_HOTEL;
    } else {
      if (s.bankHouses < 1) return ERR.noHouses;
      s.bankHouses -= 1;
    }
    s.players[pid].cash -= sq.houseCost;
    pr.houses += 1;
    ctx.events.push({ type: 'build', playerId: pid, square: i, houses: pr.houses });
  };

  H.sell_building = function (ctx, pid, a) {
    const s = ctx.s;
    const i = a.square;
    const err = manageGuard(s, i, pid);
    if (err) return err;
    const sq = SQ[i];
    const pr = s.props[i];
    if (sq.type !== 'property' || pr.houses === 0) return ERR.noBuildings;
    const group = B.groupSquares(sq.group);
    const maxH = Math.max.apply(null, group.map(function (g) { return s.props[g].houses; }));
    if (pr.houses < maxH) return ERR.uneven;
    if (pr.houses === CONFIG.HOUSES_BEFORE_HOTEL + 1) {
      if (s.bankHouses < CONFIG.HOUSES_BEFORE_HOTEL) return ERR.housesForHotel;
      s.bankHouses -= CONFIG.HOUSES_BEFORE_HOTEL;
      s.bankHotels += 1;
    } else {
      s.bankHouses += 1;
    }
    pr.houses -= 1;
    const got = Math.floor(sq.houseCost * CONFIG.HOUSE_SELL_RATE);
    s.players[pid].cash += got;
    ctx.events.push({ type: 'sell_building', playerId: pid, square: i, houses: pr.houses, amount: got });
  };

  H.mortgage = function (ctx, pid, a) {
    const s = ctx.s;
    const i = a.square;
    const err = manageGuard(s, i, pid);
    if (err) return err;
    const pr = s.props[i];
    if (pr.mortgaged) return ERR.mortgaged;
    if (hasBuildingsAt(s, i)) return ERR.hasBuildings;
    pr.mortgaged = true;
    s.players[pid].cash += SQ[i].mortgage;
    ctx.events.push({ type: 'mortgage', playerId: pid, square: i, amount: SQ[i].mortgage });
  };

  function unmortgageCost(i) {
    return Math.round(SQ[i].mortgage * (1 + CONFIG.UNMORTGAGE_INTEREST));
  }

  H.unmortgage = function (ctx, pid, a) {
    const s = ctx.s;
    const i = a.square;
    const err = manageGuard(s, i, pid);
    if (err) return err;
    const pr = s.props[i];
    if (!pr.mortgaged) return ERR.notMortgaged;
    const cost = unmortgageCost(i);
    if (s.players[pid].cash < cost) return ERR.noCash;
    s.players[pid].cash -= cost;
    pr.mortgaged = false;
    ctx.events.push({ type: 'unmortgage', playerId: pid, square: i, amount: cost });
  };

  // ----- debts -----

  function finishDebt(ctx) {
    const s = ctx.s;
    if (s.phase !== 'turn') return;
    if (s.debts.length) return; // the next debtor is up
    const cur = s.players[curId(s)];
    s.stage = cur.bankrupt ? null : s.resume;
    s.resume = null;
    if (cur.bankrupt) nextPlayer(ctx);
  }

  H.pay_debt = function (ctx, pid) {
    const s = ctx.s;
    if (s.stage !== 'debt' || !s.debts.length || s.debts[0].debtor !== pid) return ERR.notDebtor;
    const d = s.debts[0];
    if (s.players[pid].cash < d.amount) return ERR.noCash;
    s.debts.shift();
    s.players[pid].cash -= d.amount;
    if (d.creditor) s.players[d.creditor].cash += d.amount;
    ctx.events.push({ type: 'pay', playerId: pid, to: d.creditor, amount: d.amount, reason: d.reason });
    finishDebt(ctx);
  };

  H.declare_bankruptcy = function (ctx, pid) {
    const s = ctx.s;
    if (s.stage !== 'debt' || !s.debts.length || s.debts[0].debtor !== pid) return ERR.notDebtor;
    goBankrupt(ctx, pid, s.debts[0].creditor);
    finishDebt(ctx);
  };

  // ----- trades -----

  function cleanSide(side) {
    side = side && typeof side === 'object' ? side : {};
    const props = Array.isArray(side.props) ? side.props : [];
    return {
      props: props.slice(0, B.SIZE),
      cash: side.cash === undefined ? 0 : side.cash,
      jailCards: side.jailCards === undefined ? 0 : side.jailCards,
    };
  }

  function sideError(s, pid, side) {
    if (!isInt(side.cash) || side.cash < 0 || side.cash > s.players[pid].cash) return ERR.badTrade;
    if (!isInt(side.jailCards) || side.jailCards < 0 || side.jailCards > s.players[pid].jailCards.length) return ERR.badTrade;
    if (new Set(side.props).size !== side.props.length) return ERR.badTrade;
    for (const i of side.props) {
      if (!validSquare(i) || s.props[i].owner !== pid) return ERR.badTrade;
      if (hasBuildingsAt(s, i)) return ERR.hasBuildings;
    }
    return null;
  }

  function isEmpty(side) { return !side.props.length && !side.cash && !side.jailCards; }

  H.trade_offer = function (ctx, pid, a) {
    const s = ctx.s;
    if (s.stage === 'auction') return ERR.wrongStage;
    if (s.trade) return ERR.tradeBusy;
    const to = a.to;
    if (!s.players[to] || to === pid || s.players[to].bankrupt) return ERR.badTrade;
    const give = cleanSide(a.give);
    const get = cleanSide(a.get);
    if (isEmpty(give) && isEmpty(get)) return ERR.emptyTrade;
    const e = sideError(s, pid, give) || sideError(s, to, get);
    if (e) return e;
    s.tradeSeq += 1;
    s.trade = { id: s.tradeSeq, from: pid, to: to, give: give, get: get };
    ctx.events.push({ type: 'trade_offer', trade: clone(s.trade) });
  };

  function moveSide(s, from, to, side) {
    side.props.forEach(function (i) { s.props[i].owner = to; }); // mortgaged stays mortgaged
    s.players[from].cash -= side.cash;
    s.players[to].cash += side.cash;
    for (let k = 0; k < side.jailCards; k++) s.players[to].jailCards.push(s.players[from].jailCards.shift());
  }

  H.trade_accept = function (ctx, pid) {
    const s = ctx.s;
    const t = s.trade;
    if (!t || t.to !== pid) return ERR.noTrade;
    if (s.stage === 'auction') return ERR.wrongStage;
    const e = sideError(s, t.from, t.give) || sideError(s, t.to, t.get);
    if (e) { s.trade = null; ctx.events.push({ type: 'trade_cancelled', reason: 'invalid' }); return null; }
    moveSide(s, t.from, t.to, t.give);
    moveSide(s, t.to, t.from, t.get);
    s.trade = null;
    ctx.events.push({ type: 'trade_done', trade: clone(t) });
  };

  H.trade_reject = function (ctx, pid) {
    const s = ctx.s;
    if (!s.trade || s.trade.to !== pid) return ERR.noTrade;
    ctx.events.push({ type: 'trade_rejected', trade: clone(s.trade) });
    s.trade = null;
  };

  H.trade_cancel = function (ctx, pid) {
    const s = ctx.s;
    if (!s.trade || s.trade.from !== pid) return ERR.noTrade;
    ctx.events.push({ type: 'trade_cancelled', reason: 'withdrawn', trade: clone(s.trade) });
    s.trade = null;
  };

  // ---------- public API ----------

  function createGame(playerIds, opts) {
    opts = opts || {};
    if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length) return { error: ERR.badAction };
    if (playerIds.length < CONFIG.MIN_PLAYERS || playerIds.length > CONFIG.MAX_PLAYERS) {
      return { error: 'عدد اللاعبين يجب أن يكون بين ' + CONFIG.MIN_PLAYERS + ' و ' + CONFIG.MAX_PLAYERS + '.' };
    }
    const s = {
      rng: opts.seed === undefined ? randomSeed() : opts.seed >>> 0,
      playerIds: playerIds.slice(),
      players: {},
      props: {},
      current: 0,
      phase: 'turn',
      stage: 'roll',
      dice: null,
      diceTotal: 0,
      doublesInRow: 0,
      rolledDoubles: false,
      pending: null,
      auction: null,
      debts: [],
      resume: null,
      trade: null,
      tradeSeq: 0,
      lastCard: null,
      turnCount: 0,
      winnerIds: null,
      bankHouses: CONFIG.BANK_HOUSES,
      bankHotels: CONFIG.BANK_HOTELS,
      decks: {},
    };
    playerIds.forEach(function (id) {
      s.players[id] = { id: id, cash: CONFIG.START_CASH, pos: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false };
    });
    SQ.forEach(function (sq) {
      if (B.isOwnable(sq)) s.props[sq.index] = { owner: null, houses: 0, mortgaged: false };
    });
    const rand = randOf(s);
    s.decks.chance = shuffle(CARDS.CHANCE.map(function (c) { return c.id; }), rand);
    s.decks.chest = shuffle(CARDS.CHEST.map(function (c) { return c.id; }), rand);
    return { state: s };
  }

  function run(state, fn) {
    const ctx = { s: clone(state), events: [] };
    const err = fn(ctx);
    if (err) return { error: err };
    settle(ctx);
    return { state: ctx.s, events: ctx.events };
  }

  function act(state, playerId, action) {
    if (!action || typeof action.type !== 'string' || !Object.prototype.hasOwnProperty.call(H, action.type)) {
      return { error: ERR.badAction };
    }
    if (!state.players[playerId]) return { error: ERR.unknownPlayer };
    if (state.phase !== 'turn') return { error: ERR.gameOver };
    if (state.players[playerId].bankrupt) return { error: ERR.bankrupt };
    return run(state, function (ctx) { return H[action.type](ctx, playerId, action); });
  }

  // Timer for the current decision ran out (or the player is disconnected): take the safe default.
  function autoPlay(state) {
    if (state.phase !== 'turn') return { error: ERR.gameOver };
    return run(state, function (ctx) {
      const s = ctx.s;
      const pid = curId(s);
      switch (s.stage) {
        case 'roll': return H.roll(ctx, pid);
        case 'buy': return H.decline(ctx, pid);
        case 'auction': return closeAuctionIn(ctx);
        case 'debt': {
          const d = s.debts[0];
          if (s.players[d.debtor].cash >= d.amount) return H.pay_debt(ctx, d.debtor);
          return H.declare_bankruptcy(ctx, d.debtor);
        }
        case 'postRoll': return H.end_turn(ctx, pid);
        default: return ERR.wrongStage;
      }
    });
  }

  function closeAuctionIn(ctx) {
    const s = ctx.s;
    if (s.stage !== 'auction') return ERR.wrongStage;
    const au = s.auction;
    if (au.bidder && s.players[au.bidder].cash >= au.bid && !s.players[au.bidder].bankrupt) {
      s.players[au.bidder].cash -= au.bid;
      s.props[au.square].owner = au.bidder;
      ctx.events.push({ type: 'auction_won', playerId: au.bidder, square: au.square, amount: au.bid });
    } else {
      ctx.events.push({ type: 'auction_none', square: au.square });
    }
    s.auction = null;
    s.stage = 'postRoll';
    return null;
  }

  // The auction clock ran out.
  function closeAuction(state) {
    if (state.phase !== 'turn') return { error: ERR.gameOver };
    return run(state, closeAuctionIn);
  }

  // A trade offer was left unanswered.
  function expireTrade(state) {
    if (!state.trade) return { error: ERR.noTrade };
    return run(state, function (ctx) {
      ctx.events.push({ type: 'trade_expired', trade: clone(ctx.s.trade) });
      ctx.s.trade = null;
    });
  }

  // The host ends the game early: the richest (cash + property + buildings) wins.
  function endGameEarly(state) {
    if (state.phase !== 'turn') return { error: ERR.gameOver };
    return run(state, function (ctx) {
      const s = ctx.s;
      const left = active(s);
      const worth = {};
      left.forEach(function (id) { worth[id] = netWorth(s, id); });
      const best = Math.max.apply(null, left.map(function (id) { return worth[id]; }));
      s.phase = 'gameOver';
      s.stage = null;
      s.auction = null;
      s.trade = null;
      s.winnerIds = left.filter(function (id) { return worth[id] === best; });
      ctx.events.push({ type: 'game_over', winnerIds: s.winnerIds, reason: 'early', worth: worth });
    });
  }

  // Everything on the table is public in this game, except the order of the card decks and the RNG.
  function viewFor(state, playerId) {
    const v = clone(state);
    delete v.rng;
    v.decks = { chance: state.decks.chance.length, chest: state.decks.chest.length };
    v.you = playerId;
    v.currentPlayerId = state.phase === 'turn' ? curId(state) : null;
    v.worth = {};
    state.playerIds.forEach(function (id) { v.worth[id] = netWorth(state, id); });
    v.lastCard = state.lastCard ? { deck: state.lastCard.deck, id: state.lastCard.id, playerId: state.lastCard.playerId, text: CARDS.byId[state.lastCard.id].text } : null;
    return v;
  }

  return {
    ERR, createGame, act, autoPlay, closeAuction, expireTrade, endGameEarly, viewFor,
    rentFor, netWorth, unmortgageCost,
  };
});
