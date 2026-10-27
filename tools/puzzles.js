'use strict';
// 自動產生殘局題庫：隨機殘局 → 求解器驗證 → 只留下「答案明確」的題目
// 用法：node tools/puzzles.js <秒數> [輸出檔] [目標JSON]    可重複執行，會接續累積（以局面雜湊去重）
const fs = require('fs'), Rules = require('../public/rules.js'), {mateSearch, mateLine, materialSearch} = require('./solver.js'), {mulberry32} = require('./sim.js');
const SECS = +process.argv[2] || 60, OUT = process.argv[3] || 'data/puzzles-raw.jsonl';
const TARGET = JSON.parse(process.argv[4] || '{"mate1":40,"mate2":80,"mate3":60,"win":320}');
const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const cnt = {mate1:0, mate2:0, mate3:0, win:0}; const seen = new Set();
have.forEach(p => { cnt[p.kind === 'mate' ? 'mate' + p.n : 'win']++; seen.add(p.key); });
const rnd = mulberry32(Date.now() % 1e9), opp = s => s==='w' ? 'b' : 'w';
const POOL = {dong:1, ol:1, kid:1, tea:1, night:1, iron:2, shoe:2, guard:2, t:6};
function randPos(biased){
  const list = [], occ = new Set(), K = {};
  const put = (type, side, near, within) => { for (let i = 0; i < 80; i++) { const x = rnd()*9|0, y = rnd()*9|0, key = x+','+y; if (occ.has(key)) continue;
    const d = near ? Math.max(Math.abs(x-near.x), Math.abs(y-near.y)) : 9; if (near && d < 3) continue; if (within && d > within) continue; occ.add(key); list.push([type, side, x, y]); return {x, y}; } return null; };
  const turn = rnd() < 0.5 ? 'w' : 'b', def = opp(turn);
  const edge = () => { const e = rnd()*4|0, r = rnd()*9|0; return e===0 ? {x:0,y:r} : e===1 ? {x:8,y:r} : e===2 ? {x:r,y:0} : {x:r,y:8}; };
  if (biased) { const c = edge(); occ.add(c.x+','+c.y); list.push(['king', def, c.x, c.y]); K[def] = c; K[turn] = put('king', turn, c); }
  else { K.w = put('king', 'w'); K.b = put('king', 'b', K.w); }
  for (const side of ['w', 'b']) {
    const atk = biased && side === turn, n = biased ? (atk ? 3 + (rnd()*3|0) : (rnd()*2|0)) : 2 + (rnd()*5|0);
    const bag = []; for (const [t, c] of Object.entries(POOL)) for (let i = 0; i < c; i++) bag.push(t);
    if (atk) { bag.unshift('kid', 'night'); }
    if (!atk) for (let i = bag.length - 1; i > 0; i--) { const j = rnd()*(i+1)|0; [bag[i], bag[j]] = [bag[j], bag[i]]; }
    else { const rest = bag.slice(2); for (let i = rest.length - 1; i > 0; i--) { const j = rnd()*(i+1)|0; [rest[i], rest[j]] = [rest[j], rest[i]]; } bag.length = 0; bag.push('kid', 'night', ...rest); }
    bag.slice(0, n).forEach(t => put(t, side, atk ? K[opp(side)] : null, atk && rnd() < 0.8 ? 5 : 0));
  }
  return {list, turn};
}
const find = (G, id) => G.pieces.find(p => p.id === id);
const themeOf = (G0, line, mate) => {   // 重播主變，從棋譜文字找出主題
  const G = JSON.parse(JSON.stringify(G0)), th = new Set(); let first = true;
  for (const a of line) { const side = G.turn; const h0 = G.hist.length; Rules.play(G, side, {t:'move', pid:a.pid, x:a.x, y:a.y}, 0); while (G.phase) Rules.play(G, G.phase.side, Rules.autoAction(G), 0);
    G.hist.slice(h0).forEach(t => { if (/斬殺/.test(t)) th.add('斬擊'); if (/被消滅於/.test(t)) th.add('連鎖'); if (/復活在/.test(t)) th.add('復活'); if (/轉生|OTL/.test(t)) th.add('轉化'); if (/ 吃/.test(t) && first) th.add('吃子'); }); first = false; }
  if (mate) th.add('殺王'); return [...th];
};
const mv = (G, w) => { const p = find(G, w.pid); return [p.x, p.y, w.x, w.y]; };
function lineOut(G0, line){ const G = JSON.parse(JSON.stringify(G0)); const out = []; for (const a of line) { const p = find(G, a.pid); out.push([p.x, p.y, a.x, a.y]); Rules.play(G, G.turn, {t:'move', pid:a.pid, x:a.x, y:a.y}, 0); while (G.phase) Rules.play(G, G.phase.side, Rules.autoAction(G), 0); } return out; }
const t0 = Date.now(); let tried = 0, found = 0;
while ((Date.now() - t0) / 1000 < SECS && Object.keys(TARGET).some(k => cnt[k] < TARGET[k])) {
  const needM = cnt.mate1 < TARGET.mate1 || cnt.mate2 < TARGET.mate2 || cnt.mate3 < TARGET.mate3;
  const {list, turn} = randPos(needM && rnd() < (cnt.win >= TARGET.win ? 0.9 : 0.5)), G = Rules.custom(list, turn); tried++;
  const key = Rules.kit(G, k => k.hash()); if (seen.has(key)) continue;
  const rootN = Rules.kit(G, k => k.moves(turn).length); if (rootN < 8) continue;
  let rec = null;
  const needMate = cnt.mate1 < TARGET.mate1 || cnt.mate2 < TARGET.mate2 || cnt.mate3 < TARGET.mate3;
  if (needMate) {
    const m = mateSearch(G, turn, 3, 60000);
    if (m && m.winners.length <= 2 && cnt['mate' + m.n] < TARGET['mate' + m.n]) {
      const L = mateLine(G, turn, m.n, m.winners);
      if (L.over === turn && L.line.length === 2 * m.n - 1) {
        // 一手殺王太直接的題目只留「用到特殊機制」或前面子力複雜的
        rec = {kind:'mate', n:m.n, level: m.n === 1 ? 1 : m.n === 2 ? 2 + (m.winners.length === 1 ? 1 : 0) : 4 + (m.winners.length === 1 ? 1 : 0), a: m.winners.map(w => mv(G, w)), l: lineOut(G, L.line), theme: themeOf(G, L.line, true)};
      }
    }
  }
  if (!rec && cnt.win < TARGET.win) {
    const d3 = materialSearch(G, turn, 3, 2, 60000);
    if (d3 && d3.res.length >= 8 && d3.res[0].v < 4000) {
      const b = d3.res[0], s2 = d3.res[1], gain = b.v - d3.base;
      if (gain >= 3 && b.v - s2.v >= 2) {
        const d4 = materialSearch(G, turn, 4, 2, 120000);
        if (d4 && d4.res[0].pid === b.pid && d4.res[0].x === b.x && d4.res[0].y === b.y && d4.res[0].v - d4.res[1].v >= 2) {
          const d2 = materialSearch(G, turn, 2, 2, 30000), easy = d2 && d2.res[0].pid === b.pid && d2.res[0].x === b.x && d2.res[0].y === b.y;
          // 主變：己方最佳 → 對方最佳回應 → 己方最佳
          const C = JSON.parse(JSON.stringify(G)), line = [{pid:b.pid, x:b.x, y:b.y}];
          Rules.play(C, turn, {t:'move', pid:b.pid, x:b.x, y:b.y}, 0); while (C.phase) Rules.play(C, C.phase.side, Rules.autoAction(C), 0);
          for (let i = 0; i < 2 && !C.over; i++) { const sd = C.turn, r = materialSearch(C, sd, 3, 0.5, 40000); if (!r || !r.res.length) break; const x = r.res[0]; line.push({pid:x.pid, x:x.x, y:x.y});
            Rules.play(C, sd, {t:'move', pid:x.pid, x:x.x, y:x.y}, 0); while (C.phase) Rules.play(C, C.phase.side, Rules.autoAction(C), 0); }
          const lv = easy ? (gain >= 8 ? 2 : 1) : (gain >= 8 ? 5 : gain >= 5 ? 4 : 3);
          rec = {kind:'win', n:0, level:lv, gain, a:[mv(G, b)], l: lineOut(G, line), theme: themeOf(G, line, false)};
        }
      }
    }
  }
  if (rec) { rec.key = key; rec.side = turn; rec.p = list; seen.add(key); cnt[rec.kind === 'mate' ? 'mate' + rec.n : 'win']++; found++; fs.appendFileSync(OUT, JSON.stringify(rec) + '\n'); }
}
console.log(`試了 ${tried} 個局面，新增 ${found} 題；累計`, JSON.stringify(cnt), `用時 ${Math.round((Date.now() - t0) / 1000)}s`);
