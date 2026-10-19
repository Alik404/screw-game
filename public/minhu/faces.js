// "Minhu?" faces: flat SVG portraits drawn from the character table (config.js), so what you see always
// matches what the server answers. viewBox 100 x 120. Colours come from CSS classes (minhu.css / tokens.css).
(function (root) {
  const C = root.MinhuConfig;

  const HEAD = { cx: 50, cy: 54, rx: 21, ry: 25 };

  function hairBack(c) {
    switch (c.hair) {
      case 'long': return '<path class="hair" d="M27 48 C24 70 25 94 30 104 L70 104 C75 94 76 70 73 48 C70 30 30 30 27 48 Z"/>';
      case 'curly': return '<g class="hair">' + [[30, 40, 10], [38, 30, 11], [50, 26, 12], [62, 30, 11], [70, 40, 10], [27, 52, 8], [73, 52, 8]].map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + p[2] + '"/>'; }).join('') + '</g>';
      case 'bun': return '<circle class="hair" cx="50" cy="22" r="10"/>';
      case 'ponytail': return '<path class="hair" d="M66 36 C82 38 84 60 78 76 C76 66 72 54 66 48 Z"/>';
      default: return '';
    }
  }

  function hairFront(c) {
    switch (c.hair) {
      case 'short': return '<path class="hair" d="M29 50 C27 30 39 24 50 24 C63 24 74 30 71 50 C68 40 62 35 52 35 C44 35 36 38 33 44 C31 46 30 48 29 50 Z"/>';
      case 'long': return '<path class="hair" d="M29 52 C27 30 39 25 50 25 C62 25 74 31 71 52 C66 38 58 33 50 33 C44 38 36 42 29 52 Z"/>';
      case 'curly': return '<g class="hair">' + [[34, 36, 7], [42, 31, 8], [51, 29, 8], [60, 31, 8], [67, 37, 7]].map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + p[2] + '"/>'; }).join('') + '</g>';
      case 'bun':
      case 'ponytail': return '<path class="hair" d="M29 50 C28 32 39 27 50 27 C61 27 72 32 71 50 C67 38 60 34 50 34 C40 34 33 38 29 50 Z"/>';
      case 'bald': return c.old ? '<path class="hair" d="M28 52 C28 46 30 44 31 43 L32 54 Z M72 52 C72 46 70 44 69 43 L68 54 Z"/><ellipse class="shine" cx="44" cy="35" rx="7" ry="3.5"/>' : '<ellipse class="shine" cx="44" cy="35" rx="7" ry="3.5"/>';
      default: return '';
    }
  }

  function eyes(c) {
    let s = '';
    [41, 59].forEach(function (x) {
      s += '<ellipse class="eye-w" cx="' + x + '" cy="53" rx="4.2" ry="3.4"/><circle class="eye" cx="' + x + '" cy="53.4" r="2.4"/><circle class="eye-hi" cx="' + (x + 0.8) + '" cy="52.6" r="0.8"/>';
    });
    // eyebrows (hair colour; dark when the hair is hidden)
    s += '<path class="brow" d="M35.5 46.5 Q41 43.5 46 46"/><path class="brow" d="M54 46 Q59 43.5 64.5 46.5"/>';
    return s;
  }

  function mouth(c) {
    if (c.smile) return '<path class="mouth-open" d="M42.5 67 Q50 76 57.5 67 Z"/><path class="teeth" d="M43.5 67.5 L56.5 67.5 L55.5 69.6 L44.5 69.6 Z"/>';
    return '<path class="mouth" d="M44 68.5 Q50 71.5 56 68.5"/>';
  }

  function beard(c) {
    let s = '';
    if (c.beard) s += '<path class="fhair" d="M29.5 54 C29 78 40 86 50 86 C60 86 71 78 70.5 54 C67 66 62 72 56 73 C54 70 46 70 44 73 C38 72 33 66 29.5 54 Z"/>';
    if (c.mustache) s += '<path class="fhair" d="M41 65 C44 61 48 62 50 63.5 C52 62 56 61 59 65 C56 64.5 53 65.5 50 66 C47 65.5 44 64.5 41 65 Z"/>';
    return s;
  }

  function glasses() {
    return '<g class="glasses"><circle cx="41" cy="53" r="6.3"/><circle cx="59" cy="53" r="6.3"/><path d="M47.3 53 Q50 51 52.7 53 M34.7 52 L29.5 50.5 M65.3 52 L70.5 50.5"/></g>';
  }

  function headwear(c) {
    switch (c.hat) {
      case 'cap': return '<path class="hat" d="M28 44 C27 26 39 18 50 18 C62 18 73 26 72 44 C64 39 36 39 28 44 Z"/><path class="hat-2" d="M50 41 C62 40 76 41 86 45 C84 48 74 48 66 46 C60 44 54 43 50 43 Z"/><circle class="hat-2" cx="50" cy="19" r="2.2"/>';
      case 'beret': return '<ellipse class="hat" cx="46" cy="30" rx="26" ry="9" transform="rotate(-9 46 30)"/><circle class="hat" cx="40" cy="21" r="2.6"/>';
      case 'hijab': return '<path class="scarf" fill-rule="evenodd" d="M16 120 C16 98 22 88 29 80 C22 66 22 40 33 28 C40 19 60 19 67 28 C78 40 78 66 71 80 C78 88 84 98 84 120 Z M31 54 A19 23 0 1 0 69 54 A19 23 0 1 0 31 54 Z"/><path class="scarf-2" d="M33 32 C42 24 58 24 67 32"/>';
      case 'shemagh': return '<path class="shemagh" fill-rule="evenodd" d="M12 120 C12 96 20 86 28 80 C20 64 20 38 32 26 C40 17 60 17 68 26 C80 38 80 64 72 80 C80 86 88 96 88 120 Z M31 55 A19 23 0 1 0 69 55 A19 23 0 1 0 31 55 Z"/>' +
        '<ellipse class="agal" cx="50" cy="27" rx="21" ry="5.5"/><ellipse class="agal" cx="50" cy="31.5" rx="21.5" ry="5.5"/>';
      default: return '';
    }
  }

  // the portrait of character i (an <svg> string)
  function face(i) {
    const c = C.CHARACTERS[i];
    const covered = c.hat === 'hijab' || c.hat === 'shemagh';
    const cls = 'mh-face sk-' + c.skin + ' hc-' + (c.color || (c.old ? 'gray' : 'black')) + ' sh-' + c.shirt + ' sc-' + ((c.shirt + 2) % 8 + 1);
    let s = '<svg class="' + cls + '" viewBox="0 0 100 120" aria-hidden="true">';
    // shoulders, neck
    s += '<path class="shirt" d="M8 120 C10 98 28 89 50 89 C72 89 90 98 92 120 Z"/>';
    s += '<path class="collar" d="M40 90 L50 101 L60 90 Z"/>';
    s += '<rect class="skin" x="42" y="72" width="16" height="20" rx="6"/><rect class="shade" x="42" y="72" width="16" height="9" rx="4"/>';
    if (!covered) s += hairBack(c);
    // head and ears
    if (!covered) s += '<ellipse class="skin" cx="29" cy="56" rx="4" ry="6"/><ellipse class="skin" cx="71" cy="56" rx="4" ry="6"/>';
    s += '<ellipse class="skin" cx="' + HEAD.cx + '" cy="' + HEAD.cy + '" rx="' + HEAD.rx + '" ry="' + HEAD.ry + '"/>';
    if (c.earrings && !covered) s += '<circle class="earring" cx="29" cy="64" r="2.6"/><circle class="earring" cx="71" cy="64" r="2.6"/>';
    if (c.old) s += '<path class="wrinkle" d="M41 39 Q50 37 59 39 M43 42.5 Q50 41 57 42.5 M33 57 L35 58 M67 57 L65 58"/>';
    s += eyes(c);
    s += '<path class="nose" d="M50 55 Q47.5 62 49.5 63 Q51 63.4 52 62.6"/>';
    s += '<circle class="blush" cx="36" cy="63" r="4"/><circle class="blush" cx="64" cy="63" r="4"/>';
    s += beard(c);
    s += mouth(c);
    if (!covered) s += hairFront(c);
    if (c.glasses) s += glasses();
    s += headwear(c);
    return s + '</svg>';
  }

  // the shemagh's red checks, once per page
  function ensureDefs() {
    if (document.getElementById('mh-defs')) return;
    const d = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    d.id = 'mh-defs';
    d.setAttribute('width', '0');
    d.setAttribute('height', '0');
    d.style.position = 'absolute';
    d.innerHTML = '<defs><pattern id="mh-checks" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="7" height="7" class="mh-chk-bg"/><rect width="3.2" height="3.2" class="mh-chk"/><rect x="3.5" y="3.5" width="3.2" height="3.2" class="mh-chk"/></pattern></defs>';
    document.body.append(d);
  }

  root.MinhuFaces = { face: face, ensureDefs: ensureDefs };
})(window);
