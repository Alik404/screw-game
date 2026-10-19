// Dominoes engine: pure functions. state + action in, new state (or an Arabic error) out.
// No network, no timers: the server calls autoPlay() / nextHand() when a countdown ends.
// A tile is "a-b" with a <= b. The line of play is a list of oriented tiles [left, right], so the open
// ends are line[0][0] and line[last][1]; `first` is the index of the opening tile (the layout grows from it).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'));
  else root.DominoEngine = factory(root.DominoConfig);
})(this, function (CONFIG) {
  const ERR = {
    badAction: 'حركة غير صالحة.',
    unknownPlayer: 'أنت لست لاعباً في هذه اللعبة.',
    notYourTurn: 'ليس دورك الآن.',
    wrongStage: 'هذه الحركة غير متاحة الآن.',
    gameOver: 'انتهت اللعبة.',
    noTile: 'هذه القطعة ليست عندك.',
    noFit: 'هذه القطعة لا تركب على أي طرف.',
    noFitEnd: 'هذه القطعة لا تركب على هذا الطرف.',
    chooseEnd: 'اختر الطرف الذي تضع عليه القطعة.',
    mustOpen: 'ابدأ بأكبر دبل عندك.',
    canPlay: 'عندك قطعة تركب، لا يجوز السحب.',
    noDraw: 'لا سحب في هذه اللعبة.',
    emptyYard: 'الكومة فارغة.',
    badOptions: 'خيارات اللعبة غير صالحة.',
  };

  // ---------- helpers ----------

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

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
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function tileId(a, b) { return Math.min(a, b) + '-' + Math.max(a, b); }
  function pips(id) { return id.split('-').map(Number); }
  function isDouble(id) { const p = pips(id); return p[0] === p[1]; }
  function value(id) { const p = pips(id); return p[0] + p[1]; }
  function handPips(hand) { return hand.reduce(function (n, id) { return n + value(id); }, 0); }

  function fullSet() {
    const out = [];
    for (let a = 0; a <= CONFIG.MAX_PIP; a++) for (let b = a; b <= CONFIG.MAX_PIP; b++) out.push(tileId(a, b));
    return out;
  }

  function curId(s) { return s.playerIds[s.current]; }
  function ends(s) { return s.line.length ? [s.line[0][0], s.line[s.line.length - 1][1]] : null; }

  // the ends a tile can go on: [] none, ['any'] when the line is empty, else some of 'left' / 'right'
  function fits(s, id) {
    if (s.must && id !== s.must) return [];
    const e = ends(s);
    if (!e) return ['any'];
    const p = pips(id);
    const out = [];
    if (p[0] === e[0] || p[1] === e[0]) out.push('left');
    if (p[0] === e[1] || p[1] === e[1]) out.push('right');
    return out;
  }

  function playables(s, pid) {
    const out = [];
    s.hands[pid].forEach(function (id) {
      const f = fits(s, id);
      if (f.length) out.push({ tile: id, ends: f });
    });
    return out;
  }

  function sideOf(s, pid) { return s.teams ? s.teams[pid] : pid; }
  function sides(s) {
    if (!s.teams) return s.playerIds.slice();
    return ['A', 'B'];
  }
  function membersOf(s, side) { return s.playerIds.filter(function (id) { return sideOf(s, id) === side; }); }

  function readOptions(o, count) {
    o = o || {};
    const pick = function (v, def) { return v === undefined ? def : v; };
    const out = {
      mode: pick(o.mode, CONFIG.DEFAULT_MODE),
      target: pick(o.target, CONFIG.DEFAULT_TARGET),
      teams: pick(o.teams, CONFIG.DEFAULT_TEAMS),
    };
    if (CONFIG.MODES.indexOf(out.mode) < 0) return null;
    if (CONFIG.TARGETS.indexOf(out.target) < 0) return null;
    if (typeof out.teams !== 'boolean') return null;
    if (count !== undefined && count !== 4) out.teams = false; // partners need four players
    return out;
  }

  // ---------- dealing ----------

  function dealHand(ctx) {
    const s = ctx.s;
    const tiles = shuffle(fullSet(), randOf(s));
    s.hands = {};
    s.playerIds.forEach(function (id) { s.hands[id] = tiles.splice(0, CONFIG.HAND_SIZE); });
    s.yard = tiles;
    s.line = [];
    s.first = 0;
    s.passes = 0;
    s.must = null;
    s.result = null;
    s.phase = 'turn';
    s.turnCount = 0;
    s.moveCount = s.moveCount || 0;
    // who leads: the first hand by the highest double (it must be played); later the last winner
    if (s.hand === 1 || s.leader === null) {
      let best = null;
      s.playerIds.forEach(function (id, i) {
        s.hands[id].forEach(function (t) {
          const score = (isDouble(t) ? 100 : 0) + value(t);
          if (!best || score > best.score) best = { i: i, tile: t, score: score };
        });
      });
      s.current = best.i;
      s.must = best.tile;
    } else {
      s.current = s.leader;
    }
    ctx.events.push({ type: 'hand_start', hand: s.hand, firstPlayerId: curId(s), must: s.must, yard: s.yard.length });
    ctx.events.push({ type: 'turn', playerId: curId(s) });
  }

  function createGame(playerIds, opts) {
    opts = opts || {};
    if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length) return { error: ERR.badAction };
    if (playerIds.length < CONFIG.MIN_PLAYERS || playerIds.length > CONFIG.MAX_PLAYERS) {
      return { error: 'عدد اللاعبين يجب أن يكون بين ' + CONFIG.MIN_PLAYERS + ' و ' + CONFIG.MAX_PLAYERS + '.' };
    }
    const options = readOptions(opts, playerIds.length);
    if (!options) return { error: ERR.badOptions };
    const s = {
      rng: opts.seed === undefined ? randomSeed() : opts.seed >>> 0,
      playerIds: playerIds.slice(),
      bots: Array.isArray(opts.bots) ? opts.bots.filter(function (id) { return playerIds.indexOf(id) >= 0; }) : [],
      options: options,
      teams: null,
      scores: {},
      hand: 1,
      leader: null,
      history: [],
      winnerSides: null,
      endedEarly: false,
      moveCount: 0,
    };
    // partners sit across: seats 0 and 2 against 1 and 3
    if (options.teams) {
      s.teams = {};
      playerIds.forEach(function (id, i) { s.teams[id] = i % 2 === 0 ? 'A' : 'B'; });
    }
    sides(s).forEach(function (k) { s.scores[k] = 0; });
    const ctx = { s: s, events: [] };
    dealHand(ctx);
    return { state: s, events: ctx.events, privates: [] };
  }

  // ---------- the end of a hand ----------

  function endHand(ctx, winnerId, reason) {
    const s = ctx.s;
    const pipsBy = {};
    s.playerIds.forEach(function (id) { pipsBy[id] = handPips(s.hands[id]); });
    let side = null;
    let points = 0;
    if (reason === 'domino') {
      side = sideOf(s, winnerId);
      s.playerIds.forEach(function (id) { if (sideOf(s, id) !== side) points += pipsBy[id]; });
    } else {
      // blocked: the side with the fewest pips wins the others' pips; a tie scores nothing
      const total = {};
      sides(s).forEach(function (k) { total[k] = 0; });
      s.playerIds.forEach(function (id) { total[sideOf(s, id)] += pipsBy[id]; });
      const low = Math.min.apply(null, sides(s).map(function (k) { return total[k]; }));
      const lows = sides(s).filter(function (k) { return total[k] === low; });
      if (lows.length === 1) {
        side = lows[0];
        sides(s).forEach(function (k) { if (k !== side) points += total[k]; });
        // the player who leads next: the lowest hand on the winning side
        const mine = membersOf(s, side).sort(function (a, b) { return pipsBy[a] - pipsBy[b]; });
        winnerId = mine[0];
      }
    }
    if (side !== null) s.scores[side] += points;
    s.leader = winnerId ? s.playerIds.indexOf(winnerId) : (s.leader === null ? 0 : (s.leader + 1) % s.playerIds.length);
    s.result = {
      hand: s.hand,
      reason: reason,
      winnerId: winnerId || null,
      side: side,
      points: points,
      pips: pipsBy,
      hands: clone(s.hands),
      scores: clone(s.scores),
    };
    s.history.push({ hand: s.hand, reason: reason, side: side, points: points });
    ctx.events.push({ type: 'hand_end', result: clone(s.result) });
    const best = Math.max.apply(null, sides(s).map(function (k) { return s.scores[k]; }));
    if (best >= s.options.target) {
      s.phase = 'gameOver';
      s.winnerSides = sides(s).filter(function (k) { return s.scores[k] === best; });
      ctx.events.push({ type: 'game_over', winnerSides: s.winnerSides.slice(), scores: clone(s.scores), early: false });
    } else {
      s.phase = 'handOver';
    }
  }

  // Next player who can do something. Players with nothing to play (and nothing to draw) pass by
  // themselves; when everybody passed in a row the hand is blocked.
  function advance(ctx) {
    const s = ctx.s;
    const n = s.playerIds.length;
    for (let k = 0; k < n; k++) {
      s.current = (s.current + 1) % n;
      s.turnCount += 1;
      const pid = curId(s);
      if (playables(s, pid).length || (s.options.mode === 'draw' && s.yard.length)) {
        ctx.events.push({ type: 'turn', playerId: pid });
        return;
      }
      s.passes += 1;
      ctx.events.push({ type: 'pass', playerId: pid });
      if (s.passes >= n) { endHand(ctx, null, 'blocked'); return; }
    }
    endHand(ctx, null, 'blocked');
  }

  // ---------- handlers ----------

  const H = {};

  function needTurn(s, pid) {
    if (s.phase !== 'turn') return ERR.wrongStage;
    if (curId(s) !== pid) return ERR.notYourTurn;
    return null;
  }

  H.play = function (ctx, pid, a) {
    const s = ctx.s;
    const err = needTurn(s, pid);
    if (err) return err;
    const hand = s.hands[pid];
    const i = hand.indexOf(a.tile);
    if (i < 0) return ERR.noTile;
    if (s.must && a.tile !== s.must) return ERR.mustOpen;
    const f = fits(s, a.tile);
    if (!f.length) return ERR.noFit;
    let end = a.end;
    if (f[0] === 'any') end = 'right';
    else if (end === undefined) {
      if (f.length > 1) {
        // both ends: it only matters when they show different numbers
        const e = ends(s);
        if (e[0] !== e[1]) return ERR.chooseEnd;
      }
      end = f[f.length - 1];
    }
    if (f[0] !== 'any' && f.indexOf(end) < 0) return ERR.noFitEnd;
    hand.splice(i, 1);
    const p = pips(a.tile);
    let placed;
    if (!s.line.length) {
      placed = [p[0], p[1]];
      s.line.push(placed);
      s.first = 0;
    } else if (end === 'left') {
      const e = s.line[0][0];
      placed = p[1] === e ? [p[0], p[1]] : [p[1], p[0]];
      s.line.unshift(placed);
      s.first += 1;
    } else {
      const e = s.line[s.line.length - 1][1];
      placed = p[0] === e ? [p[0], p[1]] : [p[1], p[0]];
      s.line.push(placed);
    }
    s.must = null;
    s.passes = 0;
    s.moveCount += 1;
    ctx.events.push({ type: 'play', playerId: pid, tile: a.tile, end: end, placed: placed, left: hand.length });
    if (!hand.length) { endHand(ctx, pid, 'domino'); return; }
    advance(ctx);
  };

  // draw until something fits (or the pile is empty); then the player plays, or passes if nothing came
  H.draw = function (ctx, pid) {
    const s = ctx.s;
    const err = needTurn(s, pid);
    if (err) return err;
    if (s.options.mode !== 'draw') return ERR.noDraw;
    if (playables(s, pid).length) return ERR.canPlay;
    if (!s.yard.length) return ERR.emptyYard;
    let got = 0;
    while (s.yard.length) {
      const t = s.yard.pop();
      s.hands[pid].push(t);
      got += 1;
      if (fits(s, t).length) break;
    }
    s.moveCount += 1;
    ctx.events.push({ type: 'draw', playerId: pid, count: got, yard: s.yard.length });
    if (!playables(s, pid).length) {
      s.passes += 1;
      ctx.events.push({ type: 'pass', playerId: pid });
      if (s.passes >= s.playerIds.length) { endHand(ctx, null, 'blocked'); return; }
      advance(ctx);
    }
  };

  H.next_round = function (ctx) {
    const s = ctx.s;
    if (s.phase !== 'handOver') return ERR.wrongStage;
    s.hand += 1;
    dealHand(ctx);
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

  // The move a computer player makes (and the server makes for an idle player): get rid of the heaviest
  // tile, doubles first; keep a number you hold many of on the open end.
  function bestMove(s, pid) {
    const opts = playables(s, pid);
    if (!opts.length) return null;
    const hand = s.hands[pid];
    const count = {};
    hand.forEach(function (t) { pips(t).forEach(function (v) { count[v] = (count[v] || 0) + 1; }); });
    const e = ends(s);
    let best = null;
    opts.forEach(function (o) {
      const p = pips(o.tile);
      (o.ends[0] === 'any' ? ['any'] : o.ends).forEach(function (end) {
        let score = value(o.tile) * 2 + (isDouble(o.tile) ? 7 : 0);
        if (end !== 'any') {
          const open = end === 'left' ? e[0] : e[1];
          const left = p[0] === open ? p[1] : p[0]; // the number this leaves open
          score += (count[left] || 0) * 2;
        }
        if (!best || score > best.score) best = { tile: o.tile, end: end === 'any' ? undefined : end, score: score };
      });
    });
    return { type: 'play', tile: best.tile, end: best.end };
  }

  function autoPlay(state) {
    if (state.phase !== 'turn') return { error: ERR.wrongStage };
    return run(state, function (ctx) {
      const s = ctx.s;
      const pid = curId(s);
      let mv = bestMove(s, pid);
      if (mv) return H.play(ctx, pid, mv);
      const err = H.draw(ctx, pid);
      if (err) return err;
      if (s.phase === 'turn' && curId(s) === pid) {
        mv = bestMove(s, pid);
        if (mv) return H.play(ctx, pid, mv);
      }
      return null;
    });
  }

  function nextHand(state) {
    if (state.phase !== 'handOver') return { error: ERR.wrongStage };
    return run(state, function (ctx) { return H.next_round(ctx); });
  }

  // host ends the game: the side with the most points wins (ties share it)
  function endGameEarly(state) {
    if (state.phase === 'gameOver') return { error: ERR.wrongStage };
    return run(state, function (ctx) {
      const s = ctx.s;
      const best = Math.max.apply(null, sides(s).map(function (k) { return s.scores[k]; }));
      s.phase = 'gameOver';
      s.endedEarly = true;
      s.winnerSides = sides(s).filter(function (k) { return s.scores[k] === best; });
      ctx.events.push({ type: 'game_over', winnerSides: s.winnerSides.slice(), scores: clone(s.scores), early: true });
    });
  }

  // My hand only; everyone else is a count. The pile is a count. The rest of the table is public.
  function viewFor(state, playerId) {
    const s = state;
    const myTurn = s.phase === 'turn' && curId(s) === playerId;
    const over = s.phase !== 'turn';
    return {
      you: playerId,
      phase: s.phase,
      currentPlayerId: s.phase === 'turn' ? curId(s) : null,
      options: clone(s.options),
      playerIds: s.playerIds.slice(),
      players: s.playerIds.map(function (id) {
        return { id: id, count: s.hands[id].length, bot: s.bots.indexOf(id) >= 0, side: sideOf(s, id) };
      }),
      teams: s.teams ? clone(s.teams) : null,
      hand: clone(s.hands[playerId] || []),
      line: clone(s.line),
      first: s.first,
      ends: ends(s),
      yard: s.yard.length,
      must: s.must,
      playable: myTurn ? playables(s, playerId) : [],
      canDraw: myTurn && s.options.mode === 'draw' && s.yard.length > 0 && !playables(s, playerId).length,
      handNo: s.hand,
      moveCount: s.moveCount,
      scores: clone(s.scores),
      history: clone(s.history),
      result: over && s.result ? clone(s.result) : null,
      winnerSides: s.winnerSides ? s.winnerSides.slice() : null,
      endedEarly: s.endedEarly,
    };
  }

  return { ERR, createGame, act, autoPlay, nextHand, endGameEarly, viewFor, readOptions, fullSet, fits, playables, handPips, bestMove };
});
