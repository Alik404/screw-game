// 3D board for the bank game: Three.js scene, GSAP motion. Loaded as an ES module; exposes window.Bank3D.
// The game logic stays in app.js. This file only draws the view it is given:
//   Bank3D.element()           the persistent host element (canvas + overlay), reused on every render
//   Bank3D.update(view, opts)  sync the scene with an engine view (names, tokens, focus, onCell...)
//   Bank3D.roll([a, b])        tumble the dice and land on the server's numbers
import * as THREE from '/vendor/three.module.min.js';

const gsap = window.gsap;
const B = window.BankBoard;
const U = window.BankUI;
const SQ = B.SQUARES;
const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const dur = (d) => (REDUCED ? 0 : d);

// ---------- colours come from tokens.css ----------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
const COL = {};
['--board', '--board-line', '--ink', '--paper', '--brass', '--table', '--table-glow', '--table-deep', '--red', '--blue', '--green', '--orange', '--text']
  .forEach((n) => { COL[n] = cssVar(n); });
for (let g = 1; g <= 8; g++) COL['--g' + g] = cssVar('--g' + g);
for (let p = 1; p <= 6; p++) COL['--p' + p] = cssVar('--p' + p);

// ---------- board layout: the same 11x11 grid as the 2D board, in texture pixels ----------
const TEX = 2048;
const WORLD = 10; // board top is a 10x10 square centred on the origin
const UNIT = TEX / (1.55 * 2 + 9);
function track(n) {
  if (n === 1) return [0, 1.55 * UNIT];
  if (n === 11) return [TEX - 1.55 * UNIT, 1.55 * UNIT];
  return [1.55 * UNIT + (n - 2) * UNIT, UNIT];
}
function cellRect(i) {
  const p = U.cellPos(i);
  const [x, w] = track(p.c);
  const [y, h] = track(p.r);
  return { x, y, w, h, side: p.side };
}
// the colour band sits on the side that faces the centre of the board
function bandRect(r) {
  const t = 0.26;
  switch (r.side) {
    case 'b': return { x: r.x, y: r.y, w: r.w, h: r.h * t };
    case 't': return { x: r.x, y: r.y + r.h * (1 - t), w: r.w, h: r.h * t };
    case 'l': return { x: r.x + r.w * (1 - t), y: r.y, w: r.w * t, h: r.h };
    case 'r': return { x: r.x, y: r.y, w: r.w * t, h: r.h };
    default: return null;
  }
}
function bodyRect(r, hasBand) {
  if (!hasBand) return r;
  const b = bandRect(r);
  switch (r.side) {
    case 'b': return { x: r.x, y: r.y + b.h, w: r.w, h: r.h - b.h };
    case 't': return { x: r.x, y: r.y, w: r.w, h: r.h - b.h };
    case 'l': return { x: r.x, y: r.y, w: r.w - b.w, h: r.h };
    case 'r': return { x: r.x + b.w, y: r.y, w: r.w - b.w, h: r.h };
    default: return r;
  }
}
const toWorld = (px, py) => new THREE.Vector3(-WORLD / 2 + (px / TEX) * WORLD, 0, -WORLD / 2 + (py / TEX) * WORLD);
const centreOf = (r) => toWorld(r.x + r.w / 2, r.y + r.h / 2);

// ---------- icon images (the same drawings as the 2D board) ----------
const ICON_COLOR = { chance: COL['--orange'], chest: COL['--blue'], tax: COL['--red'], go: COL['--green'], jail: COL['--ink'], parking: COL['--brass'], gotojail: COL['--blue'], station: COL['--ink'], utility: COL['--ink'] };
function svgImage(paths, stroke) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="128" height="128" fill="none" stroke="' + stroke +
    '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return new Promise((resolve) => { img.onload = () => resolve(img); img.onerror = () => resolve(null); });
}
const images = { square: {}, token: {} };
const ready = (async () => {
  const jobs = [];
  SQ.forEach((sq) => {
    const name = U.squareIcon(sq);
    if (name && !images.square[name]) {
      images.square[name] = null;
      jobs.push(svgImage(U.ICON_PATHS[name], ICON_COLOR[sq.type] || COL['--ink']).then((img) => { images.square[name] = img; }));
    }
  });
  Object.keys(U.TOKEN_PATHS).forEach((t) => jobs.push(svgImage(U.TOKEN_PATHS[t], '#ffffff').then((img) => { images.token[t] = img; })));
  jobs.push(document.fonts ? Promise.all([document.fonts.load('700 30px Tajawal'), document.fonts.load('150px Lalezar')]).catch(() => null) : null);
  await Promise.all(jobs);
})();

// ---------- the board texture (redrawn only when ownership / buildings change) ----------
const canvas = document.createElement('canvas');
canvas.width = canvas.height = TEX;
const ctx = canvas.getContext('2d');

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  words.forEach((w) => {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  });
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

function playerColor(view, id) { return COL['--p' + (view.playerIds.indexOf(id) + 1)] || COL['--brass']; }

function drawBoard(view, tokens) {
  ctx.clearRect(0, 0, TEX, TEX);
  // the centre: felt with a soft light, and the name of the game
  const g = ctx.createRadialGradient(TEX / 2, TEX / 2, 60, TEX / 2, TEX / 2, TEX * 0.45);
  g.addColorStop(0, COL['--table-glow']);
  g.addColorStop(1, COL['--table']);
  ctx.fillStyle = COL['--table-deep'];
  ctx.fillRect(0, 0, TEX, TEX);
  ctx.fillStyle = g;
  roundRect(UNIT * 1.55 + 6, UNIT * 1.55 + 6, TEX - UNIT * 3.1 - 12, TEX - UNIT * 3.1 - 12, 28);
  ctx.fill();
  ctx.save();
  ctx.translate(TEX / 2, TEX * 0.36);
  ctx.rotate(-0.07);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = COL['--table-deep'];
  ctx.font = '170px Lalezar, Tajawal, sans-serif';
  ctx.fillText('بنك الحظ', 6, 10);
  ctx.fillStyle = COL['--brass'];
  ctx.fillText('بنك الحظ', 0, 0);
  ctx.restore();

  SQ.forEach((sq, i) => {
    const r0 = cellRect(i);
    const r = { x: r0.x + 5, y: r0.y + 5, w: r0.w - 10, h: r0.h - 10, side: r0.side };
    const pr = view.props[i];
    const owner = pr && pr.owner;
    roundRect(r.x, r.y, r.w, r.h, 12);
    ctx.fillStyle = COL['--board'];
    ctx.fill();
    if (owner) {
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = playerColor(view, owner);
      ctx.fill();
      ctx.restore();
    }
    const band = sq.group ? bandRect(r) : null;
    if (band) {
      ctx.save();
      roundRect(r.x, r.y, r.w, r.h, 12);
      ctx.clip();
      ctx.fillStyle = COL['--g' + sq.group];
      ctx.fillRect(band.x, band.y, band.w, band.h);
      ctx.restore();
    }
    if (owner) {
      roundRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 10);
      ctx.lineWidth = 9;
      ctx.strokeStyle = playerColor(view, owner);
      ctx.stroke();
    }
    // name, price and icon
    const body = bodyRect(r, !!band);
    const corner = r.side === 'corner';
    const ic = U.squareIcon(sq);
    const img = ic && images.square[ic];
    let y = body.y + body.h * (corner ? 0.3 : 0.22);
    if (img) {
      const s = corner ? body.w * 0.42 : Math.min(body.w, body.h) * 0.32;
      ctx.drawImage(img, body.x + body.w / 2 - s / 2, y - s / 2, s, s);
      y += s * 0.6 + 14;
    } else {
      y = body.y + body.h * 0.3;
    }
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL['--ink'];
    ctx.font = (corner ? '700 34px' : '700 27px') + ' Tajawal, sans-serif';
    wrapText(sq.name, body.w - 18).forEach((line, k) => ctx.fillText(line, body.x + body.w / 2, y + k * (corner ? 38 : 30)));
    if (sq.price) {
      ctx.font = '500 24px Tajawal, sans-serif';
      ctx.globalAlpha = 0.7;
      ctx.fillText(String(sq.price), body.x + body.w / 2, body.y + body.h - 26);
      ctx.globalAlpha = 1;
    }
    // owner badge on the band (or in the corner for stations and utilities)
    if (owner) {
      const bx = band ? band.x + band.w / 2 : r.x + 34;
      const by = band ? band.y + band.h / 2 : r.y + 34;
      const rad = band ? Math.min(band.w, band.h) * 0.4 : 26;
      ctx.beginPath();
      ctx.arc(bx, by, rad, 0, Math.PI * 2);
      ctx.fillStyle = playerColor(view, owner);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = COL['--paper'];
      ctx.stroke();
      const t = images.token[tokens[owner]];
      if (t) ctx.drawImage(t, bx - rad * 0.62, by - rad * 0.62, rad * 1.24, rad * 1.24);
    }
    if (pr && pr.mortgaged) {
      ctx.save();
      roundRect(r.x, r.y, r.w, r.h, 12);
      ctx.clip();
      ctx.strokeStyle = 'rgba(31,36,48,.28)';
      ctx.lineWidth = 7;
      for (let k = -r.h; k < r.w; k += 22) { ctx.beginPath(); ctx.moveTo(r.x + k, r.y + r.h); ctx.lineTo(r.x + k + r.h, r.y); ctx.stroke(); }
      ctx.restore();
    }
  });
  texture.needsUpdate = true;
  dirty = true;
}

// ---------- scene ----------
const host = document.createElement('div');
host.className = 'bk-board3d';
const overlay = document.createElement('div');
overlay.className = 'bk-3d-overlay';
host.append(overlay);

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (e) {
  renderer = null;
}
const supported = !!renderer;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
const texture = new THREE.CanvasTexture(canvas);
let dirty = true;

if (supported) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.prepend(renderer.domElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223a40, 1.25));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.1);
  sun.position.set(-4, 12, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  // the board: a dark wooden frame with the printed top
  const frame = new THREE.Mesh(new THREE.BoxGeometry(WORLD + 0.5, 0.4, WORLD + 0.5), new THREE.MeshStandardMaterial({ color: COL['--table-deep'], roughness: 0.7 }));
  frame.position.y = -0.2;
  frame.receiveShadow = true;
  scene.add(frame);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.002;
  top.receiveShadow = true;
  top.name = 'top';
  scene.add(top);
  // a soft shadow catcher around the board so the board sits on the table
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.4;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ---------- 3D pieces, one model per symbol (all original, from simple shapes) ----------
function mat(color, extra) { return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.38, metalness: 0.35 }, extra || {})); }
function mesh(geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true;
  return m;
}
const DARK = () => mat(0x1f2430, { metalness: 0.1, roughness: 0.6 });
const WHITE = () => mat(0xf8f4ea, { metalness: 0.05, roughness: 0.5 });

const MODELS = {
  car(c) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.15, 0.27), mat(c), 0, 0.15, 0));
    g.add(mesh(new THREE.BoxGeometry(0.27, 0.12, 0.23), mat(c), -0.03, 0.28, 0));
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.08, 0.235), mat(0xbfe3f2, { metalness: 0.6, roughness: 0.1 }), -0.03, 0.29, 0));
    [[0.16, 0.135], [0.16, -0.135], [-0.16, 0.135], [-0.16, -0.135]].forEach((p) => {
      const w = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 18), DARK(), p[0], 0.08, p[1]);
      w.rotation.x = Math.PI / 2;
      g.add(w);
    });
    return g;
  },
  camel(c) {
    const g = new THREE.Group();
    const body = mesh(new THREE.SphereGeometry(0.16, 20, 14), mat(c), 0, 0.33, 0);
    body.scale.set(1.45, 0.8, 0.8);
    g.add(body);
    g.add(mesh(new THREE.SphereGeometry(0.1, 16, 12), mat(c), -0.02, 0.44, 0));
    const neck = mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.25, 12), mat(c), 0.22, 0.42, 0);
    neck.rotation.z = -0.55;
    g.add(neck);
    g.add(mesh(new THREE.BoxGeometry(0.13, 0.07, 0.07), mat(c), 0.31, 0.53, 0));
    [[0.13, 0.06], [0.13, -0.06], [-0.13, 0.06], [-0.13, -0.06]].forEach((p) => g.add(mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.28, 8), mat(c), p[0], 0.14, p[1])));
    return g;
  },
  palm(c) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.055, 0.5, 10), mat(0x8d5b3c, { metalness: 0.05, roughness: 0.8 }), 0, 0.27, 0));
    for (let k = 0; k < 7; k++) {
      const leaf = mesh(new THREE.SphereGeometry(0.1, 12, 8), mat(c), 0, 0, 0);
      leaf.scale.set(2.1, 0.22, 0.6);
      const pivot = new THREE.Group();
      pivot.position.y = 0.52;
      pivot.rotation.y = (k / 7) * Math.PI * 2;
      leaf.position.x = 0.17;
      leaf.rotation.z = -0.45;
      pivot.add(leaf);
      g.add(pivot);
    }
    g.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0x8d5b3c), 0.03, 0.5, 0.02));
    return g;
  },
  tea(c) {
    const g = new THREE.Group();
    const pts = [[0, 0], [0.08, 0], [0.09, 0.02], [0.06, 0.15], [0.055, 0.2], [0.085, 0.34], [0.095, 0.36]].map((p) => new THREE.Vector2(p[0], p[1]));
    const glass = mesh(new THREE.LatheGeometry(pts, 28), mat(0xd27a2c, { transparent: true, opacity: 0.85, metalness: 0.1, roughness: 0.1, side: THREE.DoubleSide }), 0, 0.06, 0);
    g.add(glass);
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.03, 28), mat(c), 0, 0.045, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), mat(0xd7d7d7, { metalness: 0.9, roughness: 0.2 }), 0.05, 0.34, 0.02));
    return g;
  },
  boat(c) {
    const g = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(-0.32, 0.18);
    s.quadraticCurveTo(-0.24, 0, 0, 0);
    s.quadraticCurveTo(0.24, 0, 0.32, 0.18);
    s.lineTo(0.22, 0.1);
    s.lineTo(-0.22, 0.1);
    s.closePath();
    const hull = mesh(new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 }), mat(c), 0, 0.06, -0.09);
    g.add(hull);
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), DARK(), 0, 0.35, 0));
    const sail = new THREE.Shape();
    sail.moveTo(0, 0);
    sail.lineTo(0.22, 0);
    sail.lineTo(0, 0.32);
    sail.closePath();
    g.add(mesh(new THREE.ShapeGeometry(sail), mat(0xf8f4ea, { side: THREE.DoubleSide, metalness: 0, roughness: 0.6 }), 0.015, 0.2, 0));
    return g;
  },
  plane(c) {
    const g = new THREE.Group();
    const body = mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 16), mat(c), 0, 0.34, 0);
    body.rotation.z = Math.PI / 2;
    g.add(body);
    const nose = mesh(new THREE.ConeGeometry(0.045, 0.1, 16), mat(c), 0.3, 0.34, 0);
    nose.rotation.z = -Math.PI / 2;
    g.add(nose);
    g.add(mesh(new THREE.BoxGeometry(0.13, 0.02, 0.55), mat(c), 0.02, 0.34, 0));
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.015, 0.22), mat(c), -0.21, 0.35, 0));
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.12, 0.015), mat(c), -0.22, 0.42, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), DARK(), 0, 0.17, 0));
    return g;
  },
  dallah(c) {
    const g = new THREE.Group();
    const pts = [[0, 0], [0.12, 0], [0.135, 0.04], [0.1, 0.18], [0.06, 0.25], [0.085, 0.29], [0.05, 0.35], [0, 0.38]].map((p) => new THREE.Vector2(p[0], p[1]));
    g.add(mesh(new THREE.LatheGeometry(pts, 28), mat(c, { metalness: 0.7, roughness: 0.25 }), 0, 0.05, 0));
    const spout = mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.24, 10), mat(c, { metalness: 0.7, roughness: 0.25 }), 0.14, 0.26, 0);
    spout.rotation.z = -0.9;
    g.add(spout);
    g.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), mat(c, { metalness: 0.7 }), 0, 0.45, 0));
    const handle = mesh(new THREE.TorusGeometry(0.08, 0.012, 8, 20, Math.PI), mat(c, { metalness: 0.7 }), -0.1, 0.2, 0);
    handle.rotation.z = Math.PI / 2;
    g.add(handle);
    return g;
  },
  crown(c) {
    const g = new THREE.Group();
    const band = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.14, 32, 1, true), mat(c, { metalness: 0.75, roughness: 0.25, side: THREE.DoubleSide }), 0, 0.15, 0);
    g.add(band);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.add(mesh(new THREE.ConeGeometry(0.045, 0.14, 10), mat(c, { metalness: 0.75, roughness: 0.25 }), Math.cos(a) * 0.14, 0.28, Math.sin(a) * 0.14));
      g.add(mesh(new THREE.SphereGeometry(0.025, 10, 8), mat(0xf8f4ea, { metalness: 0.3, roughness: 0.2 }), Math.cos(a) * 0.14, 0.36, Math.sin(a) * 0.14));
    }
    return g;
  },
};

function buildPiece(type, color) {
  const g = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 32), mat(color, { metalness: 0.2, roughness: 0.5 }), 0, 0.025, 0);
  base.receiveShadow = true;
  g.add(base);
  const rim = mesh(new THREE.TorusGeometry(0.205, 0.012, 8, 40), WHITE(), 0, 0.05, 0);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const figure = (MODELS[type] || MODELS.car)(color);
  figure.position.y = 0.04;
  g.add(figure);
  g.scale.setScalar(1.15);
  return g;
}

// ---------- houses and hotels ----------
const buildings = new THREE.Group();
scene.add(buildings);
function houseMesh() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.09, 0.12), mat(0x3daa6d, { metalness: 0.1, roughness: 0.5 }), 0, 0.045, 0));
  const roof = mesh(new THREE.ConeGeometry(0.1, 0.07, 4), mat(0x2e7d51, { metalness: 0.1 }), 0, 0.125, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  return g;
}
function hotelMesh() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.16, 0.14), mat(0xd6453d, { metalness: 0.1, roughness: 0.5 }), 0, 0.08, 0));
  const roof = mesh(new THREE.BoxGeometry(0.32, 0.03, 0.16), mat(0x9e2e28), 0, 0.175, 0);
  g.add(roof);
  return g;
}
function placeBuildings(view) {
  buildings.clear();
  SQ.forEach((sq, i) => {
    const pr = view.props[i];
    if (!pr || !pr.houses || !sq.group) return;
    const band = bandRect(cellRect(i));
    const c = centreOf(band);
    const along = band.w > band.h ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    if (pr.houses === 5) {
      const m = hotelMesh();
      m.position.copy(c);
      if (along.z) m.rotation.y = Math.PI / 2;
      buildings.add(m);
      return;
    }
    for (let k = 0; k < pr.houses; k++) {
      const m = houseMesh();
      const off = (k - (pr.houses - 1) / 2) * 0.17;
      m.position.copy(c).addScaledVector(along, off);
      buildings.add(m);
    }
  });
}

// ---------- highlight frames (current square, selected square) ----------
function frameMesh(color, opacity) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity });
  ['n', 's', 'e', 'w'].forEach((k) => { const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 1), m); b.name = k; g.add(b); });
  g.visible = false;
  scene.add(g);
  return g;
}
function fitFrame(f, i) {
  const r = cellRect(i);
  const c = centreOf(r);
  const w = (r.w / TEX) * WORLD;
  const d = (r.h / TEX) * WORLD;
  const t = 0.06;
  f.children.forEach((b) => {
    if (b.name === 'n' || b.name === 's') { b.scale.set(w, 1, t); b.position.set(0, 0.03, (b.name === 'n' ? -1 : 1) * (d / 2 - t / 2)); } else { b.scale.set(t, 1, d); b.position.set((b.name === 'w' ? -1 : 1) * (w / 2 - t / 2), 0.03, 0); }
  });
  f.position.copy(c);
  f.visible = true;
}
const curFrame = frameMesh(COL['--brass'], 0.95);
const focusFrame = frameMesh(COL['--paper'], 0.95);

// ---------- dice ----------
function pipTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 128, 128);
  const P = { 1: [[64, 64]], 2: [[32, 32], [96, 96]], 3: [[32, 32], [64, 64], [96, 96]], 4: [[32, 32], [96, 32], [32, 96], [96, 96]], 5: [[32, 32], [96, 32], [64, 64], [32, 96], [96, 96]], 6: [[32, 30], [96, 30], [32, 64], [96, 64], [32, 98], [96, 98]] };
  x.fillStyle = COL['--ink'];
  P[n].forEach((p) => { x.beginPath(); x.arc(p[0], p[1], 11, 0, Math.PI * 2); x.fill(); });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// faces in BoxGeometry order: +x, -x, +y, -y, +z, -z
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
// rotation (x, z) that brings each value to the top
const UP = { 1: [0, 0], 6: [Math.PI, 0], 2: [-Math.PI / 2, 0], 5: [Math.PI / 2, 0], 3: [0, Math.PI / 2], 4: [0, -Math.PI / 2] };
const DIE = 0.62;
const diceMats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: pipTexture(v), roughness: 0.35, metalness: 0.05 }));
const dice = [0, 1].map((k) => {
  const d = mesh(new THREE.BoxGeometry(DIE, DIE, DIE), diceMats, (k ? 0.5 : -0.5), DIE / 2, 0.6);
  scene.add(d);
  return d;
});
let diceValues = [5, 3];
function restDice(values) {
  dice.forEach((d, k) => {
    const u = UP[values[k]];
    d.rotation.set(u[0], (k ? -0.25 : 0.2), u[1]);
    d.position.set(k ? 0.5 : -0.5, DIE / 2, 0.6);
  });
  diceValues = values.slice();
  dirty = true;
}
function rollDice(values) {
  dice.forEach((d, k) => {
    const u = UP[values[k]];
    const tl = gsap.timeline({ onUpdate: () => { dirty = true; } });
    const fromX = (k ? 1.6 : -1.6);
    tl.fromTo(d.position, { x: fromX, y: 2.6, z: 3 }, { x: k ? 0.5 : -0.5, z: 0.6, duration: dur(0.95), ease: 'power2.out' }, 0);
    tl.fromTo(d.position, { y: 2.6 }, { y: DIE / 2, duration: dur(0.95), ease: 'bounce.out' }, 0);
    tl.fromTo(d.rotation,
      { x: u[0] + Math.PI * 4 + Math.random(), y: Math.random() * 6, z: u[1] + Math.PI * 4 + Math.random() },
      { x: u[0], y: (k ? -0.25 : 0.2), z: u[1], duration: dur(1.0), ease: 'power3.out' }, 0);
    tl.delay(k * 0.08);
  });
  diceValues = values.slice();
}

// ---------- pieces on the board ----------
const pieces = {}; // id -> { obj, pos, type, color, bob }
function squareSpot(i, k, n) {
  const r = cellRect(i);
  const sq = SQ[i];
  const body = bodyRect(r, !!sq.group);
  const c = centreOf(body);
  if (n <= 1) return c;
  const a = (k / n) * Math.PI * 2;
  const rad = Math.min(body.w, body.h) / TEX * WORLD * 0.28;
  return c.add(new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad));
}

function syncPieces(view, tokens) {
  const alive = view.playerIds.filter((id) => !view.players[id].bankrupt);
  Object.keys(pieces).forEach((id) => {
    if (alive.indexOf(id) < 0 || pieces[id].type !== (tokens[id] || 'car')) { scene.remove(pieces[id].obj); delete pieces[id]; }
  });
  const bySquare = {};
  alive.forEach((id) => { const p = view.players[id].pos; (bySquare[p] = bySquare[p] || []).push(id); });
  alive.forEach((id) => {
    const pos = view.players[id].pos;
    const group = bySquare[pos];
    const spot = squareSpot(pos, group.indexOf(id), group.length);
    let pc = pieces[id];
    if (!pc) {
      const type = tokens[id] || 'car';
      const obj = buildPiece(type, playerColor(view, id));
      obj.position.copy(spot);
      scene.add(obj);
      pc = pieces[id] = { obj: obj, pos: pos, type: type, target: spot.clone() };
    } else if (pc.pos !== pos || pc.target.distanceTo(spot) > 0.001) {
      // hop to the new place (the 2D logic already walks square by square)
      const steps = Math.min(4, (pos - pc.pos + 40) % 40 || 1);
      const d = dur(0.28 * Math.min(steps, 2));
      gsap.killTweensOf(pc.obj.position);
      gsap.to(pc.obj.position, { x: spot.x, z: spot.z, duration: d, ease: 'power1.inOut', onUpdate: () => { dirty = true; } });
      gsap.timeline({ onUpdate: () => { dirty = true; } })
        .to(pc.obj.position, { y: pc.pos === pos ? 0 : 0.42, duration: d / 2, ease: 'power2.out' })
        .to(pc.obj.position, { y: 0, duration: d / 2, ease: 'bounce.out' });
      pc.pos = pos;
      pc.target = spot.clone();
    }
    // the player whose turn it is slowly turns, so you see whose move it is
    const isCur = view.currentPlayerId === id;
    if (isCur && !pc.spin) {
      pc.spin = gsap.to(pc.obj.rotation, { y: '+=' + Math.PI * 2, duration: dur(6), repeat: -1, ease: 'none', onUpdate: () => { dirty = true; } });
    } else if (!isCur && pc.spin) {
      pc.spin.kill();
      pc.spin = null;
      gsap.to(pc.obj.rotation, { y: 0, duration: dur(0.4), onUpdate: () => { dirty = true; } });
    }
  });
}

// ---------- camera, resize, picking ----------
function fitCamera() {
  const w = host.clientWidth || 1;
  const h = host.clientHeight || 1;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // tilted view from the near side: move back until every board corner
  // (and a piece standing on it) is inside the picture
  const half = (WORLD + 0.5) / 2;
  const pts = [];
  [-half, half].forEach((x) => [-half, half].forEach((z) => [0, 0.9].forEach((y) => pts.push(new THREE.Vector3(x, y, z)))));
  const dir = new THREE.Vector3(0, 0.95, 0.45).normalize();
  const target = new THREE.Vector3(0, 0, 0);
  let cy = 0; // vertical centre of the board in the picture
  const fits = (d) => {
    camera.position.copy(dir).multiplyScalar(d).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let ok = true, y0 = 1e9, y1 = -1e9;
    pts.forEach((p) => {
      const q = p.clone().project(camera);
      if (Math.abs(q.x) > 0.97 || Math.abs(q.y) > 0.97 || q.z >= 1) ok = false;
      y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    });
    cy = (y0 + y1) / 2;
    return ok;
  };
  const fitDistance = () => {
    let lo = 4, hi = 80;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    fits(hi);
  };
  // the tilt pushes the board low: slide the look point until it is centred
  for (let k = 0; k < 6; k++) {
    fitDistance();
    if (Math.abs(cy) < 0.005) break;
    target.z -= cy * half * 0.9;
  }
  renderer.setSize(w, h, false);
  dirty = true;
}
if (supported && window.ResizeObserver) new ResizeObserver(fitCamera).observe(host);

const ray = new THREE.Raycaster();
let onCell = null;
if (supported) {
  renderer.domElement.addEventListener('click', (ev) => {
    if (!onCell) return;
    const r = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v, camera);
    const hit = ray.intersectObject(scene.getObjectByName('top'))[0];
    if (!hit) return;
    const px = ((hit.point.x + WORLD / 2) / WORLD) * TEX;
    const py = ((hit.point.z + WORLD / 2) / WORLD) * TEX;
    for (let i = 0; i < SQ.length; i++) {
      const c = cellRect(i);
      if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) { onCell(i); return; }
    }
  });
}

// render only when something changed or moves
if (supported) {
  gsap.ticker.add(() => {
    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
  });
}

// ---------- public API ----------
let lastSig = '';
let fontsDone = false;
ready.then(() => { fontsDone = true; lastSig = ''; if (lastView) update(lastView.view, lastView.opts); });
let lastView = null;

function update(view, opts) {
  opts = opts || {};
  lastView = { view: view, opts: opts };
  onCell = opts.onCell || null;
  const tokens = opts.tokens || {};
  // the texture only changes with ownership, mortgages and pieces' symbols
  const sig = JSON.stringify([view.playerIds, SQ.map((s, i) => view.props[i] ? [view.props[i].owner, view.props[i].mortgaged] : 0), tokens, fontsDone]);
  if (sig !== lastSig) { lastSig = sig; drawBoard(view, tokens); }
  const bsig = JSON.stringify(SQ.map((s, i) => view.props[i] ? view.props[i].houses : 0));
  if (bsig !== update.bsig) { update.bsig = bsig; placeBuildings(view); }
  syncPieces(view, tokens);
  // the current player's square and the selected square
  const cur = view.currentPlayerId;
  if (cur && !view.players[cur].bankrupt) fitFrame(curFrame, view.players[cur].pos); else curFrame.visible = false;
  if (opts.focus !== null && opts.focus !== undefined) fitFrame(focusFrame, opts.focus); else focusFrame.visible = false;
  if (!opts.rolling && view.dice && (view.dice[0] !== diceValues[0] || view.dice[1] !== diceValues[1])) restDice(view.dice);
  // words over the board: last event and whose turn it is
  overlay.replaceChildren();
  if (opts.eventText) { const e = document.createElement('div'); e.className = 'bk-3d-event'; e.textContent = opts.eventText; overlay.append(e); }
  if (cur && opts.names) {
    const t = document.createElement('div');
    t.className = 'bk-3d-turn';
    t.style.setProperty('--pc', 'var(--p' + (view.playerIds.indexOf(cur) + 1) + ')');
    const d = document.createElement('span');
    d.className = 'dot';
    t.append(d, cur === view.you ? 'دورك' : 'دور ' + opts.names[cur]);
    overlay.append(t);
  }
  dirty = true;
}

window.Bank3D = {
  supported: () => supported,
  element: () => host,
  update: update,
  roll: rollDice,
};
window.dispatchEvent(new Event('bank3d-ready'));
