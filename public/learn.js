// 題庫、高手對決（棋局回放）、教學 —— 與對弈共用同一份規則（Rules）
(function () {
  const clone = o => JSON.parse(JSON.stringify(o)), $$ = (sel, r = document) => [...r.querySelectorAll(sel)];
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const getJSON = async u => { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); };
  const solvedKey = 'pz_solved';

  // ===== 通用：畫棋盤 =====
  // o: flip 翻轉、hl {'x,y': 'cls'}、click(x,y)、sm 小盤面
  function drawBoard(host, G, o = {}) {
    host.className = 'bd' + (o.sm ? ' sm' : ''); host.innerHTML = '';
    const pa = (x, y) => G.pieces.find(p => p.x === x && p.y === y);
    for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
      const x = o.flip ? SIZE - 1 - i : i, y = o.flip ? SIZE - 1 - j : j, q = pa(x, y), e = el('div', 'sq ' + ((x + y) % 2 ? 'd' : 'l') + ' ' + ((o.hl && o.hl[x + ',' + y]) || ''));
      if (j === SIZE - 1) e.insertAdjacentHTML('beforeend', `<span class="c" style="top:auto;bottom:1px;left:auto;right:3px">${files[x]}</span>`);
      if (i === 0) e.insertAdjacentHTML('beforeend', `<span class="c">${SIZE - y}</span>`);
      if (q) { const im = new Image(); im.src = img(q); im.alt = N(q); e.appendChild(im); }
      if (o.click) e.onclick = () => o.click(x, y, q);
      host.appendChild(e);
    }
  }
  // 依動作清單算出每一步之後的局面（自動處理斬擊／復活步驟）
  function playLine(G0, moves) {
    const G = clone(G0), states = [clone(G0)];
    for (const [fx, fy, tx, ty] of moves) {
      const p = G.pieces.find(o => o.x === fx && o.y === fy); if (!p) break;
      Rules.play(G, G.turn, {t: 'move', pid: p.id, x: tx, y: ty}, 0);
      for (let g = 0; G.phase && g < 8; g++) Rules.play(G, G.phase.side, Rules.autoAction(G), 0);
      states.push(clone(G)); if (G.over) break;
    }
    return states;
  }
  const sqName = (x, y) => files[x] + (SIZE - y);
  const pieceTag = p => `<span class="tag">${esc(N(p))}</span>`;

  // ===== 題庫 =====
  const PZ = {data: null, idx: 1, solved: new Set(), filt: {kind: '', level: ''}, cur: null};
  const loadSolved = () => { try { PZ.solved = new Set(JSON.parse(store.get(solvedKey) || '[]')); } catch (e) { PZ.solved = new Set(); } };
  const saveSolved = () => store.set(solvedKey, JSON.stringify([...PZ.solved]));
  const pzList = () => PZ.data.items.filter(p => (!PZ.filt.kind || p.kind === PZ.filt.kind) && (!PZ.filt.level || p.level === +PZ.filt.level));
  const prompt = p => p.kind === 'mate' ? `${S(p.side)}先：${p.n === 1 ? '一手' : p.n + ' 手內'}強制吃掉對方的王` : `${S(p.side)}先：找出最佳著法（最佳應對下可淨贏約 ${p.gain} 分的子力）`;
  async function openPuzzles() {
    const host = $('puzzles'); if (!PZ.data) { host.textContent = '載入題庫中…'; try { PZ.data = await getJSON('/data/puzzles.json'); } catch (e) { host.textContent = '題庫載入失敗'; return; } loadSolved(); }
    host.innerHTML = `<h2>🧩 殘局題庫（${PZ.data.items.length} 題）</h2>
      <div class="bar"><label>篩選 <select id="pzk"><option value="">全部題型</option><option value="mate">殺王</option><option value="win">贏子</option></select></label>
      <label><select id="pzl"><option value="">全部難度</option>${[1,2,3,4,5].map(n => `<option value="${n}">難度 ${'★'.repeat(n)}</option>`).join('')}</select></label>
      <span id="pzprog" class="sm"></span></div>
      <div class="bar"><button id="pzprev">◀ 上一題</button><input id="pzno" type="number" min="1" style="width:5.5em;display:inline-block;margin:0"><span id="pzof" class="sm"></span><button id="pzgo">前往</button><button id="pznext">下一題 ▶</button><button id="pzrnd">🎲 隨機未解</button></div>
      <div class="row"><div id="pzb"></div><div class="side"><div id="pzt" class="banner"></div><div id="pzmsg" class="note"></div><div id="pztags"></div>
      <div><button id="pzhint">💡 提示</button><button id="pzsol">👁 看解答</button><button id="pzreset">↺ 重來</button></div>
      <div id="pzctl" hidden><div class="bar"><button id="pzp">⏮</button><button id="pzm">◀</button><button id="pzn">▶</button><button id="pzauto">▶ 自動播放</button></div><div id="pzstep" class="sm"></div></div></div></div>`;
    $('pzk').value = PZ.filt.kind; $('pzl').value = PZ.filt.level;
    $('pzk').onchange = e => { PZ.filt.kind = e.target.value; gotoFirst(); }; $('pzl').onchange = e => { PZ.filt.level = e.target.value; gotoFirst(); };
    $('pzprev').onclick = () => step(-1); $('pznext').onclick = () => step(1);
    $('pzgo').onclick = () => { const id = +$('pzno').value, p = PZ.data.items.find(x => x.id === id); if (p) { PZ.filt = {kind: '', level: ''}; $('pzk').value = ''; $('pzl').value = ''; showPuzzle(p); } };
    $('pzrnd').onclick = () => { const l = pzList().filter(p => !PZ.solved.has(p.id)); const pool = l.length ? l : pzList(); showPuzzle(pool[Math.random() * pool.length | 0]); };
    $('pzhint').onclick = hint; $('pzsol').onclick = solution; $('pzreset').onclick = () => showPuzzle(PZ.cur.p);
    const cur = PZ.data.items.find(p => p.id === PZ.idx) || PZ.data.items[0]; showPuzzle(cur);
  }
  function gotoFirst() { const l = pzList(); if (l.length) showPuzzle(l[0]); else { $('pzmsg').textContent = '沒有符合條件的題目'; } }
  function step(d) { const l = pzList(); let i = l.findIndex(p => p.id === PZ.cur.p.id); if (i < 0) i = 0; showPuzzle(l[(i + d + l.length) % l.length]); }
  function showPuzzle(p) {
    PZ.idx = p.id; const G = Rules.custom(p.p, p.side);
    PZ.cur = {p, G, sel: null, moves: [], done: false, states: null, si: 0, hint: 0, tries: 0, auto: null};
    $('pzno').value = p.id; $('pzof').textContent = `／${PZ.data.items.length}`;
    $('pzprog').textContent = `已解 ${[...PZ.solved].filter(id => PZ.data.items.some(x => x.id === id)).length} / ${PZ.data.items.length}`;
    $('pzt').className = 'banner me'; $('pzt').innerHTML = `第 ${p.id} 題　${'★'.repeat(p.level)}${'☆'.repeat(5 - p.level)}${PZ.solved.has(p.id) ? '　✅' : ''}<div style="font-size:15px;font-weight:600">${esc(prompt(p))}</div>`;
    $('pzmsg').textContent = '點選你要走的棋子，再點目的地。斬擊與復活會自動選最佳處理。'; $('pztags').innerHTML = ''; $('pzctl').hidden = true;
    pzDraw();
  }
  function pzDraw(extra) {
    const c = PZ.cur, G = c.states ? c.states[c.si] : c.G, hl = {};
    if (!c.states) { if (c.sel) hl[c.sel.x + ',' + c.sel.y] = 'sel'; c.moves.forEach(m => hl[m.x + ',' + m.y] = pieceAtG(G, m.x, m.y) ? 'cap' : 'mv'); }
    else if (c.si > 0 && c.p.l[c.si - 1]) { const [a, b, x, y] = c.p.l[c.si - 1]; hl[a + ',' + b] = 'last'; hl[x + ',' + y] = 'last'; }
    if (extra) Object.assign(hl, extra);
    drawBoard($('pzb'), G, {flip: c.p.side === 'b', hl, click: c.states ? null : pzClick});
  }
  const pieceAtG = (G, x, y) => G.pieces.find(p => p.x === x && p.y === y);
  function pzClick(x, y, q) {
    const c = PZ.cur; if (c.done) return;
    if (c.sel && c.moves.some(m => m.x === x && m.y === y)) {
      const ok = c.p.a.some(a => a[0] === c.sel.x && a[1] === c.sel.y && a[2] === x && a[3] === y);
      if (ok) { c.done = true; PZ.solved.add(c.p.id); saveSolved(); $('pzmsg').innerHTML = `✅ <b>正確！</b>${c.tries ? `（試了 ${c.tries + 1} 次）` : '（一次答對）'}`; $('pztags').innerHTML = (c.p.theme || []).map(t => `<span class="tag">${t}</span>`).join(''); $('pzprog').textContent = `已解 ${PZ.solved.size} / ${PZ.data.items.length}`; solution(); return; }
      c.tries++; c.sel = null; c.moves = []; $('pzmsg').innerHTML = `❌ 這不是最佳著法（已嘗試 ${c.tries} 次）。再想想，或按「提示」。`; pzDraw(); return;
    }
    if (q && q.side === c.p.side) { c.sel = q; c.moves = Rules.moves(c.G, q.id); } else { c.sel = null; c.moves = []; }
    pzDraw();
  }
  function hint() {
    const c = PZ.cur; if (c.done) return; c.hint++; const a = c.p.a[0];
    if (c.hint === 1) { $('pzmsg').innerHTML = `💡 提示：想一想「${(c.p.theme || []).join('、') || '戰術'}」。再按一次會標出要動的棋子。`; }
    else { $('pzmsg').innerHTML = '💡 要動的棋子已標出（黃框）。'; pzDraw({[a[0] + ',' + a[1]]: 'sel'}); }
  }
  function solution() {
    const c = PZ.cur; c.states = playLine(c.G, c.p.l); c.si = 0; $('pzctl').hidden = false;
    $('pzp').onclick = () => go(0); $('pzm').onclick = () => go(c.si - 1); $('pzn').onclick = () => go(c.si + 1);
    $('pzauto').onclick = () => { if (c.auto) { clearInterval(c.auto); c.auto = null; $('pzauto').textContent = '▶ 自動播放'; } else { $('pzauto').textContent = '⏸ 暫停'; c.auto = setInterval(() => { if (c.si >= c.states.length - 1) { clearInterval(c.auto); c.auto = null; $('pzauto').textContent = '▶ 自動播放'; } else go(c.si + 1); }, 1100); } };
    $('pztags').innerHTML = (c.p.theme || []).map(t => `<span class="tag">${t}</span>`).join('');
    go(1);
  }
  function go(i) { const c = PZ.cur; c.si = Math.max(0, Math.min(c.states.length - 1, i)); const G = c.states[c.si];
    $('pzstep').innerHTML = c.si === 0 ? '開局（題目局面）' : `第 ${c.si} 手：${esc((G.hist.filter(h => / →|→/.test(h)).slice(-1)[0]) || '')}${G.over ? '<br><b>' + (G.over === 'draw' ? '和局' : S(G.over) + '獲勝') + '</b>' : ''}`;
    pzDraw(); }

  // ===== 高手對決（回放）=====
  const RP = {data: null, g: null, states: [], i: 0, timer: null, speed: 1100};
  async function openReplays() {
    const host = $('replays'); if (!RP.data) { host.textContent = '載入中…'; try { RP.data = await getJSON('/data/games.json'); } catch (e) { host.textContent = '載入失敗'; return; } }
    host.innerHTML = `<h2>🏆 高手對決</h2><p class="sm">${esc(RP.data.intro || '')}</p><div id="rplist"></div><div id="rpview" hidden></div>`;
    const list = $('rplist');
    RP.data.games.forEach((g, n) => { const c = el('div', 'gcard', `<b>第 ${n + 1} 局　${esc(g.title)}</b><div class="sm">${esc(g.result.text)}　·　${g.moves} 手</div><div>${g.badges.map(b => `<span class="tag">${esc(b)}</span>`).join('')}</div><div class="sm">${esc(g.summary)}</div>`);
      c.onclick = () => openGame(n); list.appendChild(c); });
  }
  function openGame(n) {
    const g = RP.data.games[n]; RP.g = g; clearInterval(RP.timer); RP.timer = null;
    const G = Rules.create(), states = [clone(G)], moveLog = [];
    g.actions.forEach((x, k) => { Rules.play(G, x.s, x.a, 0); states.push(clone(G)); });
    if (g.capped) { Rules.adjudicate(G); states[states.length - 1] = clone(G); }   // 到達步數上限：最後一步之後依分數判定
    RP.states = states; RP.i = 0;
    $('rplist').hidden = true; const v = $('rpview'); v.hidden = false;
    v.innerHTML = `<div class="bar"><button id="rpback">← 回對局列表</button><b>${esc(g.title)}</b></div>
      <div class="row"><div id="rpb"></div><div class="side"><div id="rpt" class="banner"></div>
        <div class="bar"><button id="rp0">⏮</button><button id="rpm">◀ 上一手</button><button id="rpplay">▶ 播放</button><button id="rpn">下一手 ▶</button><button id="rpe">⏭</button></div>
        <div class="bar"><input id="rpsl" type="range" min="0" max="${states.length - 1}" value="0" style="flex:1;margin:0"><select id="rpsp"><option value="1900">慢</option><option value="1100" selected>中</option><option value="500">快</option></select></div>
        <div id="rpnote" class="note"></div><svg id="rpchart" viewBox="0 0 300 70" width="100%"></svg><div class="sm">子力分差曲線（上＝白方領先，下＝黑方領先），紅線是目前這一手</div></div></div>
      <h3>棋譜</h3><div id="rplog"></div>`;
    $('rpback').onclick = () => { stopPlay(); $('rpview').hidden = true; $('rplist').hidden = false; };
    $('rp0').onclick = () => rgo(0); $('rpm').onclick = () => { stopPlay(); rgo(RP.i - 1); }; $('rpn').onclick = () => { stopPlay(); rgo(RP.i + 1); }; $('rpe').onclick = () => { stopPlay(); rgo(RP.states.length - 1); };
    $('rpsl').oninput = e => { stopPlay(); rgo(+e.target.value); }; $('rpsp').onchange = e => { RP.speed = +e.target.value; if (RP.timer) { stopPlay(); startPlay(); } };
    $('rpplay').onclick = () => RP.timer ? stopPlay() : startPlay();
    const log = $('rplog'); log.innerHTML = '';
    g.actions.forEach((x, k) => { if (x.a.t !== 'move' && !(g.notes[k] || []).length) return; const t = (g.notes[k] || [])[0] || `${S(x.s)}：${x.a.t}`;
      const d = el('div', 'lg', `<span class="sm">${k + 1}.</span> ${esc(t)}`); d.dataset.i = k + 1; d.onclick = () => { stopPlay(); rgo(k + 1); }; log.appendChild(d); });
    rgo(0);
  }
  function startPlay() { if (RP.i >= RP.states.length - 1) rgo(0); $('rpplay').textContent = '⏸ 暫停'; RP.timer = setInterval(() => { if (RP.i >= RP.states.length - 1) stopPlay(); else rgo(RP.i + 1); }, RP.speed); }
  function stopPlay() { clearInterval(RP.timer); RP.timer = null; const b = $('rpplay'); if (b) b.textContent = '▶ 播放'; }
  function rgo(i) {
    i = Math.max(0, Math.min(RP.states.length - 1, i)); RP.i = i; const G = RP.states[i], g = RP.g, hl = {};
    if (i > 0) { const a = g.actions[i - 1].a; const prev = RP.states[i - 1];
      if (a.t === 'move') { const p0 = prev.pieces.find(p => p.id === a.pid); if (p0) hl[p0.x + ',' + p0.y] = 'last'; hl[a.x + ',' + a.y] = 'last'; } else if (a.t === 'place') hl[a.x + ',' + a.y] = 'last'; }
    drawBoard($('rpb'), G, {hl});
    const who = i === 0 ? '開局' : `第 ${i} 手　${S(g.actions[i - 1].s)}`;
    $('rpt').className = 'banner'; $('rpt').innerHTML = G.over && i === RP.states.length - 1 ? `${who}<div style="font-size:15px">${esc(g.result.text)}</div>` : `${who}<div style="font-size:15px">${G.over ? '' : '輪到：' + S(G.phase ? G.phase.side : G.turn)}</div>`;
    $('rpnote').innerHTML = i === 0 ? '按「▶ 播放」開始，或用「◀ ▶」逐手觀看。快捷鍵：← → 換手、空白鍵 播放／暫停。' : (g.notes[i - 1] || []).map(t => `<div>${esc(t)}</div>`).join('');
    $('rpsl').value = i;
    $$('#rplog .lg').forEach(d => d.classList.toggle('on', +d.dataset.i === i)); const on = $$('#rplog .lg.on')[0]; if (on) on.scrollIntoView({block: 'nearest'});
    // 子力曲線
    const mat = g.mat, W = 300, H = 70, mx = Math.max(10, ...mat.map(Math.abs)), X = k => 4 + k * (W - 8) / Math.max(1, mat.length - 1), Y = v => H / 2 - v / mx * (H / 2 - 4);
    $('rpchart').innerHTML = `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="currentColor" opacity=".3"/><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${mat.map((v, k) => X(k) + ',' + Y(v)).join(' ')}"/><line x1="${X(Math.max(0, i - 1))}" y1="0" x2="${X(Math.max(0, i - 1))}" y2="${H}" stroke="#c0392b" stroke-width="1.5"/>`;
  }
  document.addEventListener('keydown', e => { if ($('replays').hidden || $('rpview').hidden || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { stopPlay(); rgo(RP.i + 1); } else if (e.key === 'ArrowLeft') { stopPlay(); rgo(RP.i - 1); } else if (e.key === ' ') { e.preventDefault(); RP.timer ? stopPlay() : startPlay(); } });

  // ===== 教學 =====
  const LS = {data: null, sub: 'basic', piece: 'king'};
  const LESSONS = {
    king:  {t:'王', d:['往八個方向各走 1 格，可以吃子。', '王被吃掉就輸了；沒有「將軍必須化解」的限制，王可以走進被攻擊的格子，但那通常就是輸棋。', '分數表裡王是 0 分，只靠它活著才不會直接輸。']},
    dong:  {t:'咚咚咚咚咚將軍（咚）', d:['上下左右各走 1 格，可以吃子。', '<b>斬擊</b>：往前、往左或往右走一步之後，如果「落腳點正前方一格」有敵方棋子（不能是咚），可以選擇斬殺它。往後走不能斬。', '斬擊殺掉的棋子如果是孩子多或 OL，對方可以復活；如果是孩，還會觸發「死亡連鎖」。', '剛復活的咚可以走，但這一手不能吃棋，也不能斬擊。', '價值 10 分，是最值錢的棋子。']},
    ol:    {t:'OL', d:['上下左右各 1 格，以及上下左右各跳 2 格（可以跳過中間的棋子）。', '特別規則：OL 可以吃「己方的龍」，吃完之後 OL 轉化為 OTL（走法改變）。', 'OL 被殺時，OL 的主人可以復活一顆棋子。價值 8 分。']},
    otl:   {t:'OTL（OL 轉化後）', d:['沿著「蛇形」路線往前：左前 1 格 → 正前 2 格 → 右前 3 格，或右前 1 格 → 正前 2 格 → 左前 3 格，路上每一格都可以停。', '路上被己方擋住就停止；碰到敵人可以吃，吃了就停。', '被殺時不會觸發復活。價值 3 分。']},
    kid:   {t:'孩子多（孩）', d:['上下左右直線移動，格數不限，不能越過棋子，遇到敵人可以吃並停下。', '<b>死亡連鎖</b>：孩被殺時，它周圍 3×3 範圍內的「己方量產型戰士」各自發出白光，消滅正前方 5 格內的所有棋子（敵我皆消滅，包含王）。', '孩被殺時，孩的主人還可以復活一顆棋子。價值 8 分。']},
    tea:   {t:'抹茶小紅豆（茶）', d:['斜角走 1 格或 2 格（2 格是跳躍，可以越過中間的棋子）。', '被殺後可以復活，復活後變成「謎之美少女」。價值 7 分。']},
    godness:{t:'謎之美少女（謎）', d:['茶復活後的型態：斜角 1 格，以及上下左右跳 2 格。價值 3 分。']},
    night: {t:'夜王（夜）', d:['八個方向直線移動，格數不限，不能越過棋子，<b>而且不能吃子</b>，只能走到空格。', '<b>冰凍</b>：如果敵方夜王周圍 3×3 範圍內（不含夜王本身）只有「你的一顆棋子」，那顆棋子被冰凍，不能移動（王不受影響）。', '價值 5 分。']},
    iron:  {t:'熨斗（熨）', d:['往前（朝敵方）直線前進，格數不限，不能越過棋子，遇到敵人可吃並停下。', '往後、往左、往右各只能走 1 格。價值 3 分。']},
    shoe:  {t:'鞋子（鞋）', d:['跳到「距離 2」的八個格子：上下左右 2 格，以及四個斜角 (2,2)，可以越過中間的棋子。價值 3 分。']},
    guard: {t:'量產型戰士（士）', d:['往前三個方向（左前、正前、右前）各 1 格，往後只能走左後、右後兩個斜角各 1 格。', '孩死亡連鎖的「白光」是它發出的。龍走進敵方底部兩排時，如果己方士不到 2 顆，龍會轉生成士。價值 3 分。']},
    t:     {t:'龍（Tequila）', d:['上下左右各走 1 格，可以吃子。', '<b>轉生</b>：龍（不是吃子的那一步）走進敵方最前面兩排，而且己方量產型戰士不到 2 顆，就轉生為量產型戰士。', '價值 2 分，最便宜，但很重要：它是你的先頭部隊與轉生來源。']}
  };
  const ORDER = ['king','dong','ol','kid','tea','night','iron','shoe','guard','t','otl','godness'];
  const BASIC = `
  <h3>1. 目標</h3><p>吃掉對方的王就贏。棋盤是 9×9，雙方各 18 顆棋子；沒有「將軍必須化解」「不能送王」「將死」這些限制，王受到威脅時畫面只會提示。你也可以隨時按「投降」。</p>
  <h3>2. 開局擺法</h3><div id="lsboard"></div><p class="sm">白方在下（第 1、2 排），黑方是旋轉 180° 的鏡像。第 1 排由左至右：鞋、熨、孩、OL、王、茶、夜、熨、鞋；第 2 排：龍、龍、士、龍、咚、龍、士、龍、龍。白方先走。</p>
  <h3>3. 回合與棋鐘</h3><ul><li>每手有 8 秒，用完才開始扣你的「自由時間」（一開始 301 秒）。自由時間燒完，遊戲就結束。</li><li>雙方棋子（含王）都只剩 7 顆以下時，每手縮為 3 秒。</li><li>時間到之後算分，分高者勝，同分和局：剩餘棋子點數＋沒燒完自由時間的人加 10 分。<br>點數：咚 10；OL、孩 8；茶 7；夜 5；龍 2；王 0；其餘（熨、鞋、士、OTL、謎）各 3。</li></ul>
  <h3>4. 吃子與特殊機制</h3><ul>
   <li><b>吃子</b>：走到敵方棋子的格子就吃掉它（夜王不能吃子）。</li>
   <li><b>咚的斬擊</b>：往前或往左右走一步後，可以斬殺落腳點正前方一格的敵人（見「棋子走法」）。</li>
   <li><b>孩的死亡連鎖</b>：孩被殺，旁邊的己方士會對正前方 5 格發出白光，敵我通殺。</li>
   <li><b>復活</b>：孩或 OL 被殺時，主人可以選一顆棋子復活到任一空格。可復活：龍（場上少於 6 顆）、士（少於 2 顆）、熨（少於 2）、鞋（少於 2）、夜王、咚、茶（場上沒有茶／謎時；復活後是謎）。孩、OL、王不能復活。剛復活的棋子，在它那一方下一手不能吃棋；剛復活的咚也不能斬擊。</li>
   <li><b>龍的轉生</b>：龍走進敵方最前面兩排，且己方士不到 2 顆時，轉生為士。</li>
   <li><b>OL 吃龍</b>：OL 可以吃己方的龍，變成 OTL。</li>
   <li><b>夜王的冰凍</b>：敵方夜王周圍 3×3 只剩你的一顆棋子時，那顆棋子不能動。</li></ul>
  <h3>5. 重複局面（禁止著法）</h3><p>同一個局面（同一方要走）出現第 3 次時裁決，看「上一次出現到現在」那一圈裡，雙方每一手是否都帶著同一種威脅：</p><ul><li><b>長將</b>：每一手都能吃對方的王。<b>長殺</b>：每一手都能一次消滅 2 子以上（咚斬擊、孩連鎖）。<b>長捉</b>：每一手都能吃同一顆有價值的子（目標比攻擊者值錢，或吃完不會被回吃）。</li><li>只有一方違規：違規方必須變著，不變就判負。雙方都違規或都沒違規：和局。</li></ul>
  <h3>6. 其他</h3><ul><li>一方無棋可走：跳過該方回合；雙方都無棋可走：依分數判定。</li><li>大廳有四間固定的 AI 練習室：初階、中等、進階、超高階；每間一次一位玩家，進房後隨機分配黑白。</li><li>本頁的「題庫」可以練習殘局，「高手對決」可以觀摩超高階 AI 的精彩對局。</li></ul>`;
  async function openLearn() {
    const host = $('learn');
    if (!LS.data) { try { LS.data = await getJSON('/data/learn.json'); } catch (e) { LS.data = {}; } }
    host.innerHTML = `<h2>📚 教學</h2><div class="bar"><button data-s="basic">基本玩法</button><button data-s="pieces">棋子走法</button><button data-s="tactics">戰術規律與公式</button></div><div id="lsbody"></div>`;
    $$('#learn [data-s]').forEach(b => { b.classList.toggle('on', b.dataset.s === LS.sub); b.onclick = () => { LS.sub = b.dataset.s; openLearn(); }; });
    const body = $('lsbody');
    if (LS.sub === 'basic') { body.innerHTML = BASIC; drawBoard($('lsboard'), Rules.create(), {sm: true}); }
    else if (LS.sub === 'pieces') {
      body.innerHTML = `<div class="bar" id="lspick"></div><div class="row"><div id="lspb"></div><div class="side" id="lspd"></div></div>`;
      ORDER.forEach(t => { const b = el('button', LS.piece === t ? 'on' : '', LESSONS[t].t.split('（')[0]); b.onclick = () => { LS.piece = t; openLearn(); }; $('lspick').appendChild(b); });
      const t = LS.piece, G = Rules.custom(t === 'king' ? [['king','w',4,5],['king','b',4,0]] : [['king','w',4,8],['king','b',4,0],[t,'w',4,5]], 'w'), id = G.pieces.find(p => p.type === t && p.side === 'w').id, hl = {'4,5': 'sel'};
      if (t === 'guard' || t === 'iron' || t === 'otl') {}
      Rules.moves(G, id).forEach(m => hl[m.x + ',' + m.y] = 'mv');
      drawBoard($('lspb'), G, {hl, sm: true});
      $('lspd').innerHTML = `<h3>${esc(LESSONS[t].t)}</h3>` + (TYPES[t].tags || []).map(x => `<span class="tag">${esc(x)}</span>`).join('') + LESSONS[t].d.map(x => `<p>${x}</p>`).join('') + `<p class="sm">圖：白方的${esc(TYPES[t].label)}站在 e4，黃點是可以走到的格子（白方往上走；黑方相反）。</p>`;
    } else { renderTactics(body); }
  }
  function renderTactics(body) {
    const d = LS.data; if (!d.patterns) { body.textContent = '（戰術資料尚未產生）'; return; }
    body.innerHTML = `<p class="sm">${esc(d.intro || '')}</p>` + d.patterns.map(p => `<div class="gcard"><b>${esc(p.title)}</b>${p.kind ? ` <span class="tag">${esc(p.kind)}</span>` : ''}<p>${p.text}</p>${p.formula ? `<p><code>${esc(p.formula)}</code></p>` : ''}${p.evidence ? `<p class="sm">📊 ${esc(p.evidence)}</p>` : ''}</div>`).join('') + (d.tables || []).map(t => `<h3>${esc(t.title)}</h3><div style="overflow-x:auto"><table><tr>${t.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div><p class="sm">${esc(t.note || '')}</p>`).join('');
  }
  window.Learn = {open(t) { if (t === 'puzzles') openPuzzles(); else if (t === 'replays') openReplays(); else if (t === 'learn') openLearn(); }};
})();
