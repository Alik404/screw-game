// 3D board for the bank game: Three.js scene, GSAP motion. Loaded as an ES module; exposes window.Bank3D.
// The game logic stays in app.js. This file only draws the view it is given:
//   Bank3D.element()           the persistent host element (canvas + overlay), reused on every render
//   Bank3D.update(view, opts)  sync the scene with an engine view (names, tokens, focus, onCell...)
//   Bank3D.roll([a, b])        tumble the dice and land on the server's numbers
// The camera follows the player whose turn it is, close enough to read the squares;
// a button, the mouse wheel or a pinch shows the whole board, and a swipe looks along it.
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
['--board', '--board-line', '--board-edge', '--wood', '--wood-dark', '--ink', '--paper', '--brass', '--table', '--table-glow', '--table-deep', '--red', '--blue', '--green', '--orange', '--text', '--text-dim']
  .forEach((n) => { COL[n] = cssVar(n); });
for (let g = 1; g <= 8; g++) COL['--g' + g] = cssVar('--g' + g);
for (let p = 1; p <= 6; p++) COL['--p' + p] = cssVar('--p' + p);

// ---------- board layout: the same 11x11 grid as the 2D board ----------
// All drawing uses TEX logical pixels; the canvas itself is SCALE times bigger for sharp text.
const TEX = 2048;
const WORLD = 10; // board is a 10x10 square centred on the origin
const UNIT = TEX / (1.55 * 2 + 9);
const GAP = 5; // logical pixels between two raised squares (each side)
const TILE_H = 0.12; // height of a square
const OWNED_H = 0.26; // owned squares stand higher
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
const inset = (r, d) => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d, side: r.side });
// the colour band sits on the side that faces the centre of the board
function bandRect(r) {
  const t = 0.2;
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
const CENTRE = { x: 1.55 * UNIT, y: 1.55 * UNIT, w: TEX - 3.1 * UNIT, h: TEX - 3.1 * UNIT };
// Like a real board, every square is printed to be read from outside its own side:
// bottom row upright, left column turned a quarter, top row upside down, right column the other quarter.
// A corner is printed like the side that starts at it.
const SIDE_ROT = { b: 0, l: Math.PI / 2, t: Math.PI, r: -Math.PI / 2 };
const CORNER_ROT = { 0: 0, 10: Math.PI / 2, 20: Math.PI, 30: -Math.PI / 2 };

// ---------- icon images (the same drawings as the 2D board) ----------
const ICON_COLOR = { chance: COL['--orange'], chest: COL['--blue'], tax: COL['--red'], go: COL['--green'], jail: COL['--ink'], parking: COL['--brass'], gotojail: COL['--blue'], station: COL['--ink'], utility: COL['--ink'] };
function svgImage(paths, stroke) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="192" height="192" fill="none" stroke="' + stroke +
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
  Object.keys(U.TOKEN_PATHS).forEach((t) => jobs.push(svgImage(U.TOKEN_PATHS[t], COL['--paper']).then((img) => { images.token[t] = img; })));
  jobs.push(document.fonts ? Promise.all([document.fonts.load('700 30px Tajawal'), document.fonts.load('800 30px Tajawal'), document.fonts.load('150px Lalezar')]).catch(() => null) : null);
  await Promise.all(jobs);
})();

// ---------- the printed texture: every square top and the centre ----------
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (e) {
  renderer = null;
}
const supported = !!renderer;
// big screens get a 4096 texture, phones 3072 (sharp text without eating the phone's memory)
const maxTex = supported ? renderer.capabilities.maxTextureSize : 2048;
const SCALE = Math.min(maxTex / TEX, Math.min(window.innerWidth, window.innerHeight) >= 700 ? 2 : 1.5);
const canvas = document.createElement('canvas');
canvas.width = canvas.height = Math.round(TEX * SCALE);
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

function wrapWords(text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  words.forEach((w) => {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  });
  if (line) lines.push(line);
  return lines;
}
// the biggest font (from sizes) that fits the text in maxLines lines of maxW and a height of maxH
function fitName(text, maxW, sizes, maxLines, maxH) {
  for (const s of sizes) {
    ctx.font = '700 ' + s + 'px Tajawal, sans-serif';
    const lines = wrapWords(text, maxW);
    if (lines.length <= maxLines && lines.length * s * 1.12 <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size: s, lines: lines };
  }
  const s = sizes[sizes.length - 1];
  ctx.font = '700 ' + s + 'px Tajawal, sans-serif';
  return { size: s, lines: wrapWords(text, maxW).slice(0, maxLines) };
}
function fitLine(text, maxW, size, weight) {
  let s = size;
  ctx.font = weight + ' ' + s + 'px Tajawal, sans-serif';
  while (s > 16 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = weight + ' ' + s + 'px Tajawal, sans-serif'; }
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  return t === text ? t : t + '…';
}

function playerColor(view, id) { return COL['--p' + (view.playerIds.indexOf(id) + 1)] || COL['--brass']; }

function drawCentre() {
  const c = CENTRE;
  ctx.fillStyle = COL['--wood-dark'];
  ctx.fillRect(0, 0, TEX, TEX);
  const g = ctx.createRadialGradient(TEX / 2, TEX / 2, 40, TEX / 2, TEX / 2, c.w * 0.62);
  g.addColorStop(0, COL['--table-glow']);
  g.addColorStop(1, COL['--table-deep']);
  ctx.fillStyle = g;
  ctx.fillRect(c.x, c.y, c.w, c.h);
  // a faint eight-point star lattice, like old Baghdadi tiles
  ctx.save();
  ctx.beginPath();
  ctx.rect(c.x, c.y, c.w, c.h);
  ctx.clip();
  ctx.strokeStyle = COL['--brass'];
  ctx.globalAlpha = 0.09;
  ctx.lineWidth = 3;
  const step = 150;
  for (let x = c.x + step / 2; x < c.x + c.w + step; x += step) {
    for (let y = c.y + step / 2; y < c.y + c.h + step; y += step) {
      for (const a of [0, Math.PI / 4]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.strokeRect(-44, -44, 88, 88);
        ctx.restore();
      }
    }
  }
  ctx.restore();
  // double brass border
  ctx.strokeStyle = COL['--brass'];
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 5;
  ctx.strokeRect(c.x + 30, c.y + 30, c.w - 60, c.h - 60);
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x + 44, c.y + 44, c.w - 88, c.h - 88);
  ctx.globalAlpha = 1;
}

// The name of the game and the two card piles lie on their own clear plane over the felt.
// It turns a quarter with the camera, so they always read the right way up.
const DEC = Math.round(TEX * 0.75 * Math.min(1, SCALE));
const decCanvas = document.createElement('canvas');
decCanvas.width = decCanvas.height = DEC;
const dctx = decCanvas.getContext('2d');
function drawDecor() {
  const k = DEC / CENTRE.w; // logical felt pixels -> decor canvas pixels
  dctx.setTransform(k, 0, 0, k, 0, 0);
  dctx.clearRect(0, 0, CENTRE.w, CENTRE.w);
  dctx.direction = 'rtl';
  dctx.textAlign = 'center';
  dctx.textBaseline = 'middle';
  const m = CENTRE.w / 2;
  dctx.save();
  dctx.translate(m, m);
  dctx.rotate(-Math.PI / 4);
  dctx.font = '250px Lalezar, Tajawal, sans-serif';
  dctx.fillStyle = COL['--wood-dark'];
  dctx.fillText('بنك الحظ', 8, 2);
  dctx.fillStyle = COL['--brass'];
  dctx.fillText('بنك الحظ', 0, -10);
  dctx.font = '600 56px Tajawal, sans-serif';
  dctx.fillStyle = COL['--text-dim'];
  dctx.fillText('عقارات بغداد', 0, 150);
  dctx.restore();
  [['chance', 'حظ', -1], ['chest', 'صندوق', 1]].forEach(([icon, label, side]) => {
    dctx.save();
    dctx.translate(m + side * 370, m + side * 370);
    dctx.rotate(-Math.PI / 4);
    const x = -170, y = -105, w = 340, h = 210, r = 22;
    dctx.beginPath();
    dctx.moveTo(x + r, y);
    dctx.arcTo(x + w, y, x + w, y + h, r);
    dctx.arcTo(x + w, y + h, x, y + h, r);
    dctx.arcTo(x, y + h, x, y, r);
    dctx.arcTo(x, y, x + w, y, r);
    dctx.closePath();
    dctx.globalAlpha = 0.55;
    dctx.fillStyle = COL['--table-deep'];
    dctx.fill();
    dctx.globalAlpha = 1;
    dctx.setLineDash([18, 12]);
    dctx.lineWidth = 5;
    dctx.strokeStyle = COL['--brass'];
    dctx.stroke();
    dctx.setLineDash([]);
    const img = images.square[icon];
    if (img) dctx.drawImage(img, 55, -46, 92, 92);
    dctx.font = '700 64px Tajawal, sans-serif';
    dctx.fillStyle = COL['--text'];
    dctx.fillText(label, -50, 4);
    dctx.restore();
  });
  decTexture.needsUpdate = true;
}

// the owner's colour disc with their symbol
function badge(view, tokens, owner, x, y, rad) {
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fillStyle = playerColor(view, owner);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COL['--paper'];
  ctx.stroke();
  const t = images.token[tokens[owner]];
  if (t) ctx.drawImage(t, x - rad * 0.64, y - rad * 0.64, rad * 1.28, rad * 1.28);
}

// One square. Drawn in its own frame (turned to its side), so every square has the same
// tall layout: colour band at the top (toward the centre), name, price, owner strip at the bottom.
function drawSquare(view, tokens, names, sq, i) {
  const r = inset(cellRect(i), GAP);
  const pr = view.props[i];
  const owner = pr && pr.owner;
  const oc = owner ? playerColor(view, owner) : null;
  const corner = r.side === 'corner';
  ctx.fillStyle = COL['--board'];
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const turned = r.side === 'l' || r.side === 'r';
  const w = turned ? r.h : r.w;
  const hh = turned ? r.w : r.h;
  const L = { x: -w / 2, y: -hh / 2, w: w, h: hh };
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.rotate(corner ? CORNER_ROT[i] : SIDE_ROT[r.side]);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const band = sq.group ? { x: L.x, y: L.y, w: L.w, h: Math.round(L.h * 0.2) } : null;
  if (band) {
    ctx.fillStyle = COL['--g' + sq.group];
    ctx.fillRect(band.x, band.y, band.w, band.h);
  }
  let body = band ? { x: L.x, y: L.y + band.h, w: L.w, h: L.h - band.h } : { x: L.x, y: L.y, w: L.w, h: L.h };
  // owned: a wash of the owner's colour and a strip with the owner's name along the outer edge
  if (owner) {
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = oc;
    ctx.fillRect(body.x, body.y, body.w, body.h);
    ctx.restore();
    const sh = 56;
    const sy = body.y + body.h - sh;
    ctx.fillStyle = oc;
    ctx.fillRect(body.x, sy, body.w, sh);
    let tx = body.x + body.w / 2;
    let tw = body.w - 16;
    if (!band) { badge(view, tokens, owner, body.x + 30, sy + sh / 2, 21); tx += 24; tw = body.w - 60; }
    const t = fitLine(names[owner] || '', tw, 36, '800');
    ctx.fillStyle = COL['--ink'];
    ctx.fillText(t, tx, sy + sh / 2 + 2);
    body = { x: body.x, y: body.y, w: body.w, h: body.h - sh };
  }
  // icon, name and price (or "mortgaged"), stacked in the middle of the free space
  const ic = U.squareIcon(sq);
  const img = ic && images.square[ic];
  const mort = !!(pr && pr.mortgaged);
  const sub = mort ? 'مرهون' : (!owner && sq.price ? String(sq.price) : '');
  const SUBH = 40;
  const GY = 8;
  const iconS = img ? (corner ? 104 : 66) : 0;
  const room = body.h - 18 - (iconS ? iconS + GY : 0) - (sub ? SUBH + GY : 0);
  const nm = corner
    ? fitName(sq.name, body.w - 30, [62, 56, 50, 44, 38], 2, room)
    : fitName(sq.name, body.w - 14, [52, 48, 44, 40, 36, 32, 28, 24], 2, room);
  const lineH = nm.size * 1.12;
  const total = (iconS ? iconS + GY : 0) + nm.lines.length * lineH + (sub ? GY + SUBH : 0);
  let y = body.y + (body.h - total) / 2;
  const cx = body.x + body.w / 2;
  if (img) { ctx.drawImage(img, cx - iconS / 2, y, iconS, iconS); y += iconS + GY; }
  ctx.fillStyle = COL['--ink'];
  ctx.font = '700 ' + nm.size + 'px Tajawal, sans-serif';
  nm.lines.forEach((line) => { ctx.fillText(line, cx, y + lineH / 2); y += lineH; });
  if (sub) {
    y += GY;
    ctx.font = (mort ? '800 ' : '700 ') + '38px Tajawal, sans-serif';
    ctx.fillStyle = mort ? COL['--red'] : COL['--ink'];
    ctx.globalAlpha = mort ? 1 : 0.75;
    ctx.fillText(sub, cx, y + SUBH / 2);
    ctx.globalAlpha = 1;
  }
  if (owner && band) badge(view, tokens, owner, band.x + band.w / 2, band.y + band.h / 2, Math.min(band.w, band.h) * 0.46);
  if (mort) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x, L.y, L.w, L.h);
    ctx.clip();
    ctx.strokeStyle = COL['--ink'];
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 8;
    for (let k = -L.h; k < L.w; k += 26) { ctx.beginPath(); ctx.moveTo(L.x + k, L.y + L.h); ctx.lineTo(L.x + k + L.h, L.y); ctx.stroke(); }
    ctx.restore();
  }
  // a thin printed edge (thick in the owner's colour)
  const lw = owner ? 8 : 3;
  ctx.strokeStyle = owner ? oc : COL['--board-line'];
  ctx.lineWidth = lw;
  ctx.strokeRect(L.x + lw / 2, L.y + lw / 2, L.w - lw, L.h - lw);
  ctx.restore();
}

function drawBoard(view, tokens, names) {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.clearRect(0, 0, TEX, TEX);
  drawCentre();
  SQ.forEach((sq, i) => drawSquare(view, tokens, names, sq, i));
  drawDecor();
  texture.needsUpdate = true;
  dirty = true;
}

// ---------- scene ----------
const host = document.createElement('div');
host.className = 'bk-board3d';
const overlay = document.createElement('div');
overlay.className = 'bk-3d-overlay';
host.append(overlay);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
const texture = new THREE.CanvasTexture(canvas);
let dirty = true;
const tiles = []; // one raised mesh per square, index = square number
const decTexture = new THREE.CanvasTexture(decCanvas);
decTexture.colorSpace = THREE.SRGBColorSpace;
const decorTurn = new THREE.Group(); // turned about the vertical axis with the camera
const decor = new THREE.Mesh(
  new THREE.PlaneGeometry((CENTRE.w / TEX) * WORLD, (CENTRE.w / TEX) * WORLD),
  new THREE.MeshStandardMaterial({ map: decTexture, transparent: true, alphaTest: 0.02, roughness: 0.9, depthWrite: false }));
decorTurn.add(decor);
scene.add(decorTurn);
const heights = SQ.map(() => TILE_H);

// map the top face of a box (or a plane) onto a rectangle of the texture
function mapTop(geo, r, first) {
  const uv = geo.attributes.uv;
  for (let k = first; k < first + 4; k++) {
    const u = uv.getX(k), v = uv.getY(k);
    uv.setXY(k, (r.x + u * r.w) / TEX, 1 - (r.y + (1 - v) * r.h) / TEX);
  }
  uv.needsUpdate = true;
}

if (supported) {
  // render a little above the screen's pixel ratio on plain screens: smoother text
  renderer.setPixelRatio(Math.min(2, Math.max(1.5, window.devicePixelRatio || 1)));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.prepend(renderer.domElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.minFilter = THREE.LinearMipmapLinearFilter;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3a3c, 1.5));
  const sun = new THREE.DirectionalLight(0xfff6e6, 1.7);
  sun.position.set(-3, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // wooden frame with a brass rim
  const wood = new THREE.MeshStandardMaterial({ color: COL['--wood'], roughness: 0.6, metalness: 0.05 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(WORLD + 0.7, 0.36, WORLD + 0.7), [wood, wood, new THREE.MeshStandardMaterial({ color: COL['--wood-dark'], roughness: 0.8 }), wood, wood, wood]);
  frame.position.y = -0.18;
  frame.receiveShadow = true;
  scene.add(frame);
  const brass = new THREE.MeshStandardMaterial({ color: COL['--brass'], roughness: 0.3, metalness: 0.8 });
  const RIM = WORLD + 0.7;
  [[0, -RIM / 2, RIM, 0.08], [0, RIM / 2, RIM, 0.08], [-RIM / 2, 0, 0.08, RIM], [RIM / 2, 0, 0.08, RIM]].forEach((b) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b[2], 0.07, b[3]), brass);
    m.position.set(b[0], 0.035, b[1]);
    scene.add(m);
  });

  // the centre felt
  const cw = (CENTRE.w / TEX) * WORLD;
  const cgeo = new THREE.PlaneGeometry(cw, cw);
  mapTop(cgeo, CENTRE, 0);
  const centre = new THREE.Mesh(cgeo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }));
  centre.rotation.x = -Math.PI / 2;
  centre.position.y = 0.002;
  centre.receiveShadow = true;
  scene.add(centre);

  decor.rotation.x = -Math.PI / 2;
  decor.position.y = 0.004;
  decor.receiveShadow = true;
  if (renderer) decTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // forty raised squares; the top face shows its part of the texture
  const topMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, emissive: COL['--paper'], emissiveMap: texture, emissiveIntensity: 0.22 });
  SQ.forEach((sq, i) => {
    const r = inset(cellRect(i), GAP);
    const geo = new THREE.BoxGeometry((r.w / TEX) * WORLD, 1, (r.h / TEX) * WORLD);
    mapTop(geo, r, 8); // vertices 8..11 are the +y face
    const side = new THREE.MeshStandardMaterial({ color: COL['--board-edge'], roughness: 0.7 });
    const m = new THREE.Mesh(geo, [side, side, topMat, side, side, side]);
    const c = centreOf(r);
    m.position.set(c.x, TILE_H / 2, c.z);
    m.scale.y = TILE_H;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.index = i;
    m.userData.side = side;
    scene.add(m);
    tiles.push(m);
  });

  // a soft shadow catcher around the board so the board sits on the table
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.36;
  floor.receiveShadow = true;
  scene.add(floor);
}

// owned squares rise and their sides take the owner's colour
function applyOwnership(view) {
  tiles.forEach((m, i) => {
    const pr = view.props[i];
    const owner = pr && pr.owner;
    const h = owner ? OWNED_H : TILE_H;
    m.userData.side.color.set(owner ? playerColor(view, owner) : COL['--board-edge']);
    if (heights[i] !== h) {
      heights[i] = h;
      gsap.to(m.scale, { y: h, duration: dur(0.45), ease: 'back.out(2)', onUpdate: () => { m.position.y = m.scale.y / 2; dirty = true; } });
    }
  });
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
  g.scale.setScalar(1.05);
  return g;
}

// ---------- houses and hotels ----------
const buildings = new THREE.Group();
scene.add(buildings);
function houseMesh() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.13, 0.1, 0.13), mat(COL['--g7'], { metalness: 0.1, roughness: 0.5 }), 0, 0.05, 0));
  const roof = mesh(new THREE.ConeGeometry(0.11, 0.08, 4), mat(COL['--green'], { metalness: 0.1 }), 0, 0.14, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  return g;
}
function hotelMesh() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.32, 0.18, 0.15), mat(COL['--red'], { metalness: 0.1, roughness: 0.5 }), 0, 0.09, 0));
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.03, 0.17), mat(COL['--wood-dark']), 0, 0.195, 0));
  return g;
}
function placeBuildings(view) {
  buildings.clear();
  SQ.forEach((sq, i) => {
    const pr = view.props[i];
    if (!pr || !pr.houses || !sq.group) return;
    const band = bandRect(inset(cellRect(i), GAP));
    const c = centreOf(band);
    c.y = heights[i];
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
      const off = (k - (pr.houses - 1) / 2) * 0.18;
      m.position.copy(c).addScaledVector(along, off);
      buildings.add(m);
    }
  });
  dirty = true;
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
  const t = 0.07;
  f.children.forEach((b) => {
    if (b.name === 'n' || b.name === 's') { b.scale.set(w, 1, t); b.position.set(0, 0.02, (b.name === 'n' ? -1 : 1) * (d / 2 - t / 2)); } else { b.scale.set(t, 1, d); b.position.set((b.name === 'w' ? -1 : 1) * (w / 2 - t / 2), 0.02, 0); }
  });
  f.position.set(c.x, heights[i], c.z);
  f.visible = true;
}
const curFrame = frameMesh(COL['--brass'], 0.95);
const focusFrame = frameMesh(COL['--paper'], 0.95);

// ---------- dice ----------
function pipTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = COL['--paper'];
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
// rotation (x, z) that brings each value to the top; the turn about y comes last (Euler order YXZ),
// so it never tips the top face
const UP = { 1: [0, 0], 6: [Math.PI, 0], 2: [-Math.PI / 2, 0], 5: [Math.PI / 2, 0], 3: [0, Math.PI / 2], 4: [0, -Math.PI / 2] };
const DIE = 0.62;
const diceMats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: pipTexture(v), roughness: 0.35, metalness: 0.05 }));
const dice = [0, 1].map((k) => {
  const d = mesh(new THREE.BoxGeometry(DIE, DIE, DIE), diceMats, (k ? 0.5 : -0.5), DIE / 2, 0.6);
  d.rotation.order = 'YXZ';
  scene.add(d);
  return d;
});
let diceValues = [5, 3];
let diceAt = null; // where the dice lie: { spot, right, fwd, th }
const FELT = (CENTRE.w / TEX) * WORLD / 2 - 0.55;
// the dice land on the felt just inside the side of the player who rolls, in front of the camera
function diceSpot(pos) {
  const th = azimuth(pos);
  const fwd = forwardOf(th);
  const spot = lookTarget(pos).addScaledVector(fwd, 1.95);
  spot.x = Math.max(-FELT, Math.min(FELT, spot.x));
  spot.z = Math.max(-FELT, Math.min(FELT, spot.z));
  spot.y = DIE / 2;
  return { spot: spot, right: rightOf(th), fwd: fwd, th: th };
}
function restDice(values) {
  const at = diceAt || (diceAt = diceSpot(cam.curPos));
  dice.forEach((d, k) => {
    const u = UP[values[k]];
    d.rotation.set(u[0], at.th + (k ? -0.25 : 0.2), u[1]);
    d.position.copy(at.spot).addScaledVector(at.right, k ? 0.45 : -0.45);
  });
  diceValues = values.slice();
  dirty = true;
}
function rollDice(values) {
  const at = diceAt = diceSpot(cam.curPos);
  dice.forEach((d, k) => {
    const u = UP[values[k]];
    const end = at.spot.clone().addScaledVector(at.right, k ? 0.45 : -0.45);
    // thrown from the player's side of the board
    const start = end.clone().addScaledVector(at.fwd, -2.4).addScaledVector(at.right, k ? 0.9 : -0.9);
    const yaw = at.th + (k ? -0.25 : 0.2);
    gsap.killTweensOf(d.position);
    gsap.killTweensOf(d.rotation);
    const tl = gsap.timeline({ onUpdate: () => { dirty = true; } });
    tl.fromTo(d.position, { x: start.x, z: start.z }, { x: end.x, z: end.z, duration: dur(0.95), ease: 'power2.out' }, 0);
    tl.fromTo(d.position, { y: 2.6 }, { y: DIE / 2, duration: dur(0.95), ease: 'bounce.out' }, 0);
    tl.fromTo(d.rotation,
      { x: u[0] + Math.PI * 4 + Math.random(), y: yaw + Math.random() * 6, z: u[1] + Math.PI * 4 + Math.random() },
      { x: u[0], y: yaw, z: u[1], duration: dur(1.0), ease: 'power3.out' }, 0);
    tl.delay(k * 0.08);
  });
  diceValues = values.slice();
}

// ---------- pieces on the board ----------
const pieces = {}; // id -> { obj, pos, type, target, spin }
const INWARD = { b: new THREE.Vector3(0, 0, -1), t: new THREE.Vector3(0, 0, 1), l: new THREE.Vector3(1, 0, 0), r: new THREE.Vector3(-1, 0, 0) };
const ALONG = { b: new THREE.Vector3(1, 0, 0), t: new THREE.Vector3(1, 0, 0), l: new THREE.Vector3(0, 0, 1), r: new THREE.Vector3(0, 0, 1) };
function squareSpot(i, k, n) {
  const r = inset(cellRect(i), GAP);
  const body = bodyRect(r, !!SQ[i].group);
  const c = centreOf(body);
  c.y = heights[i];
  // on a side, one or two pieces stand by the colour band (behind the name, seen from outside)
  if (r.side !== 'corner' && n <= 2) {
    const flat = r.side === 'b' || r.side === 't';
    const depth = ((flat ? body.h : body.w) / TEX) * WORLD;
    const band = SQ[i].group ? ((flat ? r.h : r.w) / TEX) * WORLD * 0.2 : 0;
    c.addScaledVector(INWARD[r.side], band ? depth / 2 + band * 0.35 : depth * 0.3);
    if (n === 2) c.addScaledVector(ALONG[r.side], k ? 0.22 : -0.22);
    return c;
  }
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
      const moved = pc.pos !== pos;
      const steps = Math.min(4, (pos - pc.pos + 40) % 40 || 1);
      const d = dur(0.28 * Math.min(steps, 2));
      const peak = Math.max(pc.obj.position.y, spot.y) + (moved ? 0.42 : 0.05);
      gsap.killTweensOf(pc.obj.position);
      gsap.to(pc.obj.position, { x: spot.x, z: spot.z, duration: d, ease: 'power1.inOut', onUpdate: () => { dirty = true; } });
      gsap.timeline({ onUpdate: () => { dirty = true; } })
        .to(pc.obj.position, { y: peak, duration: d / 2, ease: 'power2.out' })
        .to(pc.obj.position, { y: spot.y, duration: d / 2, ease: 'bounce.out' });
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

// ---------- camera ----------
// The camera travels along the ring of squares. cam.s is a (never wrapped) square number:
// it gives the point the camera looks at and the side it looks from (one quarter turn per side).
// cam.zoom: 0 = close to the squares (default), 1 = the whole board, below 0 = even closer.
const SQW = (UNIT / TEX) * WORLD; // width of a normal square in world units
const PHI_F = (56 * Math.PI) / 180; // camera pitch close to the squares
const PHI_O = (66 * Math.PI) / 180; // camera pitch for the whole board
const ZMIN = -0.6;
const UPV = new THREE.Vector3(0, 1, 0);
const ZOOM_KEY = 'bank.zoom3d';
function loadZoom() {
  try {
    const v = parseFloat(localStorage.getItem(ZOOM_KEY));
    return isFinite(v) ? Math.min(1, Math.max(ZMIN, v)) : 0;
  } catch (e) {
    return 0;
  }
}
let saveTimer = null;
function saveZoom() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(ZOOM_KEY, String(Math.round(cam.zoom * 100) / 100)); } catch (e) { /* no storage: the choice lasts this visit */ }
  }, 300);
}
const cam = { s: 0, zoom: loadZoom(), follow: true, curId: null, curPos: 0 };
let Df = 10; // camera distance of the close view, set from the canvas size

const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
function forwardOf(th) { return new THREE.Vector3(-Math.sin(th), 0, -Math.cos(th)); }
function rightOf(th) { return new THREE.Vector3(Math.cos(th), 0, -Math.sin(th)); }
// side 0 (bottom row) is seen from the front, then a quarter turn for each side.
// The turn happens while the piece steps onto the corner, so a corner is seen like the side it starts.
function azimuth(s) {
  const k = Math.floor(s / 10);
  const u = s - 10 * k;
  return (-Math.PI / 2) * (k + (u > 9 ? smooth(u - 9) : 0));
}
function squareMid(i) {
  const c = centreOf(cellRect(((i % 40) + 40) % 40));
  c.y = 0.1;
  return c;
}
function ringPoint(s) {
  const i0 = Math.floor(s);
  return squareMid(i0).lerp(squareMid(i0 + 1), s - i0);
}
// the camera aims one square ahead of the piece (where it is going), never past the next corner
function lookTarget(s) { return ringPoint(Math.min(s + 1, (Math.floor(s / 10) + 1) * 10)); }

function setPose(L, D, phi, th) {
  camera.position.copy(L).addScaledVector(forwardOf(th), -D * Math.cos(phi)).addScaledVector(UPV, D * Math.sin(phi));
  camera.lookAt(L);
  camera.updateMatrixWorld();
}
const tmpV = new THREE.Vector3();
// close view: the outer edge of the board sits near the bottom of the picture,
// so the row being played is big and the felt with the dice is right above it
function followPose(s, D) {
  const th = azimuth(s);
  const f = forwardOf(th);
  const T = lookTarget(s);
  // near a corner the camera stops at the board's edge instead of showing the empty table
  const rt = rightOf(th);
  const halfW = D * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect * 0.92;
  const lim = Math.max(0, WORLD / 2 + 0.35 - halfW);
  const lat = T.dot(rt);
  if (Math.abs(lat) > lim) T.addScaledVector(rt, Math.sign(lat) * lim - lat);
  const E = T.clone().addScaledVector(f, -1.0);
  E.y = 0;
  const L = new THREE.Vector3();
  let lo = -4, hi = 9;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    setPose(L.copy(T).addScaledVector(f, m), D, PHI_F, th);
    if (tmpV.copy(E).project(camera).y > -0.86) lo = m; else hi = m;
  }
  return { L: L.copy(T).addScaledVector(f, hi), D: D, phi: PHI_F };
}
// whole board: as close as possible with every corner inside the picture, centred
const ov = { key: '', pose: null };
function overviewPose(th) {
  const key = th.toFixed(4) + '|' + camera.aspect.toFixed(4);
  if (ov.key === key) return ov.pose;
  const half = (WORLD + 0.7) / 2;
  const pts = [];
  [-half, half].forEach((x) => [-half, half].forEach((z) => [0, 0.6].forEach((y) => pts.push(new THREE.Vector3(x, y, z)))));
  const f = forwardOf(th);
  const L = new THREE.Vector3();
  let cy = 0;
  let D = 30;
  const fits = (d) => {
    setPose(L, d, PHI_O, th);
    let ok = true, y0 = 1e9, y1 = -1e9;
    pts.forEach((p) => {
      const q = tmpV.copy(p).project(camera);
      if (Math.abs(q.x) > 0.97 || Math.abs(q.y) > 0.97 || q.z >= 1) ok = false;
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    });
    cy = (y0 + y1) / 2;
    return ok;
  };
  for (let k = 0; k < 6; k++) {
    let lo = 3, hi = 150;
    for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    D = hi;
    fits(D);
    if (Math.abs(cy) < 0.005) break;
    L.addScaledVector(f, cy * half * 0.9);
  }
  ov.key = key;
  ov.pose = { L: L.clone(), D: D, phi: PHI_O };
  return ov.pose;
}

let decorSide = null;
function turnDecor(th) {
  const k = Math.round(-th / (Math.PI / 2));
  if (k === decorSide) return;
  const first = decorSide === null;
  decorSide = k;
  gsap.killTweensOf(decorTurn.rotation);
  if (first) { decorTurn.rotation.y = -k * Math.PI / 2; return; }
  gsap.to(decorTurn.rotation, { y: -k * Math.PI / 2, duration: dur(0.7), ease: 'power2.inOut', onUpdate: () => { dirty = true; } });
}

function applyCamera() {
  if (!supported) return;
  const z = cam.zoom;
  const th = azimuth(cam.s);
  turnDecor(th);
  if (z <= 0) {
    const p = followPose(cam.s, Df * (1 + 0.75 * z));
    setPose(p.L, p.D, p.phi, th);
  } else {
    const a = followPose(cam.s, Df);
    const b = overviewPose(th);
    const e = smooth(z);
    const L = a.L.clone().lerp(b.L, e);
    const D = Math.exp(Math.log(a.D) + (Math.log(b.D) - Math.log(a.D)) * e);
    setPose(L, D, a.phi + (b.phi - a.phi) * e, th);
  }
  dirty = true;
}

// glide along the ring to a square (the short way round)
function goTo(pos) {
  let delta = (((pos - cam.s) % 40) + 40) % 40;
  if (delta > 20) delta -= 40;
  gsap.killTweensOf(cam, 's');
  if (Math.abs(delta) < 1e-6) { applyCamera(); return; }
  gsap.to(cam, { s: cam.s + delta, duration: dur(Math.min(1.4, 0.45 + Math.abs(delta) * 0.05)), ease: 'power2.out', onUpdate: applyCamera });
}
function setZoom(z) {
  gsap.killTweensOf(cam, 'zoom');
  cam.zoom = Math.min(1, Math.max(ZMIN, z));
  applyCamera();
  refreshCtrl();
}
function stopFollow() {
  cam.follow = false;
  gsap.killTweensOf(cam, 's');
  refreshCtrl();
}

function onResize() {
  if (!supported) return;
  const w = host.clientWidth || 1;
  const h = host.clientHeight || 1;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  // how wide a normal square is on screen: about a sixth of a phone screen,
  // 70 to 100 CSS pixels on a computer (more of the board in view, text still large)
  const px = w < 600 ? Math.max(60, w / 5.8) : Math.min(100, Math.max(70, w / 8));
  Df = (h * SQW) / (2 * Math.tan((camera.fov * Math.PI) / 360) * px);
  ov.key = '';
  applyCamera();
}
if (supported && window.ResizeObserver) new ResizeObserver(onResize).observe(host);

// ---------- on-board buttons ----------
const ICONS = {
  whole: U.ICON_PATHS.board,
  close: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  centre: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
};
function ctrlButton(onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bk-3d-btn';
  b.addEventListener('click', onClick);
  return b;
}
function setIcon(b, mode, paths, label) {
  if (b.dataset.mode === mode) return;
  b.dataset.mode = mode;
  b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  b.setAttribute('aria-label', label);
  b.title = label;
}
const ctrl = document.createElement('div');
ctrl.className = 'bk-3d-ctrl';
const zoomBtn = ctrlButton(() => {
  const goal = cam.zoom < 0.5 ? 1 : 0;
  gsap.killTweensOf(cam, 'zoom');
  gsap.to(cam, { zoom: goal, duration: dur(0.8), ease: 'power2.inOut', onUpdate: applyCamera, onComplete: saveZoom });
  refreshCtrl(goal);
});
const centreBtn = ctrlButton(() => {
  cam.follow = true;
  goTo(cam.curPos);
  refreshCtrl();
});
setIcon(centreBtn, 'centre', ICONS.centre, 'ارجع إلى الدور');
ctrl.append(zoomBtn, centreBtn);
const info = document.createElement('div');
info.className = 'bk-3d-info';
overlay.append(info);
if (supported) host.append(ctrl);
function refreshCtrl(goal) {
  const z = goal === undefined ? cam.zoom : goal;
  if (z < 0.5) setIcon(zoomBtn, 'whole', ICONS.whole, 'اللوحة كاملة');
  else setIcon(zoomBtn, 'close', ICONS.close, 'اقترب من الدور');
  centreBtn.hidden = cam.follow;
}
refreshCtrl();

// ---------- touch and mouse: tap a square, swipe along the board, pinch or wheel to zoom ----------
const ray = new THREE.Raycaster();
let onCell = null;
const pointers = new Map();
let gesture = null;
function pick(clientX, clientY) {
  if (!onCell) return;
  const r = renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(v, camera);
  const hit = ray.intersectObjects(tiles, false)[0];
  if (hit) onCell(hit.object.userData.index);
}
// how many screen pixels one square takes where the camera looks (to move the board with the finger)
function pxPerSquare() {
  const half = rightOf(azimuth(cam.s)).multiplyScalar(SQW / 2);
  const T = lookTarget(cam.s);
  const a = T.clone().add(half).project(camera);
  const b = T.clone().sub(half).project(camera);
  return Math.max(20, (Math.abs(a.x - b.x) / 2) * (host.clientWidth || 1));
}
const spread = () => { const [a, b] = [...pointers.values()]; return Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)); };
if (supported) {
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (pointers.size === 1) gesture = { kind: 'tap', pxs: pxPerSquare(), lastX: e.clientX, lastT: performance.now(), v: 0 };
    else if (pointers.size === 2) gesture = { kind: 'pinch', d0: spread(), z0: cam.zoom };
  });
  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (gesture.kind === 'pinch') {
      if (pointers.size >= 2) setZoom(gesture.z0 + Math.log(gesture.d0 / spread()) * 1.2);
      return;
    }
    if (gesture.kind === 'tap' && Math.abs(p.x - p.x0) > 8) {
      gesture.kind = 'drag';
      el.classList.add('dragging');
      stopFollow();
    }
    if (gesture.kind === 'drag') {
      const now = performance.now();
      const ds = (e.clientX - gesture.lastX) / gesture.pxs;
      cam.s += ds;
      gesture.v = 0.7 * gesture.v + 0.3 * ((ds / Math.max(8, now - gesture.lastT)) * 1000);
      gesture.lastX = e.clientX;
      gesture.lastT = now;
      applyCamera();
    }
  });
  const end = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (gesture && gesture.kind === 'tap' && e.type === 'pointerup' && performance.now() - p.t0 < 700) pick(e.clientX, e.clientY);
    else if (gesture && gesture.kind === 'drag' && Math.abs(gesture.v) > 0.6) {
      // a flick keeps the board moving a little
      gsap.to(cam, { s: cam.s + Math.max(-8, Math.min(8, gesture.v * 0.35)), duration: dur(0.8), ease: 'power3.out', onUpdate: applyCamera });
    }
    if (gesture && gesture.kind === 'pinch') saveZoom();
    el.classList.remove('dragging');
    // after a pinch the finger left behind starts nothing until it is lifted
    gesture = pointers.size ? { kind: 'none' } : null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(cam.zoom + Math.max(-0.25, Math.min(0.25, e.deltaY * 0.0015)));
    saveZoom();
  }, { passive: false });
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
  const names = opts.names || {};
  // the texture only changes with ownership, mortgages, names and symbols
  const sig = JSON.stringify([view.playerIds, SQ.map((s, i) => view.props[i] ? [view.props[i].owner, view.props[i].mortgaged] : 0), tokens, names, fontsDone]);
  if (sig !== lastSig) { lastSig = sig; drawBoard(view, tokens, names); applyOwnership(view); }
  const bsig = JSON.stringify(SQ.map((s, i) => view.props[i] ? [view.props[i].houses, heights[i]] : 0));
  if (bsig !== update.bsig) { update.bsig = bsig; placeBuildings(view); }
  syncPieces(view, tokens);
  // the camera follows the player whose turn it is (and comes back to them whenever they move)
  const cur = view.currentPlayerId;
  if (cur && view.players[cur]) {
    const pos = view.players[cur].pos;
    if (cam.curId === null) {
      cam.curId = cur;
      cam.curPos = pos;
      cam.s = pos;
      applyCamera();
    } else if (cur !== cam.curId || pos !== cam.curPos) {
      cam.curId = cur;
      cam.curPos = pos;
      if (!(gesture && gesture.kind === 'drag')) {
        cam.follow = true;
        goTo(pos);
        refreshCtrl();
      }
    }
  }
  // the current player's square and the selected square
  if (cur && !view.players[cur].bankrupt) fitFrame(curFrame, view.players[cur].pos); else curFrame.visible = false;
  if (opts.focus !== null && opts.focus !== undefined) fitFrame(focusFrame, opts.focus); else focusFrame.visible = false;
  if (!diceAt) restDice(view.dice || diceValues);
  if (!opts.rolling && view.dice && (view.dice[0] !== diceValues[0] || view.dice[1] !== diceValues[1])) restDice(view.dice);
  // words over the board: whose turn it is and the last event
  const parts = [];
  if (cur && opts.names) {
    const t = document.createElement('div');
    t.className = 'bk-3d-turn';
    t.style.setProperty('--pc', 'var(--p' + (view.playerIds.indexOf(cur) + 1) + ')');
    const d = document.createElement('span');
    d.className = 'dot';
    t.append(d, cur === view.you ? 'دورك' : 'دور ' + opts.names[cur]);
    parts.push(t);
  }
  if (opts.eventText) { const e = document.createElement('div'); e.className = 'bk-3d-event'; e.textContent = opts.eventText; parts.push(e); }
  info.replaceChildren(...parts);
  dirty = true;
}

window.Bank3D = {
  supported: () => supported,
  element: () => host,
  update: update,
  roll: rollDice,
};
window.dispatchEvent(new Event('bank3d-ready'));
