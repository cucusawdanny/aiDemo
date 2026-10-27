#!/usr/bin/env node
'use strict';
/* 大量生成對局紀錄（透過 WebSocket 連到線上網站，真的在網站上開房、對弈）。需要 Node 22+（內建 WebSocket）。

   兩種模式：
   pvp  兩個腳本帳號進同一間私人房互相對弈（可同時開很多間），雙方策略可各自指定：
        node tools/online-gen.js --mode pvp --games 50 --concurrency 3 --w medium,advanced --b random,beginner,medium
   bot  腳本帳號去挑戰網站上的 AI 練習室（四間房各一次只能一人，所以最多同時 4 局）：
        node tools/online-gen.js --mode bot --games 40 --bots beginner,medium,advanced,super --me medium

   策略（--w / --b / --me）：random 亂走、beginner、medium、advanced、super（用本機的 ai.js 思考）。逗號分隔＝每局隨機挑一個。
   算分策略：在任何策略後面加 +harvest（例如 super+harvest；單寫 harvest ＝ super+harvest）。
     尾盤（雙方棋子都 ≤ --harvest-n 顆，預設 7）且己方棋子分數 > 10 並領先時，改用「收割搜尋」：以最少代價吃光對方除王以外的棋子（會把對方復活算進去，
     最後一顆不吃孩／OL）。達成條件後就停手不走，讓棋鐘燒完進入結算：燒完的是自己 → 自己得 P 分、對方得 Q+10 分，所以 P > Q+10 就必勝。
     --harvest-goal lone（預設）：對方只剩王（Q=0）且 P>10 才停手；  lead：只要 P−Q>10 就停手（更省步）。
     停手要等整個自由時間燒完（約 5 分鐘），可用 --no-stall 關閉停手、改成繼續走到步數上限。
   單王提前結算（僅 pvp、雙方都是 super 時）：只要有一方只剩王（且沒有待處理的復活/選擇階段），就不再走子、也不等棋鐘，
     直接呼叫 Rules.adjudicate 依剩餘棋子分數結算（同專案「到達步數上限」的判定：雙方都沒燒完自由時間，+10 互相抵銷，分高者勝、同分和局），
     記錄 reason='lone-settle' 後離房。用 --no-lone-settle 關閉。
   輸出：<out>（JSONL，一局一行）與同名 .txt（給 AI 閱讀的棋譜摘要）。 */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), {parseArgs} = require('util');
const Rules = require('../public/rules.js'), AI = require('../ai.js');

const {values: O} = parseArgs({options: {
  url: {type: 'string', default: 'https://aidemo-5h0s.onrender.com'},
  mode: {type: 'string', default: 'pvp'},
  games: {type: 'string', default: '20'},
  concurrency: {type: 'string', default: '2'},
  w: {type: 'string', default: 'medium'}, b: {type: 'string', default: 'medium'}, me: {type: 'string', default: 'medium'},
  bots: {type: 'string', default: 'beginner,medium,advanced,super'},
  budget: {type: 'string', default: '300'},          // 本機 AI 每手思考毫秒數（網站每手只有 8 秒，別設太大）
  'open-tol': {type: 'string', default: '1.2'},      // 開局前幾手放寬選擇（增加開局多樣性，同 selfplay）
  'open-plies': {type: 'string', default: '14'},
  cap: {type: 'string', default: '250'},             // 單局步數上限（超過就放棄該局並標記 capped）
  gap: {type: 'string', default: '500'},             // 兩局之間的停頓毫秒
  delay: {type: 'string', default: '30'},            // 每步之間的停頓毫秒
  out: {type: 'string', default: 'data/online-games.jsonl'},
  prefix: {type: 'string', default: 'gen'},          // 腳本帳號 ID 前綴
  'harvest-n': {type: 'string', default: '7'},       // 收割策略啟動條件：雙方棋子數都 ≤ 此值
  'harvest-goal': {type: 'string', default: 'lone'}, // lone＝對方只剩王才停手；lead＝領先超過 10 分就停手
  'no-stall': {type: 'boolean', default: false},     // 達成條件後不停手等棋鐘，繼續走
  'no-lone-settle': {type: 'boolean', default: false}, // 關閉「super vs super 單王提前結算」
  boards: {type: 'boolean', default: false},         // 每一步都存盤面（檔案會大很多）
  help: {type: 'boolean', default: false}
}});
if (O.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
const cfg = {mode: O.mode, games: +O.games, conc: Math.max(1, +O.concurrency), w: O.w.split(','), b: O.b.split(','), me: O.me.split(','),
  bots: O.bots.split(','), budget: +O.budget, openTol: +O['open-tol'], openPlies: +O['open-plies'], cap: +O.cap, gap: +O.gap, delay: +O.delay,
  boards: O.boards, out: O.out, prefix: O.prefix, harvestN: +O['harvest-n'], harvestGoal: O['harvest-goal'], stall: !O['no-stall'], loneSettle: !O['no-lone-settle']};
if (!['lone', 'lead'].includes(cfg.harvestGoal)) { console.error('--harvest-goal 只能是 lone 或 lead'); process.exit(1); }
const STRATS = ['random', 'beginner', 'medium', 'advanced', 'super'];
const parseStrat = s => { const [b, f] = String(s).split('+'); return s === 'harvest' ? {base: 'super', harvest: true} : {base: b, harvest: f === 'harvest'}; };
[...cfg.w, ...cfg.b, ...cfg.me].forEach(s => { const p = parseStrat(s); if (!STRATS.includes(p.base) || (s.includes('+') && !p.harvest)) { console.error('未知策略：' + s + '（可用：' + STRATS.join(', ') + '，後面可加 +harvest）'); process.exit(1); } });
const BOT_ROOMS = {beginner: '初階AI練習室', medium: '中等AI練習室', advanced: '進階AI練習室', super: '超高階AI練習室'};
cfg.bots.forEach(s => { if (!BOT_ROOMS[s]) { console.error('未知 AI 房：' + s); process.exit(1); } });
const BASE = O.url.replace(/\/+$/, ''), WS = BASE.replace(/^http/, 'ws');
const RUN = Date.now().toString(36).slice(-4), sleep = ms => new Promise(r => setTimeout(r, ms));
const pick = a => a[Math.floor(Math.random() * a.length)], clone = o => JSON.parse(JSON.stringify(o));

// ---------- 帳號金鑰（存在本機，之後重跑用同一批 ID，不會一直在伺服器上新增玩家）----------
const KEYFILE = path.join(path.dirname(path.resolve(cfg.out)), 'gen-keys.json');
let keys = {}; try { keys = JSON.parse(fs.readFileSync(KEYFILE, 'utf8')); } catch (e) {}
function keyFor(id) { if (!keys[id]) { keys[id] = crypto.randomBytes(24).toString('hex'); fs.mkdirSync(path.dirname(KEYFILE), {recursive: true}); fs.writeFileSync(KEYFILE, JSON.stringify(keys, null, 1)); } return keys[id]; }

// ---------- WebSocket 客戶端 ----------
class Client {
  constructor(id) { this.id = id; this.key = keyFor(id); this.waiters = []; this.reset(); this.ver = 0; this.errVer = 0; this.leftVer = 0; }
  reset() { this.room = null; this.state = null; }
  async connect() {
    this.helloOk = false; this.fatal = null; this.closed = false; this.room = null; this.state = null; this.rooms = null;
    await new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(WS), to = setTimeout(() => rej(new Error('連線逾時')), 20000);
      ws.onopen = () => { clearTimeout(to); res(); }; ws.onerror = () => { clearTimeout(to); rej(new Error('連線失敗')); };
      ws.onmessage = e => this.onMsg(JSON.parse(e.data)); ws.onclose = () => { this.closed = true; this.poke(); };
    });
    this.send({t: 'hello', id: this.id, key: this.key});
    await this.waitFor(() => this.helloOk || this.fatal, 15000, 'hello');
    if (this.fatal) throw new Error(this.id + '：' + this.fatal + '（若 ID 已被占用，請改用 --prefix 換一批 ID）');
    // 登入後伺服器會回「房間」（這個 ID 還留在舊房間，例如上次腳本被中斷）或「大廳」；還在舊房間就先離開，否則之後開房會被拒絕
    await this.waitFor(() => this.room || this.rooms, 5000, '大廳').catch(() => {});
    if (this.room) { console.log(`  （${this.id} 還留在舊房間「${this.room.name}」，先離開）`); await this.leave(); }
  }
  onMsg(m) {
    if (m.t === 'hello_ok') this.helloOk = true;
    else if (m.t === 'room') { this.room = m.room; this.state = m.state; this.ver++; }
    else if (m.t === 'rooms') this.rooms = m.list;
    else if (m.t === 'error') { this.lastError = m; this.errVer++; if (m.fatal) this.fatal = m.msg; }
    else if (m.t === 'left') { this.leftVer++; this.reset(); }
    this.poke();
  }
  poke() { this.waiters = this.waiters.filter(w => { let ok = false; try { ok = w.pred(); } catch (e) {}
    if (ok) { clearTimeout(w.timer); w.res(); return false; } if (this.closed) { clearTimeout(w.timer); w.rej(new Error('連線中斷')); return false; } return true; }); }
  waitFor(pred, ms, what) { return new Promise((res, rej) => { try { if (pred()) return res(); } catch (e) {}
    if (this.closed) return rej(new Error('連線中斷'));
    const w = {pred, res, rej, timer: setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); rej(new Error('等待逾時：' + (what || ''))); }, ms)}; this.waiters.push(w); }); }
  send(o) { if (this.closed) throw new Error('連線中斷'); this.ws.send(JSON.stringify(o)); }
  async request(msg, pred, ms = 15000) { const ev = this.errVer; this.send(msg);
    await this.waitFor(() => this.errVer > ev || pred(), ms, msg.t); if (this.errVer > ev) throw new Error(this.lastError.msg); }
  async leave() { if (this.closed) return; const lv = this.leftVer; try { this.send({t: 'leave'}); await this.waitFor(() => this.leftVer > lv, 5000, 'leave'); } catch (e) {} }
  close() { try { this.ws.close(); } catch (e) {} }
}
async function wake() {   // Render 免費方案閒置後要冷啟動，先戳醒它
  for (let i = 0; i < 12; i++) { try { const r = await fetch(BASE + '/', {signal: AbortSignal.timeout(30000)}); if (r.ok) return; } catch (e) {}
    console.log('等待網站啟動…'); await sleep(5000); }
  throw new Error('網站沒有回應：' + BASE);
}
async function ensure(c) { if (c.closed || !c.helloOk) { for (let i = 0; i < 5; i++) { try { await c.connect(); return; } catch (e) { await sleep(2000 * (i + 1)); } } throw new Error('重新連線失敗'); } }

// ---------- 決策 ----------
function randomActions(G, side) {
  if (G.phase) {
    if (G.phase.kind === 'slash') return [{t: 'slash', yes: Math.random() < 0.5}];
    if (G.phase.kind === 'pick') return [{t: 'pick', ty: pick(G.phase.cands)}];
    const e = []; for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (!G.pieces.some(p => p.x === x && p.y === y)) e.push({t: 'place', x, y});
    return [pick(e)];
  }
  const o = []; G.pieces.filter(p => p.side === side && !Rules.frozen(G, p.id)).forEach(p => Rules.moves(G, p.id).forEach(m => o.push({t: 'move', pid: p.id, x: m.x, y: m.y})));
  for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
  return o;
}
// ---------- 算分收割策略 ----------
const HV = {king: 0, dong: 10, ol: 8, kid: 8, tea: 7, night: 5, t: 2}, hv = p => p.type in HV ? HV[p.type] : 3;   // 同網站計分表，其餘 3 分
const oppOf = s => s === 'w' ? 'b' : 'w', HTIMEOUT = {};
const cntOf = (G, s) => G.pieces.filter(p => p.side === s).length;
function harvestOn(G, side) {   // 尾盤、己方分數 > 10 且領先 → 啟動收割
  if (G.phase || G.over || G.turn !== side) return false;
  const P = Rules.pts(G, side), Q = Rules.pts(G, oppOf(side));
  return cntOf(G, 'w') <= cfg.harvestN && cntOf(G, 'b') <= cfg.harvestN && P > 10 && P > Q;
}
function stallOK(G, side) {   // 此刻停手不走、等棋鐘結算，是否保證獲勝（最壞情況：自己的鐘燒完 → 自己 P 分、對方 Q+10 分）
  if (G.phase || G.over || G.turn !== side) return false;
  const P = Rules.pts(G, side), Q = Rules.pts(G, oppOf(side));
  return cfg.harvestGoal === 'lone' ? (Q === 0 && P > 10) : (P - Q > 10);
}
// ---------- super vs super（pvp）：一方只剩王 → 直接依棋子分數結算（不等棋鐘）----------
const onlyKing = (G, s) => { const a = G.pieces.filter(p => p.side === s); return a.length > 0 && a.every(p => p.type === 'king'); };
function loneSettle(G, players) {
  if (!cfg.loneSettle || cfg.mode !== 'pvp' || G.phase || G.over) return null;
  if (parseStrat(players.w.strat).base !== 'super' || parseStrat(players.b.strat).base !== 'super') return null;   // 含 super+harvest
  const wl = onlyKing(G, 'w'), bl = onlyKing(G, 'b'); if (!wl && !bl) return null;
  const S = clone(G); Rules.adjudicate(S);   // 在複本上結算，取結果
  return {over: S.over, lone: wl && bl ? 'both' : wl ? 'w' : 'b', pts: S.result.pieces};
}
function hEval(k, me) {   // 己方視角：自己的分數 − 2×對方分數；P ≤ 10 重罰；對方只剩王且 P>10 重賞；其餘靠近對方的子（沒子了就靠近王）
  let P = 0, Q = 0; const mine = [], theirs = [];
  for (const p of k.pieces()) { if (p.side === me) { P += hv(p); mine.push(p); } else { Q += hv(p); theirs.push(p); } }
  let s = P - 2 * Q; if (P <= 10) s -= (11 - P) * 20; if (Q === 0) s += P > 10 ? 500 : 100;
  const tg = theirs.filter(p => p.type !== 'king'), targets = tg.length ? tg : theirs, hunters = mine.filter(p => p.type !== 'king'), hs = hunters.length ? hunters : mine; let d = 0;
  for (const t of targets) { let m = 9; for (const a of hs) m = Math.min(m, Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y))); d += m; }
  return s - 0.05 * d;
}
function hOrdered(k, side) {
  const list = k.moves(side);
  for (const o of list) { const q = k.pieceAt(o.m.x, o.m.y); o.o = q && q.side !== side ? hv(q) * 10 - hv(o.p) : 0; }
  return list.sort((a, b) => b.o - a.o);
}
function hSearch(k, me, side, depth, alpha, beta, dl) {   // negamax：回傳 side 視角的分數
  const ov = k.over(); if (ov) return ov === 'draw' ? 0 : ov === side ? 10000 + depth : -(10000 + depth);
  if (depth === 0) return (side === me ? 1 : -1) * hEval(k, me);
  if (Date.now() > dl) throw HTIMEOUT;
  const list = hOrdered(k, side);
  if (!list.length) return -hSearch(k, me, oppOf(side), depth - 1, -beta, -alpha, dl);   // 無棋可走＝跳過
  let best = -Infinity;
  for (const {p, m} of list) {
    const v = k.trial(() => { k.play(p, m); return -hSearch(k, me, oppOf(side), depth - 1, -beta, -alpha, dl); });
    if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break;
  }
  return best;
}
function harvestActions(G, side, budget) {   // 迭代加深；k.play 會自動模擬斬擊與對方復活（殺孩／OL 的代價因此算得進去）
  const sc = Rules.kit(G, k => {
    if (k.over() || k.phase() || k.turn() !== side) return null;
    const root = hOrdered(k, side); if (!root.length) return null;
    const dl = Date.now() + budget; let scored = null;
    for (let d = 1; d <= 8; d++) {
      const cur = [];
      try { for (const {p, m} of root) cur.push({p, m, v: k.trial(() => { k.play(p, m); return -hSearch(k, side, oppOf(side), d - 1, -Infinity, Infinity, dl); })}); }
      catch (e) { if (e !== HTIMEOUT) throw e; break; }
      scored = cur.sort((a, b) => b.v - a.v); root.splice(0, root.length, ...scored);
    }
    if (!scored) scored = root.map(({p, m}) => ({p, m, v: 0}));
    const pool = scored.filter(s => s.v >= scored[0].v - 0.02), first = pool[Math.floor(Math.random() * pool.length)];
    return [first, ...scored.filter(s => s !== first)].map(s => ({t: 'move', pid: s.p.id, x: s.m.x, y: s.m.y, v: s.v}));
  });
  if (!sc) return [];
  const safe = [], risky = []; sc.forEach((a, i) => (i < 6 && Rules.wouldLoseByRepeat(G, side, a) ? risky : safe).push(a));   // 避開「照走就因禁止著法判負」的著法
  return [...safe, ...risky].map(({t, pid, x, y}) => ({t, pid, x, y}));
}
function decide(G, side, strat0, moves) {
  const S = parseStrat(strat0), strat = S.base; let list = [];
  if (S.harvest && harvestOn(G, side)) { try { list = harvestActions(G, side, Math.min(cfg.budget * 2, 3000)); } catch (e) { console.error('收割策略錯誤', e.message); } if (list.length) return [...list, ...randomActions(G, side).slice(0, 8)]; }
  if (strat !== 'random') {
    try { list = AI.chooseActions(G, side, strat, {budgetMs: Math.min(cfg.budget, 3000), rnd: Math.random, tol: moves < cfg.openPlies ? cfg.openTol : 0.05}); } catch (e) { console.error('AI 錯誤', e.message); }
  }
  return [...list, ...randomActions(G, side).slice(0, 8)];   // 後面接幾個隨機合法動作當保底
}
const LET = {king: 'k', ol: 'o', otl: 'l', kid: 'i', iron: 'r', shoe: 's', tea: 't', godness: 'g', night: 'n', dong: 'd', guard: 'u', t: 'p'};
function boardStr(G) {   // 9 列以 / 分隔：白方大寫、黑方小寫，. 為空格（k王 o OL l OTL i孩 r熨 s鞋 t茶 g謎 n夜 d咚 u士 p龍）
  const g = Array.from({length: 9}, () => Array(9).fill('.'));
  G.pieces.forEach(p => { const c = LET[p.type] || '?'; g[p.y][p.x] = p.side === 'w' ? c.toUpperCase() : c; });
  return g.map(r => r.join('')).join('/') + ' ' + (G.phase ? G.phase.side : G.turn);
}

// ---------- 一局的共用流程：輪到我方的客戶端就思考並送出動作 ----------
// players: {w:{client,strat}, b:{client,strat}}（bot 模式中另一方沒有 client，等伺服器 AI 自己下）
async function playLoop(watcher, players, boards, label) {
  let moves = 0, capped = false, stall = null, settle = null, shown = 0; const actions = [];
  if (cfg.boards) boards.push(boardStr(watcher.state));
  while (!watcher.state.over) {
    if (moves >= cfg.cap) { capped = true; break; }
    const G = clone(watcher.state), side = G.phase ? G.phase.side : G.turn, pl = players[side];
    const st = loneSettle(G, players);
    if (st) { settle = {...st, at: moves}; console.log(`  ↳ ${label} 有一方只剩王（${st.lone === 'both' ? '雙方' : st.lone === 'w' ? '白' : '黑'}），直接結算：白 ${st.pts.w} 分、黑 ${st.pts.b} 分，${st.over === 'draw' ? '和局' : (st.over === 'w' ? '白' : '黑') + '勝'}`); break; }
    if (!pl.client) { const v = watcher.ver; await watcher.waitFor(() => watcher.ver > v, 30000, '等對手下棋'); continue; }
    if (cfg.stall && parseStrat(pl.strat).harvest && stallOK(G, side)) {   // 已達成算分條件：停手，讓棋鐘燒完進入結算
      const P = Rules.pts(G, side), Q = Rules.pts(G, oppOf(side)), wait = (G.clock ? Rules.moveLimit(G) + G.clock.free[side] : 10000) + 60000;
      stall = {side, at: moves, P, Q}; console.log(`  ↳ ${side === 'w' ? '白' : '黑'}方已達成算分條件（己方 ${P} 分、對方 ${Q} 分），停手等棋鐘結算（最多約 ${Math.ceil(wait / 1000)} 秒）`);
      const t1 = Date.now(), hb = setInterval(() => console.log(`  · ${label} 仍在等棋鐘結算…（已等 ${Math.round((Date.now() - t1) / 1000)} 秒）`), 60000);
      try { await watcher.waitFor(() => watcher.state.over, wait, '等待棋鐘結算'); } finally { clearInterval(hb); } break;
    }
    const cl = pl.client, cands = decide(G, side, pl.strat, moves); let ok = false;
    for (const a of cands) {
      const av = watcher.ver, ev = cl.errVer, cv = cl.ver; cl.send(a);
      await watcher.waitFor(() => cl.errVer > ev || watcher.ver > av, 20000, '伺服器回應');
      if (cl.errVer > ev) { await cl.waitFor(() => cl.ver > cv, 1500).catch(() => {}); continue; }
      const res = watcher.state && watcher.state.result;
      if (!(res && res.reason === 'time')) { actions.push({s: side, a}); if (a.t === 'move') moves++; }
      ok = true; break;
    }
    if (!ok) throw new Error('所有候選動作都被伺服器拒絕');
    if (cfg.boards && watcher.state) boards.push(boardStr(watcher.state));
    if (moves - shown >= 50 && watcher.state) { shown = moves; const S = watcher.state; console.log(`  · ${label} 第 ${moves} 手｜白 ${Rules.pts(S, 'w')} 分（${cntOf(S, 'w')} 顆）：黑 ${Rules.pts(S, 'b')} 分（${cntOf(S, 'b')} 顆）`); }
    await sleep(cfg.delay);
  }
  return {actions, moves, capped, stall, settle};
}
function record(meta, G, r, boards, t0) {
  const pts = {w: Rules.pts(G, 'w'), b: Rules.pts(G, 'b')}, cnt = s => G.pieces.filter(p => p.side === s).length;
  return {id: meta.id, run: RUN, mode: cfg.mode, t: new Date(t0).toISOString(), ms: Date.now() - t0,
    white: meta.white, black: meta.black, room: meta.room,
    over: r.settle ? r.settle.over : (G.over || null), reason: r.settle ? 'lone-settle' : G.result ? G.result.reason : (G.over ? 'king' : 'abandoned'),
    result: r.settle ? {reason: 'lone-settle', winner: r.settle.over, local: true} : (G.result || null), capped: r.capped,
    moves: r.moves, pts, left: {w: cnt('w'), b: cnt('b')}, ...(r.stall ? {stall: r.stall} : {}), ...(r.settle ? {settle: r.settle} : {}), actions: r.actions, log: G.hist, ...(cfg.boards ? {boards} : {})};
}
// ---------- 兩種模式 ----------
async function playPvp(A, B, n) {
  const room = `g${RUN}-${n}`, t0 = Date.now(), boards = []; A.reset(); B.reset();
  try {
    await A.request({t: 'create', name: room}, () => A.room && A.room.name === room);
    await B.request({t: 'join', name: room}, () => B.room && B.room.name === room && B.state);
    await A.waitFor(() => A.room.status === 'playing' && A.state, 10000, '開局');
    const sw = pick(cfg.w), sb = pick(cfg.b), by = {[A.room.you]: A, [B.room.you]: B};
    const players = {w: {client: by.w, strat: sw}, b: {client: by.b, strat: sb}};
    console.log(`▶ ${room} 開局：白 ${sw} vs 黑 ${sb}`);
    const r = await playLoop(A, players, boards, room);
    return record({id: `${RUN}-${n}`, room, white: {id: by.w.id, strat: sw}, black: {id: by.b.id, strat: sb}}, A.state, r, boards, t0);
  } finally { await Promise.all([A.leave(), B.leave()]); }
}
const roomLocks = {};   // 同一間 AI 房一次只能一個人
async function playBot(C, level, n) {
  const room = BOT_ROOMS[level], t0 = Date.now(), boards = []; C.reset();
  try {
    for (let i = 0; ; i++) {
      try { await C.request({t: 'join', name: room}, () => C.room && C.room.name === room && C.state); break; }
      catch (e) { if (i < 20 && /已滿|找不到/.test(e.message)) { await sleep(3000); continue; } throw e; }
    }
    const me = C.room.you, opp = me === 'w' ? 'b' : 'w', strat = pick(cfg.me), sides = C.room.sides;
    const players = {[me]: {client: C, strat}, [opp]: {client: null, strat: 'server:' + level}};
    console.log(`▶ ${room} 開局：我方（${me === 'w' ? '白' : '黑'}）${strat} vs 網站 ${level} AI`);
    const r = await playLoop(C, players, boards, room);
    return record({id: `${RUN}-${n}`, room, white: {id: sides.w.name, strat: players.w.strat}, black: {id: sides.b.name, strat: players.b.strat}}, C.state, r, boards, t0);
  } finally { await C.leave(); }
}

// ---------- 輸出與統計 ----------
const TXT = cfg.out.replace(/\.jsonl$/, '') + '.txt', stats = {n: 0, w: 0, b: 0, draw: 0, aband: 0, moves: 0, by: {}};
function save(g) {
  fs.mkdirSync(path.dirname(path.resolve(cfg.out)), {recursive: true});
  fs.appendFileSync(cfg.out, JSON.stringify(g) + '\n');
  const res = g.capped ? `步數上限（比分 白${g.pts.w}:黑${g.pts.b}）` : g.over === 'draw' ? '和局' : g.over ? (g.over === 'w' ? '白勝' : '黑勝') + '（' + g.reason + '）' : '中斷';
  fs.appendFileSync(TXT, `=== 對局 ${g.id}｜白：${g.white.strat}（${g.white.id}） vs 黑：${g.black.strat}（${g.black.id}）｜${res}${g.stall ? '（' + (g.stall.side === 'w' ? '白' : '黑') + '方達成條件後停手等棋鐘）' : ''}${g.settle ? '（單王提前結算：白 ' + g.settle.pts.w + ' 分、黑 ' + g.settle.pts.b + ' 分）' : ''}｜${g.moves} 手｜${g.t} ===\n` +
    g.log.map((l, i) => `${i + 1}. ${l}`).join('\n') + '\n\n');
  stats.n++; stats.moves += g.moves; if (g.capped || !g.over) stats.aband++; else stats[g.over]++;
  const k = `${g.white.strat} vs ${g.black.strat}`; (stats.by[k] = stats.by[k] || {n: 0, w: 0, b: 0, draw: 0})[g.over || 'aband'] = (stats.by[k][g.over || 'aband'] || 0) + 1; stats.by[k].n++;
  console.log(`[${stats.n}/${cfg.games}] ${g.white.strat} vs ${g.black.strat}：${res}，${g.moves} 手，${Math.round(g.ms / 1000)}s`);
}
let nextGame = 1, stopping = false, fails = 0;
const take = () => stopping || nextGame > cfg.games ? 0 : nextGame++;
async function worker(i) {
  if (cfg.mode === 'pvp') {
    const A = new Client(`${cfg.prefix}-${i}a`), B = new Client(`${cfg.prefix}-${i}b`);
    for (let n; (n = take());) {
      try { await ensure(A); await ensure(B); save(await playPvp(A, B, n)); fails = 0; }
      catch (e) { console.error(`第 ${n} 局失敗：${e.message}`); if (++fails >= 6) { stopping = true; console.error('連續失敗太多次，停止。'); } }
      await sleep(cfg.gap);
    }
    A.close(); B.close();
  } else {
    const C = new Client(`${cfg.prefix}-${i}m`), level = cfg.bots[i % cfg.bots.length];
    for (let n; (n = take());) {
      try { await ensure(C); save(await playBot(C, level, n)); fails = 0; }
      catch (e) { console.error(`第 ${n} 局失敗：${e.message}`); if (++fails >= 6) { stopping = true; console.error('連續失敗太多次，停止。'); } }
      await sleep(cfg.gap);
    }
    C.close();
  }
}
process.on('SIGINT', () => { if (stopping) process.exit(1); stopping = true; console.log('\n收到中斷：本局打完就停（再按一次 Ctrl+C 強制結束）'); });
module.exports = {harvestActions, harvestOn, stallOK, decide, randomActions};
if (require.main === module) (async () => {
  if (!['pvp', 'bot'].includes(cfg.mode)) { console.error('--mode 只能是 pvp 或 bot'); process.exit(1); }
  console.log(`模式 ${cfg.mode}｜${BASE}｜${cfg.games} 局｜輸出 ${cfg.out}`); await wake();
  const workers = cfg.mode === 'bot' ? Math.min(cfg.conc, cfg.bots.length) : cfg.conc;   // AI 房一人一間，同時局數最多等於房數
  await Promise.all(Array.from({length: workers}, (_, i) => worker(i)));
  console.log(`\n完成：${stats.n} 局（白勝 ${stats.w}、黑勝 ${stats.b}、和局 ${stats.draw}、中斷/上限 ${stats.aband}），平均 ${stats.n ? Math.round(stats.moves / stats.n) : 0} 手`);
  Object.entries(stats.by).forEach(([k, v]) => console.log(`  ${k}：${v.n} 局，白勝 ${v.w || 0}、黑勝 ${v.b || 0}、和 ${v.draw || 0}`));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
