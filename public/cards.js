// Playing-card art, drawn as inline SVG (viewBox 250x350, ratio 5:7).
// Everything is vector: suit symbols, icons and illustrations are paths, not font glyphs,
// so cards look identical on every device. Colours come from CSS classes (cards.css -> tokens.css).
(function (root) {
  const W = 250;
  const H = 350;
  const CX = 125;
  const CY = 175;

  const SUIT_COLOR = { spades: 'black', clubs: 'black', hearts: 'red', diamonds: 'red' };

  // ---------- shared symbols (injected once per page) ----------

  const SPRITE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    '<symbol id="sx-spades" viewBox="0 0 100 100"><path d="M50 4C50 4 9 36 9 60C9 74 19 82 31 82C39 82 45 78 48 71C47 82 43 91 35 96H65C57 91 53 82 52 71C55 78 61 82 69 82C81 82 91 74 91 60C91 36 50 4 50 4Z"/></symbol>' +
    '<symbol id="sx-hearts" viewBox="0 0 100 100"><path d="M50 95C17 69 5 51 5 33C5 17 17 6 31 6C40 6 47 11 50 19C53 11 60 6 69 6C83 6 95 17 95 33C95 51 83 69 50 95Z"/></symbol>' +
    '<symbol id="sx-diamonds" viewBox="0 0 100 100"><path d="M50 2C60 22 76 38 93 50C76 62 60 78 50 98C40 78 24 62 7 50C24 38 40 22 50 2Z"/></symbol>' +
    '<symbol id="sx-clubs" viewBox="0 0 100 100"><circle cx="50" cy="29" r="23"/><circle cx="26" cy="63" r="23"/><circle cx="74" cy="63" r="23"/><circle cx="50" cy="55" r="14"/><path d="M50 56C50 80 45 90 34 97H66C55 90 50 80 50 56Z"/></symbol>' +
    // eye icon (peek abilities)
    '<symbol id="sx-eye" viewBox="0 0 24 24"><path d="M1.5 12C4.5 6.5 8 4.5 12 4.5C16 4.5 19.5 6.5 22.5 12C19.5 17.5 16 19.5 12 19.5C8 19.5 4.5 17.5 1.5 12Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.8" fill="currentColor"/></symbol>' +
    // screw (side view): head, shaft with thread cuts, point
    '<symbol id="sx-screw" viewBox="0 0 60 140"><path d="M6 27C6 11 15 4 30 4C45 4 54 11 54 27Z"/><path d="M19 27H41V116L30 137L19 116Z"/>' +
    '<path class="cut" d="M30 4V20M19 45L41 38M19 60L41 53M19 75L41 68M19 90L41 83M19 105L41 98" fill="none" stroke-width="3.2" stroke-linecap="round"/></symbol>' +
    // back pattern: interlaced lozenges
    '<pattern id="sx-back" width="30" height="30" patternUnits="userSpaceOnUse">' +
    '<rect width="30" height="30" class="bk-base"/>' +
    '<path d="M0 0L30 30M30 0L0 30" class="bk-line" fill="none" stroke-width="2.2"/>' +
    '<path d="M15 0V30M0 15H30" class="bk-line2" fill="none" stroke-width="1"/>' +
    '<circle cx="15" cy="15" r="3" class="bk-dot"/><circle cx="0" cy="0" r="2.4" class="bk-dot"/><circle cx="30" cy="0" r="2.4" class="bk-dot"/><circle cx="0" cy="30" r="2.4" class="bk-dot"/><circle cx="30" cy="30" r="2.4" class="bk-dot"/>' +
    '</pattern>' +
    '</defs></svg>';

  function ensureSprite() {
    if (document.getElementById('sx-sprite-host')) return;
    const host = document.createElement('div');
    host.id = 'sx-sprite-host';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    host.innerHTML = SPRITE;
    (document.body || document.documentElement).prepend(host);
  }

  // ---------- number cards: classic pip layouts ----------

  const IX = 34; // centre line of the corner index
  const COL = { L: 94, C: 125, R: 156 };
  const R3 = [84, 175, 266];
  const R4 = [84, 145, 205, 266];

  function side(rows) {
    const out = [];
    rows.forEach(function (y) { out.push([COL.L, y], [COL.R, y]); });
    return out;
  }

  const LAYOUT = {
    1: [[COL.C, CY, 104]],
    2: [[COL.C, R3[0]], [COL.C, R3[2]]],
    3: [[COL.C, R3[0]], [COL.C, R3[1]], [COL.C, R3[2]]],
    4: side([R3[0], R3[2]]),
    5: side([R3[0], R3[2]]).concat([[COL.C, CY]]),
    6: side(R3),
    7: side(R3).concat([[COL.C, 128]]),
    8: side(R3).concat([[COL.C, 128], [COL.C, 222]]),
    9: side(R4).concat([[COL.C, CY]]),
    10: side(R4).concat([[COL.C, 115], [COL.C, 235]]),
  };

  function pips(card) {
    const suit = card.suit || 'spades';
    const color = SUIT_COLOR[suit];
    return LAYOUT[card.rank].map(function (p) {
      const s = p[2] || (card.rank >= 9 ? 36 : 40);
      const x = p[0];
      const y = p[1];
      const flip = y > CY; // lower half is upside-down, like real cards
      return '<use href="#sx-' + suit + '" class="s-' + color + '" x="' + (x - s / 2) + '" y="' + (y - s / 2) +
        '" width="' + s + '" height="' + s + '"' + (flip ? ' transform="rotate(180 ' + x + ' ' + y + ')"' : '') + '/>';
    }).join('');
  }

  function eyes(rank) {
    if (rank < 7) return '';
    if (rank <= 8) return '<use href="#sx-eye" class="i-blue" x="22" y="114" width="24" height="24"/>';
    return '<use href="#sx-eye" class="i-blue" x="11" y="114" width="22" height="22"/>' +
      '<use href="#sx-eye" class="i-blue" x="35" y="114" width="22" height="22"/>';
  }

  function numIndex(card) {
    const suit = card.suit || 'spades';
    const color = SUIT_COLOR[suit];
    return '<text class="f-num tx-' + color + '" x="' + IX + '" y="68" text-anchor="middle" font-size="' + (card.rank === 10 ? 50 : 60) + '">' + card.rank + '</text>' +
      '<use href="#sx-' + suit + '" class="s-' + color + '" x="' + (IX - 17) + '" y="76" width="34" height="34"/>' + eyes(card.rank);
  }

  // ---------- geometry helpers for the illustrations ----------

  function pt(cx, cy, r, a) {
    const rad = a * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  function r1(n) { return Math.round(n * 10) / 10; }

  function arc(cx, cy, r, a1, a2, cls, sw) {
    const p1 = pt(cx, cy, r, a1);
    const p2 = pt(cx, cy, r, a2);
    return '<path class="' + cls + '" fill="none" stroke-width="' + sw + '" d="M' + r1(p1[0]) + ' ' + r1(p1[1]) +
      'A' + r + ' ' + r + ' 0 0 1 ' + r1(p2[0]) + ' ' + r1(p2[1]) + '"/>';
  }

  // arrow head at angle a on the circle, pointing in the direction of increasing angle
  function head(cx, cy, r, a, fillCls) {
    const rad = a * Math.PI / 180;
    const nx = Math.cos(rad);
    const ny = Math.sin(rad);
    const tx = -ny;
    const ty = nx;
    const px = cx + r * nx;
    const py = cy + r * ny;
    const w = 14;
    const l = 20;
    const pts = [[px + nx * w, py + ny * w], [px - nx * w, py - ny * w], [px + tx * l, py + ty * l]]
      .map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' ');
    return '<polygon class="' + fillCls + ' k-black" stroke-width="2" stroke-linejoin="round" points="' + pts + '"/>';
  }

  function diamond(x, y, s, cls) {
    return '<path class="' + cls + ' k-black" stroke-width="1.8" d="M' + x + ' ' + (y - s) + 'L' + (x + s * 0.75) + ' ' + y + 'L' + x + ' ' + (y + s) + 'L' + (x - s * 0.75) + ' ' + y + 'Z"/>';
  }

  function star(x, y, s, cls) {
    const k = s * 0.28;
    return '<path class="' + cls + ' k-black" stroke-width="1.8" stroke-linejoin="round" d="M' + x + ' ' + (y - s) + 'L' + (x + k) + ' ' + (y - k) + 'L' + (x + s) + ' ' + y + 'L' + (x + k) + ' ' + (y + k) +
      'L' + x + ' ' + (y + s) + 'L' + (x - k) + ' ' + (y + k) + 'L' + (x - s) + ' ' + y + 'L' + (x - k) + ' ' + (y - k) + 'Z"/>';
  }

  function burst(cx, cy, R, r, n) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const p = pt(cx, cy, i % 2 ? r : R, (i * 180) / n - 90);
      pts.push(r1(p[0]) + ',' + r1(p[1]));
    }
    return pts.join(' ');
  }

  // ---------- illustrations for the ability cards (top half; the bottom is the same, rotated 180) ----------
  // All original artwork: flat shapes in the classic red / blue / yellow / black palette.

  const FIELD_FULL = '<rect x="58" y="28" width="134" height="145" rx="3" class="a-yellow" fill-opacity=".38"/>';
  const FIELD_HALF = '<rect x="58" y="28" width="134" height="121" rx="3" class="a-yellow" fill-opacity=".38"/>';

  const ART = {
    // خد وهات: two arrows chasing each other in a circle (exchange)
    swap: function () {
      return (
        '<circle cx="125" cy="100" r="54" class="a-white k-black" stroke-width="2.5"/>' +
        arc(125, 100, 36, 205, 335, 'k-red', 12) + head(125, 100, 36, 335, 'a-red') +
        arc(125, 100, 36, 25, 155, 'k-blue', 12) + head(125, 100, 36, 155, 'a-blue') +
        '<circle cx="125" cy="100" r="9" class="a-yellow k-black" stroke-width="2.5"/>' +
        star(78, 46, 9, 'a-red') + star(172, 46, 9, 'a-blue'));
    },
    // كعب داير: an eye inside a turning ring (look around)
    peekall: function () {
      return (
        arc(125, 100, 60, 212, 328, 'k-red', 9) + head(125, 100, 60, 328, 'a-red') +
        arc(125, 100, 60, 32, 148, 'k-black', 9) + head(125, 100, 60, 148, 'a-black') +
        '<path d="M80 100C98 70 152 70 170 100C152 130 98 130 80 100Z" class="a-white k-black" stroke-width="3" stroke-linejoin="round"/>' +
        '<circle cx="125" cy="100" r="19" class="a-blue k-black" stroke-width="2.5"/>' +
        '<circle cx="125" cy="100" r="8" class="a-black"/>' +
        '<circle cx="131" cy="94" r="4" class="a-white"/>');
    },
    // بصرة: a card thrown away along a dashed arc
    basra: function () {
      return (
        '<path d="M70 150C68 112 82 88 100 80" class="k-black" fill="none" stroke-width="3.5" stroke-dasharray="7 6" stroke-linecap="round"/>' +
        '<g transform="rotate(-28 108 108)"><rect x="86" y="76" width="44" height="64" rx="5" class="a-blue k-black" stroke-width="2.5"/>' +
        '<rect x="91.5" y="81.5" width="33" height="53" rx="3" fill="none" class="k-white" stroke-width="2"/></g>' +
        '<g transform="rotate(16 142 100)"><rect x="120" y="68" width="44" height="64" rx="5" class="a-white k-black" stroke-width="2.5"/>' +
        '<use href="#sx-hearts" class="s-red" x="131" y="87" width="22" height="22"/></g>' +
        star(176, 52, 13, 'a-yellow') + star(84, 52, 8, 'a-yellow') +
        '<path d="M168 112L184 106M170 124L188 124M168 136L184 142" class="k-black" fill="none" stroke-width="3" stroke-linecap="round"/>');
    },
  };

  const ABILITY_LABEL = {
    swap: ['خد', 'وهات'],
    peekall: ['كعب', 'داير'],
    basra: ['بصرة'],
  };

  const NAMES = {
    swap: 'خد وهات', peekall: 'كعب داير', basra: 'بصرة', plus20: '+20',
    screw_red: 'سكرو أحمر', screw_green: 'سكرو أخضر', minus1: 'سالب واحد',
  };
  const SUIT_NAMES = { spades: 'ورق شجر', hearts: 'قلب', diamonds: 'ديناري', clubs: 'سباتي' };

  function abilityIndex(card) {
    return '<text class="f-num tx-black" x="30" y="64" text-anchor="middle" font-size="40">' + card.value + '</text>';
  }

  // the card's name on a horizontal band across the middle, always upright
  const BAND_SIZE = { swap: 46, peekall: 44, basra: 54 };
  function nameBand(card) {
    return '<rect x="8" y="148" width="234" height="54" rx="6" class="a-black"/>' +
      '<path d="M14 153.5H236M14 196.5H236" fill="none" class="k-yellow" stroke-width="1.6"/>' +
      '<text class="f-num tx-yellow" x="125" y="176" text-anchor="middle" dominant-baseline="central" font-size="' + BAND_SIZE[card.type] + '">' +
      ABILITY_LABEL[card.type].join(' ') + '</text>';
  }

  function abilityFace(card, mini) {
    const art = ART[card.type]();
    if (mini) {
      return '<g transform="translate(125 175) scale(1.62) translate(-125 -102)">' + FIELD_FULL + art + '</g>';
    }
    // each half: the illustration, scaled to fit between the frame and the name band
    const half = FIELD_HALF + '<g transform="translate(125 88) scale(.78) translate(-125 -100)">' + art + '</g>';
    return '<rect x="56" y="26" width="138" height="298" rx="4" fill="none" class="k-black" stroke-width="2.5"/>' +
      '<g>' + half + '</g><g transform="rotate(180 ' + CX + ' ' + CY + ')">' + half + '</g>' + nameBand(card);
  }

  // ---------- special-value cards (joker style) ----------

  const VALUE_CLASS = { screw_red: 'v-red', screw_green: 'v-green', plus20: 'v-orange', minus1: 'v-blue' };

  function valueText(card) {
    if (card.type === 'minus1') return '−1';
    if (card.type === 'plus20') return '+20';
    return String(card.value);
  }

  function valueArt(card) {
    switch (card.type) {
      case 'screw_red':
      case 'screw_green':
        return '<use href="#sx-screw" class="vf" x="75" y="60" width="100" height="233"/>';
      case 'plus20':
        return '<polygon class="vf" points="' + burst(CX, CY, 96, 78, 18) + '"/>' +
          '<circle cx="125" cy="175" r="66" fill="none" class="k-white" stroke-width="4"/>' +
          '<text class="f-num tx-white" x="125" y="203" text-anchor="middle" font-size="76">+20</text>';
      case 'minus1':
        return '<circle cx="125" cy="175" r="90" class="vf"/>' +
          '<circle cx="125" cy="175" r="76" fill="none" class="k-white" stroke-width="4"/>' +
          '<text class="f-num tx-white" x="125" y="212" text-anchor="middle" font-size="104">−1</text>';
      default:
        return '';
    }
  }

  function valueIcon(card) {
    if (card.type === 'screw_red' || card.type === 'screw_green') {
      return '<use href="#sx-screw" class="vf" x="' + (IX - 9) + '" y="78" width="18" height="42"/>';
    }
    if (card.type === 'plus20') return '<polygon class="vf" points="' + burst(IX, 94, 15, 12, 10) + '"/>';
    return '<circle cx="' + IX + '" cy="94" r="13" class="vf"/>';
  }

  function valueIndex(card) {
    const t = valueText(card);
    return '<text class="f-num vt" x="' + IX + '" y="66" text-anchor="middle" font-size="' + (t.length > 2 ? 34 : 54) + '">' + t + '</text>' + valueIcon(card);
  }

  // ---------- backs ----------

  function backSVG() {
    return '<rect x="1" y="1" width="248" height="348" rx="25" class="c-face"/>' +
      '<rect x="14" y="14" width="222" height="322" rx="14" fill="url(#sx-back)" class="bk-edge" stroke-width="3"/>' +
      '<rect x="22" y="22" width="206" height="306" rx="9" fill="none" class="bk-line" stroke-width="2.5"/>' +
      '<path d="M125 128L168 175L125 222L82 175Z" class="bk-base k-white" stroke-width="4" stroke-linejoin="round"/>' +
      '<path d="M125 144L151 175L125 206L99 175Z" fill="none" class="bk-line" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<circle cx="125" cy="175" r="6" class="bk-dot"/>';
  }

  // ---------- assembling a card ----------

  function label(card) {
    if (card.type === 'num') return card.rank + ' ' + (SUIT_NAMES[card.suit || 'spades']);
    return NAMES[card.type];
  }

  // card: a card object, or {hidden:true}. mini: true = small opponent-size face (one big index, no pips).
  function svg(card, mini) {
    ensureSprite();
    const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" ';
    if (!card || card.hidden) {
      return open + 'class="cv" role="img" aria-label="ظهر الكرت">' + backSVG() + '</svg>';
    }
    let body = '<rect x="1" y="1" width="248" height="348" rx="25" class="c-face"/>';
    let cls = 'cv';
    if (card.type === 'num') {
      if (mini) {
        const suit = card.suit || 'spades';
        const color = SUIT_COLOR[suit];
        body += '<text class="f-num tx-' + color + '" x="125" y="168" text-anchor="middle" font-size="' + (card.rank === 10 ? 150 : 176) + '">' + card.rank + '</text>' +
          '<use href="#sx-' + suit + '" class="s-' + color + '" x="72" y="196" width="106" height="106"/>';
      } else {
        const idx = numIndex(card);
        body += pips(card) + idx + '<g transform="rotate(180 ' + CX + ' ' + CY + ')">' + idx + '</g>';
      }
    } else if (ABILITY_LABEL[card.type]) {
      body += abilityFace(card, mini);
      if (!mini) {
        const idx = abilityIndex(card);
        body += idx + '<g transform="rotate(180 ' + CX + ' ' + CY + ')">' + idx + '</g>';
      }
    } else {
      cls += ' ' + VALUE_CLASS[card.type];
      body += '<rect x="56" y="24" width="138" height="302" rx="10" class="vf" fill-opacity=".09"/>' + valueArt(card);
      if (!mini) {
        const idx = valueIndex(card);
        body += idx + '<g transform="rotate(180 ' + CX + ' ' + CY + ')">' + idx + '</g>';
      }
    }
    return open + 'class="' + cls + '" role="img" aria-label="' + label(card) + '">' + body + '</svg>';
  }

  root.ScrewCards = { svg: svg, label: label, ensureSprite: ensureSprite };
})(window);
