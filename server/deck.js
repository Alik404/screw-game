// Card definitions, deck building and shuffling. Pure, no I/O.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'));
  else root.ScrewDeck = factory(root.ScrewConfig);
})(this, function (CONFIG) {
  // Special (non-number) card types: point value, ability, Arabic name.
  const SPECIALS = {
    swap: { value: 10, ability: 'swap', name: 'خد وهات' },
    peekall: { value: 10, ability: 'peek_all', name: 'كعب داير' },
    basra: { value: 10, ability: 'throw', name: 'بصرة' },
    plus20: { value: 20, ability: null, name: '+20' },
    screw_red: { value: 25, ability: null, name: 'سكرو أحمر' },
    screw_green: { value: 0, ability: null, name: 'سكرو أخضر' },
    minus1: { value: -1, ability: null, name: '-1' },
  };

  // Suits are cosmetic only: they never affect value, abilities or matching.
  const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];

  function makeCard(type, rank, suit) {
    if (type === 'num') return { type: 'num', rank: rank, suit: suit || SUITS[0], value: rank };
    if (!SPECIALS[type]) throw new Error('unknown card type: ' + type);
    return { type: type, value: SPECIALS[type].value };
  }

  // Cards match when they are the same number, or the same special type.
  function kindOf(card) {
    return card.type === 'num' ? 'num' + card.rank : card.type;
  }

  // Ability granted when this card is drawn and thrown straight to the floor.
  function abilityOf(card) {
    if (card.type === 'num') {
      if (card.rank === 7 || card.rank === 8) return 'peek_own';
      if (card.rank === 9 || card.rank === 10) return 'peek_other';
      return null;
    }
    return SPECIALS[card.type].ability;
  }

  function describe(card) {
    if (!card || card.hidden) return '؟';
    if (card.type === 'num') return String(card.rank);
    // +20 and -1 are wrapped in left-to-right marks so they are not flipped inside Arabic text
    if (card.type === 'plus20' || card.type === 'minus1') return '‎' + SPECIALS[card.type].name + '‎';
    return SPECIALS[card.type].name;
  }

  function buildDeck(deckConfig) {
    const cfg = deckConfig || CONFIG.DECK;
    const cards = [];
    Object.keys(cfg.num).forEach(function (rank) {
      // one card of each suit per rank (cycles if a rank is configured with more than 4)
      for (let i = 0; i < cfg.num[rank]; i++) cards.push(makeCard('num', Number(rank), SUITS[i % SUITS.length]));
    });
    Object.keys(SPECIALS).forEach(function (type) {
      for (let i = 0; i < (cfg[type] || 0); i++) cards.push(makeCard(type));
    });
    return cards;
  }

  // Fisher-Yates in place. `rand` returns a float in [0, 1).
  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  return { SPECIALS, SUITS, makeCard, kindOf, abilityOf, describe, buildDeck, shuffle };
});
