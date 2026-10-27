/*
 * tw-submeter-bill 計算核心（純函式，不碰畫面）
 * 瀏覽器：window.Bill；Node：require('./bill.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Bill = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    mode: 'ratio',          // 'fixed' 固定每度單價｜'ratio' 依台電帳單比例
    unitPrice: 5,           // fixed 模式每度單價（元）
    commonMode: 'equal',    // 公共用電：'equal' 平均分｜'usage' 依用電比例｜'landlord' 房東負擔
    rounding: 'round',      // 'round' 四捨五入到元｜'ceil' 無條件進位｜'floor' 無條件捨去｜'none' 不取整（到小數 2 位）
    remainder: 'last',      // 取整差額：'last' 加到最後一間｜'landlord' 由房東吸收
    minCharge: 0,           // 每間最低收費（元），0 = 不設
    spikeFactor: 2,         // 本期度數 > 上期 × 這個倍數 就提醒
    spikeMinKwh: 10,        // 而且至少多這麼多度才提醒（避免小數字誤報）
  };

  // ---------- 數字 ----------
  /** 把輸入轉成數字；空白或看不懂回 null。支援千分位逗號、全形數字。 */
  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim()
      .replace(/[０-９．－]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[,，\s]/g, '');
    if (s === '') return null;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;   // 不收 0x10、1e3、Infinity 這類寫法
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
  /** 金額取整；先修掉浮點誤差（例如 2.4999999 → 2.5） */
  function roundMoney(x, mode) {
    const v = Number(x.toFixed(6));
    switch (mode) {
      case 'none': return r2(v);
      case 'ceil': return Math.ceil(v);
      case 'floor': return Math.floor(v);
      default: return Math.round(v);
    }
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim() !== ''));
  }
  function loadCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  /** 陣列的陣列 → CSV 文字（CRLF，Excel 習慣）。bom=true 時開頭加 UTF-8 BOM，Excel 才不會亂碼。 */
  function toCSV(rows, bom) {
    const cell = v => {
      let s = v === null || v === undefined ? '' : String(v);
      // 防 CSV 公式注入：文字開頭是 = + - @ Tab 換行時加單引號（純數字，含負數，不動）
      if (typeof v === 'string' && /^[\t\r\s]*[=+\-@]|^[\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
      return /[",\r\n\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return (bom ? '﻿' : '') + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  // ---------- 度數 ----------
  /**
   * 單一房間本期用電度數。
   * 一般：本期 − 上期
   * 換表：(舊表最後度數 − 上期) + (本期 − 新表起始度數)
   * 回傳 { usage, status: 'ok'|'missing'|'negative', detail }
   */
  function usageOf(rd) {
    rd = rd || {};
    const prev = num(rd.prev), curr = num(rd.curr);
    if (prev === null || curr === null) return { usage: null, status: 'missing', detail: prev === null ? '缺上期度數' : '缺本期度數' };
    if (rd.replaced) {
      const oldFinal = num(rd.oldFinal), newStart = num(rd.newStart);
      if (oldFinal === null || newStart === null) return { usage: null, status: 'missing', detail: '換表：缺舊表最後度數或新表起始度數' };
      const a = oldFinal - prev, b = curr - newStart;
      if (a < 0 || b < 0) return { usage: r2(a + b), status: 'negative', detail: a < 0 ? '舊表最後度數小於上期度數' : '本期度數小於新表起始度數' };
      return { usage: r2(a + b), status: 'ok', detail: `換表：舊表 ${r2(a)} 度 + 新表 ${r2(b)} 度` };
    }
    const u = r2(curr - prev);
    if (u < 0) return { usage: u, status: 'negative', detail: '本期度數小於上期，請確認是否換表或抄錯' };
    return { usage: u, status: 'ok', detail: '' };
  }

  /** 上一期每間房的用電度數 { roomId: kWh }（只收正常算得出來的） */
  function usageMap(rooms, period) {
    const out = {};
    if (!period) return out;
    for (const room of rooms) {
      const u = usageOf((period.readings || {})[room.id]);
      if (u.status === 'ok') out[room.id] = u.usage;
    }
    return out;
  }

  /** 開新的一期：上期「本期度數」自動帶成這期的「上期度數」 */
  function carryForward(rooms, last, opts) {
    opts = opts || {};
    const readings = {};
    for (const room of rooms) {
      const prevRd = last && last.readings && last.readings[room.id];
      // 上期有填本期度數就用它；沒填（漏抄）就沿用上期的上期度數，下次抄表時才不會憑空少算一段
      let c = prevRd ? num(prevRd.curr) : null;
      if (c === null && prevRd) c = num(prevRd.prev);
      readings[room.id] = { prev: c === null ? '' : c, curr: '', replaced: false, oldFinal: '', newStart: '', note: '' };
    }
    return {
      id: opts.id || 'p' + Date.now().toString(36),
      label: opts.label || '',
      startDate: last ? last.endDate || '' : '',
      endDate: opts.endDate || '',
      bill: { amount: '', kwh: '' },
      readings,
    };
  }

  // ---------- 計算 ----------
  /**
   * 算一期的電費。
   * input: { rooms, period, prevPeriod?, settings? }
   * 回傳 { lines, totals, warnings }
   *   lines[i]: { room, reading, usage, status, commonKwh, kwh, raw, amount, warnings[] }
   *   totals: { sumUsage, totalKwh, commonKwh, landlordKwh, rate, billAmount, rawSum, billed, roundingDiff, landlordBears }
   */
  function computePeriod(input) {
    const S = Object.assign({}, DEFAULTS, input.settings || {});
    const rooms = input.rooms || [];
    const period = input.period || { readings: {}, bill: {} };
    const prevUse = usageMap(rooms, input.prevPeriod);
    const warnings = [];
    const lines = [];
    if (period.startDate && !period.endDate) warnings.push({ code: 'noEndDate', msg: '尚未填「本次抄表日」，繳費通知單的抄表期間會顯示「本次抄表日未填」，列印前請補上' });

    for (const room of rooms) {
      if (!room.active) continue;
      const rd = (period.readings || {})[room.id] || {};
      const u = usageOf(rd);
      const w = [];
      if (u.status === 'missing') w.push({ code: 'missing', msg: u.detail });
      if (u.status === 'negative') w.push({ code: 'negative', msg: `用電 ${u.usage} 度為負數：${u.detail}` });
      if (u.status === 'ok' && rd.replaced) w.push({ code: 'replaced', msg: u.detail });
      const pr = input.prevPeriod && input.prevPeriod.readings && input.prevPeriod.readings[room.id];
      if (pr && num(pr.curr) !== null && num(rd.prev) !== null && num(pr.curr) !== num(rd.prev)) {
        w.push({ code: 'chainBreak', msg: `上期度數 ${num(rd.prev)} 和前一期的本期度數 ${num(pr.curr)} 不一致（是不是改過前一期？）` });
      }
      const p = prevUse[room.id];
      if (u.status === 'ok' && p > 0 && u.usage > p * S.spikeFactor && u.usage - p >= S.spikeMinKwh) {
        w.push({ code: 'spike', msg: `用電 ${u.usage} 度，是上期 ${p} 度的 ${r2(u.usage / p)} 倍，請確認` });
      }
      lines.push({ room, reading: rd, usage: u.usage, status: u.status, commonKwh: 0, kwh: 0, raw: 0, amount: 0, warnings: w });
    }

    const ok = lines.filter(l => l.status === 'ok');
    const sumUsage = r2(ok.reduce((s, l) => s + l.usage, 0));
    const bill = period.bill || {};
    const totalKwh = num(bill.kwh), billAmount = num(bill.amount);

    // 公共用電 = 台電總度數 − Σ分表
    let commonKwh = null;
    if (totalKwh !== null) {
      commonKwh = r2(totalKwh - sumUsage);
      if (commonKwh < 0) {
        warnings.push({ code: 'commonNegative', msg: `分表合計 ${sumUsage} 度比台電帳單 ${totalKwh} 度還多，公共用電視為 0；請確認抄表日期是否和帳單期間一致` });
        commonKwh = 0;
      }
      if (lines.some(l => l.status !== 'ok') && commonKwh > 0) {
        warnings.push({ code: 'commonIncomplete', msg: '有房間度數缺漏或異常，公共用電可能被高估，建議先補齊再收費' });
      }
    }

    let landlordKwh = 0;
    if (commonKwh !== null && commonKwh > 0 && ok.length) {
      if (S.commonMode === 'equal') ok.forEach(l => { l.commonKwh = commonKwh / ok.length; });
      else if (S.commonMode === 'usage') {
        if (sumUsage > 0) ok.forEach(l => { l.commonKwh = commonKwh * l.usage / sumUsage; });
        else ok.forEach(l => { l.commonKwh = commonKwh / ok.length; });
      } else landlordKwh = commonKwh;
    } else if (commonKwh) landlordKwh = commonKwh;

    // 每度單價
    let rate = 0;
    if (S.mode === 'fixed') rate = num(S.unitPrice) || 0;
    else if (totalKwh > 0 && billAmount !== null) rate = billAmount / totalKwh;
    else warnings.push({ code: 'noBill', msg: '「依台電帳單比例」需要填帳單總金額和總度數' });

    // 原始金額用未取整的分攤度數算，顯示用的度數才取到小數 2 位
    for (const l of ok) {
      l.raw = (l.usage + l.commonKwh) * rate;
      l.kwh = r2(l.usage + l.commonKwh);
      l.commonKwh = r2(l.commonKwh);
    }
    const rawSum = ok.reduce((s, l) => s + l.raw, 0);

    // 取整與差額：全部換成「最小單位」整數算（元；不取整時是 0.01 元），避免浮點誤差，
    // 合計一定等於原始總額（四捨五入到最小單位）。差額加在最後一間；
    // 如果最後一間扣到變負數（例如空房度數 0），多出來的往前一間扣，不會出現負的應繳金額。
    const unit = S.rounding === 'none' ? 0.01 : 1;
    const toU = x => Math.round(Number((x / unit).toFixed(6)));
    ok.forEach(l => { l.amount = S.rounding === 'none' ? r2(l.raw) : roundMoney(l.raw, S.rounding); });
    let roundingDiff = 0;
    if (ok.length) {
      const targetU = toU(rawSum);
      const sumU = ok.reduce((s2, l) => s2 + toU(l.amount), 0);
      let diffU = targetU - sumU;
      roundingDiff = r2(diffU * unit);
      if (S.remainder === 'last' && diffU !== 0) {
        for (let i = ok.length - 1; i >= 0 && diffU !== 0; i--) {
          const l = ok[i], curU = toU(l.amount);
          const take = diffU < 0 ? Math.max(diffU, -curU) : diffU;
          if (take === 0) continue;
          l.amount = r2((curU + take) * unit);
          l.warnings.push({ code: 'remainder', msg: `取整差額 ${take > 0 ? '+' : ''}${r2(take * unit)} 元加在這間` });
          diffU -= take;
        }
      }
    }

    // 最低收費
    const minC = num(S.minCharge) || 0;
    if (minC > 0) ok.forEach(l => {
      if (l.amount < minC) { l.warnings.push({ code: 'minCharge', msg: `未達最低收費，以 ${minC} 元計` }); l.amount = minC; }
    });

    const billed = r2(lines.reduce((s, l) => s + l.amount, 0));
    const landlordBears = billAmount !== null ? r2(billAmount - billed) : null;
    lines.forEach(l => { if (l.warnings.length) l.warnings.forEach(x => { x.room = l.room; }); });

    return {
      lines,
      totals: {
        sumUsage, totalKwh, commonKwh, landlordKwh: r2(landlordKwh), rate,
        billAmount, rawSum: r2(rawSum), billed, roundingDiff: S.remainder === 'last' ? 0 : roundingDiff, landlordBears,
        settings: S,
      },
      warnings,
    };
  }

  // ---------- 抄表期間文字（迄日、起日沒填時不顯示問號） ----------
  function dateRangeText(start, end) {
    if (start && end) return `${start} ～ ${end}`;
    if (start) return `${start} 起（本次抄表日未填）`;
    if (end) return `至 ${end}（上次抄表日未填）`;
    return '';
  }

  // ---------- 匯入抄表 CSV ----------
  const FIELDS = { meterId: '電表編號', room: '房號', prev: '上期度數', curr: '本期度數', oldFinal: '舊表最後度數', newStart: '新表起始度數', note: '備註' };

  /**
   * 把抄表 CSV 套進某一期（不改原物件，回傳新的 period）。
   * 用「電表編號」對房間；沒有這欄就用「房號」。上期度數欄空白時保留原值。
   */
  function applyReadingsCSV(rooms, period, text, fields) {
    const F = Object.assign({}, FIELDS, fields || {});
    const recs = loadCSV(text);
    const out = JSON.parse(JSON.stringify(period));
    out.readings = out.readings || {};
    const unmatched = [];
    let count = 0;
    for (const rec of recs) {
      const key = rec[F.meterId] || rec[F.room] || '';
      const room = rooms.find(r => (rec[F.meterId] && r.meterId === rec[F.meterId]) || (!rec[F.meterId] && rec[F.room] && r.room === rec[F.room]));
      if (!room) { if (key) unmatched.push(key); continue; }
      const rd = Object.assign({ prev: '', curr: '', replaced: false, oldFinal: '', newStart: '', note: '' }, out.readings[room.id]);
      const val = k => (num(rec[F[k]]) === null ? '' : num(rec[F[k]]));
      if (rec[F.prev] !== undefined && rec[F.prev] !== '') rd.prev = val('prev');
      if (rec[F.curr] !== undefined) rd.curr = val('curr');
      const of = rec[F.oldFinal], ns = rec[F.newStart];
      if ((of !== undefined && of !== '') || (ns !== undefined && ns !== '')) {
        rd.replaced = true; rd.oldFinal = val('oldFinal'); rd.newStart = val('newStart');
      }
      if (rec[F.note] !== undefined) rd.note = rec[F.note];
      out.readings[room.id] = rd;
      count++;
    }
    return { period: out, count, unmatched };
  }

  /** 結果 → CSV 列（含表頭、合計） */
  function summaryRows(result, period) {
    const rows = [['期別', '樓層', '房號', '電表編號', '房客', '上期度數', '本期度數', '換表', '用電度數', '公共分攤度數', '計費度數', '應繳金額(元)', '提醒']];
    const lbl = period ? period.label || '' : '';
    for (const l of result.lines) {
      const rd = l.reading || {};
      rows.push([lbl, l.room.floor, l.room.room, l.room.meterId, l.room.tenant, rd.prev, rd.curr,
        rd.replaced ? `舊表 ${rd.oldFinal}／新表起 ${rd.newStart}` : '', l.usage === null ? '' : l.usage,
        l.commonKwh, l.kwh, l.amount, l.warnings.map(w => w.msg).join('；')]);
    }
    const t = result.totals;
    rows.push([lbl, '合計', '', '', '', '', '', '', t.sumUsage, t.commonKwh === null ? '' : r2(t.commonKwh - t.landlordKwh), '', t.billed,
      t.billAmount !== null ? `台電帳單 ${t.billAmount} 元；房東負擔 ${t.landlordBears} 元` : '']);
    return rows;
  }

  // ---------- 備份 ----------
  const BAD_KEY = /^(__proto__|constructor|prototype)$/;
  const ENUMS = { mode: ['fixed', 'ratio'], commonMode: ['equal', 'usage', 'landlord'], rounding: ['round', 'ceil', 'floor', 'none'], remainder: ['last', 'landlord'] };
  const NUM_SETTINGS = ['unitPrice', 'minCharge', 'spikeFactor', 'spikeMinKwh'];
  /**
   * 檢查並「重建」匯入的 JSON 備份：只收白名單欄位、型別強制轉換、
   * 擋掉 __proto__／constructor 之類的 id、重複 id 直接報錯。格式不對丟錯誤。
   */
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('不是有效的備份檔');
    if (!Array.isArray(obj.rooms) || !Array.isArray(obj.periods)) throw new Error('備份檔缺少 rooms 或 periods');
    if (obj.rooms.length > 5000 || obj.periods.length > 2000) throw new Error('備份檔太大（房間超過 5000 或期別超過 2000）');
    const str = (v, max) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v)).slice(0, max || 100);
    const val = v => {                       // 度數／金額欄位：數字或數字字串，其他一律清空
      if (typeof v === 'number') return Number.isFinite(v) ? v : '';
      const n = num(v);
      return n === null ? '' : n;
    };
    const ids = new Set();
    const rooms = obj.rooms.map(r => {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) throw new Error('房間資料缺少 id');
      if (BAD_KEY.test(r.id)) throw new Error('房間 id 不合法：' + r.id);
      if (ids.has(r.id)) throw new Error('房間 id 重複：' + r.id);
      ids.add(r.id);
      return { id: str(r.id, 60), floor: str(r.floor, 20), room: str(r.room, 40), meterId: str(r.meterId, 60), tenant: str(r.tenant, 60), active: r.active !== false };
    });
    const pids = new Set();
    const periods = obj.periods.map(p => {
      if (!p || typeof p.id !== 'string' || !p.id || !p.readings || typeof p.readings !== 'object' || Array.isArray(p.readings)) throw new Error('期別資料格式不對');
      if (BAD_KEY.test(p.id)) throw new Error('期別 id 不合法：' + p.id);
      if (pids.has(p.id)) throw new Error('期別 id 重複：' + p.id);
      pids.add(p.id);
      const readings = {};
      Object.keys(p.readings).forEach(k => {
        if (BAD_KEY.test(k)) return;
        const rd = p.readings[k] || {};
        readings[k] = { prev: val(rd.prev), curr: val(rd.curr), replaced: !!rd.replaced, oldFinal: val(rd.oldFinal), newStart: val(rd.newStart), note: str(rd.note, 200) };
      });
      const bill = p.bill && typeof p.bill === 'object' ? p.bill : {};
      return { id: str(p.id, 60), label: str(p.label, 60), startDate: str(p.startDate, 10), endDate: str(p.endDate, 10),
        bill: { amount: val(bill.amount), kwh: val(bill.kwh) }, readings };
    });
    const settings = {};
    const st = obj.settings && typeof obj.settings === 'object' ? obj.settings : {};
    Object.keys(ENUMS).forEach(k => { if (ENUMS[k].includes(st[k])) settings[k] = st[k]; });
    NUM_SETTINGS.forEach(k => { const n = num(st[k]); if (n !== null && n >= 0) settings[k] = n; });
    const cur = typeof obj.current === 'string' && pids.has(obj.current) ? obj.current : (periods[periods.length - 1] || {}).id;
    return { version: 1, settings, rooms, periods, current: cur };
  }

  return { DEFAULTS, FIELDS, num, roundMoney, parseCSV, loadCSV, toCSV, usageOf, usageMap, carryForward, computePeriod, dateRangeText, applyReadingsCSV, summaryRows, validateBackup };
});
