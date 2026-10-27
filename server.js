'use strict';
// 九路棋盤連線伺服器：零依賴（只用 Node 內建模組），伺服器端驗證所有走法。
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const Rules = require('./public/rules.js');
const {Worker} = require('worker_threads');   // AI 在 worker 裡思考（ai-worker.js），不卡住主執行緒
const aiWorkers = {}, aiJobs = new Map(); let aiId = 0;
function aiThink(level, G, side, budget){
  return new Promise(res => {
    try {
      let w = aiWorkers[level];
      if (!w) { w = aiWorkers[level] = new Worker(path.join(__dirname, 'ai-worker.js')); w.unref();
        w.on('message', m => { const f = aiJobs.get(m.id); if (f) { aiJobs.delete(m.id); f(m.list); } });
        w.on('error', e => { console.error('AI worker 錯誤', e); aiWorkers[level] = null; aiJobs.forEach(f => f([])); aiJobs.clear(); });
        w.on('exit', () => { if (aiWorkers[level] === w) aiWorkers[level] = null; }); }
      const id = ++aiId; aiJobs.set(id, res); w.postMessage({id, G, side, level, budget});
    } catch (e) { console.error(e); res([]); }
  });
}
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DATA = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'players.json');
// ---------- AI 練習室：大廳固定四間，各放一款 AI（初階／中等／進階／超高階；ID 含控制字元，真人註冊不到）----------
const BOT_DELAY = +process.env.CHESS_BOT_DELAY_MS || 700;   // AI 下棋前停頓，讓人看得到
const BOTS = {
  '\u0001beginner': {name: '🤖 初階AI',   level: 'beginner', room: '初階AI練習室',   ms: 150},
  '\u0001medium':   {name: '🤖 中等AI',   level: 'medium',   room: '中等AI練習室',   ms: 400},
  '\u0001advanced': {name: '🤖 進階AI',   level: 'advanced', room: '進階AI練習室',   ms: 1500},
  '\u0001super':    {name: '🤖 超高階AI', level: 'super',    room: '超高階AI練習室', ms: 3000}
};
const MIME = {'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.gif':'image/gif'};

// ---------- 玩家（固定 ID：ID 綁定第一次登記時的金鑰，伺服器只存雜湊）----------
let players = {}; try { players = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) {}
function savePlayers(){ fs.mkdirSync(path.dirname(DATA), {recursive:true}); fs.writeFileSync(DATA + '.tmp', JSON.stringify(players)); fs.renameSync(DATA + '.tmp', DATA); }
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

// ---------- 靜態檔案 ----------
const server = http.createServer((req, res) => {
  let u; try { u = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { u = '/'; }
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(PUB, u));
  if (!f.startsWith(PUB + path.sep) || !MIME[path.extname(f)]) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(f)], 'Cache-Control': 'no-cache'}); res.end(b);
  });
});

// ---------- 最小 WebSocket（RFC 6455：文字訊息、ping/pong、close）----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', all = new Set();
function frame(op, p){
  const n = p.length; let h;
  if (n < 126) h = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, p]);
}
const send = (ws, o) => { if (ws && !ws.socket.destroyed) ws.socket.write(frame(1, Buffer.from(JSON.stringify(o)))); };
const fail = (ws, msg, fatal) => send(ws, {t:'error', msg, fatal: !!fatal});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return socket.destroy();
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
  const ws = {socket, player: null, alive: true, buf: Buffer.alloc(0), frag: []};
  all.add(ws);
  socket.on('data', d => { ws.buf = Buffer.concat([ws.buf, d]); parse(ws); });
  socket.on('close', () => { all.delete(ws); onClose(ws); });
  socket.on('error', () => socket.destroy());
});
function parse(ws){
  for (;;) {
    const b = ws.buf; if (b.length < 2) return;
    const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (len > 65536 || !masked) return ws.socket.destroy();
    if (b.length < off + 4 + len) return;
    const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    ws.buf = b.subarray(off + 4 + len);
    if (op === 8) { ws.socket.end(frame(8, Buffer.alloc(0))); return; }
    if (op === 9) { ws.socket.write(frame(10, data)); continue; }
    if (op === 10) { ws.alive = true; continue; }
    if (op === 1 || op === 0) {
      if (op === 1) ws.frag = [];
      ws.frag.push(data);
      if (fin) { const s = Buffer.concat(ws.frag).toString('utf8'); ws.frag = []; try { handle(ws, s); } catch (e) { console.error(e); } }
    }
  }
}

// ---------- 房間 ----------
const rooms = new Map(), playerRoom = new Map(), conns = new Map();   // 房名(小寫)→房間；玩家→房名；玩家→連線
const rkey = n => n.toLowerCase();
const pname = id => BOTS[id] ? BOTS[id].name : players[id].name;
function meta(r, id){
  const rk = rkey(r.name), on = x => !!x && (!!BOTS[x] || (conns.has(x) && playerRoom.get(x) === rk));
  return {name: r.name, locked: r.locked, status: r.status, host: pname(r.host),
    sides: r.sides && {w: {id: r.sides.w, name: pname(r.sides.w)}, b: {id: r.sides.b, name: pname(r.sides.b)}},
    you: r.sides ? (r.sides.w === id ? 'w' : 'b') : null,
    online: r.sides ? {w: on(r.sides.w), b: on(r.sides.b)} : null};
}
const roomMsg = (r, id) => ({t:'room', room: meta(r, id), state: r.G, now: Date.now()});
const sendRoom = r => [r.host, r.guest].forEach(id => { if (id && playerRoom.get(id) === rkey(r.name)) send(conns.get(id), roomMsg(r, id)); });
const roomsList = () => [...rooms.values()].filter(r => r.status === 'waiting').map(r => ({name: r.name, locked: r.locked, host: pname(r.host), bot: r.bot ? r.bot.level : undefined}));
function broadcastRooms(){ const list = roomsList(); conns.forEach((ws, id) => { if (!playerRoom.has(id)) send(ws, {t:'rooms', list}); }); }
function dropRoom(r){
  clearTimeout(r.timer); rooms.delete(rkey(r.name));
  [r.host, r.guest].forEach(id => { if (id && playerRoom.get(id) === rkey(r.name)) { playerRoom.delete(id); send(conns.get(id), {t:'left'}); send(conns.get(id), {t:'rooms', list: roomsList()}); } });
}

function schedule(r){   // 在時間到的那一刻由伺服器結算，不依賴玩家送出動作
  clearTimeout(r.timer); const G = r.G; if (!G || !G.clock || G.over) return;
  r.timer = setTimeout(() => { if (rooms.get(rkey(r.name)) !== r) return; if (Rules.timeUp(G, Date.now())) sendRoom(r); else schedule(r); }, Math.max(50, Rules.deadline(G) - Date.now() + 30));
  r.timer.unref();
}
function handle(ws, s){
  let m; try { m = JSON.parse(s); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'hello') return hello(ws, m);
  const id = ws.player; if (!id) return fail(ws, '請先登入');
  const rk = playerRoom.get(id), r = rk && rooms.get(rk);
  if (m.t === 'create') return create(ws, id, m, r);
  if (m.t === 'join') return join(ws, id, m, r);
  if (m.t === 'leave') return leave(id, r);
  if (!r || r.status !== 'playing') return fail(ws, '不在對局中');
  const res = Rules.play(r.G, r.sides.w === id ? 'w' : 'b', m, Date.now()); r.ts = Date.now(); schedule(r);
  if (!res.ok && !res.ended) { fail(ws, res.error); send(ws, roomMsg(r, id)); }
  else { sendRoom(r); botTurn(r); }
}
function hello(ws, m){
  const name = String(m.id || '').trim(), key = String(m.key || '');
  if (!name || name.length > 16 || /[\u0000-\u001f<>&"]/.test(name) || !/^[0-9a-f]{32,128}$/.test(key)) return fail(ws, 'ID 或金鑰格式不正確', true);
  const k = name.toLowerCase(), kh = sha(key);
  if (players[k]) { if (!same(players[k].keyHash, kh)) return fail(ws, '這個 ID 已被其他人使用', true); }
  else { players[k] = {name, keyHash: kh}; savePlayers(); }
  const old = conns.get(k);
  if (old && old !== ws) { fail(old, '你的 ID 已在別處登入', true); old.player = null; old.socket.end(); }
  ws.player = k; conns.set(k, ws);
  send(ws, {t:'hello_ok', name: pname(k)});
  const rk = playerRoom.get(k), r = rk && rooms.get(rk);
  if (r) sendRoom(r); else send(ws, {t:'rooms', list: roomsList()});
}
function create(ws, id, m, r){
  if (r) return fail(ws, '你已在房間中，請先離開');
  const name = String(m.name || '').trim().slice(0, 20); if (!name) return fail(ws, '請輸入房間名稱');
  if (rooms.has(rkey(name))) return fail(ws, '房間名稱已被使用');
  const pw = String(m.pw || '').slice(0, 64), salt = crypto.randomBytes(8).toString('hex');
  const room = {name, locked: !!pw, salt, pwHash: pw ? hashPw(pw, salt) : '', host: id, guest: null, status: 'waiting', sides: null, G: null, ts: Date.now()};
  rooms.set(rkey(name), room); playerRoom.set(id, rkey(name)); sendRoom(room); broadcastRooms();
}
function join(ws, id, m, r){
  if (r) return fail(ws, '你已在房間中，請先離開');
  const rk = rkey(String(m.name || '').trim()), room = rooms.get(rk);
  if (!room) return fail(ws, '找不到這個房間');
  if (room.host === id || room.guest === id) { playerRoom.set(id, rk); return sendRoom(room); }   // 成員重新進入
  if (room.guest) return fail(ws, '房間已滿');
  if (room.locked && !same(hashPw(String(m.pw || '').slice(0, 64), room.salt), room.pwHash)) return fail(ws, '密碼錯誤');
  const hostWhite = Math.random() < 0.5;   // 隨機分配黑白
  room.guest = id; room.sides = hostWhite ? {w: room.host, b: id} : {w: id, b: room.host};
  room.G = Rules.create(); room.status = 'playing'; room.ts = Date.now();
  const env = process.env;   // 棋鐘：每手 8 秒、自由時間 301 秒、開局緩衝 5 秒（測試時可用環境變數調短）
  room.G.clock = Rules.clockInit(Date.now(), {moveMs: +env.CHESS_MOVE_MS || 8000, fastMs: +env.CHESS_FAST_MS || 3000, freeMs: +env.CHESS_FREE_MS || 301000, graceMs: env.CHESS_GRACE_MS === undefined ? 5000 : +env.CHESS_GRACE_MS});
  schedule(room);
  playerRoom.set(id, rk); sendRoom(room); broadcastRooms(); botTurn(room);
}
function leave(id, r){
  if (!r) return;
  const ws = conns.get(id), rk = rkey(r.name);
  playerRoom.delete(id);
  if (r.bot) resetBot(r);
  else if (r.status === 'waiting' || ![r.host, r.guest].some(x => playerRoom.get(x) === rk)) dropRoom(r); else sendRoom(r);
  send(ws, {t:'left'}); send(ws, {t:'rooms', list: roomsList()}); broadcastRooms();
}
// ---------- AI 房間：建立、重置、輪到 AI 時下棋 ----------
function makeBotRoom(botId){
  const b = BOTS[botId], room = {name: b.room, locked: false, salt: '', pwHash: '', host: botId, guest: null, status: 'waiting', sides: null, G: null, ts: Date.now(), bot: {id: botId, level: b.level, ms: b.ms}};
  rooms.set(rkey(room.name), room); return room;
}
function resetBot(r){   // 對局結束或玩家離開：房間回到「等待挑戰者」，AI 房間永遠不會被刪除
  clearTimeout(r.timer); clearTimeout(r.botTimer);
  if (r.guest) playerRoom.delete(r.guest);
  r.guest = null; r.sides = null; r.G = null; r.status = 'waiting'; r.ts = Date.now(); broadcastRooms();
}
function botTurn(r){
  if (!r.bot) return; clearTimeout(r.botTimer);
  const G = r.G; if (!G || G.over) return;
  const side = r.sides.w === r.host ? 'w' : 'b';
  if ((G.phase ? G.phase.side : G.turn) !== side) return;
  const wait = Math.max(BOT_DELAY, G.clock ? G.clock.start - Date.now() : 0);   // 開局緩衝內不搶先
  r.botTimer = setTimeout(async () => {
    if (rooms.get(rkey(r.name)) !== r || r.G !== G || G.over) return;
    const avail = Rules.clockView(G, Date.now()).move, budget = Math.max(100, Math.min(r.bot.ms, avail * 0.4));
    let list = []; try { list = await aiThink(r.bot.level, G, side, budget); } catch (e) { console.error(e); }
    if (rooms.get(rkey(r.name)) !== r || r.G !== G || G.over) return;   // 思考期間房間可能已重置或對局已結束
    let done = false;
    for (const a of list) { const res = Rules.play(G, side, a, Date.now()); if (res.ok || res.ended) { done = true; break; } }
    if (!done && !G.phase) for (const p of G.pieces.filter(o => o.side === side)) {   // 保底：隨便走一步合法的
      const m = Rules.moves(G, p.id)[0]; if (m && Rules.play(G, side, {t:'move', pid:p.id, x:m.x, y:m.y}, Date.now()).ok) break; }
    r.ts = Date.now(); schedule(r); sendRoom(r); botTurn(r);
  }, wait);
  r.botTimer.unref();
}
function onClose(ws){
  const id = ws.player; if (!id || conns.get(id) !== ws) return;
  conns.delete(id);
  const rk = playerRoom.get(id), r = rk && rooms.get(rk);
  if (r && r.status === 'playing') sendRoom(r);
}

// ---------- 維護：心跳、清理過期房間 ----------
setInterval(() => all.forEach(ws => { if (!ws.alive) return ws.socket.destroy(); ws.alive = false; if (!ws.socket.destroyed) ws.socket.write(frame(9, Buffer.alloc(0))); }), 30000).unref();
setInterval(() => rooms.forEach(r => {
  if (r.bot) { if (r.guest && !conns.has(r.guest) && Date.now() - r.ts > 5 * 60e3) resetBot(r); return; }   // AI 房：玩家離線超過 5 分鐘就重置
  const idle = Date.now() - r.ts, offline = ![r.host, r.guest].some(x => x && conns.has(x));
  if ((r.status === 'waiting' && !conns.has(r.host) && idle > 10 * 60e3) || (offline && idle > 2 * 3600e3)) { dropRoom(r); broadcastRooms(); }
}), 60000).unref();

Object.keys(BOTS).forEach(makeBotRoom);
if (require.main === module) server.listen(PORT, () => console.log(`九路棋盤伺服器已啟動： http://localhost:${PORT}`));
module.exports = {server, Rules};
