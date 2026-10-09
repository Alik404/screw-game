// HTTP static files + WebSocket on one port.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const CONFIG = require('./config');
const { createRooms } = require('./rooms');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Engine files shared with the browser. Whitelist only: nothing else under server/ is served.
const SHARED = {
  '/server/config.js': path.join(__dirname, 'config.js'),
  '/server/deck.js': path.join(__dirname, 'deck.js'),
  '/server/engine.js': path.join(__dirname, 'engine.js'),
  '/server/games/bank/config.js': path.join(__dirname, 'games', 'bank', 'config.js'),
  '/server/games/bank/board.js': path.join(__dirname, 'games', 'bank', 'board.js'),
  '/server/games/bank/cards.js': path.join(__dirname, 'games', 'bank', 'cards.js'),
  '/server/games/bank/engine.js': path.join(__dirname, 'games', 'bank', 'engine.js'),
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('غير موجود');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    res.end(data);
  });
}

function createApp() {
  const rooms = createRooms();
  // Changes on every start: lets clients tell "the server restarted and every room is gone".
  const bootId = crypto.randomUUID();

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch (e) {
      res.writeHead(400);
      return res.end();
    }
    if (url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('ok');
    }
    if (SHARED[url]) return sendFile(res, SHARED[url]);
    const rel = url === '/' ? '/index.html' : url;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    sendFile(res, file);
  });

  const wss = new WebSocketServer({ server, maxPayload: CONFIG.MAX_MESSAGE_BYTES });

  wss.on('connection', (ws) => {
    const conn = {
      room: null,
      send(obj) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
      },
      close() {
        ws.close();
      },
    };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    conn.send({ type: 'hello', bootId: bootId });
    // Simple flood protection: a fixed window of RATE_LIMIT_MESSAGES per RATE_LIMIT_WINDOW_SECONDS.
    let windowStart = Date.now();
    let count = 0;
    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > CONFIG.RATE_LIMIT_WINDOW_SECONDS * 1000) { windowStart = now; count = 0; }
      count += 1;
      if (count > CONFIG.RATE_LIMIT_MESSAGES * 2) return ws.terminate(); // far over the limit: drop
      if (count > CONFIG.RATE_LIMIT_MESSAGES) {
        return conn.send({ type: 'error', code: 'RATE_LIMIT', message: 'رسائل كثيرة جداً. انتظر قليلاً.' });
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return conn.send({ type: 'error', message: 'رسالة غير صالحة.' });
      }
      rooms.handle(conn, msg);
    });
    ws.on('close', () => rooms.close(conn));
    ws.on('error', () => {});
  });

  // Drop dead sockets (phone in a pocket, wifi gone) so disconnects are noticed.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, CONFIG.HEARTBEAT_SECONDS * 1000);
  heartbeat.unref();

  return {
    server,
    rooms,
    bootId,
    close() {
      clearInterval(heartbeat);
      rooms.shutdown();
      wss.clients.forEach((ws) => ws.terminate());
      return new Promise((resolve) => {
        server.close(resolve);
        if (server.closeAllConnections) server.closeAllConnections(); // drop keep-alive sockets
      });
    },
  };
}

function lanAddresses() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach((list) => {
    (list || []).forEach((i) => {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    });
  });
  return out;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.server.listen(port, () => {
    console.log('لعبة سكرو تعمل. افتح من هذا الجهاز:');
    console.log('  http://localhost:' + port);
    const lan = lanAddresses();
    if (lan.length) {
      console.log('ومن الجوال (على نفس الواي فاي):');
      lan.forEach((a) => console.log('  http://' + a + ':' + port));
    }
    console.log('صفحة الاختبار: http://localhost:' + port + '/debug.html');
  });
}

module.exports = { createApp };
