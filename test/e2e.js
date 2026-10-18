// 端對端測試：啟動伺服器，兩個 WebSocket 玩家登入、開房、上鎖、隨機對弈到結束，並檢查雙方狀態一致。需要 Node 22+（內建 WebSocket 客戶端）。
const path = require('path'), os = require('os'), fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-'));
const {server, Rules} = require('../server.js');
const assert = require('assert');
class C {
  constructor(port, name, key){ this.name = name; this.key = key; this.q = []; this.w = []; this.state = null; this.room = null;
    this.ws = new WebSocket('ws://localhost:' + port);
    this.ws.onmessage = e => { const m = JSON.parse(e.data); if(m.t==='room'){ this.room = m.room; this.state = m.state; } this.q.push(m); this.w.splice(0).forEach(f => f()); }; }
  open(){ return new Promise(r => this.ws.onopen = r); }
  send(o){ this.ws.send(JSON.stringify(o)); }
  async next(type, ms=3000){ const t0 = Date.now();
    for(;;){ const types = [].concat(type || []), i = this.q.findIndex(m => !types.length || types.includes(m.t)); if(i>=0) return this.q.splice(i,1)[0];
      if(Date.now()-t0 > ms) throw new Error(this.name+' 等不到 '+type);
      await new Promise(r => { this.w.push(r); setTimeout(r, 50); }); } }
}
const rnd = a => a[Math.floor(Math.random()*a.length)];
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const kA = 'a'.repeat(48), kB = 'b'.repeat(48), A = new C(port,'Alice',kA), B = new C(port,'Bob',kB);
  await A.open(); await B.open();
  A.send({t:'hello', id:'Alice', key:kA}); assert.equal((await A.next('hello_ok')).name, 'Alice');
  B.send({t:'hello', id:'Bob', key:kB}); await B.next('hello_ok');
  const X = new C(port,'冒用者','c'.repeat(48)); await X.open(); X.send({t:'hello', id:'alice', key:'c'.repeat(48)});
  assert.equal((await X.next('error')).fatal, true); console.log('✔ 固定 ID：別人無法冒用');
  A.send({t:'create', name:'房一', pw:'secret'}); await A.next('room');
  B.send({t:'join', name:'房一', pw:'wrong'}); assert.match((await B.next('error')).msg, /密碼/); console.log('✔ 錯誤密碼被擋下');
  B.send({t:'join', name:'房一', pw:'secret'}); await A.next('room'); await B.next('room');
  assert.notEqual(A.room.you, B.room.you); console.log('✔ 隨機分配黑白：Alice=' + A.room.you + ' Bob=' + B.room.you);
  const by = {[A.room.you]: A, [B.room.you]: B}, other = c => c===A ? B : A;
  const wrong = by[A.state.turn==='w' ? 'b' : 'w']; wrong.send({t:'move', pid:'x', x:0, y:0}); assert.match((await wrong.next('error')).msg, /輪到/); await wrong.next('room');   // 錯誤後伺服器會重送狀態
  console.log('✔ 非輪到的玩家不能下棋');
  let plies = 0, illegal = 0;
  while(!A.state.over && plies < 600){
    const G = JSON.parse(JSON.stringify(A.state)), side = G.phase ? G.phase.side : G.turn, pl = by[side]; let a;
    if(G.phase){
      if(G.phase.kind==='slash') a = {t:'slash', yes: Math.random()<.7};
      else if(G.phase.kind==='pick') a = {t:'pick', ty: rnd(G.phase.cands)};
      else { const e=[]; for(let y=0;y<9;y++) for(let x=0;x<9;x++) if(!G.pieces.some(p=>p.x===x&&p.y===y)) e.push({x,y}); a = {t:'place', ...rnd(e)}; }
    } else {
      const opts = []; G.pieces.filter(p => p.side===side && !Rules.frozen(G,p.id)).forEach(p => Rules.moves(G,p.id).forEach(m => opts.push({t:'move', pid:p.id, x:m.x, y:m.y})));
      if(!opts.length){ console.log('（無棋可走，提前結束）'); break; }
      a = rnd(opts);
    }
    pl.send(a); const r1 = await pl.next(['room','error']); if(r1.t==='error'){ illegal++; console.log('伺服器拒絕合法動作：', a, r1.msg); break; }
    await other(pl).next('room'); plies++;
    assert.deepEqual(A.state, B.state);
  }
  assert.equal(illegal, 0); console.log(`✔ 隨機對弈 ${plies} 步，雙方狀態始終一致` + (A.state.over ? '，勝者：' + A.state.over : ''));
  B.ws.close(); await new Promise(r => setTimeout(r, 100));
  const B2 = new C(port,'Bob',kB); await B2.open(); B2.send({t:'hello', id:'Bob', key:kB}); await B2.next('hello_ok'); const rm = await B2.next('room');
  assert.deepEqual(rm.state, A.state); console.log('✔ 斷線後用同一個 ID 重連，回到對局');
  A.send({t:'leave'}); await A.next('left'); B2.send({t:'leave'}); await B2.next('left'); console.log('✔ 雙方離開後房間清除');
  // AI 練習室：大廳固定兩間；進房後 AI 會回應；離開後房間回到等待
  process.env.CHESS_GRACE_MS = '0'; process.env.CHESS_BOT_DELAY_MS = '50';
  A.q.length = 0; A.state = null; A.send({t:'join', name:'中等AI練習室'}); await A.next('room'); const me = A.room.you;
  assert.match(A.room.sides[me==='w'?'b':'w'].name, /AI/); assert.equal(A.room.online[me==='w'?'b':'w'], true);
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now(); while (!A.state.over && (A.state.phase ? A.state.phase.side : A.state.turn) !== me) { await A.next('room', 8000); if (Date.now()-t0 > 8000) throw new Error('AI 沒有回應'); }
    const G = JSON.parse(JSON.stringify(A.state)); let a;
    if (G.phase) a = G.phase.kind==='slash' ? {t:'slash', yes:false} : G.phase.kind==='pick' ? {t:'pick', ty:G.phase.cands[0]} : null;
    else { const o = []; G.pieces.filter(p => p.side===me && !Rules.frozen(G,p.id)).forEach(p => Rules.moves(G,p.id).forEach(m => o.push({t:'move', pid:p.id, x:m.x, y:m.y}))); a = rnd(o); }
    if (!a) break; A.send(a); const r = await A.next(['room','error']); assert.equal(r.t, 'room');
  }
  assert.ok(A.state.hist.some(h => /黑方|白方/.test(h)) && A.state.hist.length >= 5); console.log('✔ AI 練習室：進房、AI 回應、可繼續對弈');
  A.send({t:'leave'}); await A.next('left'); const lb = await A.next('rooms');
  assert.deepEqual(lb.list.map(r => r.name).sort(), ['中等AI練習室','進階AI練習室'].sort()); console.log('✔ 離開後兩間 AI 房仍在大廳');
  // 棋鐘：把時間調短（每手 50ms、自由 300ms、無開局緩衝），雙方都不動，白方先超時
  process.env.CHESS_MOVE_MS = '50'; process.env.CHESS_FREE_MS = '300'; process.env.CHESS_GRACE_MS = '0';
  A.q.length = 0; B2.q.length = 0; A.state = null;   // 清掉上一局殘留的訊息
  A.send({t:'create', name:'房二'}); await A.next('room'); B2.send({t:'join', name:'房二'}); await B2.next('room');
  let g; do { await A.next('room', 3000); g = A.state; } while(!(g && g.over));
  assert.equal(g.result.reason, 'time'); assert.equal(g.result.loser, 'w');
  assert.deepEqual(g.result.pieces, {w:68, b:68}); assert.deepEqual(g.result.bonus, {w:0, b:10}); assert.equal(g.over, 'b');
  console.log('✔ 棋鐘：白方自由時間先用完，計分 68 vs 68，未超時的黑方 +10 → 黑方 78 分獲勝');
  console.log('\n全部測試通過'); process.exit(0);
})().catch(e => { console.error('測試失敗：', e.message); process.exit(1); });
