// Bank game rendering: board, pieces, dice, deed cards, players, action panel, tabs.
// Pure DOM builders driven by a view (BankEngine.viewFor). Used by the preview page now and by the game in B2.
(function (root) {
  const B = root.BankBoard;
  const C = root.BankConfig;
  const SQ = B.SQUARES;

  // ---------- tiny DOM helper ----------

  function h(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        // custom properties (--x) need setProperty; Object.assign silently ignores them
        Object.keys(v).forEach(function (p) { if (p.slice(0, 2) === '--') el.style.setProperty(p, v[p]); else el.style[p] = v[p]; });
      }
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(el, k); }); return; }
    el.append(kid.nodeType ? kid : String(kid));
  }

  // ---------- icons: inline SVG, single line weight ----------

  const P = {
    train: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 19l-2 2M15 19l2 2"/><circle cx="9" cy="13" r=".6"/><circle cx="15" cy="13" r=".6"/>',
    bus: '<rect x="4" y="4" width="16" height="13" rx="2.5"/><path d="M4 11h16M7 20v-3M17 20v-3"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/>',
    plane: '<path d="M12 2.5c.9 0 1.5.8 1.5 1.8V9l7.5 4.5v2L13.5 13v4.5l2.5 2V21l-4-1-4 1v-1.5l2.5-2V13L3 15.5v-2L10.5 9V4.3c0-1 .6-1.8 1.5-1.8z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    chance: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.5v.6M12 17h.01"/>',
    chest: '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M3.5 13h17M12 9v11M12 9c-1.5-4-6-4-6-1.5S10 9 12 9c2 0 6 1 6-1.5S13.5 5 12 9"/>',
    tax: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    go: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
    jail: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M15 4v16M4 12h16"/>',
    cup: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M11 2v4M14 3v3"/>',
    police: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M12 8l1.2 2.5 2.8.4-2 2 .5 2.8L12 14.4 9.5 15.7l.5-2.8-2-2 2.8-.4z"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="16" r="1"/><circle cx="12" cy="12" r="1"/>',
    home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
    trade: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.5" cy="6.5" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="17.5" r=".6"/>',
    board: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 8.5h17M3.5 15.5h17M8.5 3.5v17M15.5 3.5v17"/>',
    hammer: '<path d="M14 6l4 4M6.5 21L3 17.5l9-9 3.5 3.5zM13 4.5l2-2 6.5 6.5-2 2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/><path d="M5 21h14"/>',
    gavel: '<path d="M14.5 3.5l6 6M12 6l6 6M9.5 8.5l6 6M4 20l7-7"/>',
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
    card: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
  };

  function icon(name, size, cls) {
    const s = document.createElement('span');
    s.className = 'bk-ico' + (cls ? ' ' + cls : '');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24"' + (size ? ' width="' + size + '" height="' + size + '"' : '') +
      ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + P[name] + '</svg>';
    return s;
  }

  function squareIcon(sq) {
    if (sq.type === 'station') return sq.index === 5 ? 'train' : sq.index === 35 ? 'plane' : 'bus';
    if (sq.type === 'utility') return sq.index === 12 ? 'bolt' : 'drop';
    return { chance: 'chance', chest: 'chest', tax: 'tax', go: 'go', jail: 'jail', parking: 'cup', gotojail: 'police' }[sq.type] || null;
  }

  // ---------- money ----------

  // amounts are in thousands of dinars
  function money(k) {
    return (k * 1000).toLocaleString('en-US') + ' د.ع';
  }
  function moneyShort(k) {
    if (Math.abs(k) >= 1000) {
      const m = k / 1000;
      return (Math.round(m * 100) / 100).toString() + ' مليون';
    }
    return k + ' ألف';
  }

  // ---------- board ----------

  // GO in the bottom-right corner, moving along the bottom, up the left, across the top, down the right
  function cellPos(i) {
    if (i <= 10) return { r: 11, c: 11 - i, side: i === 0 || i === 10 ? 'corner' : 'b' };
    if (i <= 20) return { r: 11 - (i - 10), c: 1, side: i === 20 ? 'corner' : 'l' };
    if (i <= 30) return { r: 1, c: 1 + (i - 20), side: i === 30 ? 'corner' : 't' };
    return { r: 1 + (i - 30), c: 11, side: 'r' };
  }

  function playerIndex(view, id) { return view.playerIds.indexOf(id) + 1; }

  function houses(n) {
    if (!n) return null;
    if (n === C.HOUSES_BEFORE_HOTEL + 1) return h('span', { class: 'bk-hotel' });
    const out = [];
    for (let k = 0; k < n; k++) out.push(h('span', { class: 'bk-house' }));
    return out;
  }

  // view: engine view. opts: { names, onCell(i), focus: i, eventText }
  function board(view, opts) {
    opts = opts || {};
    const cur = view.currentPlayerId;
    const curPos = cur ? view.players[cur].pos : -1;
    const el = h('div', { class: 'bk-board', role: 'grid', 'aria-label': 'اللوحة' });
    SQ.forEach(function (sq, i) {
      const pos = cellPos(i);
      const pr = view.props[i];
      const cls = ['bk-cell', 'side-' + pos.side, 'type-' + sq.type];
      if (pr && pr.owner) cls.push('owned');
      if (pr && pr.mortgaged) cls.push('mortgaged');
      if (i === curPos) cls.push('here');
      if (opts.focus === i) cls.push('focus');
      const style = { gridRow: String(pos.r), gridColumn: String(pos.c) };
      if (pr && pr.owner) style['--own'] = 'var(--p' + playerIndex(view, pr.owner) + ')';
      const kids = [];
      if (sq.group) kids.push(h('div', { class: 'bk-band', style: { background: 'var(--g' + sq.group + ')' } }, houses(pr && pr.houses)));
      const body = h('div', { class: 'bk-cbody' });
      const ic = squareIcon(sq);
      if (ic) body.append(icon(ic, null, 'sq'));
      body.append(h('span', { class: 'bk-nm' }, sq.name));
      if (sq.price) body.append(h('span', { class: 'bk-pr' }, sq.price));
      kids.push(body);
      const here = view.playerIds.filter(function (id) { return !view.players[id].bankrupt && view.players[id].pos === i; });
      if (here.length) {
        kids.push(h('div', { class: 'bk-toks' }, here.map(function (id) {
          const p = view.players[id];
          return h('span', {
            class: 'bk-tok' + (id === cur ? ' cur' : '') + (p.inJail ? ' jailed' : ''),
            style: { background: 'var(--p' + playerIndex(view, id) + ')' },
            title: opts.names ? opts.names[id] : id,
            'data-player': id,
          });
        })));
      }
      if (pr && pr.owner) kids.push(h('span', { class: 'bk-ownmark' }));
      const cell = h(opts.onCell ? 'button' : 'div', {
        class: cls.join(' '), style: style, 'data-square': i,
        'aria-label': sq.name + (pr && pr.owner && opts.names ? '، يملكه ' + opts.names[pr.owner] : ''),
        onclick: opts.onCell ? function () { opts.onCell(i); } : null,
      }, kids);
      el.append(cell);
    });
    el.append(center(view, opts));
    return el;
  }

  function center(view, opts) {
    const cur = view.currentPlayerId;
    return h('div', { class: 'bk-center' },
      h('div', { class: 'bk-logo' }, h('span', null, 'بنك'), h('b', null, 'الحظ')),
      view.dice ? dice(view.dice) : h('div', { class: 'bk-dice empty' }, dieFace(0), dieFace(0)),
      opts.eventText ? h('div', { class: 'bk-ctext' }, opts.eventText) : null,
      cur && opts.names ? h('div', { class: 'bk-cturn', style: { '--pc': 'var(--p' + playerIndex(view, cur) + ')' } },
        h('span', { class: 'dot' }), cur === view.you ? 'دورك' : 'دور ' + opts.names[cur]) : null);
  }

  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  function dieFace(n) {
    const d = h('span', { class: 'bk-die', 'aria-label': n ? 'نرد ' + n : 'نرد' });
    for (let k = 1; k <= 9; k++) d.append(h('i', { class: (PIPS[n] || []).indexOf(k) >= 0 ? 'on' : '' }));
    return d;
  }
  function dice(d) {
    return h('div', { class: 'bk-dice' + (d[0] === d[1] ? ' doubles' : '') }, dieFace(d[0]), dieFace(d[1]));
  }

  // ---------- deed (title card) ----------

  // compact: a short version (key rents in a grid) that fits above the buy buttons on a phone
  function deed(i, view, names, compact) {
    const sq = SQ[i];
    const pr = view && view.props[i];
    const owner = pr && pr.owner;
    const head = h('div', { class: 'bk-deed-head', style: sq.group ? { background: 'var(--g' + sq.group + ')' } : null },
      h('small', null, sq.type === 'property' ? 'سند ملكية · ' + B.GROUP_NAMES[sq.group - 1] : sq.type === 'station' ? 'محطة' : 'مرفق'),
      h('div', { class: 'bk-deed-name' }, !sq.group ? icon(squareIcon(sq), 22) : null, sq.name));
    const rows = [];
    function row(label, value, on) { rows.push(h('div', { class: 'bk-row' + (on ? ' on' : '') }, h('span', null, label), h('i'), h('b', null, value))); }
    if (sq.type === 'property') {
      const hz = pr ? pr.houses : 0;
      row('الإيجار', money(sq.rents[0]), hz === 0);
      row('مع المجموعة كاملة', money(sq.rents[0] * 2));
      for (let k = 1; k <= 4; k++) row(k + (k === 1 ? ' بيت' : ' بيوت'), money(sq.rents[k]), hz === k);
      row('فندق', money(sq.rents[5]), hz === 5);
      row('سعر البيت', money(sq.houseCost));
    } else if (sq.type === 'station') {
      C.STATION_RENTS.forEach(function (r, k) { row((k + 1) + (k ? ' محطات' : ' محطة'), money(r)); });
    } else {
      row('مرفق واحد', C.UTILITY_MULTIPLIERS[0] + ' × مجموع النرد');
      row('المرفقان', C.UTILITY_MULTIPLIERS[1] + ' × مجموع النرد');
    }
    row('قيمة الرهن', money(sq.mortgage));
    if (compact) {
      const cells = [];
      function cell(label, value) { cells.push(h('div', { class: 'bk-dcell' }, h('small', null, label), h('b', null, value))); }
      if (sq.type === 'property') {
        cell('الإيجار', moneyShort(sq.rents[0]));
        cell('بالمجموعة', moneyShort(sq.rents[0] * 2));
        cell('بيت واحد', moneyShort(sq.rents[1]));
        cell('4 بيوت', moneyShort(sq.rents[4]));
        cell('فندق', moneyShort(sq.rents[5]));
        cell('سعر البيت', moneyShort(sq.houseCost));
      } else if (sq.type === 'station') {
        C.STATION_RENTS.forEach(function (r, k) { cell((k + 1) + (k ? ' محطات' : ' محطة'), moneyShort(r)); });
      } else {
        cell('مرفق واحد', C.UTILITY_MULTIPLIERS[0] + '× النرد');
        cell('المرفقان', C.UTILITY_MULTIPLIERS[1] + '× النرد');
      }
      return h('div', { class: 'bk-deed compact' }, head, h('div', { class: 'bk-dgrid' }, cells));
    }
    return h('div', { class: 'bk-deed' + (pr && pr.mortgaged ? ' mortgaged' : '') },
      head,
      h('div', { class: 'bk-deed-body' }, rows),
      h('div', { class: 'bk-deed-foot' },
        h('span', null, 'السعر ', h('b', null, money(sq.price))),
        owner ? h('span', { class: 'bk-chip', style: { '--pc': 'var(--p' + playerIndex(view, owner) + ')' } }, h('span', { class: 'dot' }), names ? names[owner] : owner) :
          h('span', { class: 'dim' }, 'متاح للبيع')),
      pr && pr.mortgaged ? h('div', { class: 'bk-stamp' }, 'مرهون') : null);
  }

  // ---------- players ----------

  function players(view, names) {
    const cur = view.currentPlayerId;
    return h('div', { class: 'bk-players', role: 'list' }, view.playerIds.map(function (id) {
      const p = view.players[id];
      const owned = Object.keys(view.props).filter(function (i) { return view.props[i].owner === id; }).length;
      return h('div', {
        class: 'bk-pl' + (id === cur ? ' cur' : '') + (p.bankrupt ? ' out' : '') + (id === view.you ? ' me' : ''),
        role: 'listitem', style: { '--pc': 'var(--p' + playerIndex(view, id) + ')' },
      },
        h('span', { class: 'bk-av' }, Array.from(names[id] || '؟')[0]),
        h('div', { class: 'bk-plinfo' },
          h('div', { class: 'bk-plname' }, names[id] + (id === view.you ? ' (أنت)' : '')),
          h('div', { class: 'bk-plcash' }, p.bankrupt ? 'مفلس' : moneyShort(p.cash)),
          h('div', { class: 'bk-badges' },
            h('span', { class: 'bk-badge', title: 'عقارات' }, icon('home', 12), owned),
            p.inJail ? h('span', { class: 'bk-badge jail', title: 'في السجن' }, icon('jail', 12), 'سجن') : null,
            p.jailCards.length ? h('span', { class: 'bk-badge', title: 'بطاقة خروج من السجن' }, icon('card', 12)) : null)));
    }));
  }

  // ---------- action panel: what I can do right now ----------

  function btn(label, onclick, cls, iconName, disabled) {
    return h('button', { class: 'bk-btn ' + (cls || ''), onclick: onclick, disabled: disabled }, iconName ? icon(iconName, 20) : null, label);
  }

  // ctx: { view, names, send(msg), secondsLeft }
  function actionPanel(ctx) {
    const v = ctx.view;
    const me = v.you;
    const mine = v.players[me];
    const cur = v.currentPlayerId;
    const myTurn = cur === me;
    const send = ctx.send;
    const panel = h('div', { class: 'bk-panel' });
    if (v.phase === 'gameOver') {
      panel.append(h('div', { class: 'bk-title' }, icon('crown', 22), 'انتهت اللعبة'));
      return panel;
    }
    if (v.stage === 'auction') {
      const au = v.auction;
      const minBid = au.bid ? au.bid + C.AUCTION_MIN_INCREMENT : C.AUCTION_MIN_INCREMENT;
      const lead = au.bidder;
      panel.append(
        h('div', { class: 'bk-title' }, icon('gavel', 22), 'مزاد على ', h('b', null, SQ[au.square].name)),
        h('div', { class: 'bk-auction' },
          h('div', { class: 'bk-bid' }, h('small', null, 'أعلى عرض'), h('strong', null, au.bid ? money(au.bid) : 'لا أحد بعد'),
            lead ? h('span', { class: 'bk-chip', style: { '--pc': 'var(--p' + playerIndex(v, lead) + ')' } }, h('span', { class: 'dot' }), ctx.names[lead]) : null),
          ctx.secondsLeft !== undefined ? ring(ctx.secondsLeft, C.AUCTION_SECONDS) : null),
        mine.bankrupt ? null : h('div', { class: 'bk-quick' }, [minBid, minBid + 40, minBid + 90].map(function (amt) {
          const b = btn('', function () { send({ type: 'bid', amount: amt }); }, 'bid' + (amt === minBid ? ' primary' : ''), null, amt > mine.cash);
          b.append(h('b', null, moneyShort(amt)), h('small', null, '+' + (amt - (au.bid || 0))));
          b.setAttribute('aria-label', 'زايد ' + moneyShort(amt));
          return b;
        })));
      return panel;
    }
    if (v.stage === 'debt' && v.debts.length && v.debts[0].debtor === me) {
      const d = v.debts[0];
      panel.append(
        h('div', { class: 'bk-title danger' }, icon('lock', 22), 'عليك دين'),
        h('p', { class: 'bk-note' }, 'عليك ', h('b', null, money(d.amount)), d.creditor ? ' لـ ' + ctx.names[d.creditor] : ' للبنك',
          '. رصيدك ', h('b', null, money(mine.cash)), '. بع بيوتاً أو ارهن عقارات من "ممتلكاتي"، أو أعلن الإفلاس.'),
        h('div', { class: 'bk-row2' },
          btn('ادفع الدين', function () { send({ type: 'pay_debt' }); }, 'primary', null, mine.cash < d.amount),
          btn('إعلان الإفلاس', function () { send({ type: 'declare_bankruptcy' }); }, 'danger')));
      return panel;
    }
    if (!myTurn) {
      panel.append(h('div', { class: 'bk-wait' },
        h('span', { class: 'bk-av sm', style: { '--pc': 'var(--p' + playerIndex(v, cur) + ')' } }, Array.from(ctx.names[cur] || '؟')[0]),
        v.stage === 'debt' ? ctx.names[v.debts[0].debtor] + ' يجمع المال لدفع دين…' :
          v.stage === 'buy' ? ctx.names[cur] + ' يقرر هل يشتري ' + SQ[v.pending.square].name + '…' : 'دور ' + ctx.names[cur] + '…'));
      return panel;
    }
    if (v.stage === 'roll') {
      if (mine.inJail) {
        panel.append(h('div', { class: 'bk-title' }, icon('jail', 22), 'أنت في السجن'),
          h('p', { class: 'bk-note' }, 'ارمِ دبل لتخرج مجاناً (المحاولة ' + (mine.jailTurns + 1) + ' من ' + C.MAX_JAIL_TURNS + ')، أو ادفع ' + money(C.JAIL_FINE) + '.'));
      }
      panel.append(btn('ارمِ النرد', function () { send({ type: 'roll' }); }, 'primary big', 'dice'));
      if (mine.inJail) {
        panel.append(h('div', { class: 'bk-row2' },
          btn('ادفع ' + moneyShort(C.JAIL_FINE), function () { send({ type: 'pay_jail' }); }, '', null, mine.cash < C.JAIL_FINE),
          btn('بطاقة الخروج', function () { send({ type: 'use_jail_card' }); }, '', 'card', !mine.jailCards.length)));
      }
      return panel;
    }
    if (v.stage === 'buy') {
      const i = v.pending.square;
      panel.append(deed(i, v, ctx.names, true),
        h('div', { class: 'bk-row2' },
          btn('اشترِ بـ ' + moneyShort(SQ[i].price), function () { send({ type: 'buy' }); }, 'primary', 'home', mine.cash < SQ[i].price),
          btn('مزاد', function () { send({ type: 'decline' }); }, '', 'gavel')));
      return panel;
    }
    if (v.stage === 'postRoll') {
      panel.append(btn(v.rolledDoubles ? 'دبل! ارمِ مرة أخرى' : 'أنهِ الدور', function () { send({ type: 'end_turn' }); }, 'primary big', v.rolledDoubles ? 'dice' : null),
        h('p', { class: 'bk-note center' }, 'يمكنك البناء أو الرهن أو التبادل قبل أن تنهي دورك.'));
      return panel;
    }
    return panel;
  }

  function ring(sec, total) {
    const pct = Math.max(0, Math.min(1, sec / total));
    return h('div', { class: 'bk-ring', style: { '--pct': String(pct) }, 'aria-label': sec + ' ثانية' }, h('span', null, sec));
  }

  // ---------- my properties ----------

  function propertiesTab(ctx) {
    const v = ctx.view;
    const me = v.you;
    const mine = Object.keys(v.props).map(Number).filter(function (i) { return v.props[i].owner === me; });
    if (!mine.length) return h('div', { class: 'bk-empty' }, icon('home', 28), 'لا تملك عقارات بعد. اشترِ أي عقار تقف عليه، أو زايد في المزادات.');
    const groups = {};
    mine.forEach(function (i) {
      const key = SQ[i].group ? 'g' + SQ[i].group : SQ[i].type;
      (groups[key] = groups[key] || []).push(i);
    });
    const order = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'station', 'utility'];
    return h('div', { class: 'bk-props' }, order.filter(function (k) { return groups[k]; }).map(function (k) {
      const list = groups[k];
      const g = k.charAt(0) === 'g' ? Number(k.slice(1)) : null;
      const full = g && B.groupSquares(g).every(function (i) { return v.props[i].owner === me; });
      return h('div', { class: 'bk-pgroup', style: { '--gc': g ? 'var(--g' + g + ')' : 'var(--text-dim)' } },
        h('div', { class: 'bk-pghead' }, h('span', { class: 'sw' }),
          g ? B.GROUP_NAMES[g - 1] + ' (' + list.length + '/' + B.groupSquares(g).length + ')' : k === 'station' ? 'المحطات' : 'المرافق',
          full ? h('span', { class: 'bk-tag' }, 'مجموعة كاملة') : null),
        list.map(function (i) {
          const pr = v.props[i];
          const sq = SQ[i];
          return h('div', { class: 'bk-prop' + (pr.mortgaged ? ' mortgaged' : '') },
            h('div', { class: 'bk-pname' }, h('b', null, sq.name),
              h('small', null, pr.mortgaged ? 'مرهون' : sq.type === 'property' ? (pr.houses === 5 ? 'فندق' : pr.houses ? pr.houses + ' بيوت' : 'أرض فارغة') : '')),
            h('div', { class: 'bk-pact' },
              sq.type === 'property' && full && !pr.mortgaged ? btn('', function () { ctx.send({ type: 'build', square: i }); }, 'icon', 'plus') : null,
              sq.type === 'property' && pr.houses ? btn('', function () { ctx.send({ type: 'sell_building', square: i }); }, 'icon', 'minus') : null,
              pr.mortgaged ? btn('فك الرهن', function () { ctx.send({ type: 'unmortgage', square: i }); }, 'sm')
                : btn('ارهن', function () { ctx.send({ type: 'mortgage', square: i }); }, 'sm', null, pr.houses > 0)));
        }));
    }));
  }

  // ---------- trade composer (draft lives in the caller's state) ----------

  function tradeTab(ctx) {
    const v = ctx.view;
    const me = v.you;
    const t = v.trade;
    if (t) {
      const incoming = t.to === me;
      const side = function (s) {
        const parts = s.props.map(function (i) { return h('span', { class: 'bk-tprop', style: { '--gc': SQ[i].group ? 'var(--g' + SQ[i].group + ')' : 'var(--text-dim)' } }, SQ[i].name); });
        if (s.cash) parts.push(h('span', { class: 'bk-tcash' }, money(s.cash)));
        if (s.jailCards) parts.push(h('span', { class: 'bk-tcash' }, s.jailCards + ' بطاقة سجن'));
        return parts.length ? parts : h('span', { class: 'dim' }, 'لا شيء');
      };
      return h('div', { class: 'bk-trade' },
        h('div', { class: 'bk-title' }, icon('trade', 22), incoming ? ctx.names[t.from] + ' يعرض عليك' : t.from === me ? 'عرضك على ' + ctx.names[t.to] : ctx.names[t.from] + ' ↔ ' + ctx.names[t.to]),
        h('div', { class: 'bk-tcols' },
          h('div', { class: 'bk-tcol' }, h('small', null, 'يعطي ' + ctx.names[t.from]), side(t.give)),
          h('div', { class: 'bk-tcol' }, h('small', null, 'يعطي ' + ctx.names[t.to]), side(t.get))),
        incoming ? h('div', { class: 'bk-row2' },
          btn('اقبل', function () { ctx.send({ type: 'trade_accept' }); }, 'primary'),
          btn('ارفض', function () { ctx.send({ type: 'trade_reject' }); })) :
          t.from === me ? btn('اسحب العرض', function () { ctx.send({ type: 'trade_cancel' }); }) : null);
    }
    const d = ctx.draft; // { to, give:{props:[],cash}, get:{props:[],cash} }
    const others = v.playerIds.filter(function (id) { return id !== me && !v.players[id].bankrupt; });
    const tradable = function (pid) {
      return Object.keys(v.props).map(Number).filter(function (i) {
        return v.props[i].owner === pid && !(SQ[i].group && B.groupSquares(SQ[i].group).some(function (g) { return v.props[g].houses > 0; }));
      });
    };
    const pickList = function (pid, sel) {
      const list = tradable(pid);
      if (!list.length) return h('div', { class: 'dim small' }, 'لا عقارات قابلة للتبادل');
      return h('div', { class: 'bk-picks' }, list.map(function (i) {
        const on = sel.indexOf(i) >= 0;
        return h('button', {
          class: 'bk-tprop pick' + (on ? ' on' : ''), style: { '--gc': SQ[i].group ? 'var(--g' + SQ[i].group + ')' : 'var(--text-dim)' },
          'aria-pressed': on ? 'true' : 'false',
          onclick: function () { if (on) sel.splice(sel.indexOf(i), 1); else sel.push(i); ctx.redraw(); },
        }, SQ[i].name);
      }));
    };
    const cashInput = function (obj) {
      return h('label', { class: 'bk-cash' }, 'مال (ألف د.ع)',
        h('input', { type: 'number', min: '0', step: '10', value: obj.cash || '', inputmode: 'numeric', oninput: function (e) { obj.cash = Number(e.target.value) || 0; } }));
    };
    return h('div', { class: 'bk-trade' },
      h('div', { class: 'bk-title' }, icon('trade', 22), 'عرض تبادل'),
      h('div', { class: 'bk-tto' }, others.map(function (id) {
        return h('button', {
          class: 'bk-chip pick' + (d.to === id ? ' on' : ''), style: { '--pc': 'var(--p' + playerIndex(v, id) + ')' },
          onclick: function () { d.to = id; d.get.props = []; ctx.redraw(); },
        }, h('span', { class: 'dot' }), ctx.names[id]);
      })),
      h('div', { class: 'bk-tcols' },
        h('div', { class: 'bk-tcol' }, h('small', null, 'أعطيه'), pickList(me, d.give.props), cashInput(d.give)),
        h('div', { class: 'bk-tcol' }, h('small', null, d.to ? 'آخذ منه' : 'اختر لاعباً'), d.to ? pickList(d.to, d.get.props) : null, d.to ? cashInput(d.get) : null)),
      btn('أرسل العرض', function () { ctx.send({ type: 'trade_offer', to: d.to, give: d.give, get: d.get }); }, 'primary', 'trade', !d.to));
  }

  root.BankUI = { h, icon, money, moneyShort, board, dice, deed, players, actionPanel, propertiesTab, tradeTab, cellPos, ring };
})(window);
