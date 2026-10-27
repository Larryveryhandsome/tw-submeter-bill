// 執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../js/bill.js');

const root = path.join(__dirname, '..');
const csv = fs.readFileSync(path.join(root, 'data', 'readings.example.csv'), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(path.join(root, 'data', 'sample.js'), 'utf8'), ctx);
const CFG = ctx.window.BILL_CONFIG;
const DATA = JSON.parse(JSON.stringify(ctx.window.SAMPLE_DATA));

// 小工具：快速組房間與期別
const rooms = n => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, floor: '1F', room: 'R' + i, meterId: 'M' + i, tenant: '示範房客' + i, active: true }));
const period = (pairs, bill) => ({
  id: 'p', readings: Object.fromEntries(pairs.map((p, i) => ['r' + i, Array.isArray(p) ? { prev: p[0], curr: p[1] } : p])),
  bill: bill || {},
});
const amounts = res => res.lines.map(l => l.amount);
const sum = a => a.reduce((s, x) => s + x, 0);

test('範本 CSV 和網頁內建示範資料一模一樣', () => {
  assert.equal(ctx.window.SAMPLE_READINGS_CSV.replace(/^﻿/, ''), csv.replace(/^﻿/, ''));
});

test('設定檔欄位和範本 CSV 表頭對得上、預設值合法', () => {
  const head = B.parseCSV(csv)[0];
  for (const k of ['meterId', 'prev', 'curr', 'oldFinal', 'newStart', 'note']) assert.ok(head.includes(CFG.fields[k]), k);
  assert.ok(['fixed', 'ratio'].includes(CFG.mode));
  assert.ok(['equal', 'usage', 'landlord'].includes(CFG.commonMode));
  assert.ok(['last', 'landlord'].includes(CFG.remainder));
});

test('示範資料：把範本 CSV 匯入「從第 1 期帶過來的新一期」，結果和第 2 期一樣', () => {
  const p = B.carryForward(DATA.rooms, DATA.periods[0], { id: 'x' });
  const { period: got, count, unmatched } = B.applyReadingsCSV(DATA.rooms, p, csv, CFG.fields);
  assert.equal(count, 5);
  assert.deepEqual(unmatched, []);
  for (const r of DATA.rooms) assert.deepEqual(got.readings[r.id], DATA.periods[1].readings[r.id], r.id);
});

test('示範資料第 2 期：合計剛好等於台電帳單、換表與暴增都有提醒', () => {
  const res = B.computePeriod({ rooms: DATA.rooms, period: DATA.periods[1], prevPeriod: DATA.periods[0], settings: CFG });
  assert.equal(res.lines.length, 4, '空房不列入');
  assert.equal(res.totals.sumUsage, 650);
  assert.equal(res.totals.commonKwh, 70);
  assert.equal(res.totals.billed, 3500);
  assert.equal(res.totals.landlordBears, 0);
  const codes = res.lines.flatMap(l => l.warnings.map(w => w.code));
  assert.ok(codes.includes('replaced'));
  assert.ok(codes.includes('spike'));
});

test('數字解析：空白、千分位、全形、亂打', () => {
  assert.equal(B.num(''), null);
  assert.equal(B.num(null), null);
  assert.equal(B.num('1,234'), 1234);
  assert.equal(B.num('１２３．５'), 123.5);
  assert.equal(B.num('abc'), null);
  assert.equal(B.num(0), 0);
});

test('用電度數：一般、缺值、負數', () => {
  assert.deepEqual(B.usageOf({ prev: 100, curr: 160 }), { usage: 60, status: 'ok', detail: '' });
  assert.equal(B.usageOf({ prev: 100, curr: '' }).status, 'missing');
  assert.equal(B.usageOf({ prev: '', curr: 50 }).status, 'missing');
  const neg = B.usageOf({ prev: 100, curr: 90 });
  assert.equal(neg.status, 'negative');
  assert.equal(neg.usage, -10);
  assert.equal(B.usageOf({ prev: 10.1, curr: 10.3 }).usage, 0.2, '小數不要有浮點誤差');
});

test('換表：(舊表最後 − 上期) + (本期 − 新表起始)；缺值或倒退要擋', () => {
  assert.equal(B.usageOf({ prev: 9950, curr: 30, replaced: true, oldFinal: 9990, newStart: 0 }).usage, 70);
  assert.equal(B.usageOf({ prev: 9950, curr: 30, replaced: true, oldFinal: '', newStart: 0 }).status, 'missing');
  assert.equal(B.usageOf({ prev: 9950, curr: 30, replaced: true, oldFinal: 9900, newStart: 0 }).status, 'negative');
  assert.equal(B.usageOf({ prev: 100, curr: 5, replaced: true, oldFinal: 120, newStart: 10 }).status, 'negative');
});

test('固定每度單價：度數 × 單價，沒有帳單也能算', () => {
  const res = B.computePeriod({ rooms: rooms(3), period: period([[0, 100], [0, 55], [0, 0]]), settings: { mode: 'fixed', unitPrice: 5 } });
  assert.deepEqual(amounts(res), [500, 275, 0]);
  assert.equal(res.totals.commonKwh, null);
  assert.deepEqual(res.warnings, []);
});

test('固定單價＋有台電總度數：公共用電也照單價分攤', () => {
  const res = B.computePeriod({ rooms: rooms(2), period: period([[0, 100], [0, 50]], { kwh: 170 }), settings: { mode: 'fixed', unitPrice: 4, commonMode: 'equal' } });
  assert.deepEqual(res.lines.map(l => l.commonKwh), [10, 10]);
  assert.deepEqual(amounts(res), [440, 240]);
});

test('依帳單比例＋公共平均分（README 的例子）', () => {
  const res = B.computePeriod({
    rooms: rooms(4),
    period: period([[0, 120], [0, 90], [0, 150], [0, 60]], { amount: 2400, kwh: 480 }),
    settings: { mode: 'ratio', commonMode: 'equal' },
  });
  assert.equal(res.totals.rate, 5);
  assert.equal(res.totals.commonKwh, 60);
  assert.deepEqual(amounts(res), [675, 525, 825, 375]);
  assert.equal(res.totals.landlordBears, 0);
});

test('依帳單比例＋公共依用電比例＝每間就是 用電/分表合計 × 帳單', () => {
  const res = B.computePeriod({
    rooms: rooms(3),
    period: period([[0, 100], [0, 200], [0, 100]], { amount: 2000, kwh: 500 }),
    settings: { mode: 'ratio', commonMode: 'usage' },
  });
  assert.deepEqual(res.lines.map(l => l.commonKwh), [25, 50, 25]);
  assert.deepEqual(amounts(res), [500, 1000, 500]);
});

test('依帳單比例＋公共房東負擔：房客只付自己度數，差額算房東的', () => {
  const res = B.computePeriod({
    rooms: rooms(2),
    period: period([[0, 100], [0, 100]], { amount: 1250, kwh: 250 }),
    settings: { mode: 'ratio', commonMode: 'landlord' },
  });
  assert.deepEqual(amounts(res), [500, 500]);
  assert.equal(res.totals.landlordKwh, 50);
  assert.equal(res.totals.landlordBears, 250);
});

test('取整差額「加到最後一間」：合計剛好等於帳單', () => {
  // 1000 元分 3 間，每間 333.33 → 333、333、334
  const res = B.computePeriod({
    rooms: rooms(3),
    period: period([[0, 10], [0, 10], [0, 10]], { amount: 1000, kwh: 30 }),
    settings: { mode: 'ratio', rounding: 'round', remainder: 'last' },
  });
  assert.deepEqual(amounts(res), [333, 333, 334]);
  assert.equal(sum(amounts(res)), 1000);
  assert.ok(res.lines[2].warnings.some(w => w.code === 'remainder'));
});

test('取整差額「房東吸收」：各自四捨五入，差額記在房東', () => {
  const res = B.computePeriod({
    rooms: rooms(3),
    period: period([[0, 10], [0, 10], [0, 10]], { amount: 1000, kwh: 30 }),
    settings: { mode: 'ratio', rounding: 'round', remainder: 'landlord' },
  });
  assert.deepEqual(amounts(res), [333, 333, 333]);
  assert.equal(res.totals.roundingDiff, 1);
  assert.equal(res.totals.landlordBears, 1);
});

test('其他取整方式：無條件進位／捨去／不取整，2.5 元要進成 3', () => {
  const p = period([[0, 1], [0, 2]]);
  const run = rounding => amounts(B.computePeriod({ rooms: rooms(2), period: p, settings: { mode: 'fixed', unitPrice: 2.35, rounding, remainder: 'landlord' } }));
  assert.deepEqual(run('ceil'), [3, 5]);
  assert.deepEqual(run('floor'), [2, 4]);
  assert.deepEqual(run('none'), [2.35, 4.7]);
  assert.equal(B.roundMoney(2.5, 'round'), 3);
  assert.equal(B.roundMoney(2.4999999999, 'round'), 3, '浮點誤差先修掉');
});

test('最低收費：用電太少的房間以最低收費計並提醒', () => {
  const res = B.computePeriod({ rooms: rooms(2), period: period([[0, 3], [0, 100]]), settings: { mode: 'fixed', unitPrice: 5, minCharge: 50 } });
  assert.deepEqual(amounts(res), [50, 500]);
  assert.ok(res.lines[0].warnings.some(w => w.code === 'minCharge'));
});

test('異常提醒：負數、缺度數不收費也不參與分攤；暴增依倍數設定', () => {
  const rs = rooms(3);
  const prev = period([[0, 50], [0, 50], [0, 50]]);
  const cur = period([[50, 40], [50, ''], [50, 170]], { amount: 1000, kwh: 200 });
  const res = B.computePeriod({ rooms: rs, period: cur, prevPeriod: prev, settings: { mode: 'ratio', commonMode: 'equal', spikeFactor: 2 } });
  assert.equal(res.lines[0].warnings[0].code, 'negative');
  assert.equal(res.lines[1].warnings[0].code, 'missing');
  assert.deepEqual(amounts(res).slice(0, 2), [0, 0]);
  assert.ok(res.lines[2].warnings.some(w => w.code === 'spike'));
  assert.equal(res.totals.commonKwh, 80, '只扣有效房間');
  assert.ok(res.warnings.some(w => w.code === 'commonIncomplete'));
  // 倍數調高就不提醒
  const calm = B.computePeriod({ rooms: rs, period: cur, prevPeriod: prev, settings: { spikeFactor: 3 } });
  assert.ok(!calm.lines[2].warnings.some(w => w.code === 'spike'));
});

test('分表合計比台電總度數多：公共用電視為 0 並提醒；比例模式缺帳單要提醒', () => {
  const res = B.computePeriod({ rooms: rooms(2), period: period([[0, 100], [0, 100]], { amount: 900, kwh: 180 }), settings: { mode: 'ratio' } });
  assert.equal(res.totals.commonKwh, 0);
  assert.ok(res.warnings.some(w => w.code === 'commonNegative'));
  const nb = B.computePeriod({ rooms: rooms(1), period: period([[0, 10]]), settings: { mode: 'ratio' } });
  assert.ok(nb.warnings.some(w => w.code === 'noBill'));
  assert.deepEqual(amounts(nb), [0]);
});

test('停用的房間不計算', () => {
  const rs = rooms(2); rs[1].active = false;
  const res = B.computePeriod({ rooms: rs, period: period([[0, 10], [0, 999]], { amount: 100, kwh: 20 }), settings: { mode: 'ratio', commonMode: 'equal' } });
  assert.equal(res.lines.length, 1);
  assert.equal(res.lines[0].amount, 100);
});

test('開新一期：上期「本期度數」帶成這期「上期度數」，起日接上期迄日', () => {
  const p = B.carryForward(DATA.rooms, DATA.periods[1], { id: 'p3' });
  assert.equal(p.startDate, '2026-05-05');
  assert.equal(p.readings.r1.prev, 1330);
  assert.equal(p.readings.r3.prev, 90, '換表後帶新表度數');
  assert.equal(p.readings.r1.curr, '');
  assert.equal(B.carryForward([{ id: 'n' }], null).readings.n.prev, '');
});

test('CSV：逗號、引號、換行來回不走樣；BOM 開頭', () => {
  const rows = [['a', 'b,c', '他說"好"'], ['多\n行', '', '3']];
  const text = B.toCSV(rows, true);
  assert.ok(text.startsWith('﻿'));
  assert.deepEqual(B.parseCSV(text), rows);
  assert.deepEqual(B.loadCSV('甲,乙\r\n1,2\r\n'), [{ 甲: '1', 乙: '2' }]);
});

test('匯入抄表 CSV：找不到的電表列出來；沒有電表編號欄就用房號；上期空白保留原值', () => {
  const rs = rooms(2);
  const base = period([[100, ''], [200, '']]);
  const a = B.applyReadingsCSV(rs, base, '電表編號,本期度數\r\nM0,150\r\nX9,1\r\n');
  assert.deepEqual(a.unmatched, ['X9']);
  assert.equal(a.period.readings.r0.curr, 150);
  assert.equal(a.period.readings.r0.prev, 100);
  assert.equal(base.readings.r0.curr, '', '不改原物件');
  const b = B.applyReadingsCSV(rs, base, '房號,上期度數,本期度數\r\nR1,,260\r\n');
  assert.equal(b.period.readings.r1.prev, 200);
  assert.equal(b.period.readings.r1.curr, 260);
});

test('匯出摘要列：表頭＋每間＋合計，金額和計算結果一致，再讀回來欄數一致', () => {
  const res = B.computePeriod({ rooms: DATA.rooms, period: DATA.periods[1], prevPeriod: DATA.periods[0], settings: CFG });
  const rows = B.summaryRows(res, DATA.periods[1]);
  assert.equal(rows.length, 1 + res.lines.length + 1);
  assert.equal(rows[rows.length - 1][11], 3500);
  const back = B.parseCSV(B.toCSV(rows, true));
  assert.equal(back.length, rows.length);
  assert.ok(back.every(r => r.length === rows[0].length));
});

test('備份檢查：正常檔通過，缺欄位丟錯', () => {
  const ok = B.validateBackup(DATA);
  assert.equal(ok.current, 'p2');
  assert.throws(() => B.validateBackup({ rooms: [] }), /periods/);
  assert.throws(() => B.validateBackup('x'));
  assert.throws(() => B.validateBackup({ rooms: [{}], periods: [] }), /id/);
});

test('抄表期間文字：迄日或起日沒填時不出現問號，並提醒補填本次抄表日', () => {
  assert.equal(B.dateRangeText('2026-03-05', '2026-05-05'), '2026-03-05 ～ 2026-05-05');
  assert.equal(B.dateRangeText('2026-03-05', ''), '2026-03-05 起（本次抄表日未填）');
  assert.equal(B.dateRangeText('', '2026-05-05'), '至 2026-05-05（上次抄表日未填）');
  assert.equal(B.dateRangeText('', ''), '');
  for (const s of [B.dateRangeText('2026-03-05', ''), B.dateRangeText('', '2026-05-05')]) assert.ok(!s.includes('?'));
  const rooms = [{ id: 'a', room: 'A', meterId: 'M1', active: true }];
  const mk = endDate => B.computePeriod({ rooms, settings: {}, period: { startDate: '2026-03-05', endDate, readings: { a: { prev: 0, curr: 10 } }, bill: {} } });
  assert.ok(mk('').warnings.some(w => w.code === 'noEndDate'));
  assert.ok(!mk('2026-05-05').warnings.some(w => w.code === 'noEndDate'));
});

// ---------- 擴展性／漏洞檢視後補的測試 ----------
test('性質測試：任何取整／公共／模式，合計都等於帳單，且沒有負的應繳金額', () => {
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let it = 0; it < 1500; it++) {
    const n = 1 + Math.floor(rnd() * 30), rs = [], rd = {}; let total = 0;
    for (let i = 0; i < n; i++) {
      rs.push({ id: 'r' + i, room: 'R' + i, active: true });
      const prev = Math.floor(rnd() * 5000), u = Math.round(rnd() * rnd() * 6000) / 10;
      rd['r' + i] = { prev, curr: Math.round((prev + u) * 10) / 10 }; total += u;
    }
    const kwh = Math.round((total + rnd() * 200) * 10) / 10, amount = Math.round(rnd() * 5000000) / 100;
    for (const rounding of ['round', 'ceil', 'floor', 'none']) for (const commonMode of ['equal', 'usage']) {
      const r = B.computePeriod({ rooms: rs, period: { readings: rd, bill: { amount, kwh } }, settings: { mode: 'ratio', commonMode, rounding, remainder: 'last' } });
      assert.ok(Math.abs(r.totals.billed - amount) <= (rounding === 'none' ? 0.005 : 0.5) + 1e-9, `${rounding}/${commonMode} 合計 ${r.totals.billed} ≠ ${amount}`);
      assert.ok(r.lines.every(l => l.amount >= 0), `${rounding}/${commonMode} 出現負數`);
    }
  }
});

test('不取整（小數 2 位）三間平分 100 元：合計仍是 100.00', () => {
  const rs = [1, 2, 3].map(i => ({ id: 'r' + i, room: 'R' + i, active: true }));
  const r = B.computePeriod({ rooms: rs, period: { readings: { r1: { prev: 0, curr: 10 }, r2: { prev: 0, curr: 10 }, r3: { prev: 0, curr: 10 } }, bill: { amount: 100, kwh: 30 } }, settings: { mode: 'ratio', rounding: 'none', remainder: 'last' } });
  assert.equal(r.totals.billed, 100);
});

test('最後一間是空房（0 度）時，取整差額不會讓它變負數', () => {
  const rs = [1, 2, 3, 4, 5].map(i => ({ id: 'r' + i, room: 'R' + i, active: true }));
  const rd = {}; rs.forEach((r, i) => { rd[r.id] = { prev: 0, curr: i < 4 ? 1 : 0 }; });
  const r = B.computePeriod({ rooms: rs, period: { readings: rd, bill: { amount: 2, kwh: 4 } }, settings: { mode: 'ratio', rounding: 'round', remainder: 'last' } });
  assert.ok(r.lines.every(l => l.amount >= 0));
  assert.equal(r.totals.billed, 2);
});

test('num：不收 0x10、1e3、Infinity；全形與千分位照收', () => {
  assert.equal(B.num('0x10'), null); assert.equal(B.num('1e3'), null); assert.equal(B.num('Infinity'), null);
  assert.equal(B.num('１,２３４．５'), 1234.5); assert.equal(B.num('-5'), -5); assert.equal(B.num('.5'), 0.5);
});

test('CSV 匯出防公式注入（文字），但負數度數不受影響', () => {
  const csv = B.toCSV([['=cmd|calc', '@SUM(A1)', '+1+1', '\t=1', -5, '-5', '正常']]);
  assert.ok(csv.startsWith("'=cmd|calc,'@SUM(A1),'+1+1,"));
  assert.ok(csv.includes(',-5,-5,正常'));
});

test('匯入備份：擋 __proto__／重複 id、重建欄位、設定值驗證', () => {
  const base = () => JSON.parse('{"rooms":[{"id":"a","room":"1","extra":1}],"periods":[{"id":"p","readings":{"a":{"prev":"1","curr":"abc","evil":1}}}],"settings":{"mode":"x","unitPrice":"-3","rounding":"ceil"}}');
  const ok = B.validateBackup(base());
  assert.ok(!('extra' in ok.rooms[0])); assert.equal(ok.periods[0].readings.a.curr, ''); assert.ok(!('evil' in ok.periods[0].readings.a));
  assert.deepEqual(ok.settings, { rounding: 'ceil' });
  let b = base(); b.rooms[0].id = '__proto__'; assert.throws(() => B.validateBackup(b));
  b = base(); b.rooms.push({ id: 'a' }); assert.throws(() => B.validateBackup(b));
  b = base(); b.periods[0].readings = null; assert.throws(() => B.validateBackup(b));
  b = JSON.parse('{"rooms":[],"periods":[{"id":"p","readings":{"__proto__":{"prev":1},"b":{}}}]}');
  const k = B.validateBackup(b); assert.deepEqual(Object.keys(k.periods[0].readings), ['b']); assert.equal({}.prev, undefined);
});

test('漏抄的房間：開新一期時上期度數沿用上期的上期度數；改過前一期會提醒', () => {
  const rs = [{ id: 'r1', room: '1', active: true }];
  const last = { readings: { r1: { prev: 100, curr: '' } } };
  assert.equal(B.carryForward(rs, last).readings.r1.prev, 100);
  const r = B.computePeriod({ rooms: rs, prevPeriod: { readings: { r1: { prev: 0, curr: 150 } } }, period: { readings: { r1: { prev: 140, curr: 200 } }, bill: {} }, settings: { mode: 'fixed', unitPrice: 5 } });
  assert.ok(r.lines[0].warnings.some(w => w.code === 'chainBreak'));
});
