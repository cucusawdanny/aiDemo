'use strict';
// 讀自我對弈資料：統計規律、挑出「博弈性高」的五局、學習評估權重
// 用法：node tools/analyze.js data/selfplay.jsonl   → 輸出 data/analysis.json、data/games.json、data/weights-learned.json
const fs = require('fs'), Rules = require('../public/rules.js'), EV = require('../ai-eval.js'), {playGame} = require('./sim.js');
const file = process.argv[2] || 'data/selfplay.jsonl';
const games = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const N = games.length, side = g => g.over === 'draw' ? 'draw' : g.over;
const pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : 0;

// ---- 1. 每局事件統計（從棋譜註解的文字抓）----
const EVT = {capture:/ 吃/, slash:/斬殺/, chain:/被消滅於/, revive:/復活在/, otl:/OTL/, promote:/轉生/, skip:/跳過回合/, repeat:/重複/};
for (const g of games) {
  g.ev = Object.fromEntries(Object.keys(EVT).map(k => [k, 0]));
  g.notes.forEach(ns => ns.forEach(t => { for (const k in EVT) if (EVT[k].test(t)) g.ev[k]++; }));
  g.decisive = g.over !== 'draw'; g.kingKill = !g.capped && g.reason !== 'repeat' && g.reason !== 'time';
  // 領先權（以子力分差）換手次數與最大逆轉
  let lead = 0, changes = 0, maxSwing = 0, minD = 0, maxD = 0;
  g.mat.forEach(d => { const s = Math.sign(d); if (s && lead && s !== lead) changes++; if (s) lead = s; minD = Math.min(minD, d); maxD = Math.max(maxD, d); });
  g.changes = changes; g.range = maxD - minD;
  const fin = g.over === 'w' ? 1 : g.over === 'b' ? -1 : 0, ofs = g.mat.length ? g.mat[g.mat.length - 1] : 0;
  g.comeback = fin === 1 ? Math.max(0, -minD) : fin === -1 ? Math.max(0, maxD) : 0;   // 贏家曾經落後多少
  g.finalMargin = g.result && g.result.total ? Math.abs(g.result.total.w - g.result.total.b) : 99;
}

// ---- 2. 總體統計 ----
const wins = {w: games.filter(g => g.over === 'w').length, b: games.filter(g => g.over === 'b').length, d: games.filter(g => g.over === 'draw').length};
const avg = f => Math.round(10 * games.reduce((s, g) => s + f(g), 0) / N) / 10;
const stats = {games: N, wins, whiteRate: pct(wins.w, N), blackRate: pct(wins.b, N), drawRate: pct(wins.d, N),
  capped: games.filter(g => g.capped).length, kingKills: games.filter(g => g.kingKill).length,
  avgMoves: avg(g => g.moves), avgCapture: avg(g => g.ev.capture), avgSlash: avg(g => g.ev.slash), avgChain: avg(g => g.ev.chain), avgRevive: avg(g => g.ev.revive),
  avgPromote: avg(g => g.ev.promote), avgOtl: avg(g => g.ev.otl), avgMargin: avg(g => g.finalMargin === 99 ? 0 : g.finalMargin)};

// ---- 3. 開局：白方第一手、黑方第一手的出現次數與勝率 ----
function openingKey(g, side) { const a = g.actions.find(x => x.s === side && x.a.t === 'move'); if (!a) return null;
  const G = Rules.create(); const p = G.pieces.find(q => q.id === a.a.pid); return p ? `${Rules.N(p)}→${'abcdefghi'[a.a.x]}${9 - a.a.y}` : null; }
const openStats = {w: {}, b: {}};
games.forEach(g => ['w', 'b'].forEach(sd => { const k = openingKey(g, sd); if (!k) return; const o = openStats[sd][k] || (openStats[sd][k] = {n: 0, win: 0, draw: 0}); o.n++; if (g.over === sd) o.win++; else if (g.over === 'draw') o.draw++; }));
const topOpen = sd => Object.entries(openStats[sd]).map(([k, v]) => ({move: k, n: v.n, win: v.win, draw: v.draw, rate: pct(v.win + v.draw / 2, v.n)})).sort((a, b) => b.n - a.n).slice(0, 6);

// ---- 4. 第一次吃子：先吃子的一方勝率；第一次斬擊 ----
function firstEvent(g, re) { for (let i = 0; i < g.notes.length; i++) if (g.notes[i].some(t => re.test(t))) return {i, side: g.actions[i].s}; return null; }
let fc = {n: 0, win: 0, lose: 0}, fs_ = {n: 0, win: 0, lose: 0}, early = [];
games.forEach(g => { const c = firstEvent(g, / 吃/); if (c) { fc.n++; if (g.over === c.side) fc.win++; else if (g.over !== 'draw') fc.lose++; early.push(c.i); }
  const s = firstEvent(g, /斬殺/); if (s) { fs_.n++; if (g.over === s.side) fs_.win++; else if (g.over !== 'draw') fs_.lose++; } });
stats.firstCapture = {n: fc.n, winRate: pct(fc.win, fc.win + fc.lose)}; stats.firstSlash = {n: fs_.n, winRate: pct(fs_.win, fs_.win + fs_.lose)};
stats.firstCaptureAvgPly = Math.round(early.reduce((a, b) => a + b, 0) / Math.max(1, early.length));

// ---- 5. 終局分數與「子力」關係：各種棋子存活到終局時的勝率 ----
const surv = {};
games.forEach(g => { const G = Rules.create(); g.actions.forEach(x => Rules.play(G, x.s, x.a, 0));
  ['w', 'b'].forEach(sd => { const win = g.over === sd, draw = g.over === 'draw';
    const types = {}; G.pieces.filter(p => p.side === sd).forEach(p => types[p.type] = (types[p.type] || 0) + 1);
    Object.keys(Rules.TYPES).forEach(t => { const has = !!types[t]; const o = surv[t] || (surv[t] = {has: {n: 0, w: 0}, no: {n: 0, w: 0}}); const b = has ? o.has : o.no; b.n++; b.w += win ? 1 : draw ? .5 : 0; }); }); });
stats.survival = Object.fromEntries(Object.entries(surv).map(([t, o]) => [t, {name: Rules.TYPES[t].name, has: pct(o.has.w, o.has.n), hasN: o.has.n, no: pct(o.no.w, o.no.n), noN: o.no.n}]));

// ---- 6. 挑「博弈性高」的局：領先換手、最大分差起伏、逆轉、特殊機制、結果勝負、分差接近 ----
games.forEach(g => { const sp = g.ev.slash * 2 + g.ev.chain * 3 + g.ev.revive * 1.5 + g.ev.promote + g.ev.otl * 2;
  g.score = g.changes * 4 + Math.min(g.range, 30) * 0.6 + Math.min(g.comeback, 20) * 0.8 + sp + (g.decisive ? 6 : 0) + (g.kingKill ? 25 : 0)
    + (g.finalMargin <= 3 ? 6 : 0) - (g.ev.repeat ? 8 : 0) - Math.max(0, 60 - g.moves) * 0.3; });
const ranked = games.slice().sort((a, b) => b.score - a.score);
// 多樣性：不要五局都是同一個結果／同一個開局
const pick = []; for (const g of ranked) { if (pick.length >= 5) break;
  if (pick.filter(p => p.over === g.over).length >= 3) continue; pick.push(g); }
for (const g of ranked) { if (pick.length >= 5) break; if (!pick.includes(g)) pick.push(g); }
stats.picked = pick.map(g => ({seed: g.seed, score: Math.round(g.score), changes: g.changes, range: g.range, comeback: g.comeback, ev: g.ev, over: g.over, margin: g.finalMargin}));

// ---- 7. 學習評估權重：以局面特徵預測終局結果（邏輯迴歸 + 向先驗收斂的 L2 正則）----
const X = [], Y = [], Wt = [];
games.forEach(g => { const yw = g.over === 'w' ? 1 : g.over === 'b' ? 0 : 0.5; g.feats.forEach(([n, , f]) => { X.push(f); Y.push(yw); Wt.push(0.3 + 0.7 * n / g.actions.length); }); });
const D = EV.PRIOR.length, C = 0.15, prior = EV.PRIOR.map(v => v * C);   // 先驗：30 分差 ≈ 勝率 98%
let beta = prior.slice(); const G2 = new Array(D).fill(1e-8), lam = 40, lr = 0.5;
for (let ep = 0; ep < 400; ep++) {
  const g = new Array(D).fill(0);
  for (let i = 0; i < X.length; i++) { let z = 0; for (let j = 0; j < D; j++) z += beta[j] * X[i][j]; const p = 1 / (1 + Math.exp(-z)); const e = (p - Y[i]) * Wt[i];
    for (let j = 0; j < D; j++) g[j] += e * X[i][j]; }
  for (let j = 0; j < D; j++) { g[j] = g[j] / X.length + lam / X.length * (beta[j] - prior[j]); G2[j] += g[j] * g[j]; beta[j] -= lr * g[j] / Math.sqrt(G2[j]); }
}
const learned = beta.map(b => b / C);
let ll0 = 0, ll1 = 0; const nll = (b) => { let s = 0; for (let i = 0; i < X.length; i++) { let z = 0; for (let j = 0; j < D; j++) z += b[j] * X[i][j]; const p = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-z)))); s -= Wt[i] * (Y[i] * Math.log(p) + (1 - Y[i]) * Math.log(1 - p)); } return s / X.length; };
ll0 = nll(prior); ll1 = nll(beta);
stats.learn = {samples: X.length, nllPrior: Math.round(ll0 * 1000) / 1000, nllLearned: Math.round(ll1 * 1000) / 1000, names: EV.NAMES, prior: EV.PRIOR, learned: learned.map(v => Math.round(v * 100) / 100)};

fs.writeFileSync('data/analysis.json', JSON.stringify(stats, null, 1));
fs.writeFileSync('data/weights-learned.json', JSON.stringify({w: learned.map(v => Math.round(v * 1000) / 1000)}));
// 回放用資料：每局的動作、每一手的註解、子力分差曲線
fs.writeFileSync('data/picked.json', JSON.stringify(pick.map(g => ({seed: g.seed, over: g.over, reason: g.reason, capped: g.capped, result: g.result, moves: g.moves, score: Math.round(g.score), ev: g.ev, changes: g.changes, comeback: g.comeback,
  actions: g.actions, notes: g.notes, mat: g.mat}))));
console.log(JSON.stringify(stats, null, 1));
