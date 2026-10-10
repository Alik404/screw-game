// Card definitions, deck building and Arabic names. Pure, no I/O.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'));
  else root.SevenDeck = factory(root.SevenConfig);
})(this, function (CONFIG) {
  const COLOR_NAMES = { red: 'أحمر', yellow: 'أصفر', green: 'أخضر', blue: 'أزرق' };
  const TYPE_NAMES = { skip: 'منع', reverse: 'عكس', draw2: '+2', wild: 'لون', wild4: '+4 لون' };

  // number cards carry a rank; actions and wilds carry only a type
  function makeCard(type, color, rank) {
    const c = { type: type };
    if (color) c.color = color;
    if (type === 'num') {
      c.rank = rank;
      c.value = rank;
    } else {
      c.value = CONFIG.POINTS[type];
    }
    return c;
  }

  function isWild(card) {
    return card.type === 'wild' || card.type === 'wild4';
  }

  function buildDeck() {
    const cards = [];
    CONFIG.COLORS.forEach(function (color) {
      for (let i = 0; i < CONFIG.ZERO_PER_COLOR; i++) cards.push(makeCard('num', color, 0));
      for (let rank = 1; rank <= 9; rank++) {
        for (let i = 0; i < CONFIG.NUMBER_COPIES; i++) cards.push(makeCard('num', color, rank));
      }
      Object.keys(CONFIG.ACTION_COPIES).forEach(function (type) {
        for (let i = 0; i < CONFIG.ACTION_COPIES[type]; i++) cards.push(makeCard(type, color));
      });
    });
    for (let i = 0; i < CONFIG.WILD; i++) cards.push(makeCard('wild'));
    for (let i = 0; i < CONFIG.WILD4; i++) cards.push(makeCard('wild4'));
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

  // "5 أحمر", "منع أزرق", "لون"...  (+2 is wrapped in direction marks so it is not flipped in Arabic text)
  function describe(card) {
    if (!card) return '؟';
    const name = card.type === 'num' ? String(card.rank) : TYPE_NAMES[card.type];
    const text = card.type === 'draw2' ? '‎' + name + '‎' : name;
    return card.color ? text + ' ' + COLOR_NAMES[card.color] : text;
  }

  return { COLOR_NAMES, TYPE_NAMES, makeCard, isWild, buildDeck, shuffle, describe };
});
