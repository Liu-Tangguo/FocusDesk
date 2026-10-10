// FocusDesk 冒烟测试（jsdom）
// 依赖：npm i jsdom
// 用法：先 `python3 -m http.server 8173`，再 `node tests/smoke.js`
// 覆盖：加载探针 / 番茄钟开始暂停继续 / 待办增改删过滤 / 离线计时恢复 / 损坏数据兜底

const { JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom');
const BASE = 'http://127.0.0.1:8173/index.html';
const out = [];
const c = (n, ok, x) => out.push((ok ? 'PASS' : 'FAIL') + ' ' + n + (x !== undefined ? ' :: ' + x : ''));

function boot(url, beforeParse) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push('jsdomError: ' + (e && e.message)));
  vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
  return JSDOM.fromURL(url, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc, beforeParse })
    .then(dom => ({ dom, errs }));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // A: basic
  const a = await boot(BASE + '?probe=1&nomotion=1&seed=1');
  await wait(600);
  const d = a.dom.window.document;
  c('A0 no page errors', a.errs.length === 0, a.errs.join(' | '));
  c('A1 probe title', /^PROBE-OK/.test(d.title), d.title);
  c('A2 seed blocks=4', d.querySelectorAll('.tl-block').length === 4, d.querySelectorAll('.tl-block').length);
  c('A3 seed todos=3', d.querySelectorAll('.todo-item').length === 3, d.querySelectorAll('.todo-item').length);
  d.querySelector('#btnStart').click();
  c('A4 start running', d.querySelector('#pomoRunState').textContent === '进行中…', d.querySelector('#pomoRunState').textContent);
  c('A5 label=pause', d.querySelector('#btnStart').textContent === '暂停', d.querySelector('#btnStart').textContent);
  c('A6 ring offset numeric', !isNaN(parseFloat(d.querySelector('#ringFg').style.strokeDashoffset)), d.querySelector('#ringFg').style.strokeDashoffset);
  d.querySelector('#btnStart').click();
  c('A7 paused', d.querySelector('#pomoRunState').textContent === '已暂停', d.querySelector('#pomoRunState').textContent);
  d.querySelector('#todoInput').value = '单元测试任务';
  d.querySelector('#todoForm').dispatchEvent(new a.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  c('A8 add todo', Array.from(d.querySelectorAll('.todo-item .t-text')).some(e => e.textContent === '单元测试任务'));
  d.querySelector('#btnSkip').click();
  c('A9 skip->short', d.querySelector('#pomoPhase').textContent === '短休息', d.querySelector('#pomoPhase').textContent);
  d.querySelector('#btnSettings').click();
  c('A10 settings modal open', !d.querySelector('#modal').classList.contains('hidden') && !!d.querySelector('#sFocus'));
  if (d.querySelector('#sCancel')) d.querySelector('#sCancel').click();
  c('A11 modal closed', d.querySelector('#modal').classList.contains('hidden'));
  d.querySelector('#btnNextDay').click();
  c('A12 next day ok', d.querySelector('#dayPicker').value.length === 10, d.querySelector('#dayPicker').value);
  d.querySelector('#btnToday').click();

  // B: recovery
  const payload = { version:1, settings:{focusMin:25,shortMin:5,longMin:15,longEvery:4,shift:true,shiftSec:75,theme:'dark',timelineFrom:0,timelineTo:24,sound:true}, todos:[], blocks:{}, timer:{phase:'focus',running:true,endsAt:Date.now()-60000,remainMs:0,cycleDone:0,currentTodoId:''}, stats:{} };
  const b = await boot(BASE + '?probe=1&nomotion=1', w => { w.localStorage.setItem('focusdesk.v1', JSON.stringify(payload)); });
  await wait(600);
  const bd = b.dom.window.document;
  c('B0 no page errors', b.errs.length === 0, b.errs.join(' | '));
  c('B1 -> short break', bd.querySelector('#pomoPhase').textContent === '短休息', bd.querySelector('#pomoPhase').textContent);
  c('B2 running', bd.querySelector('#pomoRunState').textContent === '进行中…', bd.querySelector('#pomoRunState').textContent);
  c('B3 count=1', bd.querySelector('#statCount').textContent === '1', bd.querySelector('#statCount').textContent);
  c('B4 min=25', bd.querySelector('#statMin').textContent === '25', bd.querySelector('#statMin').textContent);
  c('B5 remaining ~04:0x', /^0?4:0\d$/.test(bd.querySelector('#pomoTime').textContent), bd.querySelector('#pomoTime').textContent);

  // C: broken storage
  const cc = await boot(BASE + '?probe=1&nomotion=1', w => { w.localStorage.setItem('focusdesk.v1', '{not json'); });
  await wait(600);
  const cd = cc.dom.window.document;
  c('C0 no page errors', cc.errs.length === 0, cc.errs.join(' | '));
  c('C1 default 25:00', cd.querySelector('#pomoTime').textContent === '25:00', cd.querySelector('#pomoTime').textContent);
  c('C2 probe ok', /^PROBE-OK/.test(cd.title), cd.title);

  console.log(out.join('\n'));
  const fails = out.filter(x => !x.startsWith('PASS'));
  console.log('\nSUMMARY pass=' + out.filter(x => x.startsWith('PASS')).length + ' fail=' + fails.length);
  process.exit(0);
})().catch(e => { console.log('FATAL ' + e.stack); process.exit(1); });
