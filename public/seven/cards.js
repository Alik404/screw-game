// "Seven & Seven" card art, drawn as inline SVG (viewBox 250x350, ratio 5:7). All original artwork.
// Colours come from CSS (--cc = the card colour, --fg = ink on that colour), so the file has no colour values.
// Each colour also has its own small shape (circle, square, triangle, diamond) so cards can be told apart
// without relying on colour alone.
(function (root) {
  const W = 250;
  const H = 350;
  const CX = 125;
  const CY = 175;

  const LABEL = { skip: 'منع', reverse: 'عكس', draw2: '+2', wild: 'لون', wild4: '+4' };

  // ---------- shared defs (the back pattern), injected once ----------

  const SPRITE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    '<pattern id="sc-back-pat" width="28" height="28" patternUnits="userSpaceOnUse">' +
    '<rect width="28" height="28" class="sc-back-bg"/>' +
    '<path d="M14 3L25 14L14 25L3 14Z" class="sc-back-line" fill="none" stroke-width="2"/>' +
    '<circle cx="14" cy="14" r="2.2" class="sc-back-dot"/><circle cx="0" cy="0" r="2" class="sc-back-dot"/><circle cx="28" cy="0" r="2" class="sc-back-dot"/>' +
    '<circle cx="0" cy="28" r="2" class="sc-back-dot"/><circle cx="28" cy="28" r="2" class="sc-back-dot"/>' +
    '</pattern></defs></svg>';

  function ensureSprite() {
    if (document.getElementById('sc-sprite-host')) return;
    const host = document.createElement('div');
    host.id = 'sc-sprite-host';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    host.innerHTML = SPRITE;
    (document.body || document.documentElement).prepend(host);
  }

  // ---------- little pieces ----------

  function r1(n) { return Math.round(n * 10) / 10; }

  // the colour's own shape, centred at (cx, cy); s = overall size
  function shape(color, cx, cy, s) {
    const h = s / 2;
    switch (color) {
      case 'red': return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r1(h * 0.95) + '" class="sc-fg"/>';
      case 'yellow': return '<rect x="' + r1(cx - h * 0.88) + '" y="' + r1(cy - h * 0.88) + '" width="' + r1(h * 1.76) + '" height="' + r1(h * 1.76) + '" rx="3" class="sc-fg"/>';
      case 'green': return '<polygon points="' + cx + ',' + r1(cy - h) + ' ' + r1(cx + h * 1.08) + ',' + r1(cy + h * 0.85) + ' ' + r1(cx - h * 1.08) + ',' + r1(cy + h * 0.85) + '" class="sc-fg" stroke-linejoin="round"/>';
      case 'blue': return '<polygon points="' + cx + ',' + r1(cy - h * 1.12) + ' ' + r1(cx + h * 0.88) + ',' + cy + ' ' + cx + ',' + r1(cy + h * 1.12) + ' ' + r1(cx - h * 0.88) + ',' + cy + '" class="sc-fg"/>';
      default: return '';
    }
  }

  // four-colour pinwheel (the wild symbol); r = radius, centred at (cx, cy)
  function wheel(cx, cy, r) {
    const q = [['red', -90], ['green', 0], ['blue', 90], ['yellow', 180]];
    let out = '';
    q.forEach(function (x) {
      const a1 = (x[1] * Math.PI) / 180;
      const a2 = ((x[1] + 90) * Math.PI) / 180;
      const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
      const p2 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
      out += '<path d="M' + cx + ' ' + cy + 'L' + r1(p1[0]) + ' ' + r1(p1[1]) + 'A' + r + ' ' + r + ' 0 0 1 ' + r1(p2[0]) + ' ' + r1(p2[1]) + 'Z" class="sc-w-' + x[0] + '"/>';
    });
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r1(r * 0.28) + '" class="sc-white"/>';
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" class="sc-ring" stroke-width="3"/>';
    return out;
  }

  function labelSize(text) {
    const n = Array.from(text).length;
    return n <= 1 ? 46 : n === 2 ? 40 : n === 3 ? 30 : 26;
  }

  // ---------- corner index (top start; the opposite corner is the same turned 180 degrees) ----------

  function corner(card) {
    if (card.type === 'wild' || card.type === 'wild4') {
      return wheel(36, 62, 24) + (card.type === 'wild4' ? '<text class="sc-num sc-fg sc-ltr" x="36" y="112" text-anchor="middle" font-size="30">+4</text>' : '');
    }
    let top;
    if (card.type === 'num') {
      const t = String(card.rank);
      top = '<text class="sc-num sc-fg" x="36" y="62" text-anchor="middle" font-size="' + labelSize(t) + '">' + t + '</text>';
    } else if (card.type === 'draw2') {
      top = '<text class="sc-num sc-fg sc-ltr" x="36" y="62" text-anchor="middle" font-size="38">+2</text>';
    } else if (card.type === 'skip') {
      top = '<g transform="translate(36 50)"><circle r="17" fill="none" class="sc-fgs" stroke-width="7"/><path d="M-12 12L12 -12" class="sc-fgs" stroke-width="7" stroke-linecap="round"/></g>';
    } else { // reverse
      top = '<g transform="translate(36 50) scale(.42)">' + arrow(34, -34, -22, true) + arrow(-34, 34, 22, true) + '</g>';
    }
    return top + shape(card.color, 36, 92, 24);
  }

  // ---------- centre symbols (drawn around 0,0 inside the white diamond, about 110 wide) ----------

  function arrow(x1, x2, y, fg) {
    const dir = x2 > x1 ? 1 : -1;
    const hx = x2;
    return '<path d="M' + x1 + ' ' + y + 'H' + (x2 - dir * 6) + '" class="' + (fg ? 'sc-fgs' : 'sc-sym-s') + '" stroke-width="13" stroke-linecap="round" fill="none"/>' +
      '<polygon points="' + (hx + dir * 12) + ',' + y + ' ' + (hx - dir * 10) + ',' + (y - 20) + ' ' + (hx - dir * 10) + ',' + (y + 20) + '" class="' + (fg ? 'sc-fg' : 'sc-sym') + '" stroke-linejoin="round"/>';
  }

  function centre(card) {
    switch (card.type) {
      case 'num': {
        const t = String(card.rank);
        // 6 and 9 get an underline so they cannot be mistaken for each other
        const bar = card.rank === 6 || card.rank === 9 ? '<rect x="-20" y="46" width="40" height="8" rx="4" class="sc-sym"/>' : '';
        return '<text class="sc-num sc-sym" x="0" y="34" text-anchor="middle" font-size="' + (t.length > 1 ? 80 : 104) + '">' + t + '</text>' + bar;
      }
      case 'skip':
        return '<circle cx="0" cy="0" r="40" fill="none" class="sc-sym-s" stroke-width="14"/>' +
          '<path d="M-28 28L28 -28" class="sc-sym-s" stroke-width="14" stroke-linecap="round"/>';
      case 'reverse':
        return arrow(34, -34, -22) + arrow(-34, 34, 22);
      case 'draw2':
        return '<g transform="translate(-12 -8) rotate(-14)"><rect x="-22" y="-32" width="44" height="64" rx="7" class="sc-sym" opacity=".45"/></g>' +
          '<g transform="translate(10 -4) rotate(10)"><rect x="-22" y="-32" width="44" height="64" rx="7" class="sc-sym"/><rect x="-22" y="-32" width="44" height="64" rx="7" fill="none" class="sc-white-stroke" stroke-width="3"/></g>' +
          '<text class="sc-num sc-sym sc-ltr" x="0" y="64" text-anchor="middle" font-size="36">+2</text>';
      case 'wild':
        return wheel(0, 0, 50);
      case 'wild4':
        return wheel(0, -12, 40) + '<text class="sc-num sc-ink sc-ltr" x="0" y="56" text-anchor="middle" font-size="40">+4</text>';
      default:
        return '';
    }
  }

  // ---------- faces and backs ----------

  function face(card) {
    const idx = corner(card);
    return '<rect x="6" y="6" width="238" height="338" rx="26" class="sc-bg"/>' +
      '<rect x="6" y="6" width="238" height="338" rx="26" fill="none" class="sc-edge" stroke-width="10"/>' +
      '<g transform="translate(' + CX + ' ' + CY + ') rotate(45)"><rect x="-64" y="-64" width="128" height="128" rx="28" class="sc-white"/></g>' +
      '<g transform="translate(' + CX + ' ' + CY + ')">' + centre(card) + '</g>' +
      idx + '<g transform="rotate(180 ' + CX + ' ' + CY + ')">' + idx + '</g>';
  }

  // mini face: one big index and the shape, no centre art, readable at 30px wide
  function miniFace(card) {
    if (card.type === 'wild' || card.type === 'wild4') {
      return '<rect x="6" y="6" width="238" height="338" rx="26" class="sc-bg"/><rect x="6" y="6" width="238" height="338" rx="26" fill="none" class="sc-edge" stroke-width="10"/>' +
        wheel(CX, 150, 78) + (card.type === 'wild4' ? '<text class="sc-num sc-fg sc-ltr" x="125" y="300" text-anchor="middle" font-size="84">+4</text>' : '');
    }
    const head = '<rect x="6" y="6" width="238" height="338" rx="26" class="sc-bg"/><rect x="6" y="6" width="238" height="338" rx="26" fill="none" class="sc-edge" stroke-width="10"/>';
    let big;
    if (card.type === 'num') {
      big = '<text class="sc-num sc-fg" x="125" y="205" text-anchor="middle" font-size="190">' + card.rank + '</text>';
    } else if (card.type === 'draw2') {
      big = '<text class="sc-num sc-fg sc-ltr" x="125" y="195" text-anchor="middle" font-size="130">+2</text>';
    } else if (card.type === 'skip') {
      big = '<g transform="translate(125 150) scale(1.9)"><circle r="32" fill="none" class="sc-fgs" stroke-width="12"/><path d="M-22 22L22 -22" class="sc-fgs" stroke-width="12" stroke-linecap="round"/></g>';
    } else { // reverse
      big = '<g transform="translate(125 150) scale(1.35)">' + arrow(34, -34, -22, true) + arrow(-34, 34, 22, true) + '</g>';
    }
    return head + big + shape(card.color, 125, 282, 56);
  }

  // back: dark field, brass frame, a repeating lozenge pattern and "7 7" in a diamond
  function back(mini) {
    if (mini) {
      return '<rect x="6" y="6" width="238" height="338" rx="26" class="sc-back-bg"/><rect x="6" y="6" width="238" height="338" rx="26" fill="none" class="sc-brass" stroke-width="14"/>' +
        '<g transform="translate(' + CX + ' ' + CY + ') rotate(45)"><rect x="-58" y="-58" width="116" height="116" rx="22" fill="none" class="sc-brass" stroke-width="12"/></g>';
    }
    return '<rect x="6" y="6" width="238" height="338" rx="26" class="sc-back-bg"/>' +
      '<rect x="18" y="18" width="214" height="314" rx="16" fill="url(#sc-back-pat)"/>' +
      '<rect x="6" y="6" width="238" height="338" rx="26" fill="none" class="sc-brass" stroke-width="8"/>' +
      '<rect x="22" y="22" width="206" height="306" rx="12" fill="none" class="sc-brass" stroke-width="3" opacity=".7"/>' +
      '<g transform="translate(' + CX + ' ' + CY + ') rotate(45)"><rect x="-66" y="-66" width="132" height="132" rx="26" class="sc-back-bg" stroke-width="0"/><rect x="-66" y="-66" width="132" height="132" rx="26" fill="none" class="sc-brass" stroke-width="7"/></g>' +
      '<text class="sc-num sc-brass-fill" x="125" y="200" text-anchor="middle" font-size="76">7&#160;&#160;7</text>';
  }

  // ---------- assembling ----------

  function label(card) {
    if (!card) return 'كرت مقلوب';
    const D = root.SevenDeck;
    return D ? D.describe(card) : card.type;
  }

  // card: a card object, or null for the back. mini: small version
  function svg(card, mini) {
    ensureSprite();
    const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" class="sc-svg" role="img" aria-label="' + label(card) + '">';
    if (!card) return open + back(mini) + '</svg>';
    return open + (mini ? miniFace(card) : face(card)) + '</svg>';
  }

  // the wrapper classes that carry the colour variables
  function cls(card) {
    return 'sc ' + (card ? (card.color || 'wild') : 'back');
  }

  root.SevenCards = { svg: svg, cls: cls, label: label, ensureSprite: ensureSprite };
})(window);
