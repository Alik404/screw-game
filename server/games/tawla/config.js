// Tawla (طاولي, backgammon) settings. Every number the rules depend on lives here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TawlaConfig = factory();
})(this, function () {
  return {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 2,
    CHECKERS: 15,
    // the starting position, from each player's own side: point -> checkers (24 is the far end)
    START: { 24: 2, 13: 5, 8: 3, 6: 5 },

    // host options: a match is played to this many points
    TARGETS: [1, 3, 5, 7],
    DEFAULT_TARGET: 3,
    // a win is 1 point; "مارس" (gammon: the loser bore off nothing) 2; "مارس مضاعف" (and still has a
    // checker on the bar or in the winner's home) 3
    POINTS: { single: 1, gammon: 2, backgammon: 3 },
    KIND_NAMES: { single: 'فوز', gammon: 'مارس', backgammon: 'مارس مضاعف' },

    // timers (used by the server layer; the engine itself never waits)
    ROLL_SECONDS: 15,
    MOVE_SECONDS: 60,
    BOT_SECONDS: 1.3,
    AWAY_SECONDS: 5,
    NEXT_GAME_SECONDS: 12,
    BOT_NAME: 'كمبيوتر',
  };
});
