// Dominoes (دومنو) settings. Every number the rules depend on lives here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DominoConfig = factory();
})(this, function () {
  return {
    MIN_PLAYERS: 2, // computer players count
    MAX_PLAYERS: 4,
    MAX_PIP: 6, // a double-six set: 28 tiles
    HAND_SIZE: 7,

    // host options
    MODES: ['draw', 'block'],
    MODE_NAMES: { draw: 'سحب', block: 'بلوك' },
    MODE_NOTES: { draw: 'ما عندك؟ اسحب من الكومة', block: 'ما عندك؟ تمرّر، بلا سحب' },
    DEFAULT_MODE: 'draw',
    TARGETS: [51, 101, 151], // first side to reach this many points wins the game
    DEFAULT_TARGET: 101,
    DEFAULT_TEAMS: false, // partners sitting across; only with exactly 4 players

    // timers (used by the server layer; the engine itself never waits)
    TURN_SECONDS: 25,
    BOT_SECONDS: 1.6, // a computer player's pause before it plays
    AWAY_SECONDS: 5, // a disconnected player's move comes this fast
    NEXT_HAND_SECONDS: 20, // the next hand starts by itself after the result
    BOT_NAME: 'كمبيوتر',
  };
});
