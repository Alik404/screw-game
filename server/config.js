// All tunable game settings live here. No magic numbers elsewhere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScrewConfig = factory();
})(this, function () {
  return {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 6,
    CARDS_PER_PLAYER: 4,
    INITIAL_PEEK_COUNT: 2, // the two right-most cards (slots 0 and 1)
    INITIAL_PEEK_SECONDS: 10,
    PEEK_SECONDS: 5,
    TURN_SECONDS: 45,
    BOT_SECONDS: 1.8, // a computer player's pause before it plays
    AWAY_SECONDS: 6, // a disconnected player's turn comes this fast
    BOT_NAME: 'كمبيوتر',
    ROUNDS: 5,
    LAST_ROUND_MULTIPLIER: 2,
    FAILED_SCREW_MULTIPLIER: 2,
    SCREW_ALLOWED_FROM_LAP: 4,
    WRONG_MATCH_PENALTY_CARDS: 1,
    PEEK_ALL_SELF_COUNT: 2, // kaab dayer, option A: how many own cards to see
    ROOM_CODE_LENGTH: 4,
    ROOM_CODE_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ', // no I, L, O (look-alikes)
    ROOM_IDLE_MINUTES: 30, // delete a room this long after its last player disconnects
    LOBBY_GRACE_SECONDS: 60, // a disconnected lobby player is removed after this long
    NAME_MAX_LENGTH: 16,
    MAX_MESSAGE_BYTES: 8192, // big enough for a voice call offer (about 3-5 KB)
    HEARTBEAT_SECONDS: 25,
    MAX_ROOMS: 200, // protection: rooms kept in memory at once
    RATE_LIMIT_MESSAGES: 40, // protection: messages one connection may send ...
    RATE_LIMIT_WINDOW_SECONDS: 10, // ... in this window
    JOIN_LOOKUPS_PER_MINUTE: 30, // protection: "I have a code" lookups one address may make a minute
    REACTIONS: ['laugh', 'wow', 'angry', 'cry', 'clap', 'pray', 'fire', 'snake'], // quick emoji anyone can send
    REACTION_COOLDOWN_MS: 800,
    DECK: {
      num: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4, 10: 4 },
      swap: 4, // خد وهات
      peekall: 2, // كعب داير
      basra: 2, // بصرة
      plus20: 4,
      screw_red: 2,
      screw_green: 2,
      minus1: 2,
    },
  };
});
