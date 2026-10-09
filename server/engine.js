// Pure game engine: state + action in, new state (or an Arabic error) out.
// No network, no timers. Timers live in the caller, which uses
// forceStartPlay() / autoPlay() when a countdown expires.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config'), require('./deck'));
  } else {
    root.ScrewEngine = factory(root.ScrewConfig, root.ScrewDeck);
  }
})(this, function (CONFIG, Deck) {
  const ERR = {
    badAction: 'حركة غير صالحة.',
    unknownPlayer: 'أنت لست لاعباً في هذه اللعبة.',
    notYourTurn: 'ليس دورك الآن.',
    wrongPhase: 'هذه الحركة غير متاحة الآن.',
    badSlot: 'اختر كرتاً صالحاً من كروتك.',
    badTarget: 'اختر لاعباً وكرتاً صالحين.',
    deckEmpty: 'لا توجد كروت للسحب.',
    screwEarly: 'لا يمكن إعلان سكرو قبل اللفة الرابعة.',
    screwTaken: 'تم إعلان سكرو بالفعل.',
    locked: 'كروت صاحب السكرو مقفلة ولا يمكن تبديلها.',
    badMode: 'اختر طريقة صالحة لاستخدام الخاصية.',
  };

  // ---------- helpers ----------

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  // Seeded PRNG (mulberry32). Its state lives in s.rng so the engine stays pure.
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

  // handId: random, stable while a card stays in a hand. It is drawn from its own PRNG stream
  // (s.idRng, seeded independently of the shuffle stream) so an id can never reveal the card,
  // its position in the deck, or the state of the shuffle generator.
  function newHandId(s) {
    const rand = randOf(s, 'idRng');
    const used = {};
    s.playerIds.forEach(function (id) {
      s.hands[id].forEach(function (c) { used[c.handId] = true; });
    });
    let id;
    do {
      id = 'h' + Math.floor(rand() * 4294967296).toString(36);
    } while (used[id]);
    return id;
  }

  // A card entering a hand always gets a fresh id; nobody can follow a card they once saw.
  function intoHand(s, card) {
    card.handId = newHandId(s);
    return card;
  }

  // A card leaving a hand loses its id (floor cards are public and carry no hand identity).
  function toFloor(s, card) {
    delete card.handId;
    s.discard.push(card);
  }

  function validSlot(hand, slot) {
    return Number.isInteger(slot) && slot >= 0 && slot < hand.length;
  }

  function currentId(s) {
    return s.playerIds[s.current];
  }

  function lapOf(s) {
    return Math.floor(s.turnCount / s.playerIds.length) + 1;
  }

  // Make sure the draw pile has a card; recycle the floor pile (except its top) if needed.
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

  // ---------- setup ----------

  function dealRound(s) {
    const n = s.playerIds.length;
    s.deck = Deck.shuffle(Deck.buildDeck(), randOf(s));
    s.discard = [];
    s.hands = {};
    s.ready = {};
    s.playerIds.forEach(function (id) {
      s.hands[id] = [];
      s.ready[id] = false;
    });
    for (let i = 0; i < CONFIG.CARDS_PER_PLAYER; i++) {
      s.playerIds.forEach(function (id) {
        s.hands[id].push(intoHand(s, s.deck.pop()));
      });
    }
    s.discard.push(s.deck.pop()); // first floor card: its ability never fires
    s.phase = 'peek';
    s.current = s.firstIndex = (s.round - 1) % n;
    s.stage = 'start';
    s.drawn = null;
    s.ability = null;
    s.turnCount = 0;
    s.screwCaller = null;
    s.result = null;
  }

  // Seeds come from the OS CSPRNG when available; the two streams are drawn independently.
  function randomSeed() {
    const c = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (c && c.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(Math.random() * 4294967296);
  }

  function createGame(playerIds, opts) {
    opts = opts || {};
    if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length) {
      return { error: ERR.badAction };
    }
    if (playerIds.length < CONFIG.MIN_PLAYERS || playerIds.length > CONFIG.MAX_PLAYERS) {
      return { error: 'عدد اللاعبين يجب أن يكون بين ' + CONFIG.MIN_PLAYERS + ' و ' + CONFIG.MAX_PLAYERS + '.' };
    }
    const s = {
      rng: opts.seed === undefined ? randomSeed() : opts.seed >>> 0,
      idRng: opts.idSeed === undefined ? randomSeed() : opts.idSeed >>> 0,
      playerIds: playerIds.slice(),
      round: 1,
      totals: {},
      history: [],
    };
    playerIds.forEach(function (id) {
      s.totals[id] = 0;
    });
    dealRound(s);
    return { state: s };
  }

  // ---------- turn flow ----------

  function startPlay(ctx) {
    const s = ctx.s;
    s.phase = 'turn';
    s.stage = 'start';
    s.current = s.firstIndex;
    ctx.events.push({ type: 'turn', playerId: currentId(s) });
  }

  function endTurn(ctx) {
    const s = ctx.s;
    s.turnCount += 1;
    s.drawn = null;
    s.ability = null;
    const next = (s.current + 1) % s.playerIds.length;
    if (s.screwCaller !== null && s.playerIds[next] === s.screwCaller) {
      finishRound(ctx);
      return;
    }
    s.current = next;
    s.stage = 'start';
    ctx.events.push({ type: 'turn', playerId: currentId(s) });
  }

  function sumOf(hand) {
    return hand.reduce(function (t, c) {
      return t + c.value;
    }, 0);
  }

  // Pure scoring. hands: {id: [cards]}.
  function scoreRound(hands, screwCaller, isLastRound) {
    const ids = Object.keys(hands);
    const sums = {};
    ids.forEach(function (id) {
      sums[id] = sumOf(hands[id]);
    });
    const min = Math.min.apply(null, ids.map(function (id) { return sums[id]; }));
    const minIds = ids.filter(function (id) { return sums[id] === min; });
    const scores = {};
    ids.forEach(function (id) {
      let pts = minIds.indexOf(id) >= 0 ? 0 : sums[id];
      if (id === screwCaller && minIds.indexOf(id) < 0) pts *= CONFIG.FAILED_SCREW_MULTIPLIER;
      if (isLastRound) pts *= CONFIG.LAST_ROUND_MULTIPLIER;
      scores[id] = pts;
    });
    return { sums: sums, scores: scores, minIds: minIds };
  }

  function finishRound(ctx) {
    const s = ctx.s;
    const isLast = s.round >= CONFIG.ROUNDS;
    const r = scoreRound(s.hands, s.screwCaller, isLast);
    s.playerIds.forEach(function (id) {
      s.totals[id] += r.scores[id];
    });
    s.result = {
      round: s.round,
      hands: clone(s.hands),
      sums: r.sums,
      scores: r.scores,
      minIds: r.minIds,
      screwCaller: s.screwCaller,
      totals: clone(s.totals),
      multiplied: isLast,
    };
    s.history.push({ round: s.round, scores: r.scores });
    s.stage = 'start';
    s.drawn = null;
    s.ability = null;
    if (isLast) {
      const best = Math.min.apply(null, s.playerIds.map(function (id) { return s.totals[id]; }));
      s.winnerIds = s.playerIds.filter(function (id) { return s.totals[id] === best; });
      s.phase = 'gameOver';
      ctx.events.push({ type: 'game_over', totals: clone(s.totals), winnerIds: s.winnerIds });
    } else {
      s.phase = 'roundOver';
    }
    ctx.events.push({ type: 'round_end', result: s.result });
  }

  // ---------- guards ----------

  function needTurn(ctx, pid, stage) {
    const s = ctx.s;
    if (s.phase !== 'turn') return ERR.wrongPhase;
    if (currentId(s) !== pid) return ERR.notYourTurn;
    if (s.stage !== stage) return ERR.wrongPhase;
    return null;
  }

  // ---------- handlers: each returns an Arabic error string, or undefined on success ----------

  const H = {};

  H.ready = function (ctx, pid) {
    const s = ctx.s;
    if (s.phase !== 'peek') return ERR.wrongPhase;
    s.ready[pid] = true;
    ctx.events.push({ type: 'ready', playerId: pid });
    if (s.playerIds.every(function (id) { return s.ready[id]; })) startPlay(ctx);
  };

  H.draw = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(ctx, pid, 'start');
    if (err) return err;
    if (!ensureDeck(ctx)) return ERR.deckEmpty;
    s.drawn = s.deck.pop();
    s.stage = 'drawn';
    ctx.events.push({ type: 'draw', playerId: pid });
    ctx.privates.push({
      playerId: pid,
      reason: 'draw',
      seconds: null,
      reveals: [{ ownerId: null, slot: null, card: clone(s.drawn) }],
    });
  };

  H.swap_drawn = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(ctx, pid, 'drawn');
    if (err) return err;
    const hand = s.hands[pid];
    if (!validSlot(hand, a.slot)) return ERR.badSlot;
    const old = hand[a.slot];
    const oldHandId = old.handId;
    hand[a.slot] = intoHand(s, s.drawn);
    toFloor(s, old);
    ctx.events.push({
      type: 'swap_drawn', playerId: pid, slot: a.slot, discarded: clone(old),
      handId: oldHandId, newHandId: hand[a.slot].handId,
    });
    endTurn(ctx);
  };

  H.discard_drawn = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(ctx, pid, 'drawn');
    if (err) return err;
    const card = s.drawn;
    s.discard.push(card);
    s.drawn = null;
    ctx.events.push({ type: 'discard_drawn', playerId: pid, card: clone(card) });
    const ability = Deck.abilityOf(card);
    if (ability) {
      s.stage = 'ability';
      s.ability = ability;
    } else {
      endTurn(ctx);
    }
  };

  H.take_discard = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(ctx, pid, 'start');
    if (err) return err;
    const hand = s.hands[pid];
    if (!validSlot(hand, a.slot) || s.discard.length === 0) return ERR.badSlot;
    const taken = s.discard.pop();
    const old = hand[a.slot];
    const oldHandId = old.handId;
    hand[a.slot] = intoHand(s, taken);
    toFloor(s, old);
    ctx.events.push({
      type: 'take_discard', playerId: pid, slot: a.slot,
      taken: clone(taken), discarded: clone(old),
      handId: oldHandId, newHandId: hand[a.slot].handId,
    });
    endTurn(ctx);
  };

  H.match = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(ctx, pid, 'start');
    if (err) return err;
    const hand = s.hands[pid];
    if (!validSlot(hand, a.slot) || s.discard.length === 0) return ERR.badSlot;
    const card = hand[a.slot];
    const top = s.discard[s.discard.length - 1];
    if (Deck.kindOf(card) === Deck.kindOf(top)) {
      const handId = card.handId;
      hand.splice(a.slot, 1);
      toFloor(s, card);
      ctx.events.push({
        type: 'match', playerId: pid, slot: a.slot, card: clone(card), success: true, handId: handId,
      });
    } else {
      ctx.events.push({
        type: 'match', playerId: pid, slot: a.slot, card: clone(card), success: false, handId: card.handId,
      });
      for (let i = 0; i < CONFIG.WRONG_MATCH_PENALTY_CARDS; i++) {
        if (!ensureDeck(ctx)) break;
        const pen = intoHand(s, s.deck.pop()); // face down, the player does not see it
        hand.push(pen);
        ctx.events.push({ type: 'penalty', playerId: pid, newHandId: pen.handId });
      }
    }
    endTurn(ctx);
  };

  H.skip_ability = function (ctx, pid) {
    const err = needTurn(ctx, pid, 'ability');
    if (err) return err;
    ctx.events.push({ type: 'skip_ability', playerId: pid });
    endTurn(ctx);
  };

  function revealPrivate(ctx, pid, list, seconds, ability) {
    ctx.privates.push({
      playerId: pid,
      reason: ability,
      seconds: seconds,
      reveals: list.map(function (x) {
        const card = ctx.s.hands[x.ownerId][x.slot];
        return { ownerId: x.ownerId, slot: x.slot, handId: card.handId, card: clone(card) };
      }),
    });
    // Everyone sees WHICH cards were looked at, never their value.
    ctx.events.push({
      type: 'look', playerId: pid, ability: ability,
      targets: list.map(function (x) {
        return { ownerId: x.ownerId, slot: x.slot, handId: ctx.s.hands[x.ownerId][x.slot].handId };
      }),
    });
  }

  H.use_ability = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(ctx, pid, 'ability');
    if (err) return err;
    const mine = s.hands[pid];
    const others = s.playerIds.filter(function (id) { return id !== pid; });

    function otherTarget() {
      if (!others.includes(a.targetPlayerId)) return null;
      return validSlot(s.hands[a.targetPlayerId], a.targetSlot) ? a.targetPlayerId : null;
    }

    switch (s.ability) {
      case 'peek_own': {
        if (!validSlot(mine, a.slot)) return ERR.badSlot;
        revealPrivate(ctx, pid, [{ ownerId: pid, slot: a.slot }], CONFIG.PEEK_SECONDS, 'peek_own');
        break;
      }
      case 'peek_other': {
        const t = otherTarget();
        if (!t) return ERR.badTarget;
        revealPrivate(ctx, pid, [{ ownerId: t, slot: a.targetSlot }], CONFIG.PEEK_SECONDS, 'peek_other');
        break;
      }
      case 'swap': {
        const t = otherTarget();
        if (!t || !validSlot(mine, a.slot)) return ERR.badTarget;
        if (t === s.screwCaller) return ERR.locked;
        const tmp = mine[a.slot];
        mine[a.slot] = s.hands[t][a.targetSlot];
        s.hands[t][a.targetSlot] = tmp;
        ctx.events.push({
          type: 'swap', playerId: pid, slot: a.slot, targetPlayerId: t, targetSlot: a.targetSlot,
          handId: mine[a.slot].handId, targetHandId: s.hands[t][a.targetSlot].handId, // ids keep following the cards
        });
        break;
      }
      case 'peek_all': {
        if (a.mode === 'self') {
          const need = Math.min(CONFIG.PEEK_ALL_SELF_COUNT, mine.length);
          const slots = a.slots;
          if (!Array.isArray(slots) || slots.length !== need || new Set(slots).size !== need) return ERR.badSlot;
          if (!slots.every(function (x) { return validSlot(mine, x); })) return ERR.badSlot;
          revealPrivate(
            ctx, pid,
            slots.map(function (x) { return { ownerId: pid, slot: x }; }),
            CONFIG.PEEK_SECONDS, 'peek_all'
          );
        } else if (a.mode === 'others') {
          const needIds = others.filter(function (id) { return s.hands[id].length > 0; });
          const picks = a.picks;
          if (!Array.isArray(picks) || picks.length !== needIds.length) return ERR.badTarget;
          const seen = new Set();
          for (const p of picks) {
            if (!p || !needIds.includes(p.playerId) || seen.has(p.playerId)) return ERR.badTarget;
            if (!validSlot(s.hands[p.playerId], p.slot)) return ERR.badTarget;
            seen.add(p.playerId);
          }
          revealPrivate(
            ctx, pid,
            picks.map(function (p) { return { ownerId: p.playerId, slot: p.slot }; }),
            CONFIG.PEEK_SECONDS, 'peek_all'
          );
        } else {
          return ERR.badMode;
        }
        break;
      }
      case 'throw': {
        if (!validSlot(mine, a.slot)) return ERR.badSlot;
        const card = mine.splice(a.slot, 1)[0];
        const handId = card.handId;
        toFloor(s, card); // thrown card's ability does not fire
        ctx.events.push({ type: 'throw', playerId: pid, slot: a.slot, card: clone(card), handId: handId });
        break;
      }
      default:
        return ERR.wrongPhase;
    }
    endTurn(ctx);
  };

  H.call_screw = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(ctx, pid, 'start');
    if (err) return err;
    if (s.screwCaller !== null) return ERR.screwTaken;
    if (lapOf(s) < CONFIG.SCREW_ALLOWED_FROM_LAP) return ERR.screwEarly;
    s.screwCaller = pid;
    ctx.events.push({ type: 'screw', playerId: pid });
    endTurn(ctx);
  };

  H.next_round = function (ctx) {
    const s = ctx.s;
    if (s.phase !== 'roundOver') return ERR.wrongPhase;
    s.round += 1;
    dealRound(s);
    ctx.events.push({ type: 'round_start', round: s.round });
  };

  // ---------- public API ----------

  function run(state, fn) {
    const ctx = { s: clone(state), events: [], privates: [] };
    const err = fn(ctx);
    if (err) return { error: err };
    return { state: ctx.s, events: ctx.events, privates: ctx.privates };
  }

  function act(state, playerId, action) {
    if (!action || typeof action.type !== 'string' || !Object.prototype.hasOwnProperty.call(H, action.type)) {
      return { error: ERR.badAction };
    }
    if (state.playerIds.indexOf(playerId) < 0) return { error: ERR.unknownPlayer };
    return run(state, function (ctx) {
      return H[action.type](ctx, playerId, action);
    });
  }

  // Timer expired during the opening peek: everyone is ready.
  function forceStartPlay(state) {
    if (state.phase !== 'peek') return { error: ERR.wrongPhase };
    return run(state, function (ctx) {
      ctx.s.playerIds.forEach(function (id) { ctx.s.ready[id] = true; });
      startPlay(ctx);
    });
  }

  // Turn timer expired (or the player is disconnected): draw, then throw without ability.
  function autoPlay(state) {
    if (state.phase !== 'turn') return { error: ERR.wrongPhase };
    return run(state, function (ctx) {
      const s = ctx.s;
      const pid = currentId(s);
      if (s.stage === 'start') {
        const err = H.draw(ctx, pid);
        if (err) {
          // Nothing to draw anywhere: the turn is simply skipped.
          endTurn(ctx);
          return null;
        }
      }
      if (s.stage === 'drawn') H.discard_drawn(ctx, pid);
      if (s.phase === 'turn' && s.stage === 'ability') H.skip_ability(ctx, pid);
      return null;
    });
  }

  // Personalised view: hidden cards are {hidden:true}; nothing the player may not see is included.
  function viewFor(state, playerId) {
    const s = state;
    const revealAll = s.phase === 'roundOver' || s.phase === 'gameOver';
    const peeking = s.phase === 'peek' && !s.ready[playerId];
    const players = s.playerIds.map(function (id) {
      const hand = s.hands[id].map(function (card, slot) {
        const show = revealAll || (peeking && id === playerId && slot < CONFIG.INITIAL_PEEK_COUNT);
        return show ? clone(card) : { hidden: true, handId: card.handId };
      });
      return { id: id, hand: hand, cardCount: hand.length, ready: !!s.ready[id] };
    });
    const mineDrawn = s.drawn && currentId(s) === playerId;
    return {
      you: playerId,
      phase: s.phase,
      round: s.round,
      rounds: CONFIG.ROUNDS,
      lap: lapOf(s),
      players: players,
      currentPlayerId: s.phase === 'turn' ? currentId(s) : null,
      stage: s.phase === 'turn' ? s.stage : null,
      deckCount: s.deck.length,
      discardTop: s.discard.length ? clone(s.discard[s.discard.length - 1]) : null,
      discardCount: s.discard.length,
      drawn: mineDrawn ? clone(s.drawn) : null,
      hasDrawn: !!s.drawn,
      ability: s.ability, // which ability is pending (public: everyone sees "X is using Y")
      screwCaller: s.screwCaller,
      screwAllowed: s.phase === 'turn' && s.stage === 'start' && s.screwCaller === null &&
        lapOf(s) >= CONFIG.SCREW_ALLOWED_FROM_LAP,
      totals: clone(s.totals),
      history: clone(s.history),
      result: revealAll ? clone(s.result) : null,
      winnerIds: s.phase === 'gameOver' ? s.winnerIds.slice() : null,
    };
  }

  // Start a fresh 5-round game for the same players.
  function newGame(state, opts) {
    return createGame(state.playerIds, opts);
  }

  return {
    ERR, createGame, newGame, act, autoPlay, forceStartPlay, viewFor, scoreRound, lapOf,
  };
});
