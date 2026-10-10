// Game adapters: everything rooms.js needs to know about a game, behind one interface.
//   create(seats) / act(state, seat, action) / view(state, seat) -> pure engine calls
//   timers(state) -> [{kind, key, seconds}]   what countdowns should be running right now
//   timeout(state, kind) -> result            what the server does when one runs out
//   messageFor(event) -> message to broadcast for an engine event
//   host: optional host-only actions (next_round, new_game, end_game)
const SCREW_CONFIG = require('../config');
const SCREW = require('../engine');
const BANK_CONFIG = require('./bank/config');
const BANK = require('./bank/engine');
const SEVEN_CONFIG = require('./seven/config');
const SEVEN = require('./seven/engine');

const screw = {
  id: 'screw',
  minPlayers: SCREW_CONFIG.MIN_PLAYERS,
  maxPlayers: SCREW_CONFIG.MAX_PLAYERS,
  actions: ['ready', 'draw', 'swap_drawn', 'discard_drawn', 'take_discard', 'match', 'use_ability', 'skip_ability', 'call_screw'],
  // the only fields copied from a client message into an engine action
  fields: ['type', 'slot', 'targetPlayerId', 'targetSlot', 'mode', 'slots', 'picks'],
  create: function (seats) { return SCREW.createGame(seats); },
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
  timers: function (s) {
    if (s.phase === 'peek') return [{ kind: 'peek', key: 'peek:' + s.round, seconds: SCREW_CONFIG.INITIAL_PEEK_SECONDS }];
    if (s.phase === 'turn') return [{ kind: 'turn', key: 'turn:' + s.round + ':' + s.turnCount, seconds: SCREW_CONFIG.TURN_SECONDS }];
    return [];
  },
  timeout: function (s, kind) { return kind === 'peek' ? SCREW.forceStartPlay(s) : SCREW.autoPlay(s); },
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
// decision changes) plus an independent one for an open trade offer
function bankTimers(s) {
  if (s.phase !== 'turn') return [];
  const base = s.turnCount + ':' + s.doublesInRow;
  const list = [];
  switch (s.stage) {
    case 'roll': list.push({ kind: 'turn', key: 'roll:' + base, seconds: BANK_CONFIG.TURN_SECONDS }); break;
    case 'buy': list.push({ kind: 'buy', key: 'buy:' + base, seconds: BANK_CONFIG.BUY_SECONDS }); break;
    case 'auction': list.push({ kind: 'auction', key: 'auction:' + base + ':' + s.auction.seq, seconds: BANK_CONFIG.AUCTION_SECONDS }); break;
    case 'debt': list.push({ kind: 'debt', key: 'debt:' + base + ':' + s.debts.length + ':' + s.debts[0].debtor, seconds: BANK_CONFIG.DEBT_SECONDS }); break;
    case 'postRoll': list.push({ kind: 'post', key: 'post:' + base, seconds: BANK_CONFIG.POST_MOVE_SECONDS }); break;
    default: break;
  }
  if (s.trade) list.push({ kind: 'trade', key: 'trade:' + s.trade.id, seconds: BANK_CONFIG.TRADE_SECONDS });
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
  create: function (seats) { return BANK.createGame(seats); },
  act: function (state, seat, action) {
    const r = BANK.act(state, seat, action);
    if (r.state) r.privates = []; // nothing in this game is private
    return r;
  },
  view: function (state, seat) { return BANK.viewFor(state, seat); },
  decorate: function () { /* the client reads names from game_state.roster */ },
  timers: bankTimers,
  timeout: function (s, kind) {
    const r = kind === 'trade' ? BANK.expireTrade(s) : kind === 'auction' ? BANK.closeAuction(s) : BANK.autoPlay(s);
    if (r.state) r.privates = [];
    return r;
  },
  messageFor: function (ev) { return { type: 'event', event: ev }; },
  host: {
    new_game: function (s) {
      if (s.phase !== 'gameOver') return { error: BANK.ERR.wrongStage };
      const g = BANK.createGame(s.playerIds);
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
  // the only host option: how many rounds (checked by the engine against ROUNDS_OPTIONS)
  startOptions: function (m) {
    const o = m && m.options && typeof m.options === 'object' ? m.options : {};
    return { rounds: o.rounds };
  },
  create: function (seats, options) { return SEVEN.createGame(seats, { rounds: options && options.rounds }); },
  act: function (state, seat, action) { return SEVEN.act(state, seat, action); },
  view: function (state, seat) { return SEVEN.viewFor(state, seat); },
  // the view already has players[] (id + card count): add names and connection state
  decorate: function (view, roster) {
    view.players = view.players.map(function (vp) {
      const rp = roster.find(function (p) { return p.id === vp.id; });
      vp.name = rp.name;
      vp.connected = rp.connected;
      vp.isHost = rp.isHost;
      return vp;
    });
  },
  // one clock per turn; the key changes when the turn passes, not when a drawn card is decided
  timers: function (s) {
    if (s.phase !== 'turn') return [];
    return [{ kind: 'turn', key: 'turn:' + s.round + ':' + s.turnCount, seconds: SEVEN_CONFIG.TURN_SECONDS }];
  },
  timeout: function (s) { return SEVEN.autoPlay(s); },
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
      return SEVEN.createGame(s.playerIds, { rounds: s.rounds });
    },
  },
};

module.exports = { screw: screw, bank: bank, seven: seven };
