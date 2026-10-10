// "Seven & Seven" engine: pure functions. state + action in, new state (or an Arabic error) out.
// No network, no timers: the server calls autoPlay() when a countdown ends.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config'), require('./deck'));
  } else {
    root.SevenEngine = factory(root.SevenConfig, root.SevenDeck);
  }
})(this, function (CONFIG, Deck) {
  const ERR = {
    badAction: 'حركة غير صالحة.',
    unknownPlayer: 'أنت لست لاعباً في هذه اللعبة.',
    notYourTurn: 'ليس دورك الآن.',
    wrongStage: 'هذه الحركة غير متاحة الآن.',
    gameOver: 'انتهت اللعبة.',
    noCard: 'هذا الكرت ليس في يدك.',
    cannotPlay: 'هذا الكرت لا يطابق كرت الطاولة.',
    wild4Rule: 'لا تستطيع رمي +4 لون وعندك كرت من لون الطاولة.',
    needColor: 'اختر لوناً للكرت.',
    havePlayable: 'عندك كرت صالح للرمي، لا يجوز السحب.',
    badRounds: 'عدد الجولات غير صالح.',
  };

  // ---------- helpers ----------

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  // Seeded PRNG (mulberry32); its state lives in the game state so the engine stays pure.
  function randOf(s, key) {
    key = key || 'rng';
    return function () {
      s[key] = (s[key] + 0x6d2b79f5) >>> 0;
      let t = s[key];
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    const c = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (c && c.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(Math.random() * 4294967296);
  }

  // Ids of cards in hands: random, from a stream separate from the shuffle, fresh each time a card
  // enters a hand. They carry no information about the card (same idea as the screw game).
  function newId(s) {
    const rand = randOf(s, 'idRng');
    const used = {};
    s.playerIds.forEach(function (id) { s.hands[id].forEach(function (c) { used[c.id] = true; }); });
    if (s.drawn) used[s.drawn.id] = true;
    let id;
    do {
      id = 'u' + Math.floor(rand() * 4294967296).toString(36);
    } while (used[id]);
    return id;
  }

  function withId(s, card) {
    card.id = newId(s);
    return card;
  }

  function curId(s) { return s.playerIds[s.current]; }

  function nextIndex(s, steps) {
    const n = s.playerIds.length;
    return (((s.current + s.direction * steps) % n) + n) % n;
  }

  function topCard(s) { return s.discard[s.discard.length - 1]; }

  // ---------- the matching rules ----------

  // Same colour as the table, or same number, or same action. A wild always matches.
  function matches(s, card) {
    if (Deck.isWild(card)) return true;
    if (card.color === s.color) return true;
    const top = topCard(s);
    if (card.type === 'num') return top.type === 'num' && top.rank === card.rank;
    return top.type === card.type;
  }

  // +4 needs a hand with no card of the table colour (the server checks this, so no challenge is needed).
  function playable(s, hand, card) {
    if (card.type === 'wild4') {
      return !hand.some(function (c) { return c.id !== card.id && c.color === s.color; });
    }
    return matches(s, card);
  }

  function playableIds(s, pid) {
    const hand = s.hands[pid];
    return hand.filter(function (c) { return playable(s, hand, c); }).map(function (c) { return c.id; });
  }

  // ---------- deck handling ----------

  function ensureDeck(ctx) {
    const s = ctx.s;
    if (s.deck.length === 0 && s.discard.length > 1) {
      const top = s.discard.pop();
      s.deck = Deck.shuffle(s.discard, randOf(s));
      s.discard = [top];
      ctx.events.push({ type: 'reshuffle' });
    }
    return s.deck.length > 0;
  }

  // Draw up to n cards into a player's hand (fewer if the game ran out of cards).
  function giveCards(ctx, pid, n) {
    const s = ctx.s;
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!ensureDeck(ctx)) break;
      s.hands[pid].push(withId(s, s.deck.pop()));
      got += 1;
    }
    if (got) ctx.events.push({ type: 'penalty', playerId: pid, count: got });
  }

  // ---------- turn flow ----------

  function advance(ctx, steps) {
    const s = ctx.s;
    s.current = nextIndex(s, steps);
    s.turnCount += 1;
    s.stage = 'play';
    s.drawn = null;
    ctx.events.push({ type: 'turn', playerId: curId(s) });
  }

  function mostCommonColor(hand, fallback) {
    const count = {};
    hand.forEach(function (c) { if (c.color) count[c.color] = (count[c.color] || 0) + 1; });
    let best = fallback || CONFIG.COLORS[0];
    let bestN = 0;
    CONFIG.COLORS.forEach(function (col) {
      if ((count[col] || 0) > bestN) { best = col; bestN = count[col]; }
    });
    return best;
  }

  function scoreHands(hands, winnerId) {
    let points = 0;
    Object.keys(hands).forEach(function (id) {
      if (id === winnerId) return;
      hands[id].forEach(function (c) { points += c.value; });
    });
    return points;
  }

  function finishRound(ctx, winnerId) {
    const s = ctx.s;
    const points = scoreHands(s.hands, winnerId);
    s.totals[winnerId] += points;
    const isLast = s.round >= s.rounds;
    s.result = {
      round: s.round,
      winnerId: winnerId,
      points: points,
      hands: clone(s.hands),
      totals: clone(s.totals),
    };
    s.history.push({ round: s.round, winnerId: winnerId, points: points });
    s.stage = null;
    s.drawn = null;
    ctx.events.push({ type: 'round_end', result: s.result });
    if (isLast) {
      const best = Math.max.apply(null, s.playerIds.map(function (id) { return s.totals[id]; }));
      s.winnerIds = s.playerIds.filter(function (id) { return s.totals[id] === best; });
      s.phase = 'gameOver';
      ctx.events.push({ type: 'game_over', totals: clone(s.totals), winnerIds: s.winnerIds });
    } else {
      s.phase = 'roundOver';
    }
  }

  // The card has already left its owner's hand. Put it on the table and apply its effect.
  function playCard(ctx, pid, card, color) {
    const s = ctx.s;
    const handId = card.id;
    delete card.id;
    s.discard.push(card);
    s.color = card.color || color;
    ctx.events.push({ type: 'play', playerId: pid, card: clone(card), handId: handId, color: s.color });
    const n = s.playerIds.length;
    let steps = 1;
    switch (card.type) {
      case 'skip':
        ctx.events.push({ type: 'skip', playerId: s.playerIds[nextIndex(s, 1)] });
        steps = 2;
        break;
      case 'reverse':
        s.direction = -s.direction;
        ctx.events.push({ type: 'reverse', direction: s.direction });
        steps = n === 2 ? 2 : 1; // with two players a reverse is a skip
        break;
      case 'draw2': {
        const victim = s.playerIds[nextIndex(s, 1)];
        giveCards(ctx, victim, CONFIG.DRAW2_COUNT);
        steps = 2;
        break;
      }
      case 'wild4': {
        const victim = s.playerIds[nextIndex(s, 1)];
        giveCards(ctx, victim, CONFIG.DRAW4_COUNT);
        steps = 2;
        break;
      }
      default:
        break;
    }
    if (s.hands[pid].length === 0) {
      finishRound(ctx, pid);
      return;
    }
    advance(ctx, steps);
  }

  // ---------- setup ----------

  function dealRound(ctx) {
    const s = ctx.s;
    const n = s.playerIds.length;
    s.deck = Deck.shuffle(Deck.buildDeck(), randOf(s));
    s.discard = [];
    s.hands = {};
    s.playerIds.forEach(function (id) { s.hands[id] = []; });
    s.drawn = null;
    for (let i = 0; i < CONFIG.HAND_SIZE; i++) {
      s.playerIds.forEach(function (id) { s.hands[id].push(withId(s, s.deck.pop())); });
    }
    // the first table card is never a +4: those go to the bottom of the deck
    let first = s.deck.pop();
    while (first.type === 'wild4') {
      s.deck.unshift(first);
      first = s.deck.pop();
    }
    s.discard.push(first);
    s.color = first.color || null;
    s.direction = 1;
    s.phase = 'turn';
    s.stage = 'play';
    s.current = (s.round - 1) % n;
    s.turnCount = 0;
    s.result = null;
    ctx.events.push({ type: 'round_start', round: s.round, firstPlayerId: curId(s), card: clone(first) });
    // the first card's effect lands on the first player
    switch (first.type) {
      case 'skip':
        s.current = nextIndex(s, 1);
        break;
      case 'reverse':
        s.direction = -1;
        if (n === 2) s.current = nextIndex(s, 1); // two players: a reverse is a skip
        break;
      case 'draw2':
        giveCards(ctx, curId(s), CONFIG.DRAW2_COUNT);
        s.current = nextIndex(s, 1);
        break;
      case 'wild':
        s.stage = 'color'; // the first player picks the colour
        break;
      default:
        break;
    }
  }

  function createGame(playerIds, opts) {
    opts = opts || {};
    if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length) return { error: ERR.badAction };
    if (playerIds.length < CONFIG.MIN_PLAYERS || playerIds.length > CONFIG.MAX_PLAYERS) {
      return { error: 'عدد اللاعبين يجب أن يكون بين ' + CONFIG.MIN_PLAYERS + ' و ' + CONFIG.MAX_PLAYERS + '.' };
    }
    const rounds = opts.rounds === undefined ? CONFIG.DEFAULT_ROUNDS : opts.rounds;
    if (CONFIG.ROUNDS_OPTIONS.indexOf(rounds) < 0) return { error: ERR.badRounds };
    const s = {
      rng: opts.seed === undefined ? randomSeed() : opts.seed >>> 0,
      idRng: opts.idSeed === undefined ? randomSeed() : opts.idSeed >>> 0,
      playerIds: playerIds.slice(),
      rounds: rounds,
      round: 1,
      totals: {},
      history: [],
      winnerIds: null,
      turnCount: 0,
    };
    playerIds.forEach(function (id) { s.totals[id] = 0; });
    const ctx = { s: s, events: [] };
    dealRound(ctx);
    return { state: s, events: ctx.events, privates: [] };
  }

  // ---------- handlers: each returns an Arabic error string, or undefined on success ----------

  const H = {};

  function needTurn(s, pid, stage) {
    if (s.phase !== 'turn') return ERR.wrongStage;
    if (curId(s) !== pid) return ERR.notYourTurn;
    if (s.stage !== stage) return ERR.wrongStage;
    return null;
  }

  function validColor(c) {
    return CONFIG.COLORS.indexOf(c) >= 0;
  }

  H.choose_color = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'color');
    if (err) return err;
    if (!validColor(a.color)) return ERR.needColor;
    s.color = a.color;
    s.stage = 'play';
    ctx.events.push({ type: 'color', playerId: pid, color: a.color });
  };

  H.play = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'play');
    if (err) return err;
    const hand = s.hands[pid];
    const i = hand.findIndex(function (c) { return c.id === a.card; });
    if (i < 0) return ERR.noCard;
    const card = hand[i];
    if (!playable(s, hand, card)) return card.type === 'wild4' ? ERR.wild4Rule : ERR.cannotPlay;
    if (Deck.isWild(card) && !validColor(a.color)) return ERR.needColor;
    hand.splice(i, 1);
    playCard(ctx, pid, card, a.color);
  };

  H.draw = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'play');
    if (err) return err;
    const hand = s.hands[pid];
    if (hand.some(function (c) { return playable(s, hand, c); })) return ERR.havePlayable;
    if (!ensureDeck(ctx)) { // nothing left anywhere: the turn just passes
      ctx.events.push({ type: 'draw_empty', playerId: pid });
      advance(ctx, 1);
      return;
    }
    const card = withId(s, s.deck.pop());
    ctx.events.push({ type: 'draw', playerId: pid });
    if (playable(s, hand, card)) {
      s.drawn = card; // the player chooses: play it or keep it
      s.stage = 'drawn';
    } else {
      hand.push(card);
      advance(ctx, 1);
    }
  };

  H.keep = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'drawn');
    if (err) return err;
    s.hands[pid].push(s.drawn);
    s.drawn = null;
    ctx.events.push({ type: 'keep', playerId: pid });
    advance(ctx, 1);
  };

  H.play_drawn = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'drawn');
    if (err) return err;
    const card = s.drawn;
    if (Deck.isWild(card) && !validColor(a.color)) return ERR.needColor;
    s.drawn = null;
    playCard(ctx, pid, card, a.color);
  };

  H.next_round = function (ctx) {
    const s = ctx.s;
    if (s.phase !== 'roundOver') return ERR.wrongStage;
    s.round += 1;
    dealRound(ctx);
  };

  // ---------- public API ----------

  function run(state, fn) {
    const ctx = { s: clone(state), events: [] };
    const err = fn(ctx);
    if (err) return { error: err };
    return { state: ctx.s, events: ctx.events, privates: [] };
  }

  function act(state, playerId, action) {
    if (!action || typeof action.type !== 'string' || !Object.prototype.hasOwnProperty.call(H, action.type)) {
      return { error: ERR.badAction };
    }
    if (state.playerIds.indexOf(playerId) < 0) return { error: ERR.unknownPlayer };
    if (state.phase === 'gameOver') return { error: ERR.gameOver };
    return run(state, function (ctx) { return H[action.type](ctx, playerId, action); });
  }

  // The turn clock ran out (or the player is disconnected): take the safe default move.
  function autoPlay(state) {
    if (state.phase !== 'turn') return { error: ERR.wrongStage };
    return run(state, function (ctx) {
      const s = ctx.s;
      const pid = curId(s);
      const hand = s.hands[pid];
      if (s.stage === 'color') return H.choose_color(ctx, pid, { color: mostCommonColor(hand, 'red') });
      if (s.stage === 'drawn') {
        const color = Deck.isWild(s.drawn) ? mostCommonColor(hand, s.color) : undefined;
        return H.play_drawn(ctx, pid, { color: color });
      }
      // first choice: a coloured card, then a wild, and +4 last
      const ok = hand.filter(function (c) { return playable(s, hand, c); });
      const rank = function (c) { return c.type === 'wild4' ? 2 : c.type === 'wild' ? 1 : 0; };
      ok.sort(function (a, b) { return rank(a) - rank(b); });
      if (ok.length) {
        const card = ok[0];
        const rest = hand.filter(function (c) { return c.id !== card.id; });
        return H.play(ctx, pid, { card: card.id, color: Deck.isWild(card) ? mostCommonColor(rest, s.color) : undefined });
      }
      const err = H.draw(ctx, pid);
      if (err) return err;
      if (s.stage === 'drawn') {
        const color = Deck.isWild(s.drawn) ? mostCommonColor(s.hands[pid], s.color) : undefined;
        return H.play_drawn(ctx, pid, { color: color });
      }
      return null;
    });
  }

  // Everyone sees the table; only I see my own hand. Opponents are just counts.
  function viewFor(state, playerId) {
    const s = state;
    const over = s.phase === 'roundOver' || s.phase === 'gameOver';
    const myTurn = s.phase === 'turn' && curId(s) === playerId;
    return {
      you: playerId,
      phase: s.phase,
      stage: s.phase === 'turn' ? s.stage : null,
      round: s.round,
      rounds: s.rounds,
      currentPlayerId: s.phase === 'turn' ? curId(s) : null,
      direction: s.direction,
      color: s.color,
      top: s.discard.length ? clone(topCard(s)) : null,
      deckCount: s.deck.length,
      discardCount: s.discard.length,
      playerIds: s.playerIds.slice(),
      players: s.playerIds.map(function (id) { return { id: id, count: s.hands[id].length }; }),
      hand: clone(s.hands[playerId]),
      playable: myTurn && s.stage === 'play' ? playableIds(s, playerId) : [],
      drawn: myTurn && s.drawn ? clone(s.drawn) : null,
      hasDrawn: !!s.drawn,
      totals: clone(s.totals),
      history: clone(s.history),
      result: over ? clone(s.result) : null,
      winnerIds: s.phase === 'gameOver' ? s.winnerIds.slice() : null,
    };
  }

  return { ERR, createGame, act, autoPlay, viewFor, playableIds, scoreHands };
});
