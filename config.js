/*
 * tw-submeter-bill 設定檔
 * 用記事本打開就能改，改完存檔、重新整理網頁即可。
 * 網頁上「計費設定」改過的值會存在這台電腦的瀏覽器，優先於這裡；按「恢復 config.js 預設」可還原。
 */
window.BILL_CONFIG = {
  title: '示範套房 分租電費',
  landlord: '示範房東',          // 繳費通知單上的出租人稱呼
  contact: '0900-000-123',       // 繳費通知單上的聯絡電話（示範號碼）

  // 計費方式：'fixed' 固定每度單價｜'ratio' 依台電帳單比例分攤
  mode: 'ratio',
  unitPrice: 5,                  // fixed 模式：每度幾元

  // 公共用電（台電總度數 − 各分表合計）：'equal' 有效房間平均分｜'usage' 依用電比例分｜'landlord' 房東負擔
  commonMode: 'equal',

  // 取整：'round' 四捨五入到元｜'ceil' 無條件進位｜'floor' 無條件捨去｜'none' 不取整（小數 2 位）
  rounding: 'round',
  // 取整後的差額：'last' 加到最後一間（合計 = 原始總額四捨五入）｜'landlord' 由房東吸收
  remainder: 'last',

  minCharge: 0,                  // 每間最低收費（元），0 = 不設
  spikeFactor: 2,                // 本期度數超過上期幾倍就提醒
  spikeMinKwh: 10,               // 而且至少多幾度才提醒

  // 繳費通知單下方的說明文字
  noticeNote: '請於收到通知後 7 日內繳納。電費原則上依租約約定計收，如有疑問請與出租人聯絡。',

  // 抄表 CSV 的欄位名稱（要和 CSV 第一列一樣）
  fields: {
    meterId: '電表編號',
    room: '房號',
    prev: '上期度數',
    curr: '本期度數',
    oldFinal: '舊表最後度數',
    newStart: '新表起始度數',
    note: '備註',
  },
};
