// The table layout (public/domino/tiles.js) is browser code; its layout() is pure, so it runs here in a sandbox.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../server/games/domino/engine');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'domino', 'tiles.js'), 'utf8'), sandbox);
const DT = sandbox.window.DominoTiles;

// the two square halves of a placed tile, with their numbers
function halves(p) {
  if (p.o === 'h') return [{ x: p.x, y: p.y, v: p.a }, { x: p.x + 1, y: p.y, v: p.b }];
  return [{ x: p.x, y: p.y, v: p.a }, { x: p.x, y: p.y + 1, v: p.b }];
}
// unit squares sharing an edge of positive length
function touch(a, b) {
  const ox = Math.min(a.x + 1, b.x + 1) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + 1, b.y + 1) - Math.max(a.y, b.y);
  return (Math.abs(ox) < 1e-9 && oy > 1e-9) || (Math.abs(oy) < 1e-9 && ox > 1e-9);
}
function overlap(a, b) {
  const ox = Math.min(a.x + 1, b.x + 1) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + 1, b.y + 1) - Math.max(a.y, b.y);
  return ox > 1e-9 && oy > 1e-9;
}

function check(line, first, B) {
  const P = DT.layout(line, first, B);
  const H = P.map(halves);
  // the numbers shown are the numbers of the tile
  line.forEach((t, i) => {
    const shown = [P[i].a, P[i].b].sort().join();
    assert.equal(shown, [t[0], t[1]].sort().join(), 'tile ' + i + ' shows other numbers');
  });
  // nothing overlaps
  for (let i = 0; i < H.length; i++) {
    for (let j = i + 1; j < H.length; j++) {
      H[i].forEach((a) => H[j].forEach((b) => assert.ok(!overlap(a, b), 'tiles ' + i + ' and ' + j + ' overlap (B ' + B + ')')));
    }
  }
  // neighbours in the line touch with the matching number
  for (let i = 0; i + 1 < line.length; i++) {
    const v = line[i][1];
    const ok = H[i].some((a) => a.v === v && H[i + 1].some((b) => b.v === v && touch(a, b)));
    assert.ok(ok, 'tiles ' + i + ' and ' + (i + 1) + ' do not join on ' + v + ' (B ' + B + ')');
  }
}

test('layout: real games, every row length: no overlaps, every joint matches', () => {
  let lines = 0;
  for (let seed = 1; seed <= 120; seed++) {
    let s = E.createGame(['a', 'b'], { seed, mode: 'draw' }).state;
    while (s.phase === 'turn') {
      const r = E.autoPlay(s);
      s = r.state;
      if (s.line.length) for (let B = 3; B <= 13; B++) check(s.line, s.first, B);
      lines += 1;
    }
  }
  assert.ok(lines > 500);
});

test('layout: long lines with many doubles, near every corner', () => {
  // all 28 tiles in a chain: 0-0 0-1 1-1 1-2 2-2 ... with the opening tile in different places
  const chain = [];
  let v = 0;
  for (let k = 0; k < 12; k++) {
    const n = (v + 1) % 7;
    chain.push([v, v], [v, n]);
    v = n;
  }
  for (let first = 0; first < chain.length; first += 3) for (let B = 3; B <= 13; B++) check(chain, first, B);
});

test('pickB: a phone gets short rows, a wide screen long ones', () => {
  assert.ok(DT.pickB(340, 420) < DT.pickB(900, 420));
});
