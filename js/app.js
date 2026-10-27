/* tw-submeter-bill 畫面邏輯。計算都在 bill.js。 */
(function () {
  'use strict';
  const B = window.Bill;
  const CFG = window.BILL_CONFIG || {};
  const KEY = 'tw-submeter-bill:v1';
  const SETTING_KEYS = ['mode', 'unitPrice', 'commonMode', 'rounding', 'remainder', 'minCharge', 'spikeFactor', 'spikeMinKwh'];
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cfgSettings = () => Object.fromEntries(SETTING_KEYS.filter(k => CFG[k] !== undefined).map(k => [k, CFG[k]]));

  // ---------- 資料 ----------
  function sampleState() {
    const s = clone(window.SAMPLE_DATA || { rooms: [], periods: [] });
    s.settings = {};
    return B.validateBackup(s);
  }
  let state;
  let fromStorage = false;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { state = B.validateBackup(JSON.parse(raw)); fromStorage = true; }
  } catch (e) { state = null; }
  if (!state) state = sampleState();

  let saveFailed = false;
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); fromStorage = true; saveFailed = false; }
    catch (e) {
      // 存不了（私密視窗、空間滿了）：不能靜悄悄，不然使用者以為有存
      if (!saveFailed) alert('儲存失敗：瀏覽器不允許寫入（私密視窗或儲存空間已滿）。這次的變更沒有存下來，請立刻按「匯出備份」把資料存成檔案。');
      saveFailed = true;
    }
    showDataInfo();
  };
  // 別的分頁改了資料 → 這頁重新讀入，避免兩個分頁互相用舊資料覆蓋
  window.addEventListener('storage', e => {
    if (e.key !== KEY || e.newValue === null) return;
    try { state = B.validateBackup(JSON.parse(e.newValue)); fromStorage = true; renderAll(); } catch (err) { /* 壞資料就忽略 */ }
  });
  const settings = () => Object.assign({}, B.DEFAULTS, cfgSettings(), state.settings);
  const curIndex = () => Math.max(0, state.periods.findIndex(p => p.id === state.current));
  const curPeriod = () => state.periods[curIndex()];
  const prevPeriod = () => state.periods[curIndex() - 1] || null;
  function ensurePeriod() {
    if (!state.periods.length) {
      const p = B.carryForward(state.rooms, null, { id: uid('p'), label: '第 1 期' });
      state.periods.push(p);
    }
    if (!state.periods.some(p => p.id === state.current)) state.current = state.periods[state.periods.length - 1].id;
  }
  function readingOf(p, roomId) {
    p.readings[roomId] = Object.assign({ prev: '', curr: '', replaced: false, oldFinal: '', newStart: '', note: '' }, p.readings[roomId]);
    return p.readings[roomId];
  }

  // ---------- 設定 ----------
  function renderSettings() {
    const S = settings();
    $('sMode').value = S.mode; $('modeQuick').value = S.mode;
    $('sUnit').value = S.unitPrice; $('sCommon').value = S.commonMode;
    $('sRound').value = S.rounding; $('sRemainder').value = S.remainder;
    $('sMin').value = S.minCharge; $('sSpike').value = S.spikeFactor;
    document.body.classList.toggle('mode-fixed', S.mode === 'fixed');
    document.body.classList.toggle('mode-ratio', S.mode !== 'fixed');
  }
  function bindSettings() {
    const set = (k, v) => { state.settings[k] = v; save(); renderSettings(); calc(); };
    const numOr = (v, d) => { const n = B.num(v); return n === null || n < 0 ? d : n; };
    $('sMode').onchange = e => set('mode', e.target.value);
    $('modeQuick').onchange = e => set('mode', e.target.value);
    $('sUnit').onchange = e => set('unitPrice', numOr(e.target.value, 0));
    $('sCommon').onchange = e => set('commonMode', e.target.value);
    $('sRound').onchange = e => set('rounding', e.target.value);
    $('sRemainder').onchange = e => set('remainder', e.target.value);
    $('sMin').onchange = e => set('minCharge', numOr(e.target.value, 0));
    $('sSpike').onchange = e => set('spikeFactor', numOr(e.target.value, 2));
    $('btnResetSettings').onclick = () => { state.settings = {}; save(); renderSettings(); calc(); };
  }

  // ---------- 房間 ----------
  function renderRooms() {
    const rows = state.rooms.map((r, i) => `<tr data-i="${i}">
      <td><input data-k="floor" value="${esc(r.floor)}" size="3"></td>
      <td><input data-k="room" value="${esc(r.room)}" size="5"></td>
      <td><input data-k="meterId" value="${esc(r.meterId)}" size="10"></td>
      <td><input data-k="tenant" value="${esc(r.tenant)}" size="8"></td>
      <td><input data-k="active" type="checkbox" ${r.active ? 'checked' : ''} aria-label="計費"></td>
      <td><button type="button" data-del="${i}" class="danger small">刪除</button></td>
    </tr>`).join('');
    $('roomTable').innerHTML = `<thead><tr><th>樓層</th><th>房號</th><th>電表編號</th><th>房客</th><th>計費</th><th></th></tr></thead><tbody>${rows}</tbody>`;
  }
  function bindRooms() {
    $('roomTable').addEventListener('change', e => {
      const tr = e.target.closest('tr[data-i]'); const k = e.target.dataset.k;
      if (!tr || !k) return;
      const r = state.rooms[+tr.dataset.i];
      r[k] = k === 'active' ? e.target.checked : e.target.value.trim();
      save(); renderReadings(); calc();
    });
    $('roomTable').addEventListener('click', e => {
      const i = e.target.dataset.del;
      if (i === undefined) return;
      const r = state.rooms[+i];
      if (!confirm(`確定刪除房間「${r.room || r.meterId}」？歷史抄表紀錄也會看不到。若只是空房，取消勾選「計費」即可。`)) return;
      state.rooms.splice(+i, 1);
      save(); renderRooms(); renderReadings(); calc();
    });
    $('btnAddRoom').onclick = () => {
      const n = state.rooms.length + 1;
      state.rooms.push({ id: uid('r'), floor: '', room: '房間' + n, meterId: '', tenant: '', active: true });
      save(); renderRooms(); renderReadings(); calc();
    };
  }

  // ---------- 期別與抄表 ----------
  function renderPeriodHeader() {
    $('periodSel').innerHTML = state.periods.map((p, i) => `<option value="${esc(p.id)}">${esc(p.label || '第 ' + (i + 1) + ' 期')}</option>`).join('');
    $('periodSel').value = state.current;
    const p = curPeriod();
    $('pLabel').value = p.label || '';
    $('pStart').value = p.startDate || '';
    $('pEnd').value = p.endDate || '';
    p.bill = p.bill || {};
    $('pAmount').value = p.bill.amount === undefined ? '' : p.bill.amount;
    $('pKwh').value = p.bill.kwh === undefined ? '' : p.bill.kwh;
    $('btnDelPeriod').disabled = state.periods.length <= 1;
  }
  function renderReadings() {
    const p = curPeriod();
    const rows = state.rooms.map(r => {
      const rd = readingOf(p, r.id);
      return `<tr data-id="${esc(r.id)}" class="${r.active ? '' : 'inactive'}">
        <td class="left">${esc(r.room)}<div class="sub">${esc(r.tenant)}${r.active ? '' : '（不計費）'}</div></td>
        <td><input data-k="prev" value="${esc(rd.prev)}" inputmode="decimal" size="6" aria-label="上期度數"></td>
        <td><input data-k="curr" value="${esc(rd.curr)}" inputmode="decimal" size="6" aria-label="本期度數"></td>
        <td class="left"><label class="inline"><input data-k="replaced" type="checkbox" ${rd.replaced ? 'checked' : ''}> 換表</label>
          <div class="swap" ${rd.replaced ? '' : 'hidden'}>
            <label>舊表最後<input data-k="oldFinal" value="${esc(rd.oldFinal)}" inputmode="decimal" size="6"></label>
            <label>新表起始<input data-k="newStart" value="${esc(rd.newStart)}" inputmode="decimal" size="6"></label>
          </div></td>
        <td class="num" id="use-${esc(r.id)}"></td>
        <td class="num" id="amt-${esc(r.id)}"></td>
        <td><input data-k="note" value="${esc(rd.note)}" size="10" aria-label="備註"></td>
      </tr>`;
    }).join('');
    $('readTable').innerHTML = `<thead><tr><th>房間</th><th>上期度數</th><th>本期度數</th><th>換表</th><th>用電</th><th>應繳</th><th>備註</th></tr></thead><tbody>${rows}</tbody>`;
  }
  function bindPeriod() {
    $('periodSel').onchange = e => { state.current = e.target.value; save(); renderAll(); };
    const pset = (fn) => e => { fn(curPeriod(), e.target.value); save(); renderPeriodHeader(); calc(); };
    $('pLabel').onchange = pset((p, v) => { p.label = v.trim(); });
    $('pStart').onchange = pset((p, v) => { p.startDate = v; });
    $('pEnd').onchange = pset((p, v) => { p.endDate = v; });
    $('pAmount').onchange = pset((p, v) => { p.bill.amount = B.num(v) === null ? '' : B.num(v); });
    $('pKwh').onchange = pset((p, v) => { p.bill.kwh = B.num(v) === null ? '' : B.num(v); });
    $('readTable').addEventListener('change', e => {
      const tr = e.target.closest('tr[data-id]'); const k = e.target.dataset.k;
      if (!tr || !k) return;
      const rd = readingOf(curPeriod(), tr.dataset.id);
      if (k === 'replaced') {
        rd.replaced = e.target.checked;
        tr.querySelector('.swap').hidden = !rd.replaced;
      } else if (k === 'note') rd.note = e.target.value;
      else { const n = B.num(e.target.value); rd[k] = n === null ? '' : n; }
      save(); calc();
    });
    $('btnNewPeriod').onclick = () => {
      const last = state.periods[state.periods.length - 1];
      const p = B.carryForward(state.rooms, last, { id: uid('p'), label: '第 ' + (state.periods.length + 1) + ' 期' });
      state.periods.push(p); state.current = p.id;
      save(); renderAll();
    };
    $('btnDelPeriod').onclick = () => {
      if (state.periods.length <= 1) return;
      const p = curPeriod();
      if (!confirm(`確定刪除「${p.label || '這一期'}」的抄表資料？建議先匯出備份。`)) return;
      state.periods.splice(curIndex(), 1);
      state.current = state.periods[state.periods.length - 1].id;
      save(); renderAll();
    };
  }

  // ---------- 計算與輸出 ----------
  let last = null;
  function calc() {
    const p = curPeriod();
    const res = B.computePeriod({ rooms: state.rooms, period: p, prevPeriod: prevPeriod(), settings: settings() });
    last = res;
    const S = res.totals.settings, t = res.totals;
    // 抄表表格裡的即時結果
    state.rooms.forEach(r => { const u = $('use-' + r.id), a = $('amt-' + r.id); if (u) u.textContent = ''; if (a) a.textContent = ''; });
    for (const l of res.lines) {
      const u = $('use-' + l.room.id), a = $('amt-' + l.room.id);
      if (u) u.textContent = l.usage === null ? '—' : fmt(l.usage);
      if (a) a.textContent = l.status === 'ok' ? fmt(l.amount) : '—';
      const tr = u && u.closest('tr');
      if (tr) tr.classList.toggle('warn', l.warnings.some(w => ['missing', 'negative', 'spike'].includes(w.code)));
    }
    // 提醒
    const all = res.warnings.map(w => ({ cls: 'bad', msg: w.msg }))
      .concat(res.lines.flatMap(l => l.warnings.filter(w => w.code !== 'remainder').map(w => ({ cls: ['missing', 'negative', 'spike'].includes(w.code) ? 'bad' : 'info', msg: `${l.room.room}：${w.msg}` }))));
    $('warnings').innerHTML = all.length ? '<ul>' + all.map(w => `<li class="${w.cls}">${esc(w.msg)}</li>`).join('') + '</ul>' : '';

    // 總表
    const lbl = p.label || '本期';
    $('sumTitle').textContent = `${CFG.title || '分租電費'}　${lbl}　總表`;
    const body = res.lines.map(l => {
      const rd = l.reading || {};
      return `<tr class="${l.status !== 'ok' ? 'warn' : ''}"><td>${esc(l.room.floor)}</td><td>${esc(l.room.room)}</td><td>${esc(l.room.tenant)}</td><td>${esc(l.room.meterId)}</td>
        <td class="num">${fmt(rd.prev)}</td><td class="num">${fmt(rd.curr)}${rd.replaced ? '<div class="sub">換表</div>' : ''}</td>
        <td class="num">${l.usage === null ? '—' : fmt(l.usage)}</td><td class="num">${fmt(l.commonKwh)}</td><td class="num">${fmt(l.kwh)}</td>
        <td class="num strong">${l.status === 'ok' ? fmt(l.amount) : '—'}</td>
        <td class="left small">${esc(l.warnings.map(w => w.msg).join('；'))}</td></tr>`;
    }).join('');
    $('sumTable').innerHTML = `<thead><tr><th>樓層</th><th>房號</th><th>房客</th><th>電表</th><th>上期</th><th>本期</th><th>用電度數</th><th>公共分攤</th><th>計費度數</th><th>應繳(元)</th><th>提醒</th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr><td colspan="6">合計</td><td class="num">${fmt(t.sumUsage)}</td><td class="num">${t.commonKwh === null ? '' : fmt(t.commonKwh - t.landlordKwh)}</td><td></td><td class="num strong">${fmt(t.billed)}</td><td></td></tr></tfoot>`;

    const modeTxt = S.mode === 'fixed' ? `固定每度 ${fmt(S.unitPrice)} 元` : `依台電帳單比例（每度約 ${t.rate ? t.rate.toFixed(4) : '—'} 元）`;
    const commonTxt = { equal: '平均分給計費房間', usage: '依用電比例分', landlord: '由房東負擔' }[S.commonMode];
    const items = [
      ['計費方式', modeTxt],
      ['分表合計', fmt(t.sumUsage) + ' 度'],
      ['台電帳單', t.totalKwh === null ? '未填' : `${fmt(t.totalKwh)} 度${t.billAmount !== null ? '／' + fmt(t.billAmount) + ' 元' : ''}`],
      ['公共用電', t.commonKwh === null ? '未填台電總度數，不計' : `${fmt(t.commonKwh)} 度，${commonTxt}`],
      ['房客應繳合計', fmt(t.billed) + ' 元'],
    ];
    if (t.landlordBears !== null) items.push(['房東負擔', fmt(t.landlordBears) + ' 元' + (t.landlordBears < 0 ? '（收的比帳單多，請確認單價是否合理）' : '')]);
    if (S.rounding !== 'none') items.push(['取整', ({ round: '四捨五入', ceil: '無條件進位', floor: '無條件捨去' })[S.rounding] + '到元，差額' + (S.remainder === 'last' ? '加到最後一間' : '由房東吸收')]);
    $('totals').innerHTML = items.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    $('summary').textContent = `${lbl}｜${res.lines.length} 間計費｜合計 ${fmt(t.billed)} 元`;
    renderNotices(res, p);
  }

  function renderNotices(res, p) {
    const S = res.totals.settings, t = res.totals;
    const range = B.dateRangeText(p.startDate, p.endDate);
    $('notices').innerHTML = res.lines.filter(l => l.status === 'ok').map(l => {
      const rd = l.reading || {};
      const rows = [
        ['房號', `${l.room.floor ? l.room.floor + '　' : ''}${l.room.room}`],
        ['房客', l.room.tenant],
        ['電表編號', l.room.meterId],
        ['抄表期間', range],
        ['上期度數', fmt(rd.prev)],
        ['本期度數', fmt(rd.curr)],
      ];
      if (rd.replaced) rows.push(['換表', `舊表最後 ${fmt(rd.oldFinal)}／新表起始 ${fmt(rd.newStart)}`]);
      rows.push(['用電度數', fmt(l.usage) + ' 度']);
      if (l.commonKwh) rows.push(['公共用電分攤', fmt(l.commonKwh) + ' 度']);
      rows.push(['計費方式', S.mode === 'fixed' ? `每度 ${fmt(S.unitPrice)} 元` : `台電帳單 ${fmt(t.billAmount)} 元 ÷ ${fmt(t.totalKwh)} 度 ≈ 每度 ${t.rate ? t.rate.toFixed(4) : '—'} 元`]);
      const extra = l.warnings.filter(w => ['minCharge', 'remainder'].includes(w.code)).map(w => w.msg).join('；');
      return `<article class="notice">
        <h3>電費繳費通知單</h3>
        <div class="nmeta">${esc(CFG.title || '')}　${esc(p.label || '')}</div>
        <table class="ntbl">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
        <div class="due">應繳金額　<b>NT$ ${fmt(l.amount)}</b> 元</div>
        ${extra ? `<p class="small">${esc(extra)}</p>` : ''}
        <p class="small">${esc(CFG.noticeNote || '')}</p>
        <div class="nfoot">出租人：${esc(CFG.landlord || '')}　${CFG.contact ? '電話：' + esc(CFG.contact) : ''}</div>
      </article>`;
    }).join('') || '<p class="hint">本期還沒有可以開單的房間（請先填本期度數）。</p>';
  }

  // ---------- 匯入匯出 ----------
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };  // 本機日期，不是 UTC
  function readFile(input, cb) {
    const f = input.files && input.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { cb(String(fr.result), f.name); input.value = ''; };
    fr.readAsText(f, 'utf-8');
  }
  function showDataInfo() {
    let ok = true;
    try { localStorage.setItem(KEY + ':t', '1'); localStorage.removeItem(KEY + ':t'); } catch (e) { ok = false; }
    $('dataInfo').textContent = saveFailed ? '⚠ 最近一次儲存失敗，變更沒有存下來！請立刻按「匯出備份」。' : !ok ? '這個瀏覽器不能存資料（可能是私密視窗），關掉網頁後會消失，請記得匯出備份。'
      : fromStorage ? `已存在這台電腦：${state.rooms.length} 間房、${state.periods.length} 期。` : '目前是示範資料，修改後會自動存在這台電腦。';
  }
  function bindData() {
    $('btnExportJSON').onclick = () => download(`分租電費備份-${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
    $('fileJSON').onchange = e => readFile(e.target, text => {
      try {
        const s = B.validateBackup(JSON.parse(text));
        if (!confirm(`備份內有 ${s.rooms.length} 間房、${s.periods.length} 期，要取代目前的資料嗎？`)) return;
        state = s; ensurePeriod(); save(); renderAll();
      } catch (err) { alert('匯入失敗：' + err.message); }
    });
    $('btnExportCSV').onclick = () => {
      if (!last) return;
      const p = curPeriod();
      download(`分租電費-${(p.label || '本期').replace(/[\\/:*?"<>|\s]/g, '')}.csv`, B.toCSV(B.summaryRows(last, p), true), 'text/csv;charset=utf-8');
    };
    $('fileCSV').onchange = e => readFile(e.target, text => {
      if (!confirm('匯入抄表 CSV 會覆蓋「' + (curPeriod().label || '本期') + '」裡同電表的度數，要繼續嗎？（建議先匯出備份）')) return;
      const r = B.applyReadingsCSV(state.rooms, curPeriod(), text, CFG.fields);
      state.periods[curIndex()] = r.period;
      save(); renderReadings(); calc();
      alert(`已匯入 ${r.count} 筆抄表到「${curPeriod().label || '本期'}」。` + (r.unmatched.length ? `\n找不到的電表／房號：${r.unmatched.join('、')}（請先在「房間設定」建立）` : ''));
    });
    $('btnSample').onclick = () => {
      if (!confirm('載入示範資料會取代目前的資料，確定嗎？（建議先匯出備份）')) return;
      state = sampleState(); save(); renderAll();
    };
    $('btnClear').onclick = () => {
      if (!confirm('清除這台電腦存的所有房間與抄表資料？此動作無法復原，建議先匯出備份。')) return;
      try { localStorage.removeItem(KEY); } catch (e) { /* 沒存過 */ }
      fromStorage = false; state = sampleState(); renderAll();
    };
  }

  // ---------- 列印 ----------
  function printAs(cls) {
    document.body.classList.add(cls);
    const done = () => { document.body.classList.remove(cls); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1000);
  }

  function renderAll() {
    ensurePeriod();
    renderSettings(); renderRooms(); renderPeriodHeader(); renderReadings(); calc(); showDataInfo();
  }

  document.title = CFG.title || document.title;
  $('title').textContent = CFG.title || '分租電費計算';
  $('btnPrintNotices').onclick = () => printAs('print-notices');
  $('btnPrintSummary').onclick = () => printAs('print-summary');
  bindSettings(); bindRooms(); bindPeriod(); bindData();
  renderAll();
})();
