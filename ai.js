/* 九路棋盤 AI（伺服器端使用）。
   chooseAction(G, side, level, opt) → 回傳一個可直接丟給 Rules.play / Rules.apply 的動作，或 null（還沒輪到 AI）。
   level：'medium' 中等（2 手深度＋適度失誤）、'advanced' 進階（迭代加深到 6 手，限時內盡量算深）。
   opt.budgetMs：思考時間上限（預設 medium 400ms／advanced 1500ms）；opt.rnd：亂數函式。
   會自動避開「照走就因長將／長殺／長捉而判負」的著法。 */
const Rules = require('./public/rules.js');
const VAL = {king:1000, dong:10, ol:8, kid:8, tea:7, night:5, t:2};
const v = p => p.type in VAL ? VAL[p.type] : 3;
const opp = s => s==='w' ? 'b' : 'w';
const TIMEOUT = {};

function evaluate(k, side){
  let s = 0;
  for(const p of k.pieces()){
    let x = v(p);
    if(p.type==='t') x += (p.side==='w' ? Rules.SIZE-1-p.y : p.y) * 0.08;        // 龍越接近底線越好（可轉生）
    else if(p.type!=='king') x += (4 - Math.abs(p.x-4)) * 0.02;                   // 略偏好中路
    s += p.side===side ? x : -x;
  }
  return s;
}
function ordered(k, side){
  const list = k.moves(side);
  for(const o of list){ const q = k.pieceAt(o.m.x,o.m.y); o.o = q && q.side!==side ? v(q)*10 - v(o.p) : 0; }
  return list.sort((a,b) => b.o - a.o);
}
function search(k, side, depth, alpha, beta, deadline){
  const ov = k.over();
  if(ov) return ov==='draw' ? 0 : ov===side ? 5000+depth : -(5000+depth);
  if(depth===0) return evaluate(k, side);
  if(Date.now() > deadline) throw TIMEOUT;
  const list = ordered(k, side);
  if(!list.length) return search(k, opp(side), depth-1, -beta, -alpha, deadline) * -1;   // 無棋可走＝跳過
  let best = -Infinity;
  for(const {p,m} of list){
    const sc = k.trial(() => { k.play(p,m); return -search(k, opp(side), depth-1, -beta, -alpha, deadline); });
    if(sc > best) best = sc;
    if(best > alpha) alpha = best;
    if(alpha >= beta) break;
  }
  return best;
}
// 回傳依偏好排序的候選著法 [{pid,x,y,v}]
function rank(k, side, level, budget, rnd){
  const deadline = Date.now() + budget, root = ordered(k, side);
  const maxDepth = level==='advanced' ? 6 : 2;
  let scored = null;
  for(let d=2; d<=maxDepth; d+=2){
    const cur = []; let alpha = -Infinity;
    try {
      for(const {p,m} of root){
        const sc = k.trial(() => { k.play(p,m); return -search(k, opp(side), d-1, -Infinity, level==='advanced' ? -alpha : Infinity, deadline); });
        cur.push({p,m,v:sc}); if(level==='advanced' && sc>alpha) alpha = sc;
      }
    } catch(e){ if(e!==TIMEOUT) throw e; break; }
    scored = cur.sort((a,b) => b.v - a.v);
    root.splice(0, root.length, ...scored);   // 下一層用上一層結果排序
  }
  if(!scored) scored = root.map(({p,m}) => ({p,m,v:0}));
  if(!scored.length) return [];
  const best = scored[0].v;
  const pool = scored.filter(s => s.v >= best - (level==='advanced' ? 0.05 : 0.6));
  let first = pool[Math.floor(rnd()*pool.length)];
  if(level==='medium' && rnd() < 0.15) first = scored[Math.floor(rnd()*Math.min(4, scored.length))];   // 中等：偶爾失誤
  return [first, ...scored.filter(s => s!==first)].map(s => ({pid:s.p.id, x:s.m.x, y:s.m.y, v:s.v}));
}
// 回傳依偏好排序的候選動作陣列（伺服器依序嘗試，第一個被接受的就用；用來應付「禁止著法」等額外限制）
function chooseActions(G, side, level='medium', opt={}){
  if(typeof Rules.kit!=='function') throw new Error('rules.js 缺少 Rules.kit（AI 需要）');
  const rnd = opt.rnd || Math.random, budget = opt.budgetMs || (level==='advanced' ? 1500 : 400);
  const r = Rules.kit(G, k => {
    const ph = k.phase();
    if(ph){
      if(ph.side!==side) return null;
      if(ph.kind==='slash') return {act:{t:'slash', yes:true}};
      if(ph.kind==='pick') return {act:{t:'pick', ty:k.bestPick()}};
      const c = k.bestCell(side); return {act:{t:'place', x:c.x, y:c.y}};
    }
    if(k.over() || k.turn()!==side) return null;
    return {cands: rank(k, side, level, budget, rnd)};
  });
  if(!r) return [];
  if(r.act) return [r.act];
  const acts = r.cands.map(c => ({t:'move', pid:c.pid, x:c.x, y:c.y}));
  if(typeof Rules.wouldLoseByRepeat==='function'){   // 必須變著：會因重複判負的排到最後
    const safe = [], risky = [];
    acts.forEach((a,i) => (i<6 && Rules.wouldLoseByRepeat(G, side, a) ? risky : safe).push(a));
    return [...safe, ...risky];
  }
  return acts;
}
const chooseAction = (G, side, level, opt) => chooseActions(G, side, level, opt)[0] || null;
module.exports = {chooseAction, chooseActions};
