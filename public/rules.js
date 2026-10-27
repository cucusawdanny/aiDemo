/* 九路棋盤：規則與設定（瀏覽器與伺服器共用同一份）。
   要換棋子圖片：把 TYPES 裡的 image 改成網址，例如 '/img/king.png'（圖檔放 public/img/）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
// ===== 設定區：換圖、改 tag 只動這裡（image 填網址即可，null = 自動佔位圖）=====
const SIZE = 9;
const TYPES = {
  king:    {label:'王', name:'王',  image:null, tags:['核心','8向1格']},
  ol:      {label:'OL', name:'OL',  image:null, tags:['跳躍','可吃己方龍']},
  otl:     {label:'OTL', name:'OTL', image:null, tags:['蛇形']},
  kid:     {label:'孩', name:'孩子多',  image:null, tags:['直線','遠程','死亡連鎖']},
  iron:    {label:'熨', name:'熨斗',  image:null, tags:['前衝','側移1格']},
  shoe:    {label:'鞋', name:'鞋子',  image:null, tags:['跳躍']},
  tea:     {label:'茶', name:'抹茶小紅豆',  image:null, tags:['跳躍','可復活']},
  godness: {label:'謎', name:'謎之美少女',  image:null, tags:['跳躍','茶的復活型態']},
  night:   {label:'夜', name:'夜王',  image:null, tags:['冰凍','遠程','不可吃子']},
  dong:    {label:'咚', name:'咚咚咚咚咚將軍',  image:null, tags:['斬擊']},
  guard:   {label:'士', name:'量產型戰士',  image:null, tags:['量產型戰士','前3後2']},
  t:       {label:'龍', name:'龍', image:null, tags:['基礎棋','可轉生']}
};
const BACK  = ['shoe','iron','kid','ol','king','tea','night','iron','shoe'];
const FRONT = ['t','t','guard','t','dong','t','guard','t','t'];

const files = 'abcdefghi';
const S = s => s==='w' ? '白方' : '黑方', L = p => TYPES[p.type].label, N = p => TYPES[p.type].name;
const sq = o => files[o.x] + (SIZE-o.y), opp = s => s==='w' ? 'b' : 'w';
let pieces = [], hist = [], turn = 'w', over = false, pending = [], phase = null, uid = 0, rec = [];
const pieceAt = (x,y) => pieces.find(p => p.x===x && p.y===y);
const count = (s, ...ty) => pieces.filter(p => p.side===s && ty.includes(p.type)).length;
const mk = (side, type, x, y, fresh=false) => ({id:`${side}-${type}-${++uid}`, side, type, x, y, fresh});
const commit = () => {};
// ===== 走法規則（純邏輯，之後可搬到伺服器驗證）=====
const inB = (x,y) => x>=0 && y>=0 && x<SIZE && y<SIZE;
const fwd = p => p.side==='w' ? -1 : 1;
function cell(p,x,y){ if(!inB(x,y)) return 0; const q = pieceAt(x,y); if(!q) return 1;
  return (q.side!==p.side || (p.type==='ol' && q.type==='t')) ? 2 : 0; }   // OL 可吃己方龍
function ray(p,dx,dy,max=SIZE){ const r=[]; let x=p.x+dx, y=p.y+dy;
  for(let i=0;i<max;i++,x+=dx,y+=dy){ const c=cell(p,x,y); if(!c) break; r.push({x,y}); if(c===2) break; } return r; }
const leap = (p,offs) => offs.map(([dy,dx]) => ({x:p.x+dx,y:p.y+dy})).filter(m => cell(p,m.x,m.y));
const DIR8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]], ORTH1 = [[-1,0],[1,0],[0,1],[0,-1]];
const RULES = {
  kid:  p => [[1,0],[-1,0],[0,1],[0,-1]].flatMap(([dx,dy]) => ray(p,dx,dy)),
  iron: p => [...ray(p,0,fwd(p)), ...[[0,-fwd(p)],[1,0],[-1,0]].flatMap(([dx,dy]) => ray(p,dx,dy,1))],
  otl:  p => [[[-1,1],[0,2],[1,3]], [[1,1],[0,2],[-1,3]]].flatMap(route => {
    const r=[]; for(const [dx,n] of route){ const x=p.x+dx, y=p.y+fwd(p)*n, c=cell(p,x,y); if(!c) break; r.push({x,y}); if(c===2) break; } return r; }),
  dong: p => leap(p, ORTH1),
  t:    p => leap(p, ORTH1),
  king: p => leap(p, DIR8),
  night: p => DIR8.flatMap(([dy,dx]) => ray(p,dx,dy)).filter(m => !pieceAt(m.x,m.y)),   // 不能吃子
  tea:  p => leap(p, [[-1,-1],[1,-1],[-1,1],[1,1],[-2,-2],[2,2],[-2,2],[2,-2]]),
  godness: p => leap(p, [[-1,-1],[1,-1],[-1,1],[1,1],[2,0],[0,2],[-2,0],[0,-2]]),
  guard: p => leap(p, [[fwd(p),-1],[fwd(p),0],[fwd(p),1],[-fwd(p),-1],[-fwd(p),1]]),
  shoe: p => leap(p, [[-2,-2],[-2,0],[-2,2],[0,2],[2,2],[2,0],[2,-2],[0,-2]]),
  ol:   p => leap(p, [[-1,0],[0,1],[1,0],[0,-1],[2,0],[-2,0],[0,-2],[0,2]])
};
function getMoves(p){ const mv = RULES[p.type](p); return p.fresh ? mv.filter(m => !pieceAt(m.x,m.y)) : mv; } // 剛復活不能吃子
// 夜：敵方夜的 3x3 範圍內若只剩這一顆棋子（不含夜本身），該棋子被冰凍（王除外）
const isFrozen = p => p.type!=='king' && pieces.some(n => n.type==='night' && n.side!==p.side &&
  (o => o.length===1 && o[0]===p)(pieces.filter(o => o!==n && Math.abs(o.x-n.x)<=1 && Math.abs(o.y-n.y)<=1)));

// ===== 回合流程（互動步驟存在 phase，雙方都看得到）=====
const log = s => hist.push(s);
const rm = q => pieces.splice(pieces.indexOf(q),1);
function win(side){ over = side; log(`🎉 ${S(side)}獲勝！`); }
function died(q, by){
  if(q.type==='king') return win(by);
  if(q.type==='kid') massDestroy(q);
  if(q.type==='kid' || q.type==='ol') pending.push(q.side);
}
function massDestroy(k){   // 孩死亡：周圍 3x3 己方士各自消滅正前方 5 格
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
    const w = pieceAt(k.x+dx,k.y+dy);
    if(w && w.type==='guard' && w.side===k.side){
      for(let s=1;s<=5 && !over;s++){ const y=w.y+fwd(w)*s; if(!inB(w.x,y)) break; const c=pieceAt(w.x,y);
        if(c){ rm(c); log(`${N(c)} 被消滅於 ${sq({x:w.x,y})}`);
          if(c.type==='king') return win(opp(c.side));
          if(c.type==='kid' || c.type==='ol') pending.push(c.side); } }
    }
  }
}
function slash(p,t){ rm(t); log(`${S(p.side)}${N(p)} 斬殺 ${S(t.side)}${N(t)} ${sq(t)}`); died(t,p.side); }
function act(p,m){
  const f={x:p.x,y:p.y}, q=pieceAt(m.x,m.y), d=fwd(p);
  if(q) rm(q);
  p.x=m.x; p.y=m.y;
  log(`${S(p.side)}${N(p)} ${sq(f)}→${sq(m)}` + (q ? ` 吃${S(q.side)}${N(q)}` : ''));
  if(q && p.type==='ol' && q.type==='t' && q.side===p.side){ p.type='otl'; log('OL 轉化為 OTL'); }
  if(!q && p.type==='t' && (p.side==='w' ? p.y<=1 : p.y>=SIZE-2) && count(p.side,'guard')<=1){ p.type='guard'; log(`${sq(p)} 龍轉生為量產型戰士`); }
  if(q) died(q,p.side);
  if(over) return commit();
  const fm = (m.x===f.x && m.y===f.y+d) || (m.y===f.y && Math.abs(m.x-f.x)===1), t = pieceAt(m.x,m.y+d);
  if(p.type==='dong' && !p.fresh && fm && t && t.type!=='dong' && t.side!==p.side) phase = {kind:'slash', side:p.side, pid:p.id, tid:t.id};
  else next();
  commit();
}
function resolveSlash(yes){
  const p=pieces.find(o=>o.id===phase.pid), t=pieces.find(o=>o.id===phase.tid); phase=null;
  if(yes && p && t) slash(p,t);
  next(); commit();
}
function cands(s){
  const c=[]; if(count(s,'t')<6) c.push('t'); if(count(s,'guard')<2) c.push('guard'); if(count(s,'iron')<2) c.push('iron');
  if(count(s,'shoe')<2) c.push('shoe'); if(!count(s,'night')) c.push('night'); if(!count(s,'dong')) c.push('dong'); if(!count(s,'tea','godness')) c.push('tea');
  return c;
}
function next(){
  if(over){ phase=null; return; }
  if(!pending.length) return finish();
  const s=pending.shift(), c=cands(s);
  if(!c.length){ log(`${S(s)}無可復活的角色`); return next(); }
  phase = {kind:'pick', side:s, cands:c};
}
function pick(ty){ phase = {kind:'place', side:phase.side, ty}; commit(); }
function place(x,y){
  const p = mk(phase.side, phase.ty==='tea' ? 'godness' : phase.ty, x, y, true); pieces.push(p);
  log(`${S(p.side)}${N(p)} 復活在 ${sq(p)}`); phase=null; next(); commit();
}
function finish(){ pieces.forEach(p => { if(p.side===turn) p.fresh=false; }); turn=opp(turn); phase=null; }

// ===== 對外介面：以「狀態物件 G」為單位操作（伺服器同時管理很多房間）=====
function withState(G, fn){
  pieces=G.pieces; hist=G.hist; turn=G.turn; over=G.over||false; pending=G.pending||[]; phase=G.phase||null; uid=G.uid||0; rec=G.rec||[];
  try { return fn(); }
  finally { G.pieces=pieces; G.hist=hist; G.turn=turn; G.over=over; G.pending=pending; G.phase=phase; G.uid=uid; G.rec=rec; }
}
function create(){
  pieces=[]; hist=[]; turn='w'; over=false; pending=[]; phase=null; uid=0; rec=[];
  [['w',SIZE-1,SIZE-2],['b',0,1]].forEach(([side,by,fy]) => [[BACK,by],[FRONT,fy]].forEach(([arr,y]) =>
    (side==='w' ? arr : [...arr].reverse()).forEach((type,x) => pieces.push(mk(side,type,x,y)))));
  rec.push({k:posHash(), by:null, mat:matKey(), th:[]});
  return {pieces,hist,turn,over:false,pending,phase:null,uid,rec};
}
const find = id => pieces.find(o => o.id===id);
const moves = (G, pid) => withState(G, () => { const p=find(pid); return p ? getMoves(p) : []; });
const check = (G, side) => withState(G, () => attacked(side));
const frozen = (G, pid) => withState(G, () => { const p=find(pid); return !!p && isFrozen(p); });
const ok = () => ({ok:true}), bad = error => ({ok:false, error});
const int = (v, lo, hi) => Number.isInteger(v) && v>=lo && v<=hi;
// 驗證並執行一個玩家動作；side 是送出動作的玩家陣營
function apply(G, side, a){
  return withState(G, () => {
    if (over) return bad('遊戲已結束');
    if (phase) {
      if (phase.side !== side) return bad('等待對方操作');
      if (a.t==='slash' && phase.kind==='slash') {
        resolveSlash(!!a.yes); return ok(); }
      if (a.t==='pick' && phase.kind==='pick' && phase.cands.includes(a.ty)) { pick(a.ty); return ok(); }
      if (a.t==='place' && phase.kind==='place' && int(a.x,0,SIZE-1) && int(a.y,0,SIZE-1) && !pieceAt(a.x,a.y)) { place(a.x,a.y); return ok(); }
      return bad('不合法的操作');
    }
    if (turn !== side) return bad('還沒輪到你');
    if (a.t==='move' && typeof a.pid==='string' && int(a.x,0,SIZE-1) && int(a.y,0,SIZE-1)) {
      const p = find(a.pid);
      if (!p || p.side!==side) return bad('這不是你的棋子');
      if (isFrozen(p)) return bad('該棋子被冰凍，無法移動');
      if (!getMoves(p).some(m => m.x===a.x && m.y===a.y)) return bad('不合法的走法');
      act(p, {x:a.x, y:a.y}); return ok();
    }
    return bad('不合法的操作');
  });
}
// ===== 王的威脅（只供提示與「長將」判定；已取消將軍必須化解、送王禁止、將死、困斃）=====
// 在目前狀態的複本上試走，結束後還原（可巢狀使用）
function sim(fn){
  const keep = {pieces,hist,turn,over,pending,phase,uid};
  pieces = pieces.map(p => ({...p})); hist = []; pending = [...pending]; phase = phase ? {...phase} : null;
  try { return fn(); } finally { ({pieces,hist,turn,over,pending,phase,uid} = keep); }
}
const kingOf = side => pieces.find(o => o.type==='king' && o.side===side);
const slashHit = (p, m) => { const d = fwd(p); return ((m.x===p.x && m.y===p.y+d) || (m.y===p.y && Math.abs(m.x-p.x)===1)) ? {x:m.x, y:m.y+d} : null; };
// side 的王是否會在對方下一步被殺（直接吃、咚斬擊、孩被攻擊後己方士的火線誤傷）
function attacked(side){
  const k = kingOf(side), e = opp(side); if (!k) return true;
  for (const p of pieces) {
    if (p.side!==e || isFrozen(p)) continue;
    const ms = getMoves(p);
    if (ms.some(m => m.x===k.x && m.y===k.y)) return true;
    if (p.type==='dong' && !p.fresh && ms.some(m => { const t = slashHit(p,m); return t && t.x===k.x && t.y===k.y; })) return true;
  }
  for (const K of pieces) {
    if (K.type!=='kid' || K.side!==side || !pieces.some(g => g.type==='guard' && g.side===side && Math.abs(g.x-K.x)<=1 && Math.abs(g.y-K.y)<=1)) continue;
    for (const p of pieces) {
      if (p.side!==e || isFrozen(p)) continue;
      const ms = getMoves(p), cap = ms.find(m => m.x===K.x && m.y===K.y), sl = p.type==='dong' && !p.fresh && ms.find(m => { const t = slashHit(p,m); return t && t.x===K.x && t.y===K.y; });
      const m = cap || sl; if (!m) continue;
      if (sim(() => { act(find(p.id), m); if (!cap && phase && phase.kind==='slash') resolveSlash(true); return !kingOf(side); })) return true;
    }
  }
  return false;
}
// ===== 禁止著法（長將、長殺、長捉）與重複裁決 =====
// 試走：執行 fn 後把盤面原地還原（物件參照不變）
function trial(fn){
  const s = {ps:pieces.map(o => [o,{...o}]), h:hist.length, turn, over, pending:pending.slice(), phase, uid};
  try { return fn(); }
  finally { pieces.length = 0; s.ps.forEach(([o,c]) => { Object.assign(o,c); pieces.push(o); });
    hist.length = s.h; turn = s.turn; over = s.over; phase = s.phase; uid = s.uid; pending.length = 0; pending.push(...s.pending); }
}
const val = o => o.type==='king' ? 1000 : (o.type in SCORE ? SCORE[o.type] : 3);
const matKey = () => pieces.map(p => p.side+p.type).sort().join('');
const hasMove = s => pieces.some(p => p.side===s && !isFrozen(p) && getMoves(p).length);
// by 這一方「下一手」能對對方造成的威脅記號：
//   K＝可吃王（將）  S＝一手消滅 2 子以上（殺：咚斬擊／孩連鎖）  C:<id>＝可吃某顆「有價值」的子（捉）
//   有價值＝目標價值高於攻擊者，或吃完後攻擊者不會被回吃（無根）
function threatTokens(by){
  const en = opp(by), toks = new Set(), before = pieces.filter(o => o.side===en);
  for(const e of pieces.filter(o => o.side===by)){
    if(isFrozen(e)) continue;
    for(const m of getMoves(e)){
      const q = pieceAt(m.x,m.y);
      if(!(q && q.side===en) && e.type!=='dong') continue;
      const r = trial(() => {
        act(e,m); if(!over && phase && phase.kind==='slash' && phase.side===by) resolveSlash(true);
        const lost = before.filter(o => !pieces.includes(o));
        const safe = !pieces.some(o => o.side===en && !isFrozen(o) && getMoves(o).some(mm => mm.x===e.x && mm.y===e.y));
        return {lost, safe, win: over===by};
      });
      if(r.win || r.lost.some(o => o.type==='king')){ toks.add('K'); toks.add('S'); }
      else if(r.lost.length>=2) toks.add('S');
      else if(r.lost.length===1 && (val(r.lost[0]) > val(e) || r.safe)) toks.add('C:'+r.lost[0].id);
    }
  }
  return [...toks];
}
const labelOf = toks => toks.includes('K') ? '長將' : toks.includes('S') ? '長殺' : '長捉';
// 最新局面出現達 3 次時，取「上次出現到現在」這段循環，看雙方每一手是否都帶著同一種威脅
//   單方禁止 → 該方判負（必須變著，不變就輸）；雙方皆禁止或皆允許 → 和局
function judgeRepeat(rec){
  const last = rec[rec.length-1], idx = []; rec.forEach((r,i) => { if(r.k===last.k) idx.push(i); });
  if(idx.length < 3) return null;
  const cyc = rec.slice(idx[idx.length-2] + 1);
  const verdict = side => { const mv = cyc.filter(r => r.by===side); if(!mv.length) return null;
    let common = mv[0].th; for(const r of mv.slice(1)) common = common.filter(t => r.th.includes(t));
    return common.length ? labelOf(common) : null; };
  const vw = verdict('w'), vb = verdict('b');
  if(vw && !vb) return {loser:'w', label:vw, n:idx.length};
  if(vb && !vw) return {loser:'b', label:vb, n:idx.length};
  return {loser:null, both: !!(vw && vb), n:idx.length};
}
// 要走這一步，會不會因為禁止著法重複而判負？（給介面／AI 事先避開用）
function wouldLoseByRepeat(G, side, a){
  const c = JSON.parse(JSON.stringify(G)), r = apply(c, side, a);
  if(r.ok && !c.over && !c.phase) afterTurn(c);
  return !!(r.ok && c.result && c.result.reason==='repeat' && c.result.loser===side);
}

// ===== 棋鐘與計分 =====
// 每手 8 秒；用完後扣自由時間（301 秒）；自由時間燒完即結束，依剩餘棋子計分。
const SCORE = {dong:10, ol:8, kid:8, tea:7, night:5, t:2, king:0};   // 龍 2 分；其餘（熨、鞋、士、OTL、謎）皆 3 分
const pts = (G, side) => G.pieces.filter(p => p.side===side).reduce((s,p) => s + (p.type in SCORE ? SCORE[p.type] : 3), 0);
const clockInit = (now, o={}) => ({moveMs:o.moveMs||8000, fastMs:o.fastMs||3000, free:{w:o.freeMs||301000, b:o.freeMs||301000}, start: now + (o.graceMs===undefined ? 5000 : o.graceMs), active:'w'});
// 雙方棋子都只剩 7 顆以下（含王）時，每手縮為 3 秒
const moveLimit = G => { const c = G.clock, n = x => G.pieces.filter(p => p.side===x).length; return (n('w')<=7 && n('b')<=7) ? Math.min(c.moveMs, c.fastMs) : c.moveMs; };
const deadline = G => G.clock.start + moveLimit(G) + G.clock.free[G.clock.active];
function clockView(G, now){
  const c = G.clock, lim = moveLimit(G), el = G.over ? 0 : Math.max(0, now - c.start), free = {w:c.free.w, b:c.free.b};
  free[c.active] = Math.max(0, free[c.active] - Math.max(0, el - lim));
  return {move: Math.max(0, lim - el), limit: lim, free};
}
// 依分數結算：自由時間沒燒完的一方 +10，再加剩餘棋子分數；同分和局
function settle(G, reason, loser){
  const bonus = {w:0, b:0}; ['w','b'].forEach(x => { if (x!==loser && !(G.clock && G.clock.free[x]<=0)) bonus[x] = 10; });
  const pieces = {w:pts(G,'w'), b:pts(G,'b')}, total = {w:pieces.w+bonus.w, b:pieces.b+bonus.b};
  G.over = total.w>total.b ? 'w' : total.b>total.w ? 'b' : 'draw'; G.phase = null; G.pending = [];
  G.result = {reason, loser, pieces, bonus, total};
  const why = {time:`⏱ ${S(loser)}自由時間用完`, nomoves:'雙方皆無棋可走', cap:'⏱ 到達步數上限（依時限判定）'}[reason];
  G.hist.push(`${why}；白方 ${total.w} 分，黑方 ${total.b} 分` + (G.over==='draw' ? '，和局' : `，${S(G.over)}獲勝`));
}
function timeUp(G, now){
  if (!G.clock || G.over || now < deadline(G)) return false;
  const loser = G.clock.active; G.clock.free[loser] = 0; settle(G, 'time', loser); return true;
}
function hash(str){   // 53 位元字串雜湊（cyrb53）
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i=0; i<str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1^c, 2654435761); h2 = Math.imul(h2^c, 1597334677); }
  h1 = Math.imul(h1^(h1>>>16), 2246822507) ^ Math.imul(h2^(h2>>>13), 3266489909);
  h2 = Math.imul(h2^(h2>>>16), 2246822507) ^ Math.imul(h1^(h1>>>13), 3266489909);
  return (4294967296*(2097151 & h2) + (h1>>>0)).toString(36);
}
const posHash = () => hash(turn + '|' + pieces.map(p => p.side + p.type + p.x + p.y + (p.fresh ? 'f' : '')).sort().join(','));
// 每次輪到下一位玩家（沒有待處理的決定）時：無棋可走就跳過；再做重複裁決（長將／長殺／長捉）
function afterTurn(G){
  if (G.over) return;
  const by = opp(G.turn);
  if (withState(G, () => !hasMove(turn))) {
    G.hist.push(`${S(G.turn)}無棋可走，跳過回合`); G.turn = by;
    if (withState(G, () => !hasMove(turn))) return settle(G, 'nomoves', null);
    if (G.clock) G.clock.active = G.turn;
  }
  const e = withState(G, () => ({k: posHash(), mat: matKey(), th: threatTokens(by)}));
  const rec = G.rec = G.rec || [];
  if (rec.length && rec[rec.length-1].mat !== e.mat) rec.length = 0;   // 吃子／復活／轉化後局面不可能回頭
  rec.push({k:e.k, by, mat:e.mat, th:e.th});
  const v = judgeRepeat(rec); if (!v) return;
  G.hist.push(`🔁 同一局面重複 ${v.n} 次`); G.phase = null; G.pending = [];
  if (v.loser) { G.over = opp(v.loser); G.result = {reason:'repeat', loser:v.loser, label:v.label};
    G.hist.push(`${S(v.loser)}${v.label}（禁止著法）不變著，判負，${S(opp(v.loser))}獲勝`); }
  else { G.over = 'draw'; G.result = {reason:'repeat', loser:null, label:null};
    G.hist.push(v.both ? '雙方皆為禁止著法，和局' : '雙方皆為允許著法，和局'); }
}
// 伺服器用：先結算時間，再驗證並執行動作，成功後重設棋鐘並檢查終局
function play(G, side, a, now){
  if (timeUp(G, now)) return {ok:false, ended:true, error:'時間已到'};
  if (a && a.t==='resign') {   // 投降：任何時候都可以
    if (G.over) return bad('遊戲已結束');
    G.over = opp(side); G.phase = null; G.pending = []; G.result = {reason:'resign', loser:side}; G.hist.push(`🏳 ${S(side)}投降，${S(opp(side))}獲勝`); return ok();
  }
  const lim = G.clock ? moveLimit(G) : 0, r = apply(G, side, a);
  if (r.ok && !G.over) {
    if (G.clock) { const c = G.clock, el = Math.max(0, now - c.start);
      c.free[c.active] = Math.max(0, c.free[c.active] - Math.max(0, el - lim)); c.start = now; c.active = G.phase ? G.phase.side : G.turn; }
    if (!G.phase) afterTurn(G);
  }
  return r;
}
// ===== 給 AI 用的低階介面（ai.js 使用）=====
const PICK_ORDER = ['dong','tea','night','iron','shoe','guard','t'];
const bestPick = () => PICK_ORDER.find(t => phase.cands.includes(t)) || phase.cands[0];
function bestCell(side){   // 復活位置：少被攻擊、靠近己方王
  const k = kingOf(side), att = {};
  pieces.filter(o => o.side===opp(side) && !isFrozen(o)).forEach(e => getMoves(e).forEach(m => { const key = m.x+','+m.y; att[key] = (att[key]||0)+1; }));
  let best = null, bs = -1e9;
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){ if(pieceAt(x,y)) continue;
    const sc = -(att[x+','+y]||0)*10 - (k ? Math.max(Math.abs(k.x-x), Math.abs(k.y-y)) : 0);
    if(sc>bs){ bs=sc; best={x,y}; } }
  return best;
}
function autoResolve(){   // 搜尋時用：自動處理斬擊／復活步驟
  for(let g=0; phase && !over && g<20; g++){
    if(phase.kind==='slash') resolveSlash(true);
    else if(phase.kind==='pick') pick(bestPick());
    else { const c = bestCell(phase.side); place(c.x,c.y); }
  }
}
// 依指定的棋子清單建立一個局面（題庫、教學圖解用）：list = [[type, side, x, y], ...]
function custom(list, t){
  pieces=[]; hist=[]; turn=t||'w'; over=false; pending=[]; phase=null; uid=0; rec=[];
  list.forEach(([type,side,x,y]) => pieces.push(mk(side,type,x,y)));
  rec.push({k:posHash(), by:null, mat:matKey(), th:[]});
  return {pieces,hist,turn,over:false,pending,phase:null,uid,rec};
}
// 目前待處理的斬擊／復活步驟，AI 與題庫採用的「最佳自動選擇」（斬擊一律斬；復活選價值最高、放在安全且靠近己王處）
const autoAction = G => withState(G, () => !phase ? null : phase.kind==='slash' ? {t:'slash', yes:true} : phase.kind==='pick' ? {t:'pick', ty:bestPick()} : (c => ({t:'place', x:c.x, y:c.y}))(bestCell(phase.side)));
const adjudicate = G => { if (!G.over) settle(G, 'cap', null); };   // 模擬對局到達步數上限時，依分數判定
function kit(G, fn){
  return withState(G, () => fn({
    pieces: () => pieces, turn: () => turn, over: () => over, phase: () => phase, val, trial, isFrozen, pieceAt, bestPick, bestCell,
    hash: () => posHash(), king: s => kingOf(s), rec: () => rec,
    moves: s => pieces.filter(p => p.side===s && !isFrozen(p)).flatMap(p => getMoves(p).map(m => ({p,m}))),
    play: (p,m) => { act(p,m); autoResolve(); }   // 只能在 trial() 裡用
  }));
}
return {SIZE, TYPES, BACK, FRONT, N, create, custom, adjudicate, autoAction, moves, frozen, apply, play, check, kit, wouldLoseByRepeat, clockInit, clockView, deadline, timeUp, pts, moveLimit};
});
