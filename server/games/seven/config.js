// "Seven & Seven" settings. Every number the rules depend on lives here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SevenConfig = factory();
})(this, function () {
  return {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 6,
    HAND_SIZE: 7,
    COLORS: ['red', 'yellow', 'green', 'blue'],
    ROUNDS_OPTIONS: [3, 5], // what the host may choose
    DEFAULT_ROUNDS: 3,
    DRAW2_COUNT: 2,
    DRAW4_COUNT: 4,
    // deck: per colour 1 zero, 2 of each 1-9, 2 of each action; plus the wilds
    ZERO_PER_COLOR: 1,
    NUMBER_COPIES: 2,
    ACTION_COPIES: { skip: 2, reverse: 2, draw2: 2 },
    WILD: 4,
    WILD4: 4,
    // points the round winner collects for each card left in an opponent's hand
    POINTS: { skip: 20, reverse: 20, draw2: 20, wild: 50, wild4: 50 },
    // timers (used by the server layer; the engine itself never waits)
    TURN_SECONDS: 30,
  };
});
