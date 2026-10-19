// Tawla (backgammon) engine: pure functions. state + action in, new state (or an Arabic error) out.
// No network, no timers: the server calls autoPlay() / nextGame() when a countdown ends.
//
// The board: pts[1..24] signed counts (+ white = seat 0, - black = seat 1), bar[seat], off[seat].
// White moves 24 -> 1 (home 1-6) and bears off to 0; black moves 1 -> 24 (home 19-24) and bears off to 25.
// A step is {from, to, die}: from 25 (white) / 0 (black) means "from the bar", to 0 (white) / 25 (black) "off".
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'));
  else root.TawlaEngine = factory(root.TawlaConfig);
})(this, function (CONFIG) {
  const ERR = {
    badAction: 'حركة غير صالحة.',
    unknownPlayer: 'أنت لست لاعباً في هذه اللعبة.',
    notYourTurn: 'ليس دورك الآن.',
    wrongStage: 'هذه الحركة غير متاحة الآن.',
    gameOver: 'انتهت المباراة.',
    illegal: 'هذه الحركة غير مسموحة.',
    nothingToUndo: 'لا شيء للتراجع عنه.',
    badOptions: 'خيارات اللعبة غير صالحة.',
  };

  // ---------- helpers ----------

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
  function die(s) { return 1 + Math.floor(randOf(s)() * 6); }

  const sgn = function (p) { return p === 0 ? 1 : -1; };
  const barPoint = function (p) { return p === 0 ? 25 : 0; };
  const offPoint = function (p) { return p === 0 ? 0 : 25; };
  const dest = function (p, from, d) { return p === 0 ? from - d : from + d; };
  const inHome = function (p, i) { return p === 0 ? i >= 1 && i <= 6 : i >= 19 && i <= 24; };
  const own = function (pos, i, p) { return pos.pts[i] * sgn(p); }; // > 0 mine, < 0 theirs

  function startPos() {
    const pts = new Array(26).fill(0);
    Object.keys(CONFIG.START).forEach(function (k) {
      const i = +k;
      pts[i] += CONFIG.START[k]; // white
      pts[25 - i] -= CONFIG.START[k]; // black, mirrored
    });
    return { pts: pts, bar: [0, 0], off: [0, 0] };
  }

  function copyPos(pos) { return { pts: pos.pts.slice(), bar: pos.bar.slice(), off: pos.off.slice() }; }
  function posKey(pos) { return pos.pts.join(',') + '|' + pos.bar.join(',') + '|' + pos.off.join(','); }

  function allHome(pos, p) {
    if (pos.bar[p]) return false;
    for (let i = 1; i <= 24; i++) if (own(pos, i, p) > 0 && !inHome(p, i)) return false;
    return true;
  }

  // every single step with one die
  function stepsFor(pos, p, d) {
    const out = [];
    const open = function (to) { return own(pos, to, p) >= -1; };
    if (pos.bar[p]) {
      const to = dest(p, barPoint(p), d);
      if (open(to)) out.push({ from: barPoint(p), to: to, die: d });
      return out;
    }
    const home = allHome(pos, p);
    for (let i = 1; i <= 24; i++) {
      if (own(pos, i, p) <= 0) continue;
      const to = dest(p, i, d);
      if (to >= 1 && to <= 24) {
        if (open(to)) out.push({ from: i, to: to, die: d });
      } else if (home) {
        // bearing off: exactly, or with a bigger die from the furthest checker
        const exact = to === offPoint(p);
        let furthest = true;
        if (!exact) {
          if (p === 0) { for (let j = i + 1; j <= 6; j++) if (own(pos, j, p) > 0) furthest = false; } else { for (let j = 19; j < i; j++) if (own(pos, j, p) > 0) furthest = false; }
        }
        if (exact || furthest) out.push({ from: i, to: offPoint(p), die: d });
      }
    }
    return out;
  }

  function apply(pos, p, st) {
    const n = copyPos(pos);
    let hit = false;
    if (st.from === barPoint(p)) n.bar[p] -= 1; else n.pts[st.from] -= sgn(p);
    if (st.to === offPoint(p)) n.off[p] += 1;
    else {
      if (own(n, st.to, p) === -1) { n.pts[st.to] = 0; n.bar[1 - p] += 1; hit = true; }
      n.pts[st.to] += sgn(p);
    }
    return { pos: n, hit: hit };
  }

  function without(dice, d) {
    const i = dice.indexOf(d);
    const out = dice.slice();
    out.splice(i, 1);
    return out;
  }
  function distinct(dice) { return dice.filter(function (d, i) { return dice.indexOf(d) === i; }); }

  // the most dice that can still be played from here
  function maxDepth(pos, p, dice, memo) {
    if (!dice.length) return 0;
    const key = posKey(pos) + '#' + dice.slice().sort().join('');
    if (memo[key] !== undefined) return memo[key];
    let best = 0;
    const ds = distinct(dice);
    for (let k = 0; k < ds.length && best < dice.length; k++) {
      const list = stepsFor(pos, p, ds[k]);
      for (let j = 0; j < list.length && best < dice.length; j++) {
        best = Math.max(best, 1 + maxDepth(apply(pos, p, list[j]).pos, p, without(dice, ds[k]), memo));
      }
    }
    memo[key] = best;
    return best;
  }

  // the legal next steps: each one must still allow playing as many dice as the roll allows
  function legalAt(pos, p, left, required, force, memo) {
    if (required <= 0) return [];
    memo = memo || {};
    const out = [];
    (force ? [force] : distinct(left)).forEach(function (d) {
      if (left.indexOf(d) < 0) return;
      stepsFor(pos, p, d).forEach(function (st) {
        const r = apply(pos, p, st);
        if (1 + maxDepth(r.pos, p, without(left, d), memo) === required) out.push({ from: st.from, to: st.to, die: d, hit: r.hit });
      });
    });
    return out;
  }

  function pips(pos, p) {
    let n = pos.bar[p] * 25;
    for (let i = 1; i <= 24; i++) { const c = own(pos, i, p); if (c > 0) n += c * (p === 0 ? i : 25 - i); }
    return n;
  }

  function curId(s) { return s.playerIds[s.current]; }

  function readOptions(o) {
    o = o || {};
    const out = { target: o.target === undefined ? CONFIG.DEFAULT_TARGET : o.target };
    if (CONFIG.TARGETS.indexOf(out.target) < 0) return null;
    return out;
  }

  // ---------- turns ----------

  function legalNow(s) {
    if (s.phase !== 'turn' || s.stage !== 'move') return [];
    return legalAt(s.pos, s.current, s.left, s.need - s.steps.length, s.steps.length ? null : s.force);
  }

  // dice are known: work out how many must be played (and whether the higher die is forced)
  function beginMove(ctx, dice) {
    const s = ctx.s;
    const p = s.current;
    s.dice = dice;
    s.left = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice.slice();
    s.steps = [];
    s.snap = copyPos(s.pos);
    s.need = maxDepth(s.pos, p, s.left, {});
    s.force = null;
    if (s.need === 1 && dice[0] !== dice[1]) {
      const hi = Math.max(dice[0], dice[1]);
      if (stepsFor(s.pos, p, hi).length) s.force = hi;
    }
    if (!s.need) {
      ctx.events.push({ type: 'no_moves', playerId: curId(s), dice: dice.slice() });
      s.lastMove = { playerId: curId(s), steps: [] };
      nextTurn(ctx);
      return;
    }
    s.stage = 'move';
  }

  function nextTurn(ctx) {
    const s = ctx.s;
    s.current = 1 - s.current;
    s.stage = 'roll';
    s.dice = [];
    s.left = [];
    s.steps = [];
    s.need = 0;
    s.force = null;
    s.turnCount += 1;
    ctx.events.push({ type: 'turn', playerId: curId(s) });
  }

  function startGame(ctx) {
    const s = ctx.s;
    s.pos = startPos();
    s.phase = 'turn';
    s.turnCount = 0;
    s.result = null;
    s.lastMove = null;
    // opening roll: one die each, again on a tie; the higher one starts and plays both
    let a; let b; let ties = 0;
    for (;;) { a = die(s); b = die(s); if (a !== b) break; ties += 1; }
    s.opening = [a, b];
    s.current = a > b ? 0 : 1;
    ctx.events.push({ type: 'game_start', game: s.game, opening: [a, b], ties: ties, firstPlayerId: curId(s) });
    beginMove(ctx, s.current === 0 ? [a, b] : [b, a]);
  }

  function createGame(playerIds, opts) {
    opts = opts || {};
    if (!Array.isArray(playerIds) || playerIds.length !== 2 || playerIds[0] === playerIds[1]) {
      return { error: 'الطاولي للاعبَين اثنين فقط.' };
    }
    const options = readOptions(opts);
    if (!options) return { error: ERR.badOptions };
    const s = {
      rng: opts.seed === undefined ? randomSeed() : opts.seed >>> 0,
      playerIds: playerIds.slice(),
      bots: Array.isArray(opts.bots) ? opts.bots.filter(function (id) { return playerIds.indexOf(id) >= 0; }) : [],
      options: options,
      scores: {},
      game: 1,
      history: [],
      winnerIds: null,
      endedEarly: false,
      seq: 0,
    };
    playerIds.forEach(function (id) { s.scores[id] = 0; });
    const ctx = { s: s, events: [] };
    startGame(ctx);
    return { state: s, events: ctx.events, privates: [] };
  }

  function endGame(ctx, p) {
    const s = ctx.s;
    const q = 1 - p;
    let kind = 'single';
    if (s.pos.off[q] === 0) {
      kind = 'gammon';
      let back = s.pos.bar[q] > 0;
      for (let i = 1; i <= 24; i++) if (inHome(p, i) && own(s.pos, i, q) > 0) back = true;
      if (back) kind = 'backgammon';
    }
    const points = CONFIG.POINTS[kind];
    const winnerId = s.playerIds[p];
    s.scores[winnerId] += points;
    s.result = { game: s.game, winnerId: winnerId, kind: kind, points: points, scores: clone(s.scores), pips: [pips(s.pos, 0), pips(s.pos, 1)] };
    s.history.push({ game: s.game, winnerId: winnerId, kind: kind, points: points });
    s.stage = null;
    ctx.events.push({ type: 'game_end', result: clone(s.result) });
    if (s.scores[winnerId] >= s.options.target) {
      s.phase = 'matchOver';
      s.winnerIds = [winnerId];
      ctx.events.push({ type: 'match_over', winnerIds: [winnerId], scores: clone(s.scores), early: false });
    } else {
      s.phase = 'gameEnd';
    }
  }

  // ---------- handlers ----------

  const H = {};

  function needTurn(s, pid, stages) {
    if (s.phase !== 'turn') return ERR.wrongStage;
    if (curId(s) !== pid) return ERR.notYourTurn;
    if (stages.indexOf(s.stage) < 0) return ERR.wrongStage;
    return null;
  }

  H.roll = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(s, pid, ['roll']);
    if (err) return err;
    // tests may force the dice; the server adapter never lets `forced` through
    const dice = a && Array.isArray(a.forced) ? a.forced.slice(0, 2) : [die(s), die(s)];
    s.seq += 1;
    ctx.events.push({ type: 'roll', playerId: pid, dice: dice.slice() });
    beginMove(ctx, dice);
  };

  H.move = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(s, pid, ['move']);
    if (err) return err;
    const st = legalNow(s).find(function (x) { return x.from === a.from && x.die === a.die; });
    if (!st) return ERR.illegal;
    const r = apply(s.pos, s.current, st);
    s.pos = r.pos;
    s.left = without(s.left, st.die);
    s.steps.push({ from: st.from, to: st.to, die: st.die, hit: r.hit });
    s.seq += 1;
    ctx.events.push({ type: 'step', playerId: pid, from: st.from, to: st.to, die: st.die, hit: r.hit });
    if (s.pos.off[s.current] === CONFIG.CHECKERS) { endGame(ctx, s.current); return; }
    if (s.steps.length >= s.need) s.stage = 'confirm';
  };

  H.undo = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, ['move', 'confirm']);
    if (err) return err;
    if (!s.steps.length) return ERR.nothingToUndo;
    const last = s.steps.pop();
    s.pos = copyPos(s.snap);
    s.left = s.dice[0] === s.dice[1] ? [s.dice[0], s.dice[0], s.dice[0], s.dice[0]] : s.dice.slice();
    s.steps.forEach(function (st) { s.pos = apply(s.pos, s.current, st).pos; s.left = without(s.left, st.die); });
    s.stage = 'move';
    s.seq += 1;
    ctx.events.push({ type: 'undo', playerId: pid, from: last.from, to: last.to, die: last.die, hit: last.hit });
  };

  H.done = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid, ['confirm']);
    if (err) return err;
    s.lastMove = { playerId: pid, steps: clone(s.steps) };
    s.seq += 1;
    ctx.events.push({ type: 'done', playerId: pid });
    nextTurn(ctx);
  };

  H.next_round = function (ctx) {
    const s = ctx.s;
    if (s.phase !== 'gameEnd') return ERR.wrongStage;
    s.game += 1;
    s.seq += 1;
    startGame(ctx);
  };

  // ---------- the computer player ----------

  // how good a position is for p (bigger is better); a rough but sensible player
  function evaluate(pos, p) {
    const q = 1 - p;
    const myP = pips(pos, p);
    const opP = pips(pos, q);
    let score = (opP - myP) * 0.6 + pos.off[p] * 3 - pos.off[q] * 3 + pos.bar[q] * 9 - pos.bar[p] * 9;
    // contact: is any of their checkers still behind any of mine?
    let myBack = 0;
    let opBack = 25;
    for (let i = 1; i <= 24; i++) {
      if (own(pos, i, p) > 0) myBack = Math.max(myBack, p === 0 ? i : 25 - i);
      if (own(pos, i, q) > 0) opBack = Math.min(opBack, p === 0 ? i : 25 - i);
    }
    if (pos.bar[p]) myBack = 25;
    if (pos.bar[q]) opBack = 0;
    const contact = myBack > opBack;
    if (!contact) return (opP - myP) * 2 + pos.off[p] * 4; // a pure race
    // made points, a prime, my home board closed against their bar checkers
    let run = 0; let prime = 0; let homeMade = 0;
    for (let k = 1; k <= 24; k++) {
      const i = p === 0 ? k : 25 - k; // k = distance from my bear-off
      const c = own(pos, i, p);
      if (c >= 2) { run += 1; prime = Math.max(prime, run); if (k <= 6) homeMade += 1; if (k <= 9) score += 2.2; else score += 1; } else run = 0;
      if (c > 3) score -= (c - 3) * 0.6;
    }
    score += prime * prime * 0.9 + homeMade * pos.bar[q] * 3;
    // blots: the chance of being hit times what it costs
    const shooters = [];
    for (let i = 0; i <= 25; i++) {
      const c = i === barPoint(q) ? pos.bar[q] : (i >= 1 && i <= 24 ? own(pos, i, q) : 0);
      if (c > 0) shooters.push(i);
    }
    for (let i = 1; i <= 24; i++) {
      if (own(pos, i, p) !== 1) continue;
      const dists = {};
      shooters.forEach(function (j) {
        const d = q === 0 ? j - i : i - j; // they move towards their home
        if (d >= 1 && d <= 12) dists[d] = true;
      });
      let direct = 0; let combo = 0;
      Object.keys(dists).forEach(function (d) { if (+d <= 6) direct += 1; else combo += 1; });
      const prob = Math.min(0.92, direct * 0.31 + combo * 0.07);
      const travelled = p === 0 ? 25 - i : i; // what we lose if it goes back to the bar
      score -= prob * (travelled * 0.45 + 4) * (homeMade + 1) / 3;
    }
    return score;
  }

  // every distinct end of the turn from here, with the steps that reach it
  function completions(s) {
    const p = s.current;
    const out = {};
    const memo = {};
    const seen = {}; // different orders of the same steps reach the same place: walk it once
    const walk = function (pos, left, done, first) {
      const key = posKey(pos) + '#' + left.slice().sort().join('');
      if (seen[key]) return;
      seen[key] = true;
      const required = s.need - s.steps.length - done.length;
      const list = legalAt(pos, p, left, required, first && !s.steps.length ? s.force : null, memo);
      if (!list.length) { const k = posKey(pos); if (!out[k]) out[k] = { pos: pos, steps: done }; return; }
      list.forEach(function (st) { walk(apply(pos, p, st).pos, without(left, st.die), done.concat([st]), false); });
    };
    walk(s.pos, s.left, [], true);
    return Object.keys(out).map(function (k) { return out[k]; });
  }

  function bestPlan(s) {
    const p = s.current;
    let best = null;
    completions(s).forEach(function (c) {
      const v = c.pos.off[p] === CONFIG.CHECKERS ? 1e6 : evaluate(c.pos, p);
      if (!best || v > best.v) best = { v: v, steps: c.steps };
    });
    return best ? best.steps : [];
  }

  // ---------- public API ----------

  function run(state, fn) {
    const ctx = { s: clone(state), events: [] };
    const err = fn(ctx);
    if (err) return { error: err };
    return { state: ctx.s, events: ctx.events, privates: [] };
  }

  function act(state, playerId, action) {
    if (!action || typeof action.type !== 'string' || !Object.prototype.hasOwnProperty.call(H, action.type)) return { error: ERR.badAction };
    if (state.playerIds.indexOf(playerId) < 0) return { error: ERR.unknownPlayer };
    if (state.phase === 'matchOver') return { error: ERR.gameOver };
    if (action.type === 'move' && (typeof action.from !== 'number' || typeof action.die !== 'number')) return { error: ERR.badAction };
    return run(state, function (ctx) { return H[action.type](ctx, playerId, action); });
  }

  // the clock ran out, or it is the computer's turn: roll, or finish the move (best plan) and end the turn
  function autoPlay(state) {
    if (state.phase !== 'turn') return { error: ERR.wrongStage };
    return run(state, function (ctx) {
      const s = ctx.s;
      const pid = curId(s);
      if (s.stage === 'roll') return H.roll(ctx, pid);
      if (s.stage === 'move') {
        const plan = bestPlan(s);
        for (let k = 0; k < plan.length; k++) {
          const err = H.move(ctx, pid, plan[k]);
          if (err) return err;
          if (s.phase !== 'turn') return null;
        }
      }
      if (s.phase === 'turn' && s.stage === 'confirm') return H.done(ctx, pid);
      return null;
    });
  }

  function nextGame(state) {
    if (state.phase !== 'gameEnd') return { error: ERR.wrongStage };
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

  // multi-step moves of one checker (the sum of two dice, or more with a double), for tapping the far point
  function paths(s) {
    const p = s.current;
    const out = {};
    const memo = {};
    const walk = function (pos, left, from, at, dice, first) {
      const required = s.need - s.steps.length - dice.length;
      legalAt(pos, p, left, required, first && !s.steps.length ? s.force : null, memo).forEach(function (st) {
        if (st.from !== at) return;
        const d = dice.concat([st.die]);
        if (d.length > 1) { const k = from + '>' + st.to; if (!out[k]) out[k] = { from: from, to: st.to, dice: d }; }
        if (st.to !== offPoint(p)) walk(apply(pos, p, st).pos, without(left, st.die), from, st.to, d, false);
      });
    };
    const seen = {};
    legalNow(s).forEach(function (st) {
      if (seen[st.from]) return;
      seen[st.from] = true;
      walk(s.pos, s.left, st.from, st.from, [], true);
    });
    return Object.keys(out).map(function (k) { return out[k]; });
  }

  // nothing in this game is secret except the random seed
  function viewFor(state, playerId) {
    const s = state;
    const seat = s.playerIds.indexOf(playerId);
    const myTurn = s.phase === 'turn' && curId(s) === playerId;
    return {
      you: playerId,
      seat: seat,
      phase: s.phase,
      stage: s.phase === 'turn' ? s.stage : null,
      currentPlayerId: s.phase === 'turn' ? curId(s) : null,
      playerIds: s.playerIds.slice(),
      players: s.playerIds.map(function (id) { return { id: id, bot: s.bots.indexOf(id) >= 0 }; }),
      options: clone(s.options),
      pos: clone(s.pos),
      dice: (s.dice || []).slice(),
      left: (s.left || []).slice(),
      stepsDone: (s.steps || []).length,
      need: s.need || 0,
      legal: myTurn ? legalNow(s) : [],
      paths: myTurn && s.stage === 'move' ? paths(s) : [],
      lastMove: s.lastMove ? clone(s.lastMove) : null,
      pips: [pips(s.pos, 0), pips(s.pos, 1)],
      scores: clone(s.scores),
      gameNo: s.game, // (not "game": the rooms layer puts the game type there)
      seq: s.seq,
      turnCount: s.turnCount,
      opening: s.opening ? s.opening.slice() : null,
      result: s.result ? clone(s.result) : null,
      history: clone(s.history),
      winnerIds: s.winnerIds ? s.winnerIds.slice() : null,
      endedEarly: s.endedEarly,
    };
  }

  return {
    ERR, createGame, act, autoPlay, nextGame, endGameEarly, viewFor, readOptions,
    startPos, stepsFor, legalAt, maxDepth, apply, pips, evaluate, completions, bestPlan,
  };
});
