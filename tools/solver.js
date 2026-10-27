'use strict';
// 題庫用的求解器：殺王搜尋（N 手內強制吃王）與子力搜尋（最佳著法）。與遊戲共用同一份規則。
const Rules = require('../public/rules.js');
const opp = s => s==='w' ? 'b' : 'w', TO = {};
const VAL = {dong:10, ol:8, kid:8, tea:7, night:5, t:2}, v = p => p.type === 'king' ? 0 : (VAL[p.type] || 3);

// 殺王：回傳 {n, winners:[{pid,x,y}], total, nodes}；n 是最短的「己方走幾手」；找不到回傳 null
function mateSearch(G, side, maxN, nodeCap = 120000){
  return Rules.kit(G, k => {
    let nodes = 0;
    const order = (list, s) => { for (const o of list) { const q = k.pieceAt(o.m.x, o.m.y); o.o = q && q.side !== s ? (q.type === 'king' ? 1e4 : 100 + k.val(q)) : 0; } return list.sort((a, b) => b.o - a.o); };
    const canWin = (s, n) => {
      if (++nodes > nodeCap) throw TO;
      for (const o of order(k.moves(s), s)) {
        const r = k.trial(() => { k.play(o.p, o.m); const ov = k.over(); if (ov) return ov === s; return n > 1 && allDefended(opp(s), s, n - 1); });
        if (r) return true;
      }
      return false;
    };
    const allDefended = (d, s, n) => {
      const ms = k.moves(d); if (!ms.length) return canWin(s, n);
      for (const o of order(ms, d)) {
        const ok = k.trial(() => { k.play(o.p, o.m); const ov = k.over(); if (ov) return ov === s; return canWin(s, n); });
        if (!ok) return false;
      }
      return true;
    };
    try {
      const root = k.moves(side);
      for (let n = 1; n <= maxN; n++) {
        const winners = [];
        for (const o of order(root.slice(), side)) {
          const r = k.trial(() => { k.play(o.p, o.m); const ov = k.over(); if (ov) return ov === side; return n > 1 && allDefended(opp(side), side, n - 1); });
          if (r) winners.push({pid: o.p.id, x: o.m.x, y: o.m.y});
        }
        if (winners.length) return {n, winners, total: root.length, nodes};
      }
    } catch (e) { if (e !== TO) throw e; }
    return null;
  });
}
// 殺王主變：己方走勝著、對方挑「讓己方最慢殺王」的回應
function mateLine(G, side, n0, firstWinners){
  const C = JSON.parse(JSON.stringify(G)), line = []; let n = n0, cur = firstWinners;
  for (let guard = 0; guard < 12 && !C.over; guard++) {
    const w = cur[0]; line.push(w); Rules.play(C, side, {t:'move', pid:w.pid, x:w.x, y:w.y}, 0);
    while (C.phase) Rules.play(C, C.phase.side, Rules.autoAction(C), 0);
    if (C.over) break;
    // 對方回應：選使己方殺王最慢者
    const d = opp(side); let worst = null, wn = -1;
    const opts = Rules.kit(C, k => k.moves(d).map(o => ({pid: o.p.id, x: o.m.x, y: o.m.y})));
    if (!opts.length) { n--; cur = (mateSearch(C, side, Math.max(1, n)) || {winners: []}).winners; if (!cur.length) break; continue; }
    for (const r of opts) { const T = JSON.parse(JSON.stringify(C)); Rules.play(T, d, {t:'move', pid:r.pid, x:r.x, y:r.y}, 0); while (T.phase) Rules.play(T, T.phase.side, Rules.autoAction(T), 0);
      if (T.over) { if (wn < 0) { worst = r; wn = 0; } continue; }
      const m = mateSearch(T, side, n - 1, 60000), nn = m ? m.n : 99; if (nn > wn) { wn = nn; worst = r; } }
    line.push(worst); Rules.play(C, d, {t:'move', pid:worst.pid, x:worst.x, y:worst.y}, 0); while (C.phase) Rules.play(C, C.phase.side, Rules.autoAction(C), 0);
    if (C.over) break;
    n--; const m = mateSearch(C, side, Math.max(1, n), 60000); if (!m) break; cur = m.winners;
  }
  return {line, over: C.over};
}
// 子力搜尋（含靜態搜尋）：回傳每個根著法的分數（己方視角，子力分差）；窗口只保證「最佳 − margin 以內」的著法分數是精確的
function materialSearch(G, side, depth, margin = 2, nodeCap = 150000){
  return Rules.kit(G, k => {
    let nodes = 0;
    const mat = s => { let t = 0; for (const p of k.pieces()) t += (p.side === s ? 1 : -1) * v(p); return t; };
    const order = (list, s) => { for (const o of list) { const q = k.pieceAt(o.m.x, o.m.y); o.o = q && q.side !== s ? 100 + v(q) * 10 - v(o.p) : 0; } return list.sort((a, b) => b.o - a.o); };
    const qs = (s, alpha, beta, qd) => {
      if (++nodes > nodeCap) throw TO;
      const ov = k.over(); if (ov) return ov === 'draw' ? 0 : ov === s ? 5000 : -5000;
      let best = mat(s); if (best >= beta || qd <= 0) return best; if (best > alpha) alpha = best;
      for (const o of order(k.moves(s).filter(o => { const q = k.pieceAt(o.m.x, o.m.y); return q && q.side !== s; }), s)) {
        const sc = k.trial(() => { k.play(o.p, o.m); return -qs(opp(s), -beta, -alpha, qd - 1); });
        if (sc > best) best = sc; if (best > alpha) alpha = best; if (alpha >= beta) break; }
      return best;
    };
    const search = (s, d, alpha, beta) => {
      if (++nodes > nodeCap) throw TO;
      const ov = k.over(); if (ov) return ov === 'draw' ? 0 : ov === s ? 5000 + d : -(5000 + d);
      if (d <= 0) return qs(s, alpha, beta, 3);
      const ms = k.moves(s); if (!ms.length) return -search(opp(s), d - 1, -beta, -alpha);
      let best = -Infinity;
      for (const o of order(ms, s)) { const sc = k.trial(() => { k.play(o.p, o.m); return -search(opp(s), d - 1, -beta, -alpha); });
        if (sc > best) best = sc; if (best > alpha) alpha = best; if (alpha >= beta) break; }
      return best;
    };
    try {
      const root = order(k.moves(side), side), res = []; let best = -Infinity;
      for (const o of root) {
        const sc = k.trial(() => { k.play(o.p, o.m); const ov = k.over(); if (ov) return ov === side ? 5000 : -5000; return -search(opp(side), depth - 1, -Infinity, -(best - margin)); });
        res.push({pid: o.p.id, x: o.m.x, y: o.m.y, v: sc}); if (sc > best) best = sc;
      }
      res.sort((a, b) => b.v - a.v); return {res, base: mat(side), nodes};
    } catch (e) { if (e !== TO) throw e; return null; }
  });
}
module.exports = {mateSearch, mateLine, materialSearch};
