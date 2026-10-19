// "Snakes & Ladders" (حية ودرج) settings and boards. Every number the rules depend on lives here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnakesConfig = factory();
})(this, function () {
  return {
    MIN_PLAYERS: 2, // computer players count
    MAX_PLAYERS: 6,
    SQUARES: 100,
    DIE_SIDES: 6,
    // piece colours a player can pick in the lobby (each one once per room); CSS maps them to --p1..--p6
    COLORS: ['red', 'blue', 'green', 'yellow', 'purple', 'pink'],
    COLOR_NAMES: { red: 'أحمر', blue: 'أزرق', green: 'أخضر', yellow: 'أصفر', purple: 'بنفسجي', pink: 'وردي' },

    // boards: snakes {head: tail}, ladders {bottom: top}. No end square is the start of another jump.
    BOARDS: {
      classic: {
        name: 'كلاسيكية',
        ladders: { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 },
        snakes: { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 },
      },
      wild: {
        name: 'مجنونة',
        ladders: { 3: 22, 8: 30, 20: 41, 27: 56, 39: 60, 50: 91, 54: 73, 63: 81, 72: 94 },
        snakes: { 17: 4, 34: 12, 46: 15, 59: 40, 66: 45, 76: 37, 83: 57, 89: 51, 92: 70, 97: 61, 99: 7 },
      },
      kids: {
        name: 'للصغار',
        ladders: { 2: 23, 7: 29, 15: 44, 22: 42, 33: 52, 46: 66, 57: 77, 68: 88, 74: 93 },
        snakes: { 26: 10, 49: 31, 62: 43, 85: 64, 96: 82 },
      },
    },
    BOARD_OPTIONS: ['classic', 'wild', 'kids'],
    DEFAULT_BOARD: 'classic',

    // what happens when a roll goes past the last square
    FINISH_OPTIONS: ['bounce', 'exact', 'over'],
    FINISH_NAMES: { bounce: 'ترتد للوراء', exact: 'بالضبط', over: 'أي رمية توصل' },
    DEFAULT_FINISH: 'bounce',

    DEFAULT_SIX_AGAIN: true, // a six gives another roll ...
    MAX_SIXES: 3, // ... but the third six in a row sends you back to where the turn began
    DEFAULT_START_SIX: false, // when on: a piece needs a six to enter the board

    // timers (used by the server layer; the engine itself never waits)
    TURN_SECONDS: 20,
    BOT_SECONDS: 3, // a computer player rolls after this pause (long enough for the last move to animate)
    AWAY_SECONDS: 5, // a disconnected player's roll comes this fast (the game pauses if nobody is connected)
    BOT_NAME: 'كمبيوتر',
  };
});
