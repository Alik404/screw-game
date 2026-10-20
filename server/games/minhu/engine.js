// "Minhu?" engine: pure functions. Two players each hold a secret character; on your turn ask one
// yes/no question (the server answers from the character table), flip down the faces it rules out,
// or guess. A right guess wins the round, a wrong one loses it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'));
  else root.MinhuEngine = factory(root.MinhuConfig);
})(this, function (CONFIG) {
  const ERR = {
    badAction: 'حركة غير صالحة.',
    unknownPlayer: 'أنت لست لاعباً في هذه اللعبة.',
    notYourTurn: 'ليس دورك الآن.',
    wrongStage: 'هذه الحركة غير متاحة الآن.',
    gameOver: 'انتهت المباراة.',
    badQuestion: 'سؤال غير معروف.',
    asked: 'سألت هذا السؤال من قبل.',
    badChar: 'شخصية غير معروفة.',
    badOptions: 'خيارات اللعبة غير صالحة.',
  };
  const N = CONFIG.CHARACTERS.length; // every set has the same number of characters (a test checks it)

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

  // the board chosen in the lobby: its characters and its questions
  function deck(set) { return CONFIG.SETS[set || CONFIG.DEFAULT_SET]; }
  function question(id, set) { return deck(set).questions.find(function (q) { return q.id === id; }); }
  function matches(ci, q, set) { return q.is.indexOf(deck(set).characters[ci][q.attr]) >= 0; }
  function curId(s) { return s.playerIds[s.current]; }
  function other(s, pid) { return s.playerIds[0] === pid ? s.playerIds[1] : s.playerIds[0]; }

  // the characters still possible for pid, from the answers to pid's own questions
  function candidates(s, pid) {
    const mine = s.asked.filter(function (a) { return a.by === pid; });
    const out = [];
    for (let i = 0; i < N; i++) {
      if (mine.every(function (a) { return matches(i, question(a.q, s.options.set), s.options.set) === a.yes; })) out.push(i);
    }
    return out;
  }

  function readOptions(o) {
    o = o || {};
    const out = {
      target: o.target === undefined ? CONFIG.DEFAULT_TARGET : o.target,
      level: o.level === undefined ? CONFIG.DEFAULT_LEVEL : o.level,
      set: o.set === undefined ? CONFIG.DEFAULT_SET : o.set,
    };
    if (CONFIG.SET_OPTIONS.indexOf(out.set) < 0) return null;
    if (CONFIG.TARGETS.indexOf(out.target) < 0 || CONFIG.LEVELS.indexOf(out.level) < 0) return null;
    return out;
  }

  function startRound(ctx) {
    const s = ctx.s;
    const r = randOf(s);
    // two different characters, and nobody gets the same one twice in a match
    s.used = s.used || {};
    s.secrets = {};
    s.playerIds.forEach(function (id) {
      s.used[id] = s.used[id] || [];
      const taken = Object.keys(s.secrets).map(function (k) { return s.secrets[k]; });
      let pool = [];
      for (let i = 0; i < N; i++) if (s.used[id].indexOf(i) < 0 && taken.indexOf(i) < 0) pool.push(i);
      if (!pool.length) { s.used[id] = []; for (let i = 0; i < N; i++) if (taken.indexOf(i) < 0) pool.push(i); }
      const pick = pool[Math.floor(r() * pool.length)];
      s.secrets[id] = pick;
      s.used[id].push(pick);
    });
    s.down = {};
    s.playerIds.forEach(function (id) { s.down[id] = []; });
    s.asked = [];
    s.phase = 'turn';
    s.stage = 'ask';
    s.current = s.round === 1 ? Math.floor(r() * 2) : 1 - s.starter;
    s.starter = s.current;
    s.turnCount = 0;
    s.result = null;
    ctx.events.push({ type: 'round_start', round: s.round, firstPlayerId: curId(s) });
  }

  function createGame(playerIds, opts) {
    opts = opts || {};
    if (!Array.isArray(playerIds) || playerIds.length !== 2 || playerIds[0] === playerIds[1]) return { error: 'هذه اللعبة للاعبَين اثنين فقط.' };
    const options = readOptions(opts);
    if (!options) return { error: ERR.badOptions };
    const s = {
      rng: opts.seed === undefined ? randomSeed() : opts.seed >>> 0,
      playerIds: playerIds.slice(),
      bots: Array.isArray(opts.bots) ? opts.bots.filter(function (id) { return playerIds.indexOf(id) >= 0; }) : [],
      options: options,
      scores: {},
      round: 1,
      starter: 0,
      history: [],
      winnerIds: null,
      endedEarly: false,
      seq: 0,
    };
    playerIds.forEach(function (id) { s.scores[id] = 0; });
    const ctx = { s: s, events: [] };
    startRound(ctx);
    return { state: s, events: ctx.events, privates: [] };
  }

  function endRound(ctx, winnerId, reason, guess) {
    const s = ctx.s;
    s.scores[winnerId] += 1;
    s.result = { round: s.round, winnerId: winnerId, reason: reason, guess: guess, by: curId(s), secrets: clone(s.secrets), questions: s.asked.length, scores: clone(s.scores) };
    s.history.push({ round: s.round, winnerId: winnerId, reason: reason });
    s.stage = null;
    ctx.events.push({ type: 'round_end', result: clone(s.result) });
    if (s.scores[winnerId] >= s.options.target) {
      s.phase = 'matchOver';
      s.winnerIds = [winnerId];
      ctx.events.push({ type: 'match_over', winnerIds: [winnerId], scores: clone(s.scores), early: false });
    } else {
      s.phase = 'roundOver';
    }
  }

  function nextTurn(ctx) {
    const s = ctx.s;
    s.current = 1 - s.current;
    s.stage = 'ask';
    s.turnCount += 1;
    ctx.events.push({ type: 'turn', playerId: curId(s) });
  }

  // ---------- handlers ----------

  const H = {};
  function needTurn(s, pid, stage) {
    if (s.phase !== 'turn') return ERR.wrongStage;
    if (curId(s) !== pid) return ERR.notYourTurn;
    if (stage && s.stage !== stage) return ERR.wrongStage;
    return null;
  }

  H.ask = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'ask');
    if (err) return err;
    const q = question(a.q, s.options.set);
    if (!q) return ERR.badQuestion;
    if (s.asked.some(function (x) { return x.by === pid && x.q === q.id; })) return ERR.asked;
    const yes = matches(s.secrets[other(s, pid)], q, s.options.set);
    s.asked.push({ by: pid, q: q.id, yes: yes });
    s.stage = 'flip';
    s.seq += 1;
    ctx.events.push({ type: 'ask', playerId: pid, q: q.id, yes: yes });
  };

  // my own board: which faces are turned down (any time during the round)
  H.flip = function (ctx, pid, a) {
    const s = ctx.s;
    if (s.phase !== 'turn') return ERR.wrongStage;
    if (!Array.isArray(a.ids) || a.ids.length > N) return ERR.badAction;
    const ids = [];
    for (let i = 0; i < a.ids.length; i++) {
      const v = a.ids[i];
      if (typeof v !== 'number' || v < 0 || v >= N || v !== Math.floor(v)) return ERR.badChar;
      if (ids.indexOf(v) < 0) ids.push(v);
    }
    s.down[pid] = ids.sort(function (x, y) { return x - y; });
    s.seq += 1;
  };

  H.end_turn = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'flip');
    if (err) return err;
    s.seq += 1;
    nextTurn(ctx);
  };

  H.guess = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(s, pid, 'ask');
    if (err) return err;
    if (typeof a.char !== 'number' || a.char < 0 || a.char >= N) return ERR.badChar;
    const right = s.secrets[other(s, pid)] === a.char;
    s.seq += 1;
    ctx.events.push({ type: 'guess', playerId: pid, char: a.char, right: right });
    endRound(ctx, right ? pid : other(s, pid), right ? 'right' : 'wrong', a.char);
  };

  H.next_round = function (ctx) {
    const s = ctx.s;
    if (s.phase !== 'roundOver') return ERR.wrongStage;
    s.round += 1;
    s.seq += 1;
    startRound(ctx);
  };

  // ---------- public API ----------

  function run(state, fn) {
    const ctx = { s: clone(state), events: [] };
    const err = fn(ctx);
    if (err) return { error: err };
    return { state: ctx.s, events: ctx.events, privates: [] };
  }

  function act(state, playerId, action) {
    if (!action || typeof action.type !== 'string' || !Object.prototype.hasOwnProperty.call(H, action.type) || action.type === 'next_round') return { error: ERR.badAction };
    if (state.playerIds.indexOf(playerId) < 0) return { error: ERR.unknownPlayer };
    if (state.phase === 'matchOver') return { error: ERR.gameOver };
    return run(state, function (ctx) { return H[action.type](ctx, playerId, action); });
  }

  // the question that splits the remaining faces most evenly (smart), or any useful one (easy)
  function pickQuestion(s, pid, cands, smart, r) {
    const useful = deck(s.options.set).questions.filter(function (q) {
      if (s.asked.some(function (a) { return a.by === pid && a.q === q.id; })) return false;
      const yes = cands.filter(function (c) { return matches(c, q, s.options.set); }).length;
      return yes > 0 && yes < cands.length;
    });
    if (!useful.length) return null;
    if (!smart) return useful[Math.floor(r() * useful.length)];
    let best = [];
    let bestScore = Infinity;
    useful.forEach(function (q) {
      const yes = cands.filter(function (c) { return matches(c, q, s.options.set); }).length;
      const score = Math.max(yes, cands.length - yes);
      if (score < bestScore) { bestScore = score; best = [q]; } else if (score === bestScore) best.push(q);
    });
    return best[Math.floor(r() * best.length)];
  }

  // a computer player's whole turn, or what happens when a person's clock runs out (the turn passes)
  function autoPlay(state) {
    if (state.phase !== 'turn') return { error: ERR.wrongStage };
    return run(state, function (ctx) {
      const s = ctx.s;
      const pid = curId(s);
      const isBot = s.bots.indexOf(pid) >= 0;
      if (!isBot) {
        ctx.events.push({ type: 'timeout', playerId: pid });
        s.seq += 1;
        nextTurn(ctx);
        return null;
      }
      const r = randOf(s);
      if (s.stage === 'flip') {
        const keep = candidates(s, pid);
        H.flip(ctx, pid, { ids: Array.from({ length: N }, function (x, i) { return i; }).filter(function (i) { return keep.indexOf(i) < 0; }) });
        return H.end_turn(ctx, pid);
      }
      const cands = candidates(s, pid);
      const smart = s.options.level === 'smart';
      if (cands.length === 1 || (!smart && cands.length === 2)) return H.guess(ctx, pid, { char: cands[Math.floor(r() * cands.length)] });
      const q = pickQuestion(s, pid, cands, smart, r);
      if (!q) return H.guess(ctx, pid, { char: cands[Math.floor(r() * cands.length)] });
      return H.ask(ctx, pid, { q: q.id });
    });
  }

  function nextRound(state) {
    if (state.phase !== 'roundOver') return { error: ERR.wrongStage };
    return run(state, function (ctx) { return H.next_round(ctx); });
  }

  function endGameEarly(state) {
    if (state.phase === 'matchOver') return { error: ERR.wrongStage };
    return run(state, function (ctx) {
      const s = ctx.s;
      const best = Math.max(s.scores[s.playerIds[0]], s.scores[s.playerIds[1]]);
      s.phase = 'matchOver';
      s.endedEarly = true;
      s.winnerIds = s.playerIds.filter(function (id) { return s.scores[id] === best; });
      ctx.events.push({ type: 'match_over', winnerIds: s.winnerIds.slice(), scores: clone(s.scores), early: true });
    });
  }

  // my secret and my board; never the other player's secret before the round is over
  function viewFor(state, playerId) {
    const s = state;
    const opp = other(s, playerId);
    const over = s.phase !== 'turn';
    return {
      you: playerId,
      phase: s.phase,
      stage: s.phase === 'turn' ? s.stage : null,
      currentPlayerId: s.phase === 'turn' ? curId(s) : null,
      playerIds: s.playerIds.slice(),
      players: s.playerIds.map(function (id) { return { id: id, bot: s.bots.indexOf(id) >= 0, down: s.down[id].length }; }),
      options: clone(s.options),
      secret: s.secrets[playerId],
      down: s.down[playerId].slice(),
      asked: clone(s.asked),
      scores: clone(s.scores),
      round: s.round,
      seq: s.seq,
      turnCount: s.turnCount,
      result: over && s.result ? clone(s.result) : null,
      history: clone(s.history),
      winnerIds: s.winnerIds ? s.winnerIds.slice() : null,
      endedEarly: s.endedEarly,
      oppSecret: over && s.result ? s.secrets[opp] : null,
    };
  }

  return { ERR, createGame, act, autoPlay, nextRound, endGameEarly, viewFor, readOptions, candidates, matches, question };
});
