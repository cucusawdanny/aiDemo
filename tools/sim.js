'use strict';
// 自我對弈工具：兩個 AI 下一整局，記錄每一步與棋譜註解
const Rules = require('../public/rules.js'), AI = require('../ai.js');
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function playGame(o){
  const rnd = mulberry32(o.seed || 1), G = Rules.create(), actions = [], notes = [], cap = o.moveCap || 160;
  let moves = 0, plies = 0;
  while (!G.over && moves < cap) {
    const side = G.phase ? G.phase.side : G.turn, lv = side === 'w' ? o.w : o.b, budget = side === 'w' ? o.bw : o.bb;
    const tol = o.openTol && moves < (o.openPlies || 12) ? o.openTol : 0.05;
    let list = []; try { list = AI.chooseActions(G, side, lv, {budgetMs: budget, rnd, tol, weights: side === 'w' ? o.ww : o.wb}); } catch (e) { console.error(e); }
    let ok = false;
    for (const a of list) { const h0 = G.hist.length, r = Rules.play(G, side, a, 0); if (r.ok) { actions.push({s: side, a}); notes.push(G.hist.slice(h0)); ok = true; break; } }
    if (!ok && !G.phase) for (const p of G.pieces.filter(q => q.side === side)) { const m = Rules.moves(G, p.id)[0];
      if (m) { const a = {t:'move', pid:p.id, x:m.x, y:m.y}, h0 = G.hist.length; if (Rules.play(G, side, a, 0).ok) { actions.push({s: side, a}); notes.push(G.hist.slice(h0)); ok = true; break; } } }
    if (!ok) break;
    plies++; if (!G.phase || true) moves = actions.filter(x => x.a.t === 'move').length;
    if (o.onPly) o.onPly(G, actions.length);
  }
  const capped = !G.over; if (capped) Rules.adjudicate(G);
  return {seed: o.seed, w: o.w, b: o.b, over: G.over, reason: G.result ? G.result.reason : 'king', result: G.result || null, capped, moves, actions, notes, hist: G.hist};
}
module.exports = {playGame, mulberry32};
