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

  // ---------- the animals: well-known animals, asked about facts (not about how a drawing looks) ----------
  const A = function (name, emoji, f, bg) {
    const o = { name: name, emoji: emoji, bg: bg, c: f.c || null };
    ['fur', 'legs4', 'feathers', 'flies', 'water', 'predator', 'big', 'pet', 'farm', 'horns', 'stripes', 'spots', 'desert', 'eggs', 'jumps', 'guard'].forEach(function (k) { o[k] = !!f[k]; });
    return o;
  };
  const ANIMALS = [
    A('كلب', '🐶', { fur: 1, legs4: 1, pet: 1, guard: 1 }, 1),
    A('قطة', '🐱', { fur: 1, legs4: 1, pet: 1 }, 2),
    A('أرنب', '🐰', { fur: 1, legs4: 1, pet: 1, jumps: 1 }, 3),
    A('ماعز', '🐐', { fur: 1, legs4: 1, farm: 1, horns: 1 }, 4),
    A('ثعلب', '🦊', { fur: 1, legs4: 1, predator: 1, c: 'yellow' }, 5),
    A('دب', '🐻', { fur: 1, legs4: 1, predator: 1, big: 1, c: 'brown' }, 6),
    A('أسد', '🦁', { fur: 1, legs4: 1, predator: 1, big: 1, c: 'yellow' }, 1),
    A('نمر', '🐯', { fur: 1, legs4: 1, predator: 1, big: 1, stripes: 1, c: 'yellow' }, 2),
    A('حمار وحشي', '🦓', { fur: 1, legs4: 1, big: 1, stripes: 1, c: 'bw' }, 3),
    A('حصان', '🐴', { fur: 1, legs4: 1, big: 1, farm: 1, c: 'brown' }, 4),
    A('خروف', '🐑', { fur: 1, legs4: 1, farm: 1 }, 5),
    A('زرافة', '🦒', { fur: 1, legs4: 1, big: 1, spots: 1, c: 'yellow' }, 6),
    A('قرد', '🐵', { fur: 1, jumps: 1, c: 'brown' }, 1),
    A('جمل', '🐪', { fur: 1, legs4: 1, big: 1, desert: 1, c: 'brown' }, 2),
    A('فيل', '🐘', { legs4: 1, big: 1, c: 'gray' }, 3),
    A('دولفين', '🐬', { water: 1, big: 1, c: 'gray' }, 4),
    A('دجاجة', '🐔', { feathers: 1, farm: 1, eggs: 1 }, 5),
    A('بطريق', '🐧', { feathers: 1, water: 1, eggs: 1, c: 'bw' }, 6),
    A('بومة', '🦉', { feathers: 1, flies: 1, predator: 1, eggs: 1, c: 'brown' }, 1),
    A('ببغاء', '🦜', { feathers: 1, flies: 1, pet: 1, eggs: 1, c: 'green' }, 2),
    A('ضفدع', '🐸', { legs4: 1, water: 1, eggs: 1, jumps: 1, c: 'green' }, 3),
    A('سلحفاة', '🐢', { legs4: 1, water: 1, pet: 1, eggs: 1, c: 'green' }, 4),
    A('تمساح', '🐊', { legs4: 1, water: 1, predator: 1, big: 1, eggs: 1, c: 'green' }, 5),
    A('نحلة', '🐝', { flies: 1, stripes: 1, eggs: 1, c: 'yellow' }, 6),
  ];
  const Q = function (id, text, group, attr, is) { return { id: id, text: text, group: group, attr: attr, is: is }; };
  const ANIMAL_QUESTIONS = [
    Q('fur', 'عنده فرو؟', 'الجسم', 'fur', [true]),
    Q('feathers', 'عنده ريش؟', 'الجسم', 'feathers', [true]),
    Q('legs4', 'يمشي على أربع؟', 'الجسم', 'legs4', [true]),
    Q('big', 'أكبر من الإنسان؟', 'الجسم', 'big', [true]),
    Q('horns', 'عنده قرون؟', 'الجسم', 'horns', [true]),
    Q('stripes', 'عنده خطوط؟', 'الجسم', 'stripes', [true]),
    Q('spots', 'عنده بقع؟', 'الجسم', 'spots', [true]),
    Q('flies', 'يطير؟', 'وين يعيش', 'flies', [true]),
    Q('water', 'يعيش بالماء أو يسبح؟', 'وين يعيش', 'water', [true]),
    Q('desert', 'يعيش بالصحراء؟', 'وين يعيش', 'desert', [true]),
    Q('pet', 'يتربى بالبيت؟', 'وين يعيش', 'pet', [true]),
    Q('farm', 'من حيوانات المزرعة؟', 'وين يعيش', 'farm', [true]),
    Q('predator', 'مفترس؟', 'عاداته', 'predator', [true]),
    Q('eggs', 'يبيض؟', 'عاداته', 'eggs', [true]),
    Q('jumps', 'يقفز ويتنطط؟', 'عاداته', 'jumps', [true]),
    Q('guard', 'يحرس البيت؟', 'عاداته', 'guard', [true]),
    Q('yellow', 'لونه أصفر أو برتقالي؟', 'اللون', 'c', ['yellow']),
    Q('brown', 'لونه بني؟', 'اللون', 'c', ['brown']),
    Q('green', 'لونه أخضر؟', 'اللون', 'c', ['green']),
    Q('gray', 'لونه رمادي؟', 'اللون', 'c', ['gray']),
    Q('bw', 'أبيض وأسود؟', 'اللون', 'c', ['bw']),
  ];

  // ---------- the monsters: drawn from these features ----------
  const M = function (name, c, eyes, s, bg) {
    // s: the letters of the features it has: h horns, a antennae, f fangs, s spots, t tongue, l tall, w hair, g grumpy
    return { name: name, c: c, eyes: eyes, horns: s.indexOf('h') >= 0, antennae: s.indexOf('a') >= 0, fangs: s.indexOf('f') >= 0, spots: s.indexOf('s') >= 0, tongue: s.indexOf('t') >= 0, tall: s.indexOf('l') >= 0, hairy: s.indexOf('w') >= 0, grumpy: s.indexOf('g') >= 0, bg: bg };
  };
  const MONSTERS = [
    M('زغلول', 'green', 1, 'h', 1), M('بقبوق', 'green', 2, 'asl', 2), M('شمشوم', 'green', 3, 'ftw', 3), M('فرفور', 'green', 2, 'hfg', 4),
    M('دندون', 'purple', 1, 'afl', 5), M('كركور', 'purple', 2, 'hst', 6), M('زعطوط', 'purple', 3, 'lwg', 1), M('بطبوط', 'purple', 2, 'fsw', 2),
    M('قرقور', 'orange', 1, 'stw', 3), M('لولو', 'orange', 2, 'ha', 4), M('نونو', 'orange', 3, 'hflg', 5), M('فلفل', 'orange', 2, 'tlg', 6),
    M('شخبوط', 'blue', 1, 'htlg', 1), M('طرطور', 'blue', 2, 'afw', 2), M('بلبول', 'blue', 3, 'as', 3), M('كوكو', 'blue', 2, 'hslw', 4),
    M('زنزون', 'pink', 1, 'fsg', 5), M('دبدوب', 'pink', 2, 'w', 6), M('حمحوم', 'pink', 3, 'hast', 1), M('عفروت', 'pink', 2, 'hflg', 2),
    M('قمقوم', 'yellow', 1, 'awg', 3), M('سمسوم', 'yellow', 2, 'ht', 4), M('بوبو', 'yellow', 3, 'fl', 5), M('تختوخ', 'yellow', 2, 'afstw', 6),
  ];
  const MONSTER_QUESTIONS = [
    Q('green', 'لونه أخضر؟', 'اللون', 'c', ['green']),
    Q('purple', 'لونه بنفسجي؟', 'اللون', 'c', ['purple']),
    Q('orange', 'لونه برتقالي؟', 'اللون', 'c', ['orange']),
    Q('blue', 'لونه أزرق؟', 'اللون', 'c', ['blue']),
    Q('pink', 'لونه وردي؟', 'اللون', 'c', ['pink']),
    Q('yellow', 'لونه أصفر؟', 'اللون', 'c', ['yellow']),
    Q('eye1', 'عنده عين وحدة؟', 'العيون', 'eyes', [1]),
    Q('eye3', 'عنده ثلاث عيون؟', 'العيون', 'eyes', [3]),
    Q('horns', 'عنده قرون؟', 'الراس', 'horns', [true]),
    Q('antennae', 'عنده قرون استشعار؟', 'الراس', 'antennae', [true]),
    Q('hairy', 'عنده شعر بالراس؟', 'الراس', 'hairy', [true]),
    Q('fangs', 'عنده أنياب؟', 'الوجه', 'fangs', [true]),
    Q('tongue', 'طالع لسانه؟', 'الوجه', 'tongue', [true]),
    Q('grumpy', 'زعلان؟', 'الوجه', 'grumpy', [true]),
    Q('spots', 'عنده نقط؟', 'الجسم', 'spots', [true]),
    Q('tall', 'جسمه طويل؟', 'الجسم', 'tall', [true]),
  ];

  // ---------- the robots: drawn from these features ----------
  const R = function (name, c, head, eyes, top, s, bg) {
    // s: g grill mouth, e headphones, k glowing cheeks, p a plaster
    return { name: name, c: c, head: head, eyes: eyes, top: top, grill: s.indexOf('g') >= 0, ears: s.indexOf('e') >= 0, cheeks: s.indexOf('k') >= 0, patch: s.indexOf('p') >= 0, bg: bg };
  };
  const ROBOTS = [
    R('روبو', 'silver', 'square', 'round', 'antenna', 'g', 1), R('بيبو', 'silver', 'round', 'screen', 'none', 'e', 2),
    R('زيكو', 'silver', 'dome', 'visor', 'siren', 'gk', 3), R('تيتو', 'silver', 'square', 'visor', 'propeller', 'p', 4),
    R('ميكو', 'silver', 'round', 'round', 'none', 'gkp', 5), R('نيكو', 'silver', 'dome', 'screen', 'antenna', 'e', 6),
    R('ديدو', 'red', 'square', 'screen', 'siren', '', 1), R('كيكو', 'red', 'round', 'visor', 'antenna', 'ge', 2),
    R('جيجو', 'red', 'dome', 'round', 'propeller', 'k', 3), R('فوفو', 'red', 'square', 'round', 'none', 'ek', 4),
    R('لوكو', 'red', 'round', 'round', 'siren', 'gp', 5), R('بيكو', 'red', 'dome', 'visor', 'none', 'g', 6),
    R('سوسو', 'blue', 'square', 'visor', 'antenna', 'k', 1), R('توتو', 'blue', 'round', 'screen', 'propeller', 'g', 2),
    R('ريري', 'blue', 'dome', 'round', 'antenna', 'ep', 3), R('زازا', 'blue', 'square', 'screen', 'none', 'gk', 4),
    R('مومو', 'blue', 'round', 'visor', 'siren', 'e', 5), R('فيكس', 'blue', 'dome', 'screen', 'siren', 'g', 6),
    R('بولت', 'gold', 'square', 'round', 'siren', '', 1), R('نوفا', 'gold', 'round', 'screen', 'antenna', 'k', 2),
    R('زيتا', 'gold', 'dome', 'round', 'none', 'ge', 3), R('جاكس', 'gold', 'square', 'visor', 'propeller', 'ge', 4),
    R('رادار', 'gold', 'round', 'round', 'propeller', 'p', 5), R('ترس', 'gold', 'dome', 'visor', 'antenna', 'k', 6),
  ];
  const ROBOT_QUESTIONS = [
    Q('silver', 'لونه فضي؟', 'اللون', 'c', ['silver']),
    Q('red', 'لونه أحمر؟', 'اللون', 'c', ['red']),
    Q('blue', 'لونه أزرق؟', 'اللون', 'c', ['blue']),
    Q('gold', 'لونه ذهبي؟', 'اللون', 'c', ['gold']),
    Q('square', 'راسه مربع؟', 'الراس', 'head', ['square']),
    Q('round', 'راسه مدوّر؟', 'الراس', 'head', ['round']),
    Q('dome', 'راسه قبّة؟', 'الراس', 'head', ['dome']),
    Q('antenna', 'عنده هوائي؟', 'فوق الراس', 'top', ['antenna']),
    Q('siren', 'عنده ضوء إنذار؟', 'فوق الراس', 'top', ['siren']),
    Q('propeller', 'عنده مروحة؟', 'فوق الراس', 'top', ['propeller']),
    Q('screen', 'وجهه شاشة؟', 'الوجه', 'eyes', ['screen']),
    Q('visor', 'لابس نظارة ليزر؟', 'الوجه', 'eyes', ['visor']),
    Q('grill', 'فمه شبك؟', 'الوجه', 'grill', [true]),
    Q('cheeks', 'خدوده تضوي؟', 'الوجه', 'cheeks', [true]),
    Q('ears', 'لابس سماعات؟', 'إضافات', 'ears', [true]),
    Q('patch', 'عنده لزقة؟', 'إضافات', 'patch', [true]),
  ];

  const SETS = {
    people: { name: 'الناس', icon: '👨‍👩‍👧', note: 'ناس من العراق', characters: CHARACTERS, questions: QUESTIONS },
    animals: { name: 'الحيوانات', icon: '🐾', note: 'أسئلة عن طباعهم', characters: ANIMALS, questions: ANIMAL_QUESTIONS },
    monsters: { name: 'الوحوش', icon: '👾', note: 'وحوش لطيفة', characters: MONSTERS, questions: MONSTER_QUESTIONS },
    robots: { name: 'الروبوتات', icon: '🤖', note: 'آلات بأشكال', characters: ROBOTS, questions: ROBOT_QUESTIONS },
  };

  return {
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 2,
    CHARACTERS: CHARACTERS, // the people set (the first one)
    QUESTIONS: QUESTIONS,
    SETS: SETS, // the boards to choose from in the lobby
    SET_OPTIONS: ['people', 'animals', 'monsters', 'robots'],
    DEFAULT_SET: 'people',
    // who chooses the secret characters: each player for themselves, or the draw
    PICKS: ['choose', 'random'],
    PICK_NAMES: { choose: 'كل لاعب يختار', random: 'بالقرعة' },
    DEFAULT_PICK: 'random', // the engine's default; the lobby suggests 'choose'
    LOBBY_PICK: 'choose',
    PICK_SECONDS: 30, // then a random one is chosen for whoever has not picked
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
