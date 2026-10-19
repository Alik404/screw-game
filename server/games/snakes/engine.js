// "Snakes & Ladders" engine: pure functions. state + action in, new state (or an Arabic error) out.
// No network, no timers: the server calls autoPlay() when a countdown ends (or a computer player's pause does).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'));
  else root.SnakesEngine = factory(root.SnakesConfig);
})(this, function (CONFIG) {
  const ERR = {
    badAction: 'حركة غير صالحة.',
    unknownPlayer: 'أنت لست لاعباً في هذه اللعبة.',
    notYourTurn: 'ليس دورك الآن.',
    wrongStage: 'هذه الحركة غير متاحة الآن.',
    gameOver: 'انتهت اللعبة.',
    badOptions: 'خيارات اللعبة غير صالحة.',
  };
  const LAST = CONFIG.SQUARES;

  // ---------- helpers ----------

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  // Seeded PRNG (mulberry32); its state lives in the game state so the engine stays pure.
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

  function curId(s) { return s.playerIds[s.current]; }

  function boardOf(s) { return CONFIG.BOARDS[s.options.board]; }

  // the snake or ladder that starts on this square, if any
  function jumpAt(board, sq) {
    if (board.snakes[sq]) return { kind: 'snake', to: board.snakes[sq] };
    if (board.ladders[sq]) return { kind: 'ladder', to: board.ladders[sq] };
    return null;
  }

  // Host options; anything missing takes the default, anything invalid is refused.
  function readOptions(o) {
    o = o || {};
    const pick = function (v, def) { return v === undefined ? def : v; };
    const out = {
      board: pick(o.board, CONFIG.DEFAULT_BOARD),
      finish: pick(o.finish, CONFIG.DEFAULT_FINISH),
      sixAgain: pick(o.sixAgain, CONFIG.DEFAULT_SIX_AGAIN),
      startSix: pick(o.startSix, CONFIG.DEFAULT_START_SIX),
    };
    if (CONFIG.BOARD_OPTIONS.indexOf(out.board) < 0) return null;
    if (CONFIG.FINISH_OPTIONS.indexOf(out.finish) < 0) return null;
    if (typeof out.sixAgain !== 'boolean' || typeof out.startSix !== 'boolean') return null;
    return out;
  }

  // ---------- turn flow ----------

  function advance(ctx) {
    const s = ctx.s;
    s.current = (s.current + 1) % s.playerIds.length;
    s.turnCount += 1;
    s.sixes = 0;
    s.turnStart = s.positions[curId(s)];
    ctx.events.push({ type: 'turn', playerId: curId(s) });
  }

  function finish(ctx, winnerIds, early) {
    const s = ctx.s;
    s.phase = 'gameOver';
    s.winnerIds = winnerIds;
    s.endedEarly = !!early;
    ctx.events.push({ type: 'game_over', winnerIds: winnerIds.slice(), positions: clone(s.positions), early: !!early });
  }

  // Where a roll of `value` from `from` lands, and every square the piece passes on the way (for the animation).
  function walk(s, from, value) {
    const target = from + value;
    const path = [];
    if (target <= LAST) {
      for (let q = from + 1; q <= target; q++) path.push(q);
      return { to: target, path: path, bounced: false, blocked: false };
    }
    if (s.options.finish === 'exact') return { to: from, path: path, bounced: false, blocked: true };
    for (let q = from + 1; q <= LAST; q++) path.push(q);
    if (s.options.finish === 'over') return { to: LAST, path: path, bounced: false, blocked: false };
    const to = LAST - (target - LAST); // bounce off the last square
    for (let q = LAST - 1; q >= to; q--) path.push(q);
    return { to: to, path: path, bounced: true, blocked: false };
  }

  function createGame(playerIds, opts) {
    opts = opts || {};
    if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length) return { error: ERR.badAction };
    if (playerIds.length < CONFIG.MIN_PLAYERS || playerIds.length > CONFIG.MAX_PLAYERS) {
      return { error: 'عدد اللاعبين يجب أن يكون بين ' + CONFIG.MIN_PLAYERS + ' و ' + CONFIG.MAX_PLAYERS + '.' };
    }
    const options = readOptions(opts);
    if (!options) return { error: ERR.badOptions };
    const bots = Array.isArray(opts.bots) ? opts.bots.filter(function (id) { return playerIds.indexOf(id) >= 0; }) : [];
    const s = {
      rng: opts.seed === undefined ? randomSeed() : opts.seed >>> 0,
      playerIds: playerIds.slice(),
      bots: bots,
      options: options,
      positions: {},
      stats: {},
      phase: 'turn',
      current: 0,
      turnCount: 0,
      rollCount: 0,
      sixes: 0,
      turnStart: 0,
      lastRoll: null,
      winnerIds: null,
      endedEarly: false,
    };
    playerIds.forEach(function (id) {
      s.positions[id] = 0;
      s.stats[id] = { rolls: 0, sixes: 0, ladders: 0, snakes: 0, climbed: 0, fallen: 0 };
    });
    // who starts is drawn by lot
    s.current = opts.first === undefined ? Math.floor(randOf(s)() * playerIds.length) : opts.first;
    const events = [{ type: 'game_start', firstPlayerId: curId(s), options: clone(options) }, { type: 'turn', playerId: curId(s) }];
    return { state: s, events: events, privates: [] };
  }

  // ---------- handlers: each returns an Arabic error string, or undefined on success ----------

  const H = {};

  H.roll = function (ctx, pid, a) {
    const s = ctx.s;
    if (s.phase !== 'turn') return ERR.wrongStage;
    if (curId(s) !== pid) return ERR.notYourTurn;
    // tests may force the die; the server adapter never passes `value` through
    const value = a && a.forced ? a.forced : 1 + Math.floor(randOf(s)() * CONFIG.DIE_SIDES);
    const st = s.stats[pid];
    const from = s.positions[pid];
    s.rollCount += 1;
    st.rolls += 1;
    const six = value === CONFIG.DIE_SIDES;
    if (six) st.sixes += 1;
    s.lastRoll = { playerId: pid, value: value, seq: s.rollCount };
    ctx.events.push({ type: 'roll', playerId: pid, value: value });

    if (six && s.options.sixAgain) {
      s.sixes += 1;
      if (s.sixes >= CONFIG.MAX_SIXES) { // too lucky: back to where this turn began, and the turn ends
        s.positions[pid] = s.turnStart;
        ctx.events.push({ type: 'three_sixes', playerId: pid, from: from, to: s.turnStart });
        advance(ctx);
        return;
      }
    }
    if (from === 0 && s.options.startSix && !six) {
      ctx.events.push({ type: 'need_six', playerId: pid });
      advance(ctx);
      return;
    }

    const w = walk(s, from, value);
    ctx.events.push({ type: 'move', playerId: pid, from: from, to: w.to, path: w.path, bounced: w.bounced, blocked: w.blocked });
    let pos = w.to;
    const jump = jumpAt(boardOf(s), pos);
    if (jump) {
      ctx.events.push({ type: jump.kind, playerId: pid, from: pos, to: jump.to });
      if (jump.kind === 'ladder') { st.ladders += 1; st.climbed += jump.to - pos; } else { st.snakes += 1; st.fallen += pos - jump.to; }
      pos = jump.to;
    }
    s.positions[pid] = pos;
    if (pos === LAST) {
      finish(ctx, [pid], false);
      return;
    }
    if (six && s.options.sixAgain) {
      ctx.events.push({ type: 'extra_roll', playerId: pid });
      return; // same player rolls again
    }
    advance(ctx);
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

  // The clock ran out, or it is a computer player's turn: roll for the current player.
  function autoPlay(state) {
    if (state.phase !== 'turn') return { error: ERR.wrongStage };
    return run(state, function (ctx) { return H.roll(ctx, curId(ctx.s), {}); });
  }

  // Host ends the game: whoever is furthest along wins (ties share it).
  function endGameEarly(state) {
    if (state.phase !== 'turn') return { error: ERR.wrongStage };
    return run(state, function (ctx) {
      const s = ctx.s;
      const best = Math.max.apply(null, s.playerIds.map(function (id) { return s.positions[id]; }));
      finish(ctx, s.playerIds.filter(function (id) { return s.positions[id] === best; }), true);
    });
  }

  // Players by position, furthest first (the winners lead).
  function ranking(state) {
    return state.playerIds.slice().sort(function (a, b) {
      const wa = state.winnerIds && state.winnerIds.indexOf(a) >= 0 ? 1 : 0;
      const wb = state.winnerIds && state.winnerIds.indexOf(b) >= 0 ? 1 : 0;
      if (wa !== wb) return wb - wa;
      return state.positions[b] - state.positions[a];
    });
  }

  // Nothing in this game is secret except the random seed.
  function viewFor(state, playerId) {
    const s = state;
    return {
      you: playerId,
      phase: s.phase,
      currentPlayerId: s.phase === 'turn' ? curId(s) : null,
      options: clone(s.options),
      playerIds: s.playerIds.slice(),
      players: s.playerIds.map(function (id) { return { id: id, pos: s.positions[id], bot: s.bots.indexOf(id) >= 0 }; }),
      positions: clone(s.positions),
      stats: clone(s.stats),
      turnCount: s.turnCount,
      rollCount: s.rollCount,
      sixes: s.sixes,
      lastRoll: s.lastRoll ? clone(s.lastRoll) : null,
      winnerIds: s.winnerIds ? s.winnerIds.slice() : null,
      endedEarly: s.endedEarly,
      ranking: ranking(s),
    };
  }

  return { ERR, createGame, act, autoPlay, endGameEarly, viewFor, readOptions, jumpAt, walk };
});
