// BLUEBIRD のオンラインリレー。依存パッケージはゼロ。
//
// ・静的ファイル配信（これ 1 本でゲームがまるごと動く）
// ・/ws で WebSocket（RFC 6455 を手書き）
// ・地形は全クライアントで決定論的に一致するので、中継するのは座標と姿勢だけ
//
//   node server/server.js [port]
//   ブラウザで http://localhost:8080/

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TICK_MS = 66;          // ≒ 15Hz
const MAX_PLAYERS = 48;
const IDLE_MS = 25000;
const PING_MS = 12000;

/* ------------------------------------------------------- 静的配信 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400); res.end('bad request'); return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);
  // ルート外へ抜けさせない
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403); res.end('forbidden'); return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

/* ------------------------------------------- WebSocket（RFC 6455） */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy(); return;
  }
  if (players.size >= MAX_PLAYERS) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    return;
  }

  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  addPlayer(socket);
});

/** サーバ→クライアントのフレームを作る（マスクなし）。 */
function encodeFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, data]);
}

/**
 * 受信バッファからフレームを取り出す。
 * TCP は境界を保証しないので、揃うまで溜めてから解く。
 */
function decodeFrames(state, chunk, onMessage, onClose, onPing) {
  state.buf = state.buf.length ? Buffer.concat([state.buf, chunk]) : chunk;
  for (;;) {
    const buf = state.buf;
    if (buf.length < 2) return;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return;
      len = buf.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return;
      const big = buf.readBigUInt64BE(2);
      if (big > 1_000_000n) { onClose(1009); return; }
      len = Number(big); off = 10;
    }
    if (len > 1_000_000) { onClose(1009); return; }
    let mask = null;
    if (masked) {
      if (buf.length < off + 4) return;
      mask = buf.subarray(off, off + 4);
      off += 4;
    } else {
      // クライアントからのフレームは必ずマスクされていなければならない
      onClose(1002); return;
    }
    if (buf.length < off + len) return;

    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i & 3];
    state.buf = buf.subarray(off + len);

    if (opcode === 0x8) { onClose(1000); return; }
    if (opcode === 0x9) { onPing(payload); continue; }
    if (opcode === 0xa) continue;                    // pong
    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      state.frag = state.frag ? Buffer.concat([state.frag, payload]) : payload;
      if (fin) {
        const msg = state.frag;
        state.frag = null;
        onMessage(msg.toString('utf8'));
      }
      continue;
    }
    onClose(1003); return;
  }
}

/* ---------------------------------------------------- プレイヤー */

let nextId = 1;
const players = new Map();

function addPlayer(socket) {
  const id = nextId++;
  const p = {
    id, socket, name: `rider${id}`,
    // x, y, z, yaw, roll, speed, distance, flow, state
    d: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    alive: true,
    nameDirty: true,
    last: Date.now(),
    rx: { buf: Buffer.alloc(0), frag: null },
  };
  players.set(id, p);
  // 新しく来た人が全員の名前を受け取れるよう、次のティックで名前を配り直す
  for (const q of players.values()) q.nameDirty = true;
  log(`+ ${id} （現在 ${players.size} 人）`);

  send(p, JSON.stringify({ t: 'welcome', id, players: players.size }));

  socket.on('data', (chunk) => {
    decodeFrames(p.rx, chunk,
      (msg) => onMessage(p, msg),
      () => dropPlayer(p),
      (payload) => rawSend(p, encodeFrame(payload, 0xa)));
  });
  socket.on('error', () => dropPlayer(p));
  socket.on('close', () => dropPlayer(p));
}

function dropPlayer(p) {
  if (!p.alive) return;
  p.alive = false;
  players.delete(p.id);
  try { p.socket.destroy(); } catch { /* すでに閉じている */ }
  broadcast(JSON.stringify({ t: 'bye', id: p.id }));
  log(`- ${p.id} （現在 ${players.size} 人）`);
}

function onMessage(p, raw) {
  p.last = Date.now();
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (m.t === 'hi') {
    if (typeof m.name === 'string') {
      // 制御文字を落として長さを切る（表示を壊されないように）
      const clean = Array.from(m.name).filter((ch) => ch.codePointAt(0) >= 0x20).join('');
      p.name = clean.slice(0, 12) || `rider${p.id}`;
      for (const q of players.values()) q.nameDirty = true;
    }
  } else if (m.t === 's' && Array.isArray(m.d) && m.d.length === 9) {
    for (let i = 0; i < 9; i++) {
      const v = m.d[i];
      p.d[i] = Number.isFinite(v) ? v : 0;
    }
  }
}

function rawSend(p, frame) {
  if (!p.alive) return;
  try { p.socket.write(frame); } catch { dropPlayer(p); }
}

function send(p, text) { rawSend(p, encodeFrame(text)); }

function broadcast(text) {
  const frame = encodeFrame(text);
  for (const p of players.values()) rawSend(p, frame);
}

/* ------------------------------------------------------ ワールド更新 */

setInterval(() => {
  if (!players.size) return;
  const now = Date.now();

  for (const p of players.values()) {
    if (now - p.last > IDLE_MS) dropPlayer(p);
  }
  if (!players.size) return;

  const list = [];
  const names = {};
  let anyName = false;
  for (const p of players.values()) {
    list.push([p.id, ...p.d]);
    if (p.nameDirty) { names[p.id] = p.name; anyName = true; }
  }
  const msg = { t: 'w', p: list };
  if (anyName) {
    msg.n = names;
    for (const p of players.values()) p.nameDirty = false;
  }
  const frame = encodeFrame(JSON.stringify(msg));
  for (const p of players.values()) rawSend(p, frame);
}, TICK_MS);

// 生存確認
setInterval(() => {
  const frame = encodeFrame(Buffer.alloc(0), 0x9);
  for (const p of players.values()) rawSend(p, frame);
}, PING_MS);

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

server.listen(PORT, () => {
  console.log(`BLUEBIRD  →  http://localhost:${PORT}/`);
  console.log(`WebSocket →  ws://localhost:${PORT}/ws`);
});

process.on('SIGINT', () => { console.log('\nbye'); process.exit(0); });
