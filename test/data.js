// 資料檔測試：題庫 500 題都可重新驗證；高手對決五局可重播並與紀錄一致；教學資料完整
const assert = require('assert'), fs = require('fs'), Rules = require('../public/rules.js'), {mateSearch} = require('../tools/solver.js');
const P = JSON.parse(fs.readFileSync('public/data/puzzles.json', 'utf8')).items;
assert.equal(P.length, 500); assert.deepEqual(P.map(p => p.id), P.map((_, i) => i + 1));
let mates = 0;
for (const q of P) {
  const G = Rules.custom(q.p, q.side);
  for (const m of q.a) { const p = G.pieces.find(o => o.x === m[0] && o.y === m[1] && o.side === q.side); assert.ok(p && Rules.moves(G, p.id).some(t => t.x === m[2] && t.y === m[3]), `第 ${q.id} 題答案不合法`); }
  if (q.kind === 'mate' && q.id % 5 === 0) { const r = mateSearch(G, q.side, q.n, 150000); assert.ok(r && r.n === q.n, `第 ${q.id} 題殺王步數不符`); mates++; }
}
console.log(`✔ 題庫 500 題：答案皆為合法著法；抽驗 ${mates} 題殺王題重新求解一致`);
const GM = JSON.parse(fs.readFileSync('public/data/games.json', 'utf8')).games; assert.equal(GM.length, 5);
for (const g of GM) { const G = Rules.create(); g.actions.forEach(x => assert.ok(Rules.play(G, x.s, x.a, 0).ok !== false)); Rules.adjudicate(G); assert.equal(G.over, g.result.over); assert.equal(g.mat.length, g.actions.length); }
console.log('✔ 高手對決 5 局：重播後的結果與紀錄一致');
const L = JSON.parse(fs.readFileSync('public/data/learn.json', 'utf8')); assert.ok(L.patterns.length >= 8 && L.tables.length >= 3); console.log('✔ 教學資料：規律與表格齊全');
console.log('\n資料測試全部通過');
