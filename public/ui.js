// Table rendering and small shared UI helpers. Plain DOM, no framework.
(function (root) {
  const D = root.ScrewDeck;
  const C = root.ScrewConfig;

  function h(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.append(kid.nodeType ? kid : String(kid));
  }

  // ---------- icons: inline SVG, one line weight (2), currentColor ----------

  const ICON_PATHS = {
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5v10M15 9.5v10"/>',
    log: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.5" cy="6.5" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="17.5" r=".6"/>',
    sound: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.8l6.6-4M8.7 13.2l6.6 4"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/><path d="M5 21h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.5v.6"/><path d="M12 17h.01"/>',
  };

  function icon(name, size) {
    const s = document.createElement('span');
    s.className = 'ico';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON_PATHS[name] + '</svg>';
    return s;
  }

  // ---------- cards (art lives in cards.js) ----------

  // card: {hidden:true,...} or a real card.
  // o: {size, pick, dim, marked, peeked, flipIn, onClick, slot, handId, fxkey, pile, zone}
  function cardEl(card, o) {
    o = o || {};
    const size = o.size || 'big';
    const cls = ['pc', size];
    if (o.pick) cls.push('pick');
    if (o.dim) cls.push('dim');
    if (o.marked) cls.push('marked');
    if (o.peeked) cls.push('peeked');
    if (o.flipIn) cls.push('flip-in');
    const attrs = { class: cls.join(' ') };
    if (o.slot !== undefined) attrs['data-slot'] = o.slot;
    if (o.handId) { attrs['data-hand'] = o.handId; attrs['data-fxkey'] = 'hand:' + o.handId; }
    if (o.fxkey) attrs['data-fxkey'] = o.fxkey;
    if (o.pile) attrs['data-pile'] = o.pile;
    if (o.zone) attrs['data-zone'] = o.zone;
    if (o.delay) attrs.style = 'animation-delay:' + o.delay + 'ms';
    let el;
    if (o.pick && o.onClick) {
      attrs.onclick = o.onClick;
      attrs['aria-label'] = 'اختر ' + root.ScrewCards.label(card && !card.hidden ? card : { type: 'num', rank: '', suit: 'spades' });
      if (!card || card.hidden) attrs['aria-label'] = 'اختر هذا الكرت';
      el = h('button', attrs);
    } else {
      el = h('div', attrs);
    }
    el.innerHTML = root.ScrewCards.svg(card, size === 'mini');
    return el;
  }

  // ---------- text ----------

  function nameOf(S, id) {
    const src = (S.game && S.game.players) || (S.room && S.room.players) || [];
    const p = src.find(function (x) { return x.id === id; });
    return p ? p.name : '؟';
  }

  function eventText(S, e) {
    const who = e.playerId ? nameOf(S, e.playerId) : '';
    switch (e.type) {
      case 'draw': return who + ' سحب من الكومة';
      case 'swap_drawn': return who + ' بدّل أحد كروته ورمى ' + D.describe(e.discarded);
      case 'discard_drawn': return who + ' رمى ' + D.describe(e.card);
      case 'take_discard': return who + ' أخذ ' + D.describe(e.taken) + ' من الأرض ورمى ' + D.describe(e.discarded);
      case 'match':
        return e.success ? who + ' بصّر بـ ' + D.describe(e.card) + ' ونجح' : who + ' بصّر بـ ' + D.describe(e.card) + ' وأخطأ';
      case 'penalty': return who + ' سحب كرت عقوبة';
      case 'look': {
        const t = e.targets.map(function (x) {
          return x.ownerId === e.playerId ? 'كرته' : 'كرت عند ' + nameOf(S, x.ownerId);
        });
        return who + ' نظر إلى ' + t.join(' و ');
      }
      case 'swap': return who + ' بدّل كرتاً مع ' + nameOf(S, e.targetPlayerId) + ' (خد وهات)';
      case 'throw': return who + ' رمى كرته ' + D.describe(e.card) + ' (بصرة)';
      case 'skip_ability': return who + ' تخطى الخاصية';
      case 'screw': return who + ' أعلن سكرو!';
      case 'reshuffle': return 'خُلطت كومة الرمي وصارت كومة سحب جديدة';
      case 'round_start': return 'بدأت الجولة ' + e.round;
      default: return '';
    }
  }

  function fmtTime(sec) {
    sec = Math.max(0, sec);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  function secondsLeft(S) {
    if (!S.timerEndsLocal) return null;
    return Math.max(0, Math.ceil((S.timerEndsLocal - Date.now()) / 1000));
  }

  const ABILITY_NAME = {
    peek_own: 'بص في ورقتك',
    peek_other: 'بص في ورقة غيرك',
    swap: 'خد وهات',
    peek_all: 'كعب داير',
    throw: 'بصرة',
  };

  // ---------- table ----------

  // api: { send, pick(prompt, valid, onPick), cancelPick, askScrew, openSheet(name) }
  function renderTable(S, api) {
    const g = S.game;
    const me = g.players.find(function (p) { return p.id === g.you; });
    const isMyTurn = g.currentPlayerId === g.you;
    const pend = S.pending;
    const now = Date.now();

    function slotCard(p, card, slot, size) {
      const peek = card.hidden ? S.peeks[card.handId] : null;
      const peeked = !!(peek && peek.until > now);
      const marked = !!(S.marks[card.handId] && S.marks[card.handId] > now);
      const pick = !!(pend && pend.valid(p.id, slot));
      let flipIn = false;
      if (peeked && !peek.animated) { flipIn = true; peek.animated = true; }
      return cardEl(peeked ? peek.card : card, {
        size: size, slot: slot, handId: card.handId, peeked: peeked, marked: marked, flipIn: flipIn,
        pick: pick, dim: !!(pend && !pick),
        onClick: pick ? function () { pend.onPick(p.id, slot); } : null,
      });
    }

    // thin top bar
    const left = secondsLeft(S);
    const topbar = h('div', { class: 'topbar' },
      h('div', { class: 'tb-info' },
        h('span', null, 'جولة ' + g.round + '/' + g.rounds),
        h('span', { class: 'dot' }, '·'),
        h('span', null, 'لفة ' + g.lap),
        g.screwCaller ? h('span', { class: 'tb-screw' }, 'سكرو: ' + nameOf(S, g.screwCaller)) : null),
      h('div', { class: 'tb-timer' + (left !== null && left <= 10 ? ' low' : ''), id: 'timer' },
        left === null ? null : [icon('clock', 18), h('span', { class: 'num' }, fmtTime(left))]),
      h('div', { class: 'tb-btns' },
        window.Reactions ? window.Reactions.button() : null,
        h('button', { class: 'icon-btn help-btn', onclick: api.toggleHelp, 'aria-label': 'طريقة اللعب' }, icon('help')),
        h('button', { class: 'icon-btn', onclick: function () { api.openSheet('scores'); }, 'aria-label': 'جدول النقاط' }, icon('table')),
        h('button', { class: 'icon-btn', onclick: function () { api.openSheet('menu'); }, 'aria-label': 'القائمة' }, icon('menu'))));

    // opponents
    const others = g.players.filter(function (p) { return p.id !== g.you; });
    const opps = h('div', { class: 'opps' + (others.length > 3 ? ' dense' : '') },
      others.map(function (p) {
        const turn = g.currentPlayerId === p.id;
        return h('div', { class: 'opp' + (turn ? ' turn' : '') + (p.connected ? '' : ' off'), 'data-player': p.id },
          h('span', { class: 'name' }, p.name, p.id === g.screwCaller ? h('span', { class: 'screw-tag' }, 'سكرو') : null),
          h('div', { class: 'minis' }, p.hand.length
            ? p.hand.map(function (c, i) { return slotCard(p, c, i, 'mini'); })
            : h('span', { class: 'empty' }, 'بلا كروت')),
          p.connected ? null : h('span', { class: 'off-tag' }, 'غير متصل'));
      }));

    // centre: piles, drawn card, notice, last event
    const top = g.discardTop;
    const piles = h('div', { class: 'piles' },
      h('div', { class: 'pile' },
        h('div', { class: 'stack' }, cardEl({ hidden: true }, { size: 'pile', pile: 'deck' })),
        h('span', { class: 'pile-label' }, 'السحب ', h('b', { class: 'num' }, g.deckCount))),
      h('div', { class: 'pile' },
        top ? cardEl(top, { size: 'pile', pile: 'discard', fxkey: 'pile:discard' }) : h('div', { class: 'pc pile empty-pile', 'data-pile': 'discard' }),
        h('span', { class: 'pile-label' }, 'الأرض')));

    let drawnZone = null;
    if (g.drawn && isMyTurn) {
      drawnZone = h('div', { class: 'drawn' },
        h('div', { class: 'drawn-label' }, 'سحبت'),
        cardEl(g.drawn, { size: 'xl', zone: 'drawn', fxkey: 'zone:drawn' }),
        pend ? null : h('div', { class: 'drawn-btns' },
          h('button', { class: 'primary', onclick: function () {
            api.pick('اختر الكرت الذي تريد استبداله', function (id) { return id === g.you; },
              function (id, slot) { api.send({ type: 'swap_drawn', slot: slot }); });
          }, disabled: !me.hand.length }, 'بدّله'),
          h('button', { onclick: function () { api.send({ type: 'discard_drawn' }); } }, 'ارمه')));
    }

    const centre = h('div', { class: 'centerzone' + (drawnZone ? ' has-drawn' : '') },
      piles,
      drawnZone,
      S.notice && S.notice.until > now ? h('div', { class: 'notice', role: 'status' }, S.notice.text) : null);

    const eventLine = h('button', { class: 'eventline', onclick: function () { api.openSheet('log'); }, 'aria-label': 'سجل الأحداث' },
      icon('log', 16), h('span', null, S.eventText || 'سجل الأحداث'));

    // my cards
    const mine = h('div', { class: 'mine' + (isMyTurn ? ' turn' : ''), 'data-player': g.you },
      h('div', { class: 'mine-head' },
        h('span', { class: 'me-name' }, me.name),
        isMyTurn ? h('span', { class: 'myturn' }, 'دورك') : null,
        g.screwCaller === g.you ? h('span', { class: 'screw-tag' }, 'سكرو') : null),
      h('div', { class: 'hand', style: '--n:' + Math.max(4, me.hand.length) },
        me.hand.length ? me.hand.map(function (c, i) { return slotCard(me, c, i, 'big'); }) : h('span', { class: 'empty' }, 'لا كروت معك: مجموعك صفر')));

    return h('div', { class: 'screen table-screen' }, topbar, opps, centre, eventLine, mine, actionsArea());

    // ----- actions: only the moves available right now -----

    function btn(label, onclick, cls, disabled) {
      return h('button', { class: cls || '', onclick: onclick, disabled: disabled }, label);
    }

    function actionsArea() {
      const box = h('div', { class: 'actions' });
      if (g.phase === 'peek') {
        const readyCount = g.players.filter(function (p) { return p.ready; }).length;
        box.append(h('div', { class: 'instr' }, me.ready
          ? 'بانتظار الباقين… (' + readyCount + '/' + g.players.length + ')'
          : 'احفظ كرتيك الأيمنين قبل أن ينقلبا'));
        box.append(h('div', { class: 'btns' }, btn('جاهز', function () { api.send({ type: 'ready' }); }, 'primary', me.ready)));
        return box;
      }
      if (g.phase !== 'turn') {
        box.append(h('div', { class: 'waiting' }, 'انتهت الجولة'));
        return box;
      }
      if (!isMyTurn) {
        const cur = nameOf(S, g.currentPlayerId);
        box.append(h('div', { class: 'waiting' },
          g.ability ? cur + ' يستخدم "' + ABILITY_NAME[g.ability] + '"…'
            : g.hasDrawn ? cur + ' سحب كرتاً…' : 'دور ' + cur + '…'));
        return box;
      }
      if (pend) {
        box.append(h('div', { class: 'instr' }, pend.prompt));
        box.append(h('div', { class: 'btns' }, btn('إلغاء', api.cancelPick)));
        return box;
      }
      const own = function (id) { return id === g.you; };
      const send = api.send;
      if (g.stage === 'start') {
        box.append(h('div', { class: 'btns' },
          btn('اسحب', function () { send({ type: 'draw' }); }, 'primary'),
          btn('خذ من الأرض', function () {
            api.pick('اختر الكرت الذي تبدله بكرت الأرض', own, function (id, slot) { send({ type: 'take_discard', slot: slot }); });
          }, '', !me.hand.length || !g.discardTop),
          btn('بصّر', function () {
            api.pick('اختر كرتك الذي تظن أنه مطابق لكرت الأرض', own, function (id, slot) { send({ type: 'match', slot: slot }); });
          }, '', !me.hand.length || !g.discardTop)));
        if (g.screwAllowed) box.append(h('div', { class: 'btns screw-row' }, btn('سكرو', api.askScrew, 'danger')));
      } else if (g.stage === 'drawn') {
        box.append(h('div', { class: 'instr' }, 'بدّل الكرت المسحوب بأحد كروتك أو ارمه'));
      } else if (g.stage === 'ability') {
        box.append(h('div', { class: 'instr' }, 'خاصية: ' + ABILITY_NAME[g.ability]));
        box.append(abilityButtons(send, own));
      }
      return box;
    }

    function abilityButtons(send, own) {
      const othersSel = function (id) { return id !== g.you; };
      const use = function (m) { send(Object.assign({ type: 'use_ability' }, m)); };
      const wrap = h('div', { class: 'btns' });
      switch (g.ability) {
        case 'peek_own':
          wrap.append(btn('اختر كرتك', function () {
            api.pick('اختر كرتاً من كروتك لتنظر إليه', own, function (id, slot) { use({ slot: slot }); });
          }, 'primary', !me.hand.length));
          break;
        case 'peek_other':
          wrap.append(btn('اختر كرت لاعب', function () {
            api.pick('اختر كرتاً عند لاعب آخر', othersSel, function (id, slot) { use({ targetPlayerId: id, targetSlot: slot }); });
          }, 'primary'));
          break;
        case 'swap':
          wrap.append(btn('اختر الكرتين', function () {
            api.pick('أولاً: اختر كرتاً من كروتك', own, function (id, slot) {
              api.pick('ثانياً: اختر كرتاً عند لاعب آخر', function (oid) { return oid !== g.you && oid !== g.screwCaller; },
                function (oid, oslot) { use({ slot: slot, targetPlayerId: oid, targetSlot: oslot }); });
            });
          }, 'primary', !me.hand.length));
          break;
        case 'throw':
          wrap.append(btn('اختر كرتاً لترميه', function () {
            api.pick('اختر كرتاً من كروتك لترميه مكشوفاً', own, function (id, slot) { use({ slot: slot }); });
          }, 'primary', !me.hand.length));
          break;
        case 'peek_all': {
          const need = Math.min(C.PEEK_ALL_SELF_COUNT, me.hand.length);
          wrap.append(btn('كرتان من كروتي', function () {
            const slots = [];
            const step = function () {
              api.pick('اختر الكرت ' + (slots.length + 1) + ' من ' + need,
                function (id, slot) { return id === g.you && slots.indexOf(slot) < 0; },
                function (id, slot) {
                  slots.push(slot);
                  if (slots.length === need) use({ mode: 'self', slots: slots }); else step();
                });
            };
            step();
          }, 'primary', !need));
          const targets = others.filter(function (p) { return p.hand.length > 0; }).map(function (p) { return p.id; });
          wrap.append(btn('كرت عند كل لاعب', function () {
            const picks = [];
            const step = function () {
              const left2 = targets.filter(function (id) { return !picks.some(function (p) { return p.playerId === id; }); });
              api.pick('اختر كرتاً عند: ' + left2.map(function (id) { return nameOf(S, id); }).join(' أو '),
                function (id) { return left2.indexOf(id) >= 0; },
                function (id, slot) {
                  picks.push({ playerId: id, slot: slot });
                  if (picks.length === targets.length) use({ mode: 'others', picks: picks }); else step();
                });
            };
            step();
          }, 'primary', !targets.length));
          break;
        }
      }
      wrap.append(btn('تخطي', function () { send({ type: 'skip_ability' }); }));
      return wrap;
    }
  }

  // Update just the countdown (called every ~250ms) so the DOM isn't rebuilt.
  function tickTimer(S) {
    const el = document.getElementById('timer');
    if (!el) return;
    const s = secondsLeft(S);
    const num = el.querySelector('.num');
    if (s === null) { el.replaceChildren(); return; }
    if (num) num.textContent = fmtTime(s);
    el.classList.toggle('low', s <= 10);
  }

  root.ScrewUI = { h, icon, cardEl, renderTable, tickTimer, eventText, nameOf, fmtTime, ABILITY_NAME };
})(window);
