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

  /* 計入每週有氧目標的分鐘數（飯後運動與一般有氧同一套規則，使用者指定）
   * - 中強度 1 倍、高強度 2 倍、輕鬆不計入（WHO 定義；走路步頻不到 100 步/分即輕鬆）
   * - 肌力：不計入有氧
   * 註：輕鬆的飯後運動雖然不計分鐘數，只要滿 mealMinMinutes 仍算一次飯後運動 */
  function aerobicCredit(rec) {
    var min = rec.durationSec / 60;
    if (rec.category === "strength") return 0;
    if (rec.intensity === "vigorous") return min * 2;
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
      if (r.category === "meal" && r.durationSec >= goals.mealMinMinutes * 60) d.mealCount++;
    });
    var strengthDays = days.filter(function (k) { return perDay[k].strength; }).length;
    var mealDaysMet = days.filter(function (k) { return perDay[k].mealCount >= goals.mealPerDay; }).length;
    var mealTarget = goals.mealPerDay * 7;
    /* 每天最多算 mealPerDay 次，一天多做不能補另一天 */
    days.forEach(function (k) { mealCount += Math.min(perDay[k].mealCount, goals.mealPerDay); });
    return {
      days: days,
      perDay: perDay,
      aerobicCredit: credit,
      aerobicMet: credit >= goals.aerobicMinutes,
      strengthDays: strengthDays,
      strengthMet: strengthDays >= goals.strengthDays,
      mealCount: mealCount,
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
    var m = Math.floor(sec / 60);
    if (m < 60) return m + " 分";
    return Math.floor(m / 60) + " 小時 " + (m % 60) + " 分";
  }

  /* 結束時預選的強度
   * - 走路類（autoIntensity：健走、飯後散步）不預選，要使用者依步頻自己判斷（不到 100 步/分選輕鬆）
   *   計步已移除（實測準確度不足），欄位名稱沿用以相容已存的項目設定
   * - 其他項目預選預設強度 */
  function decideIntensity(activity) {
    if (activity.autoIntensity) return { intensity: null, needConfirm: true };
    return { intensity: activity.defaultIntensity, needConfirm: false };
  }

  /* ---------- 節拍器音軌 ----------
   * 由 Web Audio 的 AudioBufferSourceNode（loop）在音訊執行緒原生循環，不經 JS 計時，
   * 也不像 <audio loop> 在 iOS 每次回到開頭都會停約 1 秒。
   * 長度取整數拍：60 秒、整數 BPM 剛好 bpm 拍，循環接縫不會亂拍。
   * 拍點位置用 round(i * 每拍樣本數)，誤差小於 1 個樣本，不會累積。 */
  function clickPositions(bpm, seconds, sampleRate) {
    var beats = Math.max(1, Math.round(seconds * bpm / 60));
    var per = sampleRate * 60 / bpm;
    var pos = [];
    for (var i = 0; i < beats; i++) pos.push(Math.round(i * per));
    return { positions: pos, totalSamples: Math.round(beats * per) };
  }

  /* 回傳 -1..1 的 Float32 樣本（長度 = totalSamples），WAV 與 AudioBuffer 共用 */
  function metronomeSamples(bpm, seconds, sampleRate, volume) {
    var cp = clickPositions(bpm, seconds, sampleRate);
    var n = cp.totalSamples;
    var out = new Float32Array(n);
    var len = Math.round(0.03 * sampleRate), attack = Math.max(1, Math.round(0.002 * sampleRate));
    var tau = 0.006 * sampleRate, amp = Math.max(0, Math.min(1, volume));
    var half = sampleRate / 1600 / 2;   /* 1600Hz 方波的半週期（樣本數） */
    cp.positions.forEach(function (p) {
      for (var j = 0; j < len && p + j < n; j++) {
        var env = j < attack ? j / attack : Math.exp(-(j - attack) / tau);
        var sq = Math.floor(j / half) % 2 === 0 ? 1 : -1;
        out[p + j] = amp * env * sq;
      }
    });
    return out;
  }

  /* 試聽用短 WAV（iOS 會忽略 audio.volume，所以音量直接寫進樣本） */
  function buildMetronomeWav(bpm, seconds, sampleRate, volume) {
    var f = metronomeSamples(bpm, seconds, sampleRate, volume);
    var n = f.length;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(f[i] * 32767), true);
    return buf;
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
    aerobicCredit: aerobicCredit,
    kcal: kcal, metFor: metFor,
    weekSummary: weekSummary,
    activeMs: activeMs, formatDuration: formatDuration, formatMinutes: formatMinutes,
    decideIntensity: decideIntensity,
    clickPositions: clickPositions, metronomeSamples: metronomeSamples, buildMetronomeWav: buildMetronomeWav, clampBpm: clampBpm,
    defaultActivities: defaultActivities, defaultSettings: defaultSettings,
    validateRecord: validateRecord, parseBackup: parseBackup, newId: newId,
  };
});
