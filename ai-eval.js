'use strict';
// 評估函數的特徵與權重（超高階 AI 使用；權重可由自我對弈的資料學習，存在 ai-weights.json）
const TYPES = ['dong','ol','kid','tea','night','iron','shoe','guard','t','godness','otl'];
const NAMES = ['咚','OL','孩','茶','夜','熨','鞋','士','龍','謎','OTL','龍推進','中心','近敵王'];
const PRIOR = [10,8,8,7,5,3,3,3,2,3,3, 0.08, 0.03, 0.3];
let W = PRIOR.slice();
try { const j = require('./ai-weights.json'); if (Array.isArray(j.w) && j.w.length === PRIOR.length) W = j.w; } catch (e) {}
// 特徵（己方 − 對方）：11 種棋子數量差、龍的推進、中心控制、靠近敵王的棋子數
function features(k, side){
  const f = new Array(PRIOR.length).fill(0), en = side==='w' ? 'b' : 'w', K = {};
  const ps = k.pieces();
  for (const p of ps) {
    if (p.type === 'king') { K[p.side] = p; continue; }
    const sg = p.side===side ? 1 : -1;
    f[TYPES.indexOf(p.type)] += sg;
    if (p.type === 't') f[11] += sg * (p.side==='w' ? 8 - p.y : p.y);
    f[12] += sg * (4 - Math.abs(p.x - 4));
  }
  for (const p of ps) { if (p.type === 'king') continue;
    if (p.side===side && K[en] && Math.max(Math.abs(p.x-K[en].x), Math.abs(p.y-K[en].y)) <= 2) f[13]++;
    else if (p.side===en && K[side] && Math.max(Math.abs(p.x-K[side].x), Math.abs(p.y-K[side].y)) <= 2) f[13]--; }
  return f;
}
const dot = (w, f) => { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * f[i]; return s; };
module.exports = {TYPES, NAMES, PRIOR, weights: () => W, setWeights: w => { W = w.slice(); }, features, dot};
