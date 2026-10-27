// AI 單元測試：四個等級都能在開局與中局給出「合法」的動作；超高階明顯強過初階
const assert = require('assert'), Rules = require('../public/rules.js'), AI = require('../ai.js'), {playGame} = require('../tools/sim.js');
const legalFirst = (G, side, lv, ms) => { const acts = AI.chooseActions(G, side, lv, {budgetMs: ms}); assert.ok(acts.length > 0, lv + ' 沒有給出動作');
  const C = JSON.parse(JSON.stringify(G)); assert.ok(Rules.play(C, side, acts[0], 0).ok, lv + ' 的首選不合法'); return acts; };
for (const [lv, ms] of [['beginner', 50], ['medium', 100], ['advanced', 200], ['super', 300]]) {
  const G = Rules.create(); const t0 = Date.now(); legalFirst(G, 'w', lv, ms); const dt = Date.now() - t0;
  assert.ok(dt < ms * 3 + 200, `${lv} 用了 ${dt}ms，超出預算`); console.log(`✔ ${lv}：開局合法動作（${dt}ms）`);
}
// 中局：隨機走 30 手後（遇到對局已結束就重來）各等級仍給出合法動作
{ let G; for (let tries = 0; tries < 8; tries++) { G = Rules.create(); for (let i = 0; i < 30 && !G.over; i++) { const side = G.phase ? G.phase.side : G.turn; const a = AI.chooseActions(G, side, 'beginner', {budgetMs: 20})[0]; if (!a || !Rules.play(G, side, a, 0).ok) break; } if (!G.over) break; }
  assert.ok(!G.over, '無法產生未結束的中局');
  for (const lv of ['beginner', 'medium', 'advanced', 'super']) legalFirst(G, G.phase ? G.phase.side : G.turn, lv, 150); console.log('✔ 中局：四個等級都能給出合法動作'); }
// 能吃免費的子就吃（進階原本會把根著法全部打成同分、等於亂走，已修正）
{ const G = Rules.custom([['king','w',4,8],['king','b',4,0],['dong','w',4,4],['kid','b',0,4]], 'b');
  for (const lv of ['advanced', 'super']) for (let i = 0; i < 3; i++) { const a = AI.chooseActions(G, 'b', lv, {budgetMs: 200})[0]; assert.ok(a.x === 4 && a.y === 4, lv + ' 沒有吃掉送上門的咚'); } console.log('✔ 進階／超高階：會吃掉沒有保護的咚'); }
// 超高階對初階：4 局（雙方各執白黑），每手 40ms、40 手，超高階子力分應較高
{ let ahead = 0; for (let g = 0; g < 4; g++) { const sw = g % 2 === 0, r = playGame({seed: 40 + g, w: sw ? 'super' : 'beginner', b: sw ? 'beginner' : 'super', bw: 40, bb: 40, moveCap: 40});
    const t = r.result && r.result.total; if (!t) { ahead += r.over === (sw ? 'w' : 'b') ? 1 : 0; continue; } if ((sw ? t.w - t.b : t.b - t.w) > 0) ahead++; }
  assert.ok(ahead >= 3, '超高階只在 ' + ahead + '/4 局領先'); console.log(`✔ 超高階對初階：${ahead}/4 局子力領先`); }
console.log('\nAI 測試全部通過');
