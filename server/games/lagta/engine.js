// "Lagta!" engine: pure functions. state + action in, new state (or an Arabic error) out.
// Everyone holds one card (their last win); a card lies in the middle. Spot the one symbol your card shares
// with it and you take it. The server is the referee: the first right claim to arrive wins.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'));
  else root.LagtaEngine = factory(root.LagtaConfig);
})(this, function (CONFIG) {
  const ERR = {
    badAction: 'حركة غير صالحة.',
    unknownPlayer: 'أنت لست لاعباً في هذه اللعبة.',
    wrongStage: 'انتظر الكرت التالي.',
    gameOver: 'انتهت اللعبة.',
    frozen: 'أنت مجمّد لحظة بسبب لقطة غلط.',
    badOptions: 'خيارات اللعبة غير صالحة.',
  };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function randOf(s) {
    return function () {
      s.rng = (s.rng + 0x6d2b79f5) >>> 0;
      let t = s.rng;
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
  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // The finite projective plane of prime order n: n*n + n + 1 cards (lines) of n + 1 symbols (points).
  function buildDeck(n) {
    const cards = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const c = [];
        for (let k = 0; k < n; k++) c.push(k * n + ((i * k + j) % n));
        c.push(n * n + i);
        cards.push(c);
      }
    }
    for (let j = 0; j < n; j++) {
      const c = [];
      for (let k = 0; k < n; k++) c.push(j * n + k);
      c.push(n * n + n);
      cards.push(c);
    }
    const inf = [];
    for (let i = 0; i <= n; i++) inf.push(n * n + i);
    cards.push(inf);
    return cards;
  }
  const DECK = buildDeck(CONFIG.ORDER);

  function common(a, b) {
    const x = DECK[a];
    const y = DECK[b];
    for (let i = 0; i < x.length; i++) if (y.indexOf(x[i]) >= 0) return x[i];
    return -1;
  }

  function readOptions(o) {
    o = o || {};
    const out = {
      size: o.size === undefined ? CONFIG.DEFAULT_SIZE : o.size,
      level: o.level === undefined ? CONFIG.DEFAULT_LEVEL : o.level,
    };
    if (CONFIG.SIZES.indexOf(out.size) < 0 || CONFIG.LEVELS.indexOf(out.level) < 0) return null;
    return out;
  }

  // a new card in the middle; each computer player decides now how long it will take to see the match
  function reveal(ctx) {
    const s = ctx.s;
    if (!s.pile.length) { finish(ctx); return; }
    s.center = s.pile.shift();
    s.seq += 1;
    s.phase = 'play';
    s.frozen = {};
    const r = randOf(s);
    const range = CONFIG.BOT_DELAYS[s.options.level];
    s.botDelay = {};
    s.bots.forEach(function (id) { s.botDelay[id] = Math.round((range[0] + r() * (range[1] - range[0])) * 10) / 10; });
    ctx.events.push({ type: 'card', seq: s.seq, center: s.center, left: s.pile.length });
  }

  function finish(ctx) {
    const s = ctx.s;
    s.phase = 'gameOver';
    s.center = null;
    const best = Math.max.apply(null, s.playerIds.map(function (id) { return s.counts[id]; }));
    s.winnerIds = s.playerIds.filter(function (id) { return s.counts[id] === best; });
    ctx.events.push({ type: 'game_over', winnerIds: s.winnerIds.slice(), counts: clone(s.counts) });
  }

  function createGame(playerIds, opts) {
    opts = opts || {};
    if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length) return { error: ERR.badAction };
    if (playerIds.length < CONFIG.MIN_PLAYERS || playerIds.length > CONFIG.MAX_PLAYERS) {
      return { error: 'عدد اللاعبين يجب أن يكون بين ' + CONFIG.MIN_PLAYERS + ' و ' + CONFIG.MAX_PLAYERS + '.' };
    }
    const options = readOptions(opts);
    if (!options) return { error: ERR.badOptions };
    const s = {
      rng: opts.seed === undefined ? randomSeed() : opts.seed >>> 0,
      playerIds: playerIds.slice(),
      bots: Array.isArray(opts.bots) ? opts.bots.filter(function (id) { return playerIds.indexOf(id) >= 0; }) : [],
      options: options,
      tops: {},
      counts: {},
      pile: [],
      center: null,
      seq: 0,
      phase: 'countdown',
      frozen: {},
      botDelay: {},
      last: null,
      winnerIds: null,
      misses: {},
    };
    const order = shuffle(DECK.map(function (c, i) { return i; }), randOf(s));
    playerIds.forEach(function (id) { s.tops[id] = order.shift(); s.counts[id] = 0; s.misses[id] = 0; });
    s.pile = order.slice(0, options.size);
    return { state: s, events: [{ type: 'countdown', seconds: CONFIG.COUNTDOWN_SECONDS, size: options.size }], privates: [] };
  }

  const H = {};

  // claim a symbol: right if it is on both your card and the middle one
  H.claim = function (ctx, pid, a) {
    const s = ctx.s;
    if (s.phase !== 'play') return ERR.wrongStage;
    const at = typeof a.at === 'number' ? a.at : 0;
    if (s.frozen[pid] && s.frozen[pid] > at) return ERR.frozen;
    if (typeof a.symbol !== 'number') return ERR.badAction;
    const answer = common(s.tops[pid], s.center);
    if (a.symbol !== answer) {
      s.frozen[pid] = at + CONFIG.FREEZE_MS;
      s.misses[pid] += 1;
      ctx.events.push({ type: 'miss', playerId: pid, symbol: a.symbol, ms: CONFIG.FREEZE_MS });
      return;
    }
    const won = s.center;
    s.counts[pid] += 1;
    s.tops[pid] = won;
    s.last = { playerId: pid, symbol: answer, card: won, seq: s.seq };
    s.center = null;
    s.phase = 'between'; // the next card (or the end) comes on the server's short timer
    ctx.events.push({ type: 'claim', playerId: pid, symbol: answer, card: won, count: s.counts[pid], left: s.pile.length });
  };

  function run(state, fn) {
    const ctx = { s: clone(state), events: [] };
    const err = fn(ctx);
    if (err) return { error: err };
    return { state: ctx.s, events: ctx.events, privates: [] };
  }

  function act(state, playerId, action) {
    if (!action || typeof action.type !== 'string' || !Object.prototype.hasOwnProperty.call(H, action.type)) return { error: ERR.badAction };
    if (state.playerIds.indexOf(playerId) < 0) return { error: ERR.unknownPlayer };
    if (state.phase === 'gameOver') return { error: ERR.gameOver };
    return run(state, function (ctx) { return H[action.type](ctx, playerId, action); });
  }

  // the countdown ended, or the won card has flown: show the next card (or end the game)
  function next(state) {
    if (state.phase !== 'countdown' && state.phase !== 'between') return { error: ERR.wrongStage };
    return run(state, function (ctx) { reveal(ctx); });
  }

  // a computer player sees it
  function botClaim(state, pid) {
    if (state.phase !== 'play') return { error: ERR.wrongStage };
    return run(state, function (ctx) { return H.claim(ctx, pid, { symbol: common(ctx.s.tops[pid], ctx.s.center), at: Infinity }); });
  }

  // nobody found it for a long time: the card is put aside
  function skip(state) {
    if (state.phase !== 'play') return { error: ERR.wrongStage };
    return run(state, function (ctx) {
      const s = ctx.s;
      ctx.events.push({ type: 'skip', card: s.center, left: s.pile.length });
      s.last = null;
      s.center = null;
      s.phase = 'between';
    });
  }

  function endGameEarly(state) {
    if (state.phase === 'gameOver') return { error: ERR.wrongStage };
    return run(state, function (ctx) { finish(ctx); ctx.s.endedEarly = true; });
  }

  // nothing here is secret but the order of the pile
  function viewFor(state, playerId) {
    const s = state;
    return {
      you: playerId,
      phase: s.phase,
      options: clone(s.options),
      playerIds: s.playerIds.slice(),
      players: s.playerIds.map(function (id) { return { id: id, count: s.counts[id], top: s.tops[id], bot: s.bots.indexOf(id) >= 0, misses: s.misses[id] }; }),
      center: s.center,
      mine: s.tops[playerId],
      seq: s.seq,
      left: s.pile.length,
      total: s.options.size,
      last: s.last ? clone(s.last) : null,
      counts: clone(s.counts),
      winnerIds: s.winnerIds ? s.winnerIds.slice() : null,
      endedEarly: !!s.endedEarly,
    };
  }

  return { ERR, DECK, buildDeck, common, createGame, act, next, botClaim, skip, endGameEarly, viewFor, readOptions };
});
