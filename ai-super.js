'use strict';
// 超高階 AI：迭代加深 + alpha-beta + 置換表 + 靜態搜尋（吃子延伸）+ 殺手／歷史啟發式；評估用學習到的權重。
const EV = require('./ai-eval.js');
const TIMEOUT = {}, opp = s => s==='w' ? 'b' : 'w';

function superRank(k, side, budgetMs, rnd, opt = {}){
  const deadline = Date.now() + budgetMs, W = opt.weights || EV.weights(), maxDepth = opt.maxDepth || 14;
  let nodes = 0; const TT = new Map(), killers = [], hh = new Map();
  const evalPos = s => EV.dot(W, EV.features(k, s));
  const isCap = (o, s) => { const q = k.pieceAt(o.m.x, o.m.y); return q && q.side !== s; };
  function order(list, s, ttm, ply){
    const kl = killers[ply];
    for (const o of list) {
      const q = k.pieceAt(o.m.x, o.m.y); let sc = q && q.side !== s ? 1000 + k.val(q)*10 - k.val(o.p) : 0;
      if (ttm && o.p.id === ttm.pid && o.m.x === ttm.x && o.m.y === ttm.y) sc += 1e6;
      if (kl && kl.some(x => x.pid === o.p.id && x.x === o.m.x && x.y === o.m.y)) sc += 500;
      o.o = sc + (hh.get(o.p.id + ':' + o.m.x + ',' + o.m.y) || 0) * 0.01;
    }
    return list.sort((a, b) => b.o - a.o);
  }
  function qs(s, alpha, beta, qd){
    if ((++nodes & 255) === 0 && Date.now() > deadline) throw TIMEOUT;
    const ov = k.over(); if (ov) return ov === 'draw' ? 0 : ov === s ? 5000 : -5000;
    let best = evalPos(s); if (best >= beta || qd <= 0) return best;
    if (best > alpha) alpha = best;
    const caps = order(k.moves(s).filter(o => isCap(o, s)), s, null, 99);
    for (const o of caps) {
      const sc = k.trial(() => { k.play(o.p, o.m); return -qs(opp(s), -beta, -alpha, qd - 1); });
      if (sc > best) best = sc; if (best > alpha) alpha = best; if (alpha >= beta) break;
    }
    return best;
  }
  function search(s, depth, alpha, beta, ply){
    if ((++nodes & 255) === 0 && Date.now() > deadline) throw TIMEOUT;
    const ov = k.over(); if (ov) return ov === 'draw' ? 0 : ov === s ? 5000 + depth : -(5000 + depth);
    if (depth <= 0) return qs(s, alpha, beta, 4);
    const key = k.hash(), e = TT.get(key); let ttm = null;
    if (e) { ttm = e.m; if (e.d >= depth && (e.f === 0 || (e.f === 1 && e.s >= beta) || (e.f === 2 && e.s <= alpha))) return e.s; }
    const list = k.moves(s);
    if (!list.length) return -search(opp(s), depth - 1, -beta, -alpha, ply + 1);   // 無棋可走＝跳過
    order(list, s, ttm, ply);
    const a0 = alpha; let best = -Infinity, bm = null;
    for (const o of list) {
      const sc = k.trial(() => { k.play(o.p, o.m); return -search(opp(s), depth - 1, -beta, -alpha, ply + 1); });
      if (sc > best) { best = sc; bm = {pid: o.p.id, x: o.m.x, y: o.m.y}; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        if (!isCap(o, s)) { const kl = killers[ply] || (killers[ply] = []); if (!kl.some(x => x.pid === bm.pid && x.x === bm.x && x.y === bm.y)) { kl.unshift(bm); kl.length = Math.min(kl.length, 2); }
          const hk = bm.pid + ':' + bm.x + ',' + bm.y; hh.set(hk, (hh.get(hk) || 0) + depth * depth); }
        break;
      }
    }
    TT.set(key, {d: depth, s: best, f: best <= a0 ? 2 : best >= beta ? 1 : 0, m: bm});
    return best;
  }
  // ----- 根節點 -----
  const root = k.moves(side); if (!root.length) return [];
  const rec = k.rec ? k.rec() : [], seenKey = new Map(); rec.forEach(r => seenKey.set(r.k, (seenKey.get(r.k) || 0) + 1));
  const tol = opt.tol !== undefined ? opt.tol : 0.05, margin = tol + 1e-6;
  order(root, side, null, 0);
  let scored = root.map(o => ({p: o.p, m: o.m, v: 0})), done = 0;
  for (let d = 1; d <= maxDepth; d++) {
    const cur = []; let best = -Infinity;
    try {
      for (const o of scored) {
        const sc = k.trial(() => { k.play(o.p, o.m);
          let pen = 0; const n = seenKey.get(k.hash()) || 0; if (n >= 1) pen = n >= 2 ? 30 : 0.4;   // 避免走回已出現的局面（二次出現幾乎等於和局）
          return -search(opp(side), d - 1, -Infinity, -(best - margin), 1) - pen; });
        cur.push({p: o.p, m: o.m, v: sc}); if (sc > best) best = sc;
      }
    } catch (ex) { if (ex !== TIMEOUT) throw ex; break; }
    cur.sort((a, b) => b.v - a.v); scored = cur; done = d;
    if (Math.abs(cur[0].v) >= 4900) break;
  }
  scored.depth = done; scored.nodes = nodes;
  return scored;
}
module.exports = {superRank};
