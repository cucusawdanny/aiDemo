'use strict';
// AI 在獨立執行緒裡思考，不會卡住伺服器處理其他玩家（超高階最多思考數秒）
const {parentPort} = require('worker_threads'), AI = require('./ai.js');
parentPort.on('message', m => {
  let list = []; try { list = AI.chooseActions(m.G, m.side, m.level, {budgetMs: m.budget}); } catch (e) { console.error('AI 錯誤', e); }
  parentPort.postMessage({id: m.id, list});
});
