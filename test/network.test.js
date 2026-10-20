const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket } = require('ws');
const CONFIG = require('../server/config');
const { createApp } = require('../server/index');

async function boot() {
  const app = createApp();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  return { app, port, base: 'http://127.0.0.1:' + port };
}

// GET without keep-alive so no socket outlives the test server.
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false, headers: { connection: 'close' } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    }).on('error', reject);
  });
}

function client(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  const c = { ws, inbox: [], waiters: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    c.inbox.push(m);
    c.waiters = c.waiters.filter((w) => !w(m));
  });
  c.open = new Promise((r) => ws.on('open', r));
  c.send = (m) => ws.send(JSON.stringify(m));
  c.raw = (s) => ws.send(s);
  c.next = (pred, ms = 2000) => new Promise((resolve, reject) => {
    const hit = c.inbox.find(pred);
    if (hit) return resolve(hit);
    const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
    c.waiters.push((m) => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; });
  });
  c.last = (type) => [...c.inbox].reverse().find((m) => m.type === type);
  return c;
}

test('serves the pages and shared engine files, and nothing else from server/', async () => {
  const { app, base } = await boot();
  try {
    for (const p of ['/', '/index.html', '/screw.html', '/bank.html', '/seven.html', '/seven/app.js', '/snakes.html', '/snakes/app.js', '/snakes/board.js', '/snakes/snakes.css', '/server/games/snakes/config.js', '/server/games/snakes/engine.js', '/domino.html', '/domino/app.js', '/domino/tiles.js', '/domino/domino.css', '/server/games/domino/config.js', '/server/games/domino/engine.js', '/tawla.html', '/tawla/app.js', '/tawla/board.js', '/tawla/tawla.css', '/server/games/tawla/config.js', '/server/games/tawla/engine.js', '/lagta.html', '/lagta/app.js', '/lagta/lagta.css', '/server/games/lagta/config.js', '/server/games/lagta/engine.js', '/minhu.html', '/minhu/app.js', '/minhu/faces.js', '/minhu/minhu.css', '/minhu/review.html', '/minhu/call.js', '/reactions.js', '/roomend.js', '/pwa.js', '/sw.js', '/manifest.json', '/offline.html', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png', '/server/games/minhu/config.js', '/server/games/minhu/engine.js', '/seven/debug.html', '/server/games/seven/engine.js', '/portal.css', '/bank/preview.html', '/debug.html', '/server/engine.js', '/server/deck.js', '/server/config.js']) {
      const r = await get(base + p);
      assert.equal(r.status, 200, p);
    }
    assert.equal((await get(base + '/server/rooms.js')).status, 404);
    assert.equal((await get(base + '/server/index.js')).status, 404);
    assert.equal((await get(base + '/package.json')).status, 404);
    const traversal = await get(base + '/..%2fpackage.json');
    assert.notEqual(traversal.status, 200);
  } finally { await app.close(); }
});

test('two real sockets: create, join, start, ready, draw; each sees only their own data', async () => {
  const { app, port } = await boot();
  const a = client(port); const b = client(port);
  try {
    await Promise.all([a.open, b.open]);
    a.send({ type: 'create_room', name: 'أحمد' });
    const ja = await a.next((m) => m.type === 'joined');
    b.send({ type: 'join_room', code: ja.code, name: 'سارة' });
    const jb = await b.next((m) => m.type === 'joined');
    await a.next((m) => m.type === 'room_state' && m.players.length === 2);
    a.send({ type: 'start_game' });
    const sa = await a.next((m) => m.type === 'game_state');
    const sb = await b.next((m) => m.type === 'game_state');
    assert.equal(sa.you, ja.you);
    assert.equal(sb.you, jb.you);
    // opening peek: own two right-most cards only
    const mineA = sa.players.find((p) => p.id === sa.you).hand;
    assert.ok(!mineA[0].hidden && !mineA[1].hidden && mineA[2].hidden && mineA[3].hidden);
    assert.ok(sa.players.find((p) => p.id !== sa.you).hand.every((c) => c.hidden));
    a.send({ type: 'ready' }); b.send({ type: 'ready' });
    const turn = await a.next((m) => m.type === 'game_state' && m.phase === 'turn');
    const [cur, oth] = turn.currentPlayerId === ja.you ? [a, b] : [b, a];
    cur.send({ type: 'draw' });
    const pc = await cur.next((m) => m.type === 'private_card');
    assert.equal(pc.reveals[0].ownerId, null);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(oth.inbox.some((m) => m.type === 'private_card'), false);
    assert.equal(oth.last('game_state').drawn, null);
    // errors do not change state and go only to the sender
    oth.send({ type: 'discard_drawn' });
    await oth.next((m) => m.type === 'error');
    assert.equal(cur.inbox.some((m) => m.type === 'error'), false);
    assert.equal(JSON.stringify(a.inbox).includes(jb.playerId), false);
    assert.equal(JSON.stringify(b.inbox).includes(ja.playerId), false);
  } finally { a.ws.close(); b.ws.close(); await app.close(); }
});

test('invalid JSON gets an Arabic error; an oversized message drops the connection', async () => {
  const { app, port } = await boot();
  const c = client(port);
  try {
    await c.open;
    c.raw('not json');
    const e = await c.next((m) => m.type === 'error');
    assert.equal(e.message, 'رسالة غير صالحة.');
    const closed = new Promise((r) => c.ws.on('close', r));
    c.raw(JSON.stringify({ type: 'create_room', name: 'x'.repeat(CONFIG.MAX_MESSAGE_BYTES + 10) }));
    await closed;
  } finally { await app.close(); }
});

test('socket drop then reconnect with the stored playerId restores the seat mid-game', async () => {
  const { app, port } = await boot();
  const a = client(port); let b = client(port);
  try {
    await Promise.all([a.open, b.open]);
    a.send({ type: 'create_room', name: 'أحمد' });
    const ja = await a.next((m) => m.type === 'joined');
    b.send({ type: 'join_room', code: ja.code, name: 'سارة' });
    const jb = await b.next((m) => m.type === 'joined');
    a.send({ type: 'start_game' });
    const before = await b.next((m) => m.type === 'game_state');
    b.ws.terminate();
    await a.next((m) => m.type === 'game_state' && m.players.find((p) => p.id === jb.you && !p.connected));
    b = client(port);
    await b.open;
    b.send({ type: 'join_room', code: ja.code, name: 'x', playerId: jb.playerId });
    const j2 = await b.next((m) => m.type === 'joined');
    assert.equal(j2.you, jb.you);
    const after = await b.next((m) => m.type === 'game_state');
    const mine = (s) => s.players.find((p) => p.id === s.you).hand;
    assert.deepEqual(mine(after), mine(before));
  } finally { a.ws.close(); b.ws.close(); await app.close(); }
});


test('every connection first gets hello with the server boot id; a restart changes it', async () => {
  const a = await boot();
  const c1 = client(a.port);
  try {
    await c1.open;
    const h1 = await c1.next((m) => m.type === 'hello');
    assert.equal(h1.bootId, a.app.bootId);
  } finally { c1.ws.close(); await a.app.close(); }
  const b = await boot();
  const c2 = client(b.port);
  try {
    await c2.open;
    const h2 = await c2.next((m) => m.type === 'hello');
    assert.notEqual(h2.bootId, a.app.bootId);
  } finally { c2.ws.close(); await b.app.close(); }
});

test('/healthz answers ok (used by the host to know the server is up)', async () => {
  const { app, base } = await boot();
  try {
    assert.equal((await get(base + '/healthz')).status, 200);
  } finally { await app.close(); }
});

test('rate limit: a flood gets an Arabic error, a much bigger flood drops the connection', async () => {
  const { app, port } = await boot();
  const c = client(port);
  try {
    await c.open;
    for (let i = 0; i < CONFIG.RATE_LIMIT_MESSAGES + 1; i++) c.send({ type: 'draw' });
    const e = await c.next((m) => m.type === 'error' && m.code === 'RATE_LIMIT');
    assert.match(e.message, /كثيرة/);
    const closed = new Promise((r) => c.ws.on('close', r));
    for (let i = 0; i < CONFIG.RATE_LIMIT_MESSAGES * 2; i++) c.send({ type: 'draw' });
    await closed;
  } finally { await app.close(); }
});
