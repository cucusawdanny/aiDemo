// 規則單元測試（不需要網路）：計分、取消將軍限制、重複裁決（長將）、跳過回合、剛復活的咚、殘局計時、投降、AI
const assert = require('assert'), R = require('../public/rules.js'), AI = require('../ai.js');
const P = (side, type, x, y) => ({id: `${side}-${type}-${x}${y}`, side, type, x, y, fresh: false});
const G0 = ps => ({pieces: ps, hist: [], turn: 'w', over: false, pending: [], phase: null, uid: 0, rec: []});
const mv = (G, side, id, x, y) => R.play(G, side, {t:'move', pid:id, x, y}, 0);

// 1. 計分：OTL、謎都算 3 分，龍 2 分
{ const G = G0([P('w','king',4,8), P('w','otl',0,8), P('w','godness',1,8), P('w','dong',2,8), P('w','tea',3,8), P('w','t',5,8)]);
  assert.equal(R.pts(G,'w'), 0 + 3 + 3 + 10 + 7 + 2); console.log('✔ OTL、謎之美少女各算 3 分，龍算 2 分'); }

// 2. 被將軍不必化解；王也可以走進被攻擊的格子（會被吃就是自己的事）
{ const G = G0([P('w','king',4,8), P('b','king',8,0), P('b','kid',4,3), P('w','kid',0,5)]);
  assert.equal(R.check(G,'w'), true);   // 仍可查詢「王受威脅」，只作提示
  assert.ok(mv(G,'w','w-kid-05',0,6).ok);   // 沒解除將軍也可以走
  const G2 = G0([P('w','king',4,8), P('b','king',8,0), P('b','kid',4,3)]);
  assert.ok(R.moves(G2,'w-king-48').some(m => m.x===4 && m.y===7));
  assert.ok(mv(G2,'w','w-king-48',4,7).ok); assert.ok(mv(G2,'b','b-kid-43',4,7).ok);
  assert.equal(G2.over, 'b'); console.log('✔ 不必化解將軍；王可以送死，被吃就輸'); }

// 3. 被牽制的棋子可以離開
{ const G = G0([P('w','king',4,8), P('w','kid',4,6), P('b','king',8,0), P('b','kid',4,2)]);
  assert.ok(R.moves(G,'w-kid-46').some(m => m.x===3 && m.y===6)); assert.ok(mv(G,'w','w-kid-46',3,6).ok);
  console.log('✔ 被牽制的棋子可以離開'); }

// 4. 無路可走：只是跳過回合
{ const G = G0([P('w','king',8,8), P('w','iron',1,0), P('w','iron',0,1), P('w','iron',1,1), P('b','night',0,0)]);
  assert.ok(mv(G,'w','w-king-88',7,8).ok);
  assert.equal(G.over, false); assert.equal(G.turn, 'w'); assert.ok(G.hist.some(h => /跳過回合/.test(h)));
  console.log('✔ 無路可走：跳過回合，不判輸'); }

// 5. 雙方都只是來回走（沒有威脅）→ 第三次重複：和局
{ const G = G0([P('w','king',4,8), P('b','king',4,0), P('w','kid',0,5), P('b','kid',8,3)]);
  const seq = [['w','w-kid-05',0,6],['b','b-kid-83',8,2],['w','w-kid-05',0,5],['b','b-kid-83',8,3]]; let n = 0;
  for (; n < 16 && !G.over; n++) { const [s,id,x,y] = seq[n%4]; assert.ok(mv(G,s,id,x,y).ok); }
  assert.ok(n <= 12); assert.equal(G.over, 'draw'); assert.equal(G.result.reason, 'repeat'); assert.equal(G.result.loser, null);
  console.log(`✔ 雙方皆為允許著法，重複 3 次判和局（第 ${n} 手）`); }

// 6. 單方長將：白孩每一手都威脅黑王，黑王來回躲 → 白方判負
{ const G = G0([P('w','king',4,8), P('b','king',4,0), P('w','kid',5,5)]);
  const wk = (id,x,y) => mv(G,'w',id,x,y), bk = (x,y) => mv(G,'b','b-king-40',x,y);
  const seqW = [[4,5],[5,5]]; let n = 0, kid = 'w-kid-55', bx = 4, last;
  while (!G.over && n < 20) {
    const x = seqW[n%2][0]; last = R.wouldLoseByRepeat(G,'w',{t:'move',pid:G.pieces.find(p=>p.side==='w'&&p.type==='kid').id,x,y:5});
    assert.ok(wk(G.pieces.find(p=>p.side==='w'&&p.type==='kid').id, x, 5).ok); if (G.over) break;
    const nx = bx===4 ? 5 : 4, k = G.pieces.find(p=>p.side==='b'&&p.type==='king'); assert.ok(mv(G,'b',k.id,nx,0).ok); bx = nx; n++; }
  assert.equal(G.over, 'b'); assert.equal(G.result.reason, 'repeat'); assert.equal(G.result.loser, 'w'); assert.equal(G.result.label, '長將');
  assert.equal(last, true);   // 事先查詢也知道這步會判負
  console.log('✔ 單方長將：長將方不變著，重複 3 次判負'); }

// 7. 剛復活的咚：可以移動，但不能吃棋也不能斬擊
{ const mk = fresh => { const d = P('w','dong',4,7); d.fresh = fresh; return G0([P('w','king',0,8), P('b','king',8,0), d, P('b','shoe',4,5), P('b','t',3,7)]); };
  const F = mk(true), ms = R.moves(F,'w-dong-47').map(m => m.x+','+m.y);
  assert.ok(ms.includes('4,6') && !ms.includes('3,7'), ms.join(' '));
  assert.ok(mv(F,'w','w-dong-47',4,6).ok); assert.equal(F.phase, null); assert.equal(F.turn, 'b');
  const N = mk(false); assert.ok(mv(N,'w','w-dong-47',4,6).ok); assert.equal(N.phase.kind, 'slash');
  console.log('✔ 剛復活的咚：可移動、不能吃棋、不能斬擊'); }

// 8. 殘局（雙方都只剩 7 顆以下）每手 3 秒
{ const G = G0([P('w','king',0,8), P('b','king',8,0)]); G.clock = R.clockInit(0, {graceMs:0});
  assert.equal(R.clockView(G,0).limit, 3000);
  const F = R.create(); F.clock = R.clockInit(0, {graceMs:0}); assert.equal(R.clockView(F,0).limit, 8000);
  const H = G0([...['king','kid','kid','iron','iron','shoe','shoe'].map((ty,i) => P('w',ty,i,8)), P('b','king',8,0), P('b','kid',8,1)]); H.clock = R.clockInit(0, {graceMs:0});
  assert.equal(R.clockView(H,0).limit, 3000); H.pieces.push(P('w','tea',7,7)); assert.equal(R.clockView(H,0).limit, 8000);
  console.log('✔ 雙方都只剩 7 顆以下時，每手縮為 3 秒；有一方超過 7 顆就維持 8 秒'); }

// 9. 投降
{ const G = G0([P('w','king',4,8), P('b','king',4,0)]);
  assert.ok(R.play(G,'b',{t:'resign'},0).ok); assert.equal(G.over, 'w'); assert.equal(G.result.reason, 'resign'); assert.equal(G.result.loser, 'b');
  assert.equal(R.play(G,'w',{t:'resign'},0).ok, false); console.log('✔ 投降：任何時候都可以，對方獲勝'); }

// 10. AI：兩種等級都能從開局選出被接受的動作，並互相對弈
{ for (const lv of ['medium','advanced']) { const G = R.create(); G.clock = R.clockInit(0, {graceMs:0});
    const list = AI.chooseActions(G, 'w', lv, {budgetMs: 200}); assert.ok(list.length > 0 && R.play(G,'w',list[0],0).ok); }
  const G = R.create(); G.clock = R.clockInit(0, {graceMs:0}); let t = 0;
  for (let i = 0; i < 40 && !G.over; i++) { const s = G.phase ? G.phase.side : G.turn;
    const list = AI.chooseActions(G, s, s==='w' ? 'advanced' : 'medium', {budgetMs: 120}); t += 1000;
    assert.ok(list.some(a => R.play(G, s, a, t).ok), '第 ' + i + ' 手 AI 沒有可被接受的動作'); }
  console.log('✔ 中等／進階 AI 對弈 40 手無誤'); }

console.log('\n規則測試全部通過');
