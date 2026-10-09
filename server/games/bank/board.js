// The 40-square board (Baghdad places) and derived prices/rents. Pure data + helpers.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'));
  else root.BankBoard = factory(root.BankConfig);
})(this, function (CONFIG) {
  const GROUP_NAMES = ['بني', 'سماوي', 'وردي', 'برتقالي', 'أحمر', 'أصفر', 'أخضر', 'أزرق'];

  // [type, name, extra]. Properties: extra = [group 1..8, price]. Stations/utilities: price. Taxes: amount.
  const LAYOUT = [
    ['go', 'انطلاق'],
    ['property', 'الباب الشرقي', [1, 60]],
    ['chest', 'صندوق'],
    ['property', 'الشورجة', [1, 60]],
    ['tax', 'ضريبة الدخل', 200],
    ['station', 'محطة قطار بغداد', 200],
    ['property', 'شارع الرشيد', [2, 100]],
    ['chance', 'حظ'],
    ['property', 'شارع المتنبي', [2, 100]],
    ['property', 'شارع السعدون', [2, 120]],
    ['jail', 'السجن'],
    ['property', 'الوزيرية', [3, 140]],
    ['utility', 'الكهرباء الوطنية', 150],
    ['property', 'الصالحية', [3, 140]],
    ['property', 'الأعظمية', [3, 160]],
    ['station', 'كراج العلاوي', 200],
    ['property', 'شارع فلسطين', [4, 180]],
    ['chest', 'صندوق'],
    ['property', 'زيونة', [4, 180]],
    ['property', 'اليرموك', [4, 200]],
    ['parking', 'استراحة'],
    ['property', 'حي الجامعة', [5, 220]],
    ['chance', 'حظ'],
    ['property', 'الداودي', [5, 220]],
    ['property', 'شارع 14 رمضان', [5, 240]],
    ['station', 'كراج النهضة', 200],
    ['property', 'العرصات', [6, 260]],
    ['property', 'أبو نؤاس', [6, 260]],
    ['utility', 'إسالة الماء', 150],
    ['property', 'الكرادة', [6, 280]],
    ['gotojail', 'اذهب إلى السجن'],
    ['property', 'الحارثية', [7, 300]],
    ['property', 'شارع الأميرات', [7, 300]],
    ['chest', 'صندوق'],
    ['property', 'المنصور', [7, 320]],
    ['station', 'مطار بغداد الدولي', 200],
    ['chance', 'حظ'],
    ['property', 'الجادرية', [8, 350]],
    ['tax', 'ضريبة الكماليات', 100],
    ['property', 'جزيرة بغداد السياحية', [8, 400]],
  ];

  function baseRent(price) {
    return Math.max(CONFIG.RENT_MIN, Math.round(price * CONFIG.RENT_BASE_RATE));
  }

  const SQUARES = LAYOUT.map(function (row, i) {
    const sq = { index: i, type: row[0], name: row[1] };
    if (row[0] === 'property') {
      sq.group = row[2][0];
      sq.price = row[2][1];
      sq.houseCost = CONFIG.HOUSE_COST_BY_GROUP[sq.group - 1];
      const b = baseRent(sq.price);
      // rents[0] = bare land, rents[1..4] = houses, rents[5] = hotel
      sq.rents = [b].concat(CONFIG.HOUSE_MULTIPLIERS.map(function (m) { return b * m; }), [b * CONFIG.HOTEL_MULTIPLIER]);
    } else if (row[0] === 'station' || row[0] === 'utility') {
      sq.price = row[2];
    } else if (row[0] === 'tax') {
      sq.amount = row[2];
    }
    if (sq.price) sq.mortgage = Math.round(sq.price * CONFIG.MORTGAGE_RATE);
    return sq;
  });

  const JAIL_INDEX = SQUARES.findIndex(function (s) { return s.type === 'jail'; });

  function isOwnable(sq) {
    return sq.type === 'property' || sq.type === 'station' || sq.type === 'utility';
  }

  function groupSquares(group) {
    return SQUARES.filter(function (s) { return s.group === group; }).map(function (s) { return s.index; });
  }

  function indicesOf(type) {
    return SQUARES.filter(function (s) { return s.type === type; }).map(function (s) { return s.index; });
  }

  return { SQUARES, GROUP_NAMES, JAIL_INDEX, SIZE: SQUARES.length, isOwnable, groupSquares, indicesOf, baseRent };
});
