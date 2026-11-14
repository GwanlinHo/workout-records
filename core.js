/* 運動紀錄核心邏輯：純函式，不碰 DOM / 儲存，瀏覽器與 node 測試共用
 * 日期一律用「本地時間」的 getter 產生，不可用 toISOString（UTC+8 會跑到前一天） */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WRCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAY_MS = 24 * 3600 * 1000;

  /* ---------- 日期 ---------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function dateKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function parseDateKey(key) {
    var p = key.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).getTime();
  }

  /* 加減天數用日曆運算，避開日光節約時間的 23/25 小時日 */
  function addDays(key, n) {
    var p = key.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2] + n);
    return dateKey(d.getTime());
  }

  /* weekStart: 1 = 星期一，0 = 星期日 */
  function weekStartKey(ts, weekStart) {
    var d = new Date(ts);
    var diff = (d.getDay() - weekStart + 7) % 7;
    return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff).getTime());
  }

  function weekDays(startKey) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(startKey, i));
    return out;
  }

  /* ---------- 個人資料與目標 ---------- */
  function ageFromBirthYear(birthYear, nowTs) {
    return new Date(nowTs).getFullYear() - birthYear;
  }

  function bmi(heightCm, weightKg) {
    if (!heightCm || !weightKg) return null;
    var m = heightCm / 100;
    return weightKg / (m * m);
  }

  /* 衛福部成人 BMI 分級 */
  function bmiLevel(v) {
    if (v == null) return "";
    if (v < 18.5) return "過輕";
    if (v < 24) return "正常";
    if (v < 27) return "過重";
    return "肥胖";
  }

  /* Mifflin-St Jeor 基礎代謝率（大卡/日） */
  function bmr(profile, nowTs) {
    var age = ageFromBirthYear(profile.birthYear, nowTs);
    var base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * age;
    return Math.round(profile.sex === "female" ? base - 161 : base + 5);
  }

  /* 每週目標
   * - 有氧：WHO / 國健署 150 分鐘中強度（高強度 1 分鐘算 2 分鐘）
   *   BMI >= 24 依 ACSM 體重管理建議提高到 250 分鐘
   *   未滿 18 歲：每天 60 分鐘 = 每週 420 分鐘
   * - 肌力：每週 2 天
   * - 飯後運動：每天 mealPerDay 次，每次至少 mealMinMinutes 分鐘 */
  function weeklyGoals(profile, settings, nowTs) {
    var age = ageFromBirthYear(profile.birthYear, nowTs);
    var b = bmi(profile.heightCm, profile.weightKg);
    var aerobic = 150, reasons = [];
    if (age < 18) {
      aerobic = 420;
      reasons.push("未滿 18 歲，建議每天 60 分鐘");
    } else if (b != null && b >= 24) {
      aerobic = 250;
      reasons.push("BMI " + b.toFixed(1) + "（" + bmiLevel(b) + "），依 ACSM 體重管理建議提高到 250 分鐘");
    } else {
      reasons.push("WHO 與國健署建議每週 150 分鐘中強度");
    }
    return {
      age: age,
      bmi: b,
      aerobicMinutes: aerobic,
      strengthDays: 2,
      mealPerDay: settings.mealPerDay,
      mealMinMinutes: settings.mealMinMinutes,
      balanceReminder: age >= 65,
      reasons: reasons,
    };
  }

  /* ---------- 強度與計分 ---------- */
  var INTENSITY_NAME = { light: "輕鬆", moderate: "中強度", vigorous: "高強度" };

  /* 步頻（步/分）判斷強度：Tudor-Locke 等人 */
  function intensityFromCadence(spm) {
    if (spm >= 130) return "vigorous";
    if (spm >= 100) return "moderate";
    return "light";
  }

  /* 計入每週有氧目標的分鐘數
   * - 飯後運動：一律計入，輕鬆也算 1 倍（使用者指定飯後運動算有氧）
   * - 其他有氧：中強度 1 倍、高強度 2 倍、輕鬆不計入（WHO 定義）
   * - 肌力：不計入有氧 */
  function aerobicCredit(rec) {
    var min = rec.durationSec / 60;
    if (rec.category === "strength") return 0;
    if (rec.intensity === "vigorous") return min * 2;
    if (rec.category === "meal") return min;
    if (rec.intensity === "moderate") return min;
    return 0;
  }

  function kcal(met, weightKg, durationSec) {
    return Math.round(met * weightKg * durationSec / 3600);
  }

  function metFor(activity, intensity) {
    return (activity.met && activity.met[intensity]) || 3.5;
  }

  /* ---------- 週統計 ---------- */
  function weekSummary(records, startKey, goals) {
    var days = weekDays(startKey);
    var endKey = days[6];
    var perDay = {};
    days.forEach(function (k) {
      perDay[k] = { totalSec: 0, mealCount: 0, strength: false, credit: 0 };
    });
    var credit = 0, rawSec = 0, kcalSum = 0, mealCount = 0;
    records.forEach(function (r) {
      if (r.dateKey < startKey || r.dateKey > endKey) return;
      var d = perDay[r.dateKey];
      var c = aerobicCredit(r);
      d.totalSec += r.durationSec;
      d.credit += c;
      credit += c;
      rawSec += r.durationSec;
      kcalSum += r.kcal || 0;
      if (r.category === "strength") d.strength = true;
      if (r.category === "meal" && r.durationSec >= goals.mealMinMinutes * 60) {
        d.mealCount++;
        mealCount++;
      }
    });
    var strengthDays = days.filter(function (k) { return perDay[k].strength; }).length;
    var mealDaysMet = days.filter(function (k) { return perDay[k].mealCount >= goals.mealPerDay; }).length;
    var mealTarget = goals.mealPerDay * 7;
    return {
      days: days,
      perDay: perDay,
      aerobicCredit: credit,
      aerobicMet: credit >= goals.aerobicMinutes,
      strengthDays: strengthDays,
      strengthMet: strengthDays >= goals.strengthDays,
      mealCount: Math.min(mealCount, mealTarget),
      mealCountRaw: mealCount,
      mealTarget: mealTarget,
      mealDaysMet: mealDaysMet,
      mealMet: mealCount >= mealTarget,
      totalSec: rawSec,
      kcal: kcalSum,
    };
  }

  /* ---------- 計時 ---------- */
  /* session: { startedAt, pauses:[{from,to}], pausedAt|null } */
  function activeMs(session, nowTs) {
    var end = session.pausedAt || nowTs;
    var paused = 0;
    (session.pauses || []).forEach(function (p) { paused += p.to - p.from; });
    return Math.max(0, end - session.startedAt - paused);
  }

  function formatDuration(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (h > 0) return h + ":" + pad2(m) + ":" + pad2(s);
    return pad2(m) + ":" + pad2(s);
  }

  function formatMinutes(sec) {
    var m = Math.round(sec / 60);
    if (m < 60) return m + " 分";
    return Math.floor(m / 60) + " 小時 " + (m % 60) + " 分";
  }

  /* ---------- 計步 ----------
   * 輸入：事件時間戳（毫秒）與加速度（含重力，m/s^2）
   * 作法：取向量長度 → 指數平均去掉重力 → 低通平滑 → 帶遲滯的峰值偵測
   * 覆蓋率：相鄰樣本間隔 < 1 秒才算「有收到感測資料」 */
  function createStepDetector(opts) {
    opts = opts || {};
    var minInterval = opts.minIntervalMs || 250;      /* 最快 240 步/分 */
    var maxInterval = opts.maxIntervalMs || 2000;
    var hi = opts.highThreshold || 1.0;               /* m/s^2 */
    var lo = opts.lowThreshold || 0.3;
    var st = {
      steps: 0, coveredMs: 0, lastT: null, mean: null, smooth: 0,
      armed: true, lastStepT: null, recent: [],
    };
    function push(t, ax, ay, az) {
      if (ax == null || ay == null || az == null) return;
      var mag = Math.sqrt(ax * ax + ay * ay + az * az);
      if (st.lastT != null) {
        var gap = t - st.lastT;
        if (gap > 0 && gap < 1000) st.coveredMs += gap;
        else if (gap >= 1000) { st.armed = true; st.smooth = 0; }
      }
      st.lastT = t;
      st.mean = st.mean == null ? mag : st.mean + (mag - st.mean) * 0.02;
      var x = mag - st.mean;
      st.smooth = st.smooth + (x - st.smooth) * 0.35;
      if (st.armed && st.smooth > hi) {
        if (st.lastStepT == null || t - st.lastStepT >= minInterval) {
          st.steps++;
          st.lastStepT = t;
          st.recent.push(t);
          if (st.recent.length > 40) st.recent.shift();
        }
        st.armed = false;
      } else if (!st.armed && st.smooth < lo) {
        st.armed = true;
      }
    }
    /* 最近 windowMs 內的即時步頻 */
    function cadence(nowT, windowMs) {
      windowMs = windowMs || 10000;
      var r = st.recent.filter(function (t) { return nowT - t <= windowMs; });
      if (r.length < 4) return 0;
      var span = r[r.length - 1] - r[0];
      if (span <= 0 || nowT - r[r.length - 1] > maxInterval) return 0;
      return Math.round((r.length - 1) / span * 60000);
    }
    function snapshot() {
      return { steps: st.steps, coveredMs: st.coveredMs };
    }
    function restore(s) {
      st.steps = s.steps || 0;
      st.coveredMs = s.coveredMs || 0;
    }
    return { push: push, cadence: cadence, snapshot: snapshot, restore: restore, state: st };
  }

  /* 結束時判斷強度
   * - 有勾「依步頻判斷」的項目，且 IMU 覆蓋率 >= 50%、平均步頻有效 → 自動
   * - 否則用項目預設強度，需要時提示使用者確認 */
  function decideIntensity(activity, durationSec, imu) {
    var coverage = durationSec > 0 ? Math.min(1, imu.coveredMs / 1000 / durationSec) : 0;
    var avgCadence = imu.coveredMs > 0 ? Math.round(imu.steps / (imu.coveredMs / 60000)) : 0;
    if (activity.autoIntensity) {
      if (coverage >= 0.5 && imu.steps >= 20) {
        return { intensity: intensityFromCadence(avgCadence), source: "auto",
          coverage: coverage, avgCadence: avgCadence, needConfirm: false };
      }
      return { intensity: activity.defaultIntensity, source: "default",
        coverage: coverage, avgCadence: avgCadence, needConfirm: true };
    }
    return { intensity: activity.defaultIntensity, source: "default",
      coverage: coverage, avgCadence: avgCadence, needConfirm: false };
  }

  /* ---------- 節拍器排程 ----------
   * 標準 lookahead 排程：在 [now, now+lookahead) 內排好所有拍點
   * 若 nextTime 已落後（回到前景、AudioContext 曾暫停），直接重設到 now，
   * 避免一次補放一長串拍子 */
  function scheduleTicks(nextTime, now, lookahead, bpm) {
    var interval = 60 / bpm;
    if (nextTime < now) nextTime = now + 0.05;
    var times = [];
    while (nextTime < now + lookahead) {
      times.push(nextTime);
      nextTime += interval;
    }
    return { times: times, nextTime: nextTime };
  }

  function clampBpm(v) {
    v = Math.round(+v || 0);
    return Math.max(40, Math.min(220, v));
  }

  /* ---------- 預設資料 ---------- */
  var CATEGORY_NAME = { meal: "飯後運動", aerobic: "有氧運動", strength: "肌力訓練" };

  /* MET 值參考 2024 Adult Compendium of Physical Activities 的相近項目 */
  function defaultActivities() {
    return [
      { id: "meal-walk", name: "飯後散步", category: "meal", defaultIntensity: "moderate",
        autoIntensity: true, bpm: 110, met: { light: 2.8, moderate: 3.5, vigorous: 4.8 } },
      { id: "brisk-walk", name: "健走", category: "aerobic", defaultIntensity: "moderate",
        autoIntensity: true, bpm: 120, met: { light: 2.8, moderate: 4.3, vigorous: 5.0 } },
      { id: "super-slow-jog", name: "超慢跑", category: "aerobic", defaultIntensity: "moderate",
        autoIntensity: false, bpm: 180, met: { light: 3.5, moderate: 4.5, vigorous: 6.0 } },
      { id: "jog", name: "慢跑", category: "aerobic", defaultIntensity: "vigorous",
        autoIntensity: false, bpm: 160, met: { light: 6.0, moderate: 7.0, vigorous: 8.3 } },
      { id: "cycle", name: "騎車", category: "aerobic", defaultIntensity: "moderate",
        autoIntensity: false, bpm: 0, met: { light: 4.0, moderate: 6.8, vigorous: 8.0 } },
      { id: "swim", name: "游泳", category: "aerobic", defaultIntensity: "moderate",
        autoIntensity: false, bpm: 0, met: { light: 4.5, moderate: 6.0, vigorous: 9.8 } },
      { id: "aerobic-other", name: "其他有氧", category: "aerobic", defaultIntensity: "moderate",
        autoIntensity: false, bpm: 0, met: { light: 3.0, moderate: 5.0, vigorous: 7.5 } },
      { id: "str-upper", name: "上肢", category: "strength", defaultIntensity: "moderate",
        autoIntensity: false, bpm: 0, met: { light: 3.0, moderate: 3.5, vigorous: 6.0 } },
      { id: "str-lower", name: "下肢", category: "strength", defaultIntensity: "moderate",
        autoIntensity: false, bpm: 0, met: { light: 3.0, moderate: 3.5, vigorous: 6.0 } },
      { id: "str-core", name: "核心", category: "strength", defaultIntensity: "moderate",
        autoIntensity: false, bpm: 0, met: { light: 3.0, moderate: 3.5, vigorous: 6.0 } },
      { id: "str-full", name: "全身", category: "strength", defaultIntensity: "moderate",
        autoIntensity: false, bpm: 0, met: { light: 3.0, moderate: 3.5, vigorous: 6.0 } },
      { id: "str-other", name: "其他肌力", category: "strength", defaultIntensity: "moderate",
        autoIntensity: false, bpm: 0, met: { light: 3.0, moderate: 3.5, vigorous: 6.0 } },
    ];
  }

  function defaultSettings() {
    return {
      weekStart: 1,
      mealPerDay: 2,
      mealMinMinutes: 15,
      keepAwake: true,
      metronomeVolume: 0.7,
    };
  }

  /* 備份檔驗證：只接受本 App 匯出的格式，逐筆檢查必要欄位 */
  function validateRecord(r) {
    return r && typeof r.id === "string" && typeof r.start === "number" &&
      typeof r.durationSec === "number" && r.durationSec >= 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.dateKey) &&
      (r.category === "meal" || r.category === "aerobic" || r.category === "strength") &&
      (r.intensity === "light" || r.intensity === "moderate" || r.intensity === "vigorous");
  }

  function parseBackup(text) {
    var data = JSON.parse(text);
    if (!data || data.app !== "workout-records" || !Array.isArray(data.records)) {
      throw new Error("不是本 App 的備份檔");
    }
    var good = data.records.filter(validateRecord);
    return {
      records: good,
      skipped: data.records.length - good.length,
      profile: data.profile || null,
      settings: data.settings || null,
      activities: Array.isArray(data.activities) ? data.activities : null,
    };
  }

  function newId(ts) {
    return ts.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  return {
    DAY_MS: DAY_MS,
    pad2: pad2, dateKey: dateKey, parseDateKey: parseDateKey, addDays: addDays,
    weekStartKey: weekStartKey, weekDays: weekDays,
    ageFromBirthYear: ageFromBirthYear, bmi: bmi, bmiLevel: bmiLevel, bmr: bmr,
    weeklyGoals: weeklyGoals,
    INTENSITY_NAME: INTENSITY_NAME, CATEGORY_NAME: CATEGORY_NAME,
    intensityFromCadence: intensityFromCadence, aerobicCredit: aerobicCredit,
    kcal: kcal, metFor: metFor,
    weekSummary: weekSummary,
    activeMs: activeMs, formatDuration: formatDuration, formatMinutes: formatMinutes,
    createStepDetector: createStepDetector, decideIntensity: decideIntensity,
    scheduleTicks: scheduleTicks, clampBpm: clampBpm,
    defaultActivities: defaultActivities, defaultSettings: defaultSettings,
    validateRecord: validateRecord, parseBackup: parseBackup, newId: newId,
  };
});
