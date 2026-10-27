'use strict';
// 用法：node tools/validate.js <局數> <每手毫秒> <步數上限>   比較「學到的權重」與「先驗權重」的超高階 AI
const fs = require('fs'), EV = require('../ai-eval.js'), {playGame} = require('./sim.js');
const N = +process.argv[2] || 24, B = +process.argv[3] || 60, CAP = +process.argv[4] || 100;
const learned = JSON.parse(fs.readFileSync(process.argv[5] || 'data/weights-learned.json', 'utf8')).w, prior = EV.PRIOR.slice();
let sc = 0, w = 0, l = 0, d = 0; const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const lw = g % 2 === 0, r = playGame({seed: 900 + g, w: 'super', b: 'super', bw: B, bb: B, moveCap: CAP, openTol: 1.2, openPlies: 14, ww: lw ? learned : prior, wb: lw ? prior : learned});
  const me = lw ? 'w' : 'b'; if (r.over === me) { sc++; w++; } else if (r.over === 'draw') { sc += .5; d++; } else l++;
}
console.log(JSON.stringify({games: N, learnedWins: w, priorWins: l, draws: d, learnedScore: sc, pct: Math.round(1000 * sc / N) / 10, secs: Math.round((Date.now() - t0) / 1000)}));
