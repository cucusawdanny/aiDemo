'use strict';
// 用法：node tools/selfplay.js <局數> <每手毫秒> <步數上限> <輸出檔>   （可中斷後續跑：已完成的局會跳過）
const fs = require('fs'), Rules = require('../public/rules.js'), EV = require('../ai-eval.js'), {playGame} = require('./sim.js');
const [N, BUDGET, CAP, OUT] = [+process.argv[2] || 100, +process.argv[3] || 90, +process.argv[4] || 180, process.argv[5] || 'data/selfplay.jsonl'];
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).seed) : []);
const t0 = Date.now();
for (let seed = 1; seed <= N; seed++) {
  if (done.has(seed)) continue;
  const mat = [], feats = []; let n = 0;
  const r = playGame({seed, w:'super', b:'super', bw:BUDGET, bb:BUDGET, moveCap:CAP, openTol:1.2, openPlies:14,
    onPly: (G) => { n++; mat.push(Rules.pts(G,'w') - Rules.pts(G,'b'));
      if (n % 6 === 0 && !G.over) feats.push([n, G.turn, Rules.kit(G, k => EV.features(k, 'w'))]); } });
  r.mat = mat; r.feats = feats; delete r.hist;
  fs.appendFileSync(OUT, JSON.stringify(r) + '\n');
  console.log(`[${seed}/${N}] ${r.moves}手 ${r.capped ? '步數上限' : r.reason} → ${r.over} ${r.result && r.result.total ? JSON.stringify(r.result.total) : ''} 已用 ${Math.round((Date.now() - t0) / 1000)}s`);
}
console.log('完成');
