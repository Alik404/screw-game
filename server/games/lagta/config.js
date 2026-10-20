// "Lagta!" (لقطة) settings: a spot-the-match card game. Every number the rules depend on lives here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LagtaConfig = factory();
})(this, function () {
  return {
    MIN_PLAYERS: 2, // computer players count
    MAX_PLAYERS: 8,
    ORDER: 7, // a projective plane of order 7: 57 cards, 8 symbols each, any two share exactly one
    // 57 symbols (emoji that need no variation selector, so they look the same everywhere)
    SYMBOLS: [
      '🍎', '🍋', '🍉', '🍇', '🍒', '🥕', '🍄', '🌵', '🌴', '🌻', '🌙', '🌈', '⭐', '🔥', '💧', '⚡',
      '🐪', '🐟', '🐢', '🦋', '🐝', '🦉', '🐸', '🐱', '🐶', '🦁', '🐘', '🦒', '🐧', '🦀', '🐌', '🦊',
      '☕', '🎈', '🎁', '🔑', '🔔', '⚓', '👑', '💎', '🎸', '🥁', '⚽', '🏀', '🚗', '🚀', '⛵', '🚲',
      '⏰', '💡', '🎩', '👓', '🍦', '🍩', '🍍', '🎨', '🧲',
    ],
    SIZES: [20, 30, 50], // cards in the middle pile
    SIZE_NAMES: { 20: 'سريعة', 30: 'عادية', 50: 'طويلة' },
    DEFAULT_SIZE: 30,
    LEVELS: ['easy', 'normal', 'hard'], // how fast the computer players spot the match
    LEVEL_NAMES: { easy: 'سهل', normal: 'عادي', hard: 'صعب' },
    DEFAULT_LEVEL: 'normal',
    BOT_DELAYS: { easy: [4.5, 8], normal: [2.6, 5], hard: [1.3, 2.6] }, // seconds, random within the range

    FREEZE_MS: 2000, // a wrong tap freezes you this long
    HINT_SECONDS: 12, // with hints on, the shared symbol starts to glow when nobody found it this long
    DEFAULT_HINT: true,
    COUNTDOWN_SECONDS: 3, // 3, 2, 1 before the first card
    BETWEEN_SECONDS: 1.4, // the won card flies to its winner before the next one shows
    STUCK_SECONDS: 45, // nobody found it: the card is put aside
    BOT_NAME: 'كمبيوتر',
  };
});
