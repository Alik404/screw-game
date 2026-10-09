// Chance ("حظ") and chest ("صندوق") cards. Original texts with an Iraqi flavour.
// Effects: advance{to}, nearest{kind, double|times}, back{steps}, collect{amount}, pay{amount},
// payEach{amount}, collectEach{amount}, repairs{house, hotel}, jail, jailFree.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BankCards = factory();
})(this, function () {
  const CHANCE = [
    { id: 'c1', text: 'تحرك إلى انطلاق واستلم 200.', effect: 'advance', to: 0 },
    { id: 'c2', text: 'موعد في شارع الرشيد: تحرك إليه. إذا مررت بانطلاق استلم 200.', effect: 'advance', to: 6 },
    { id: 'c3', text: 'عزيمة عشاء في الكرادة: تحرك إليها. إذا مررت بانطلاق استلم 200.', effect: 'advance', to: 29 },
    { id: 'c4', text: 'رحلة عائلية إلى جزيرة بغداد السياحية: تحرك إليها.', effect: 'advance', to: 39 },
    { id: 'c5', text: 'سافر بالقطار: تحرك إلى محطة قطار بغداد. إذا مررت بانطلاق استلم 200.', effect: 'advance', to: 5 },
    { id: 'c6', text: 'اركب أول كيا لأقرب محطة أو كراج. إذا كانت مملوكة ادفع لصاحبها ضعف الإيجار.', effect: 'nearest', kind: 'station', double: true },
    { id: 'c7', text: 'تأخرت عن موعدك: تحرك لأقرب محطة أو كراج. إذا كانت مملوكة ادفع ضعف الإيجار.', effect: 'nearest', kind: 'station', double: true },
    { id: 'c8', text: 'تحرك لأقرب مرفق (كهرباء أو ماء). إذا كان مملوكاً ارمِ النرد وادفع 10 أضعاف المجموع.', effect: 'nearest', kind: 'utility', times: 10 },
    { id: 'c9', text: 'نسيت محفظتك: ارجع 3 خانات.', effect: 'back', steps: 3 },
    { id: 'c10', text: 'اذهب إلى السجن مباشرة ولا تمر بانطلاق.', effect: 'jail' },
    { id: 'c11', text: 'واسطة قوية: اخرج من السجن مجاناً. احتفظ بهذه البطاقة أو بعها.', effect: 'jailFree' },
    { id: 'c12', text: 'ربحت سحب اليانصيب: استلم 50.', effect: 'collect', amount: 50 },
    { id: 'c13', text: 'أرباح محلك في الشورجة هذا الموسم: استلم 150.', effect: 'collect', amount: 150 },
    { id: 'c14', text: 'مخالفة مرور في ساحة التحرير: ادفع 15.', effect: 'pay', amount: 15 },
    { id: 'c15', text: 'انتخبوك رئيس جمعية المحلة: ادفع 50 لكل لاعب.', effect: 'payEach', amount: 50 },
    { id: 'c16', text: 'صيانة بيوتك قبل الشتاء: ادفع 25 عن كل بيت و100 عن كل فندق.', effect: 'repairs', house: 25, hotel: 100 },
  ];

  const CHEST = [
    { id: 'k1', text: 'تحرك إلى انطلاق واستلم 200.', effect: 'advance', to: 0 },
    { id: 'k2', text: 'خطأ من البنك لصالحك: استلم 200.', effect: 'collect', amount: 200 },
    { id: 'k3', text: 'مراجعة طبيب الأسنان: ادفع 50.', effect: 'pay', amount: 50 },
    { id: 'k4', text: 'بعت سيارتك القديمة: استلم 50.', effect: 'collect', amount: 50 },
    { id: 'k5', text: 'كفالة من صديق: اخرج من السجن مجاناً. احتفظ بهذه البطاقة أو بعها.', effect: 'jailFree' },
    { id: 'k6', text: 'اذهب إلى السجن مباشرة ولا تمر بانطلاق.', effect: 'jail' },
    { id: 'k7', text: 'عيد ميلادك: استلم 10 من كل لاعب.', effect: 'collectEach', amount: 10 },
    { id: 'k8', text: 'عيدية من الأقارب: استلم 100.', effect: 'collect', amount: 100 },
    { id: 'k9', text: 'استرجاع ضريبة: استلم 20.', effect: 'collect', amount: 20 },
    { id: 'k10', text: 'استحقاق التأمين: استلم 100.', effect: 'collect', amount: 100 },
    { id: 'k11', text: 'قسط المدرسة الأهلية: ادفع 100.', effect: 'pay', amount: 100 },
    { id: 'k12', text: 'انقطعت الكهرباء وشغّلت المولدة طول الشهر: ادفع 50.', effect: 'pay', amount: 50 },
    { id: 'k13', text: 'أجور دروس خصوصية: استلم 25.', effect: 'collect', amount: 25 },
    { id: 'k14', text: 'ترميم البيوت بعد المطر: ادفع 40 عن كل بيت و115 عن كل فندق.', effect: 'repairs', house: 40, hotel: 115 },
    { id: 'k15', text: 'عرس ابن عمك: ادفع 20 لكل لاعب.', effect: 'payEach', amount: 20 },
    { id: 'k16', text: 'ورثت من عمك: استلم 100.', effect: 'collect', amount: 100 },
  ];

  const ALL = {};
  CHANCE.concat(CHEST).forEach(function (c) { ALL[c.id] = c; });

  return { CHANCE, CHEST, byId: ALL, DECK_NAMES: { chance: 'حظ', chest: 'صندوق' } };
});
