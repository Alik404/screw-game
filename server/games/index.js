// Game adapters: everything rooms.js needs to know about a game, behind one interface.
//   create(seats) / act(state, seat, action) / view(state, seat) -> pure engine calls
//   timers(state) -> [{kind, key, seconds}]   what countdowns should be running right now
//   timeout(state, kind) -> result            what the server does when one runs out
//   messageFor(event) -> message to broadcast for an engine event
//   host: optional host-only actions (next_round, new_game, end_game)
//   bots: true when the host may add computer players in the lobby (create gets {bots: [seats]})
const SCREW_CONFIG = require('../config');
const SCREW = require('../engine');
const BANK_CONFIG = require('./bank/config');
const BANK = require('./bank/engine');
const SEVEN_CONFIG = require('./seven/config');
const SEVEN = require('./seven/engine');
const SNAKES_CONFIG = require('./snakes/config');
const SNAKES = require('./snakes/engine');
const DOMINO_CONFIG = require('./domino/config');
const DOMINO = require('./domino/engine');
const TAWLA_CONFIG = require('./tawla/config');
const TAWLA = require('./tawla/engine');
const LAGTA_CONFIG = require('./lagta/config');
const LAGTA = require('./lagta/engine');
const MINHU_CONFIG = require('./minhu/config');
const MINHU = require('./minhu/engine');


// The clock for whoever's move it is, in games with computer players: a short pause for a computer
// player or someone who is away, the full turn otherwise, and nothing at all when no human is connected.
function playerClock(roster, bots, cur, key, cfg) {
  if (roster && !roster.some(function (p) { return p.connected && !p.bot; })) return [];
  if (bots.indexOf(cur) >= 0) return [{ kind: 'bot', key: 'bot:' + key, seconds: cfg.BOT_SECONDS }];
  const me = roster && roster.find(function (p) { return p.id === cur; });
  if (me && !me.connected) return [{ kind: 'away', key: 'away:' + key, seconds: cfg.AWAY_SECONDS }];
  return [{ kind: 'turn', key: 'turn:' + key, seconds: cfg.TURN_SECONDS }];
}

// nobody but computer players is connected: every clock stops until someone comes back
function nobodyHere(roster) {
  return !!roster && !roster.some(function (p) { return p.connected && !p.bot; });
}

const screw = {
  id: 'screw',
  minPlayers: SCREW_CONFIG.MIN_PLAYERS,
  maxPlayers: SCREW_CONFIG.MAX_PLAYERS,
  actions: ['ready', 'draw', 'swap_drawn', 'discard_drawn', 'take_discard', 'match', 'use_ability', 'skip_ability', 'call_screw'],
  bots: true,
  botName: SCREW_CONFIG.BOT_NAME,
  // the only fields copied from a client message into an engine action
  fields: ['type', 'slot', 'targetPlayerId', 'targetSlot', 'mode', 'slots', 'picks'],
  create: function (seats, options, extra) { return SCREW.createGame(seats, { bots: extra && extra.bots }); },
  act: function (state, seat, action) { return SCREW.act(state, seat, action); },
  view: function (state, seat) { return SCREW.viewFor(state, seat); },
  // screw's view already has players[]: add the names and connection state
  decorate: function (view, roster) {
    view.players = view.players.map(function (vp) {
      const rp = roster.find(function (p) { return p.id === vp.id; });
      vp.name = rp.name;
      vp.connected = rp.connected;
      vp.isHost = rp.isHost;
      return vp;
    });
  },
  // the opening peek, then one clock per turn (a computer player plays after a short pause)
  timers: function (s, roster) {
    if (nobodyHere(roster)) return [];
    if (s.phase === 'peek') return [{ kind: 'peek', key: 'peek:' + s.round, seconds: SCREW_CONFIG.INITIAL_PEEK_SECONDS }];
    if (s.phase === 'turn') return playerClock(roster, s.bots || [], s.playerIds[s.current], s.round + ':' + s.turnCount, SCREW_CONFIG);
    return [];
  },
  timeout: function (s, kind) {
    if (kind === 'peek') return SCREW.forceStartPlay(s);
    if (kind === 'bot') { const r = SCREW.botPlay(s); return r.error ? SCREW.autoPlay(s) : r; }
    return SCREW.autoPlay(s);
  },
  messageFor: function (ev) {
    if (ev.type === 'round_end') {
      const r = ev.result;
      return {
        type: 'round_result', round: r.round, hands: r.hands, sums: r.sums, scores: r.scores,
        totals: r.totals, screwCaller: r.screwCaller, minIds: r.minIds, multiplied: r.multiplied,
      };
    }
    if (ev.type === 'game_over') return { type: 'game_over', totals: ev.totals, winnerIds: ev.winnerIds };
    return { type: 'event', event: ev };
  },
  host: {
    next_round: function (s, seat) { return SCREW.act(s, seat, { type: 'next_round' }); },
    new_game: function (s) {
      if (s.phase !== 'gameOver') return { error: SCREW.ERR.wrongPhase };
      return SCREW.newGame(s);
    },
  },
};

// timers for the bank game: one main countdown for the current decision (restarted whenever the
// decision changes) plus an independent one for an open trade offer. A computer player decides after a
// short pause, and raises bids and answers trades the same way; a player who is away is played for quickly.
function bankTimers(s, roster) {
  if (s.phase !== 'turn' || nobodyHere(roster)) return [];
  const bots = s.bots || [];
  const away = function (id) {
    const r = roster && roster.find(function (p) { return p.id === id; });
    return !!r && !r.connected && !r.bot;
  };
  const base = s.turnCount + ':' + s.doublesInRow;
  const list = [];
  const clock = function (kind, key, seconds, who) {
    if (bots.indexOf(who) >= 0 && BANK.botWaiting(s)) list.push({ kind: 'bot', key: 'bot:' + key, seconds: BANK_CONFIG.BOT_SECONDS });
    else if (away(who)) list.push({ kind: kind, key: key + ':away', seconds: BANK_CONFIG.AWAY_SECONDS });
    else list.push({ kind: kind, key: key, seconds: seconds });
  };
  const cur = s.playerIds[s.current];
  switch (s.stage) {
    case 'roll': clock('turn', 'roll:' + base, BANK_CONFIG.TURN_SECONDS, cur); break;
    case 'buy': clock('buy', 'buy:' + base, BANK_CONFIG.BUY_SECONDS, cur); break;
    case 'auction':
      list.push({ kind: 'auction', key: 'auction:' + base + ':' + s.auction.seq, seconds: BANK_CONFIG.AUCTION_SECONDS });
      if (BANK.botBidFor(s)) list.push({ kind: 'botbid', key: 'bb:' + base + ':' + s.auction.seq, seconds: BANK_CONFIG.BOT_BID_SECONDS });
      break;
    case 'debt': clock('debt', 'debt:' + base + ':' + s.debts.length + ':' + s.debts[0].debtor, BANK_CONFIG.DEBT_SECONDS, s.debts[0].debtor); break;
    case 'postRoll': clock('post', 'post:' + base, BANK_CONFIG.POST_MOVE_SECONDS, cur); break;
    default: break;
  }
  if (s.trade) {
    if (bots.indexOf(s.trade.to) >= 0) list.push({ kind: 'bottrade', key: 'bt:' + s.trade.id, seconds: BANK_CONFIG.BOT_TRADE_SECONDS });
    else list.push({ kind: 'trade', key: 'trade:' + s.trade.id, seconds: BANK_CONFIG.TRADE_SECONDS });
  }
  return list;
}

const bank = {
  id: 'bank',
  minPlayers: BANK_CONFIG.MIN_PLAYERS,
  maxPlayers: BANK_CONFIG.MAX_PLAYERS,
  actions: [
    'roll', 'pay_jail', 'use_jail_card', 'buy', 'decline', 'bid', 'end_turn', 'build', 'sell_building',
    'mortgage', 'unmortgage', 'pay_debt', 'declare_bankruptcy', 'trade_offer', 'trade_accept', 'trade_reject', 'trade_cancel',
  ],
  fields: ['type', 'square', 'amount', 'to', 'give', 'get'],
  tokens: BANK_CONFIG.TOKENS,
  bots: true,
  botName: BANK_CONFIG.BOT_NAME,
  create: function (seats, options, extra) { return BANK.createGame(seats, { bots: extra && extra.bots }); },
  act: function (state, seat, action) {
    const r = BANK.act(state, seat, action);
    if (r.state) r.privates = []; // nothing in this game is private
    return r;
  },
  view: function (state, seat) { return BANK.viewFor(state, seat); },
  decorate: function () { /* the client reads names from game_state.roster */ },
  timers: bankTimers,
  timeout: function (s, kind) {
    let r;
    if (kind === 'trade') r = BANK.expireTrade(s);
    else if (kind === 'auction') r = BANK.closeAuction(s);
    else if (kind === 'botbid') r = BANK.botBid(s);
    else if (kind === 'bottrade') { r = BANK.botTrade(s); if (r.error) r = BANK.expireTrade(s); }
    else if (kind === 'bot') { r = BANK.botAct(s); if (r.error) r = BANK.autoPlay(s); }
    else r = BANK.autoPlay(s);
    if (r.state) r.privates = [];
    return r;
  },
  messageFor: function (ev) { return { type: 'event', event: ev }; },
  host: {
    new_game: function (s) {
      if (s.phase !== 'gameOver') return { error: BANK.ERR.wrongStage };
      const g = BANK.createGame(s.playerIds, { bots: s.bots });
      if (g.state) { g.events = []; g.privates = []; }
      return g;
    },
    end_game: function (s) {
      const r = BANK.endGameEarly(s);
      if (r.state) r.privates = [];
      return r;
    },
  },
};

const seven = {
  id: 'seven',
  minPlayers: SEVEN_CONFIG.MIN_PLAYERS,
  maxPlayers: SEVEN_CONFIG.MAX_PLAYERS,
  actions: ['play', 'draw', 'keep', 'play_drawn', 'choose_color'],
  fields: ['type', 'card', 'color'],
  bots: true,
  botName: SEVEN_CONFIG.BOT_NAME,
  checkOptions: function (o) { return o.rounds === undefined || SEVEN_CONFIG.ROUNDS_OPTIONS.indexOf(o.rounds) >= 0 ? null : SEVEN.ERR.badRounds; },
  // the only host option: how many rounds (checked by the engine against ROUNDS_OPTIONS)
  startOptions: function (m) {
    const o = m && m.options && typeof m.options === 'object' ? m.options : {};
    return { rounds: o.rounds };
  },
  create: function (seats, options, extra) { return SEVEN.createGame(seats, { rounds: options && options.rounds, bots: extra && extra.bots }); },
  act: function (state, seat, action) { return SEVEN.act(state, seat, action); },
  view: function (state, seat) { return SEVEN.viewFor(state, seat); },
  // the view already has players[] (id + card count): add names and connection state
  decorate: function (view, roster) {
    view.players = view.players.map(function (vp) {
      const rp = roster.find(function (p) { return p.id === vp.id; });
      vp.name = rp.name;
      vp.connected = rp.connected;
      vp.isHost = rp.isHost;
      vp.bot = rp.bot;
      return vp;
    });
  },
  // one clock per turn; the key changes when the turn passes, not when a drawn card is decided
  timers: function (s, roster) {
    if (s.phase !== 'turn') return [];
    return playerClock(roster, s.bots || [], s.playerIds[s.current], s.round + ':' + s.turnCount, SEVEN_CONFIG);
  },
  timeout: function (s, kind) {
    if (kind === 'bot') { const r = SEVEN.botPlay(s); return r.error ? SEVEN.autoPlay(s) : r; }
    return SEVEN.autoPlay(s);
  },
  messageFor: function (ev) {
    if (ev.type === 'round_end') {
      const r = ev.result;
      return { type: 'round_result', round: r.round, winnerId: r.winnerId, points: r.points, hands: r.hands, totals: r.totals };
    }
    if (ev.type === 'game_over') return { type: 'game_over', totals: ev.totals, winnerIds: ev.winnerIds };
    return { type: 'event', event: ev };
  },
  host: {
    next_round: function (s, seat) { return SEVEN.act(s, seat, { type: 'next_round' }); },
    new_game: function (s) {
      if (s.phase !== 'gameOver') return { error: SEVEN.ERR.wrongStage };
      return SEVEN.createGame(s.playerIds, { rounds: s.rounds, bots: s.bots });
    },
  },
};

const snakes = {
  id: 'snakes',
  minPlayers: SNAKES_CONFIG.MIN_PLAYERS,
  maxPlayers: SNAKES_CONFIG.MAX_PLAYERS,
  actions: ['roll'],
  fields: ['type'], // the die is always rolled by the server
  tokens: SNAKES_CONFIG.COLORS,
  bots: true,
  botName: SNAKES_CONFIG.BOT_NAME,
  startOptions: function (m) {
    const o = m && m.options && typeof m.options === 'object' ? m.options : {};
    return { board: o.board, finish: o.finish, sixAgain: o.sixAgain, startSix: o.startSix };
  },
  checkOptions: function (o) { return SNAKES.readOptions(o) ? null : SNAKES.ERR.badOptions; },
  create: function (seats, options, extra) {
    const o = Object.assign({}, options);
    o.bots = extra && extra.bots;
    return SNAKES.createGame(seats, o);
  },
  act: function (state, seat, action) { return SNAKES.act(state, seat, action); },
  view: function (state, seat) { return SNAKES.viewFor(state, seat); },
  decorate: function (view, roster) {
    view.players = view.players.map(function (vp) {
      const rp = roster.find(function (p) { return p.id === vp.id; });
      vp.name = rp.name;
      vp.connected = rp.connected;
      vp.isHost = rp.isHost;
      vp.token = rp.token;
      return vp;
    });
  },
  // One clock per roll (a six that rolls again restarts it). Computer players and players who are away
  // get a short pause instead; with no human connected at all the game waits for someone to come back.
  timers: function (s, roster) {
    if (s.phase !== 'turn') return [];
    return playerClock(roster, s.bots, s.playerIds[s.current], s.rollCount, SNAKES_CONFIG);
  },
  timeout: function (s) { return SNAKES.autoPlay(s); },
  messageFor: function (ev) { return { type: 'event', event: ev }; },
  host: {
    new_game: function (s) {
      if (s.phase !== 'gameOver') return { error: SNAKES.ERR.wrongStage };
      return SNAKES.createGame(s.playerIds, Object.assign({}, s.options, { bots: s.bots }));
    },
    end_game: function (s) { return SNAKES.endGameEarly(s); },
  },
};

const domino = {
  id: 'domino',
  minPlayers: DOMINO_CONFIG.MIN_PLAYERS,
  maxPlayers: DOMINO_CONFIG.MAX_PLAYERS,
  actions: ['play', 'draw'],
  fields: ['type', 'tile', 'end'],
  bots: true,
  botName: DOMINO_CONFIG.BOT_NAME,
  startOptions: function (m) {
    const o = m && m.options && typeof m.options === 'object' ? m.options : {};
    return { mode: o.mode, target: o.target, teams: o.teams };
  },
  checkOptions: function (o) { return DOMINO.readOptions(o) ? null : DOMINO.ERR.badOptions; },
  create: function (seats, options, extra) {
    const o = Object.assign({}, options);
    o.bots = extra && extra.bots;
    return DOMINO.createGame(seats, o);
  },
  act: function (state, seat, action) { return DOMINO.act(state, seat, action); },
  view: function (state, seat) { return DOMINO.viewFor(state, seat); },
  decorate: function (view, roster) {
    view.players = view.players.map(function (vp) {
      const rp = roster.find(function (p) { return p.id === vp.id; });
      vp.name = rp.name;
      vp.connected = rp.connected;
      vp.isHost = rp.isHost;
      return vp;
    });
  },
  // a clock per move (a draw that brings a playable tile restarts it); after a hand, the next one deals itself
  timers: function (s, roster) {
    if (s.phase === 'turn') return playerClock(roster, s.bots, s.playerIds[s.current], s.moveCount, DOMINO_CONFIG);
    if (s.phase === 'handOver' && (!roster || roster.some(function (p) { return p.connected && !p.bot; }))) {
      return [{ kind: 'next', key: 'next:' + s.hand, seconds: DOMINO_CONFIG.NEXT_HAND_SECONDS }];
    }
    return [];
  },
  timeout: function (s, kind) { return kind === 'next' ? DOMINO.nextHand(s) : DOMINO.autoPlay(s); },
  messageFor: function (ev) { return { type: 'event', event: ev }; },
  host: {
    next_round: function (s) { return DOMINO.nextHand(s); },
    new_game: function (s) {
      if (s.phase !== 'gameOver') return { error: DOMINO.ERR.wrongStage };
      return DOMINO.createGame(s.playerIds, Object.assign({}, s.options, { bots: s.bots }));
    },
    end_game: function (s) { return DOMINO.endGameEarly(s); },
  },
};

const tawla = {
  id: 'tawla',
  minPlayers: TAWLA_CONFIG.MIN_PLAYERS,
  maxPlayers: TAWLA_CONFIG.MAX_PLAYERS,
  actions: ['roll', 'move', 'undo', 'done'],
  fields: ['type', 'from', 'die'], // the dice are always rolled by the server
  bots: true,
  botName: TAWLA_CONFIG.BOT_NAME,
  startOptions: function (m) {
    const o = m && m.options && typeof m.options === 'object' ? m.options : {};
    return { target: o.target };
  },
  checkOptions: function (o) { return TAWLA.readOptions(o) ? null : TAWLA.ERR.badOptions; },
  create: function (seats, options, extra) {
    const o = Object.assign({}, options);
    o.bots = extra && extra.bots;
    return TAWLA.createGame(seats, o);
  },
  act: function (state, seat, action) { return TAWLA.act(state, seat, action); },
  view: function (state, seat) { return TAWLA.viewFor(state, seat); },
  decorate: function (view, roster) {
    view.players = view.players.map(function (vp) {
      const rp = roster.find(function (p) { return p.id === vp.id; });
      vp.name = rp.name;
      vp.connected = rp.connected;
      vp.isHost = rp.isHost;
      return vp;
    });
  },
  // a short clock to roll and a long one to move (steps and undo do not restart it); a pause between games
  timers: function (s, roster) {
    if (s.phase === 'turn') {
      const rolling = s.stage === 'roll';
      const cfg = { BOT_SECONDS: TAWLA_CONFIG.BOT_SECONDS, AWAY_SECONDS: TAWLA_CONFIG.AWAY_SECONDS, TURN_SECONDS: rolling ? TAWLA_CONFIG.ROLL_SECONDS : TAWLA_CONFIG.MOVE_SECONDS };
      return playerClock(roster, s.bots, s.playerIds[s.current], s.game + ':' + s.turnCount + (rolling ? 'r' : 'm'), cfg);
    }
    if (s.phase === 'gameEnd' && (!roster || roster.some(function (p) { return p.connected && !p.bot; }))) {
      return [{ kind: 'next', key: 'next:' + s.game, seconds: TAWLA_CONFIG.NEXT_GAME_SECONDS }];
    }
    return [];
  },
  timeout: function (s, kind) { return kind === 'next' ? TAWLA.nextGame(s) : TAWLA.autoPlay(s); },
  messageFor: function (ev) { return { type: 'event', event: ev }; },
  host: {
    next_round: function (s) { return TAWLA.nextGame(s); },
    new_game: function (s) {
      if (s.phase !== 'matchOver') return { error: TAWLA.ERR.wrongStage };
      return TAWLA.createGame(s.playerIds, Object.assign({}, s.options, { bots: s.bots }));
    },
    end_game: function (s) { return TAWLA.endGameEarly(s); },
  },
};

const lagta = {
  id: 'lagta',
  minPlayers: LAGTA_CONFIG.MIN_PLAYERS,
  maxPlayers: LAGTA_CONFIG.MAX_PLAYERS,
  actions: ['claim'],
  fields: ['type', 'symbol'],
  bots: true,
  botName: LAGTA_CONFIG.BOT_NAME,
  startOptions: function (m) {
    const o = m && m.options && typeof m.options === 'object' ? m.options : {};
    return { size: o.size, level: o.level, hint: o.hint };
  },
  checkOptions: function (o) { return LAGTA.readOptions(o) ? null : LAGTA.ERR.badOptions; },
  create: function (seats, options, extra) {
    const o = Object.assign({}, options);
    o.bots = extra && extra.bots;
    return LAGTA.createGame(seats, o);
  },
  // a race: the server's clock stamps each claim (a wrong one freezes the player for a moment)
  act: function (state, seat, action) { action.at = Date.now(); return LAGTA.act(state, seat, action); },
  view: function (state, seat) { return LAGTA.viewFor(state, seat); },
  decorate: function (view, roster) {
    view.players = view.players.map(function (vp) {
      const rp = roster.find(function (p) { return p.id === vp.id; });
      vp.name = rp.name;
      vp.connected = rp.connected;
      vp.isHost = rp.isHost;
      return vp;
    });
  },
  // the countdown, the pause after a win, one clock per computer player, and a safety for a card nobody finds
  timers: function (s, roster) {
    if (roster && !roster.some(function (p) { return p.connected && !p.bot; })) return [];
    if (s.phase === 'countdown') return [{ kind: 'next', key: 'go', seconds: LAGTA_CONFIG.COUNTDOWN_SECONDS }];
    if (s.phase === 'between') return [{ kind: 'next', key: 'b' + s.seq, seconds: LAGTA_CONFIG.BETWEEN_SECONDS }];
    if (s.phase !== 'play') return [];
    const list = s.bots.map(function (id) { return { kind: 'bot:' + id, key: 'p' + s.seq, seconds: s.botDelay[id] }; });
    list.push({ kind: 'stuck', key: 's' + s.seq, seconds: LAGTA_CONFIG.STUCK_SECONDS });
    return list;
  },
  timeout: function (s, kind) {
    if (kind === 'next') return LAGTA.next(s);
    if (kind === 'stuck') return LAGTA.skip(s);
    return LAGTA.botClaim(s, kind.slice(4));
  },
  messageFor: function (ev) { return { type: 'event', event: ev }; },
  host: {
    new_game: function (s) {
      if (s.phase !== 'gameOver') return { error: LAGTA.ERR.wrongStage };
      return LAGTA.createGame(s.playerIds, Object.assign({}, s.options, { bots: s.bots }));
    },
    end_game: function (s) { return LAGTA.endGameEarly(s); },
  },
};

const minhu = {
  id: 'minhu',
  minPlayers: MINHU_CONFIG.MIN_PLAYERS,
  maxPlayers: MINHU_CONFIG.MAX_PLAYERS,
  actions: ['pick', 'ask', 'ask_free', 'answer', 'chat', 'flip', 'end_turn', 'guess'],
  fields: ['type', 'q', 'ids', 'char', 'random', 'text', 'voice', 'yes'],
  voice: true, // the two players may open a voice call (rooms.js relays the call setup)
  bots: true,
  botName: MINHU_CONFIG.BOT_NAME,
  startOptions: function (m) {
    const o = m && m.options && typeof m.options === 'object' ? m.options : {};
    return { target: o.target, level: o.level, set: o.set, pick: o.pick };
  },
  checkOptions: function (o) { return MINHU.readOptions(o) ? null : MINHU.ERR.badOptions; },
  create: function (seats, options, extra) {
    const o = Object.assign({}, options);
    o.bots = extra && extra.bots;
    // two people ask each other freely; against the computer the questions come from the list
    o.ask = o.bots && o.bots.length ? 'list' : 'free';
    return MINHU.createGame(seats, o);
  },
  act: function (state, seat, action) { return MINHU.act(state, seat, action); },
  view: function (state, seat) { return MINHU.viewFor(state, seat); },
  decorate: function (view, roster) {
    view.players = view.players.map(function (vp) {
      const rp = roster.find(function (p) { return p.id === vp.id; });
      vp.name = rp.name;
      vp.connected = rp.connected;
      vp.isHost = rp.isHost;
      return vp;
    });
  },
  // one clock per turn (asking, then flipping, share it); the next round deals itself
  timers: function (s, roster) {
    if (s.phase === 'pick') {
      if (roster && !roster.some(function (p) { return p.connected && !p.bot; })) return [];
      return [{ kind: 'pick', key: 'pick:' + s.round, seconds: MINHU_CONFIG.PICK_SECONDS }];
    }
    if (s.phase === 'turn' && s.stage === 'answer') {
      // the clock is the answerer's now
      const answerer = s.playerIds[1 - s.current];
      return playerClock(roster, s.bots, answerer, s.round + ':' + s.turnCount + 'a', { BOT_SECONDS: MINHU_CONFIG.BOT_SECONDS, AWAY_SECONDS: MINHU_CONFIG.AWAY_SECONDS, TURN_SECONDS: MINHU_CONFIG.ANSWER_SECONDS });
    }
    if (s.phase === 'turn') return playerClock(roster, s.bots, s.playerIds[s.current], s.round + ':' + s.turnCount + (s.bots.indexOf(s.playerIds[s.current]) >= 0 ? s.stage : ''), MINHU_CONFIG);
    if (s.phase === 'roundOver' && (!roster || roster.some(function (p) { return p.connected && !p.bot; }))) {
      return [{ kind: 'next', key: 'next:' + s.round, seconds: MINHU_CONFIG.NEXT_ROUND_SECONDS }];
    }
    return [];
  },
  timeout: function (s, kind) { return kind === 'next' ? MINHU.nextRound(s) : kind === 'pick' ? MINHU.autoPick(s) : MINHU.autoPlay(s); },
  messageFor: function (ev) { return { type: 'event', event: ev }; },
  host: {
    next_round: function (s) { return MINHU.nextRound(s); },
    new_game: function (s) {
      if (s.phase !== 'matchOver') return { error: MINHU.ERR.wrongStage };
      return MINHU.createGame(s.playerIds, Object.assign({}, s.options, { bots: s.bots }));
    },
    end_game: function (s) { return MINHU.endGameEarly(s); },
  },
};

module.exports = { screw: screw, bank: bank, seven: seven, snakes: snakes, domino: domino, tawla: tawla, lagta: lagta, minhu: minhu };
