// "Minhu?" (منو هو؟) settings: guess the other player's secret character with yes/no questions.
// The characters and the questions are data, so the server answers every question itself (no cheating,
// and a computer player can play), and the browser can draw the same faces from the same table.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MinhuConfig = factory();
})(this, function () {
  // g: m/f · skin: light/medium/dark · hair: short/long/curly/bald/bun/ponytail/hidden · color: hair colour (null if hidden or bald)
  // hat: none/cap/beret/shemagh/hijab · glasses, beard, mustache, earrings, smile, old · shirt / bg: colour numbers for the art
  const P = function (name, g, skin, hair, color, hat, glasses, beard, mustache, earrings, smile, old, shirt, bg) {
    return { name: name, g: g, skin: skin, hair: hair, color: color, hat: hat, glasses: glasses, beard: beard, mustache: mustache, earrings: earrings, smile: smile, old: old, shirt: shirt, bg: bg };
  };
  const CHARACTERS = [
    P('علي', 'm', 'medium', 'short', 'black', 'none', false, true, true, false, true, false, 1, 1),
    P('حسن', 'm', 'light', 'short', 'brown', 'none', true, false, false, false, false, false, 2, 2),
    P('عباس', 'm', 'dark', 'bald', null, 'none', false, true, true, false, true, true, 3, 3),
    P('كريم', 'm', 'medium', 'curly', 'black', 'cap', false, false, false, false, true, false, 4, 4),
    P('مصطفى', 'm', 'light', 'short', 'blond', 'none', true, false, true, false, false, false, 5, 5),
    P('حيدر', 'm', 'medium', 'hidden', null, 'shemagh', false, true, true, false, false, false, 6, 6),
    P('جاسم', 'm', 'medium', 'hidden', null, 'shemagh', true, false, true, false, true, true, 7, 1),
    P('سامي', 'm', 'dark', 'curly', 'black', 'none', false, false, false, false, false, false, 8, 2),
    P('يوسف', 'm', 'light', 'short', 'red', 'beret', false, false, false, false, true, false, 1, 3),
    P('نزار', 'm', 'light', 'short', 'gray', 'none', true, true, true, false, false, true, 2, 4),
    P('مهدي', 'm', 'dark', 'short', 'black', 'cap', true, true, false, false, false, false, 3, 5),
    P('رعد', 'm', 'medium', 'long', 'brown', 'none', false, true, true, false, true, false, 4, 6),
    P('زينب', 'f', 'medium', 'hidden', null, 'hijab', false, false, false, false, true, false, 5, 1),
    P('مريم', 'f', 'light', 'long', 'black', 'none', true, false, false, true, true, false, 6, 2),
    P('نور', 'f', 'light', 'long', 'blond', 'none', false, false, false, true, false, false, 7, 3),
    P('سارة', 'f', 'dark', 'curly', 'black', 'none', false, false, false, true, true, false, 8, 4),
    P('فاطمة', 'f', 'light', 'hidden', null, 'hijab', true, false, false, false, false, false, 1, 5),
    P('رنا', 'f', 'medium', 'bun', 'brown', 'none', false, false, false, true, false, false, 2, 6),
    P('هدى', 'f', 'medium', 'hidden', null, 'hijab', false, false, false, false, false, true, 3, 1),
    P('ليلى', 'f', 'light', 'ponytail', 'red', 'cap', false, false, false, false, true, false, 4, 2),
    P('دعاء', 'f', 'dark', 'hidden', null, 'hijab', true, false, false, false, true, false, 5, 3),
    P('سعاد', 'f', 'light', 'bun', 'gray', 'none', true, false, false, true, true, true, 6, 4),
    P('شهد', 'f', 'medium', 'ponytail', 'brown', 'none', true, false, false, false, true, false, 7, 5),
    P('تبارك', 'f', 'light', 'short', 'black', 'beret', false, false, false, true, false, false, 8, 6),
  ];

  // each question: what it asks about (one attribute equal to one value, or one of several values)
  const QUESTIONS = [
    { id: 'male', text: 'رجّال؟', group: 'عام', attr: 'g', is: ['m'] },
    { id: 'old', text: 'كبير بالعمر؟', group: 'عام', attr: 'old', is: [true] },
    { id: 'smile', text: 'يضحك؟', group: 'عام', attr: 'smile', is: [true] },
    { id: 'light', text: 'بشرته بيضاء؟', group: 'عام', attr: 'skin', is: ['light'] },
    { id: 'dark', text: 'بشرته سمراء؟', group: 'عام', attr: 'skin', is: ['dark'] },
    { id: 'bald', text: 'أصلع؟', group: 'الشعر', attr: 'hair', is: ['bald'] },
    { id: 'black', text: 'شعره أسود؟', group: 'الشعر', attr: 'color', is: ['black'] },
    { id: 'brown', text: 'شعره بني؟', group: 'الشعر', attr: 'color', is: ['brown'] },
    { id: 'blond', text: 'شعره أشقر؟', group: 'الشعر', attr: 'color', is: ['blond'] },
    { id: 'red', text: 'شعره أحمر؟', group: 'الشعر', attr: 'color', is: ['red'] },
    { id: 'gray', text: 'شعره أبيض؟', group: 'الشعر', attr: 'color', is: ['gray'] },
    { id: 'long', text: 'شعره طويل؟', group: 'الشعر', attr: 'hair', is: ['long'] },
    { id: 'curly', text: 'شعره مجعّد؟', group: 'الشعر', attr: 'hair', is: ['curly'] },
    { id: 'tied', text: 'شعره مربوط؟', group: 'الشعر', attr: 'hair', is: ['bun', 'ponytail'] },
    { id: 'beard', text: 'عنده لحية؟', group: 'الوجه', attr: 'beard', is: [true] },
    { id: 'mustache', text: 'عنده شوارب؟', group: 'الوجه', attr: 'mustache', is: [true] },
    { id: 'glasses', text: 'لابس نظارات؟', group: 'الوجه', attr: 'glasses', is: [true] },
    { id: 'earrings', text: 'لابس تراچي؟', group: 'الوجه', attr: 'earrings', is: [true] },
    { id: 'cap', text: 'لابس كاب أو بيريه؟', group: 'الراس', attr: 'hat', is: ['cap', 'beret'] },
    { id: 'shemagh', text: 'لابس يشماغ؟', group: 'الراس', attr: 'hat', is: ['shemagh'] },
    { id: 'hijab', text: 'محجّبة؟', group: 'الراس', attr: 'hat', is: ['hijab'] },
    { id: 'nohat', text: 'راسه مكشوف؟', group: 'الراس', attr: 'hat', is: ['none'] },
  ];

  return {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 2,
    CHARACTERS: CHARACTERS,
    QUESTIONS: QUESTIONS,
    TARGETS: [1, 2, 3], // rounds needed to win the match
    DEFAULT_TARGET: 2,
    LEVELS: ['easy', 'smart'],
    LEVEL_NAMES: { easy: 'سهل', smart: 'ذكي' },
    DEFAULT_LEVEL: 'smart',
    TURN_SECONDS: 60,
    BOT_SECONDS: 2,
    AWAY_SECONDS: 6,
    NEXT_ROUND_SECONDS: 10,
    BOT_NAME: 'كمبيوتر',
  };
});
