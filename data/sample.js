/* 示範資料（房客、電表編號、度數、金額全部是假的）。讓網頁不用選檔也能試用。
 * SAMPLE_READINGS_CSV 和 data/readings.example.csv 內容相同（第 2 期的抄表），測試會檢查。 */
window.SAMPLE_DATA = {
  "version": 1,
  "rooms": [
    {
      "id": "r1",
      "floor": "2F",
      "room": "2F-A",
      "meterId": "示範-2F-A",
      "tenant": "示範房客甲",
      "active": true
    },
    {
      "id": "r2",
      "floor": "2F",
      "room": "2F-B",
      "meterId": "示範-2F-B",
      "tenant": "示範房客乙",
      "active": true
    },
    {
      "id": "r3",
      "floor": "3F",
      "room": "3F-A",
      "meterId": "示範-3F-A",
      "tenant": "示範房客丙",
      "active": true
    },
    {
      "id": "r4",
      "floor": "3F",
      "room": "3F-B",
      "meterId": "示範-3F-B",
      "tenant": "示範房客丁",
      "active": true
    },
    {
      "id": "r5",
      "floor": "3F",
      "room": "3F-C",
      "meterId": "示範-3F-C",
      "tenant": "（空房）",
      "active": false
    }
  ],
  "periods": [
    {
      "id": "p1",
      "label": "第 1 期（示範）",
      "startDate": "2026-01-05",
      "endDate": "2026-03-05",
      "bill": {
        "amount": 3000,
        "kwh": 620
      },
      "readings": {
        "r1": {
          "prev": 1000,
          "curr": 1180,
          "replaced": false,
          "oldFinal": "",
          "newStart": "",
          "note": ""
        },
        "r2": {
          "prev": 2000,
          "curr": 2120,
          "replaced": false,
          "oldFinal": "",
          "newStart": "",
          "note": ""
        },
        "r3": {
          "prev": 500,
          "curr": 650,
          "replaced": false,
          "oldFinal": "",
          "newStart": "",
          "note": ""
        },
        "r4": {
          "prev": 3000,
          "curr": 3100,
          "replaced": false,
          "oldFinal": "",
          "newStart": "",
          "note": ""
        },
        "r5": {
          "prev": 800,
          "curr": 800,
          "replaced": false,
          "oldFinal": "",
          "newStart": "",
          "note": ""
        }
      }
    },
    {
      "id": "p2",
      "label": "第 2 期（示範）",
      "startDate": "2026-03-05",
      "endDate": "2026-05-05",
      "bill": {
        "amount": 3500,
        "kwh": 720
      },
      "readings": {
        "r1": {
          "prev": 1180,
          "curr": 1330,
          "replaced": false,
          "oldFinal": "",
          "newStart": "",
          "note": ""
        },
        "r2": {
          "prev": 2120,
          "curr": 2250,
          "replaced": false,
          "oldFinal": "",
          "newStart": "",
          "note": ""
        },
        "r3": {
          "prev": 650,
          "curr": 90,
          "replaced": true,
          "oldFinal": 700,
          "newStart": 0,
          "note": "本期換表（示範）"
        },
        "r4": {
          "prev": 3100,
          "curr": 3330,
          "replaced": false,
          "oldFinal": "",
          "newStart": "",
          "note": ""
        },
        "r5": {
          "prev": 800,
          "curr": 800,
          "replaced": false,
          "oldFinal": "",
          "newStart": "",
          "note": "空房"
        }
      }
    }
  ],
  "current": "p2"
};

window.SAMPLE_READINGS_CSV = "電表編號,上期度數,本期度數,舊表最後度數,新表起始度數,備註\r\n示範-2F-A,1180,1330,,,\r\n示範-2F-B,2120,2250,,,\r\n示範-3F-A,650,90,700,0,本期換表（示範）\r\n示範-3F-B,3100,3330,,,\r\n示範-3F-C,800,800,,,空房\r\n";
