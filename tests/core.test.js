/* 核心邏輯單元測試（node 執行，TZ=Asia/Taipei） */
const C = require("../core.js");
let fail = 0, pass = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log("[X] " + msg); }
}
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + " (得到 " + a + "，預期 " + b + ")"); }

/* ---- 日期：本地時間，不可跑到前一天 ---- */
const t0700 = new Date(2026, 10, 14, 7, 0).getTime();        /* 11/14 07:00 本地 */
ok(C.dateKey(t0700) === "2026-11-14", "早上 7 點的 dateKey 不可跑到前一天");
ok(C.dateKey(new Date(2026, 10, 14, 0, 5).getTime()) === "2026-11-14", "凌晨 00:05 屬當天");
ok(C.dateKey(new Date(2026, 10, 14, 23, 59).getTime()) === "2026-11-14", "23:59 屬當天");
ok(C.addDays("2026-12-31", 1) === "2027-01-01", "跨年加一天");
ok(C.addDays("2026-03-01", -1) === "2026-02-28", "跨月減一天");
/* 2026-11-14 是星期六 */
ok(C.weekStartKey(t0700, 1) === "2026-11-09", "週一起算的週首");
ok(C.weekStartKey(t0700, 0) === "2026-11-08", "週日起算的週首");
ok(C.weekStartKey(new Date(2026, 10, 9, 0, 0).getTime(), 1) === "2026-11-09", "週一當天即週首");
ok(C.weekStartKey(new Date(2026, 10, 15, 23, 0).getTime(), 1) === "2026-11-09", "週日屬於前一個週一開始的那週");
ok(C.weekDays("2026-12-28").join(",") === "2026-12-28,2026-12-29,2026-12-30,2026-12-31,2027-01-01,2027-01-02,2027-01-03", "跨年週");

/* ---- 目標 ---- */
const now = t0700;
const S = C.defaultSettings();
let g = C.weeklyGoals({ heightCm: 175, weightKg: 70, birthYear: 1980, sex: "male" }, S, now);
ok(g.aerobicMinutes === 150 && g.strengthDays === 2 && g.mealPerDay === 2 && g.mealMinMinutes === 15, "正常 BMI 目標 150 分鐘");
ok(g.age === 46 && !g.balanceReminder, "年齡計算");
g = C.weeklyGoals({ heightCm: 170, weightKg: 75, birthYear: 1980, sex: "male" }, S, now);
ok(g.aerobicMinutes === 250, "BMI 25.9 目標提高到 250");
g = C.weeklyGoals({ heightCm: 170, weightKg: 69.3, birthYear: 1955, sex: "female" }, S, now);
ok(g.aerobicMinutes === 150 && g.balanceReminder, "BMI 23.98 仍 150，71 歲提醒平衡訓練");
g = C.weeklyGoals({ heightCm: 160, weightKg: 50, birthYear: 2012, sex: "female" }, S, now);
ok(g.aerobicMinutes === 420, "未滿 18 歲每週 420 分鐘");
near(C.bmr({ heightCm: 175, weightKg: 70, birthYear: 1980, sex: "male" }, now), 1569, 1, "男性 BMR");
near(C.bmr({ heightCm: 175, weightKg: 70, birthYear: 1980, sex: "female" }, now), 1403, 1, "女性 BMR");
ok(C.bmiLevel(23.9) === "正常" && C.bmiLevel(24) === "過重" && C.bmiLevel(27) === "肥胖", "BMI 分級");

/* ---- 計分 ---- */
const rec = (o) => Object.assign({ durationSec: 1800, category: "aerobic", intensity: "moderate" }, o);
ok(C.aerobicCredit(rec({})) === 30, "中強度 30 分 = 30");
ok(C.aerobicCredit(rec({ intensity: "vigorous" })) === 60, "高強度加倍");
ok(C.aerobicCredit(rec({ intensity: "light" })) === 0, "一般有氧輕鬆不計");
ok(C.aerobicCredit(rec({ category: "meal", intensity: "light" })) === 30, "飯後散步輕鬆也計 1 倍");
ok(C.aerobicCredit(rec({ category: "strength" })) === 0, "肌力不計入有氧");
ok(C.kcal(3.5, 70, 1800) === 123, "熱量 MET*kg*hr");

/* ---- 週統計 ---- */
const goals = C.weeklyGoals({ heightCm: 175, weightKg: 70, birthYear: 1980, sex: "male" }, S, now);
const mk = (dateKey, category, min, intensity) => ({ dateKey, category, durationSec: min * 60, intensity: intensity || "moderate", kcal: 10 });
let recs = [
  mk("2026-11-09", "meal", 15), mk("2026-11-09", "meal", 20),
  mk("2026-11-10", "meal", 14),                         /* 不足 15 分不算次數，但計入有氧 */
  mk("2026-11-10", "strength", 30), mk("2026-11-12", "strength", 25),
  mk("2026-11-11", "aerobic", 40, "vigorous"),
  mk("2026-11-08", "aerobic", 100),                      /* 上週，不算 */
  mk("2026-11-16", "aerobic", 100),                      /* 下週，不算 */
];
let w = C.weekSummary(recs, "2026-11-09", goals);
near(w.aerobicCredit, 15 + 20 + 14 + 80, 0.001, "有氧計分");
ok(!w.aerobicMet, "未達 150");
ok(w.strengthDays === 2 && w.strengthMet, "肌力兩天達標");
ok(w.mealCount === 2 && w.mealDaysMet === 1 && w.mealTarget === 14, "飯後次數與達標天數");
ok(w.perDay["2026-11-10"].totalSec === (14 + 30) * 60, "單日總時間含肌力");
/* 一天三次不能補另一天 */
const meals = [];
["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"].forEach((k) => { meals.push(mk(k, "meal", 15), mk(k, "meal", 15)); });
meals.push(mk("2026-11-14", "meal", 15), mk("2026-11-15", "meal", 15));
let wm = C.weekSummary(meals, "2026-11-09", goals);
ok(wm.mealCount === 13 && !wm.mealMet && wm.mealDaysMet === 6, "週六 3 次不能補週日 1 次（" + wm.mealCount + "）");
meals.push(mk("2026-11-15", "meal", 16));
wm = C.weekSummary(meals, "2026-11-09", goals);
ok(wm.mealCount === 14 && wm.mealMet && wm.mealDaysMet === 7, "每天 2 次才達標");
ok(C.formatMinutes(14 * 60 + 40) === "14 分", "14 分 40 秒顯示 14 分，不進位成 15");
recs.push(mk("2026-11-13", "aerobic", 30));
ok(C.weekSummary(recs, "2026-11-09", goals).aerobicMet, "達 159 分 >= 150");

/* ---- 計時 ---- */
const ses = { startedAt: 1000, pauses: [{ from: 61000, to: 121000 }], pausedAt: null };
ok(C.activeMs(ses, 301000) === 240000, "扣除暫停時間");
ok(C.activeMs(Object.assign({}, ses, { pausedAt: 181000 }), 999999) === 120000, "暫停中時間凍結");
ok(C.formatDuration(3725) === "1:02:05" && C.formatDuration(65) === "01:05", "時間格式");
ok(C.formatMinutes(3900) === "1 小時 5 分" && C.formatMinutes(600) === "10 分", "分鐘格式");

/* ---- 計步：合成加速度 ---- */
function simulate(spm, seconds, hz, amp, noise, gaps) {
  const det = C.createStepDetector();
  const f = spm / 60;
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  const dt = 1000 / hz;
  for (let t = 0; t < seconds * 1000; t += dt) {
    if (gaps && gaps.some(([a, b]) => t >= a && t < b)) continue;
    /* 步伐：每步一個尖峰（取正半週次方形成脈衝），加上雜訊與抖動的取樣間隔 */
    const phase = Math.sin(2 * Math.PI * f * t / 1000);
    const pulse = amp * Math.pow(Math.max(0, phase), 2) - amp * 0.25;
    const tt = t + rnd() * 2;
    det.push(tt, 0.3 + rnd() * noise, 9.81 + pulse + rnd() * noise, 0.5 + rnd() * noise);
  }
  return det;
}
[[100, 60], [120, 60], [160, 60], [180, 60]].forEach(([spm, s]) => {
  const det = simulate(spm, s, 60, 4, 0.4);
  const exp = spm * s / 60;
  ok(Math.abs(det.state.steps - exp) <= exp * 0.05, spm + " 步/分 計步誤差 5% 內（" + det.state.steps + "/" + exp + "）");
  const cad = det.cadence(s * 1000);
  ok(Math.abs(cad - spm) <= spm * 0.05, spm + " 步/分 即時步頻（" + cad + "）");
});
let det = simulate(120, 60, 30, 4, 0.4);
ok(Math.abs(det.state.steps - 120) <= 6, "30Hz 取樣也能計步（" + det.state.steps + "）");
det = simulate(120, 60, 60, 0.3, 0.1);
ok(det.state.steps < 5, "靜止微動不計步（" + det.state.steps + "）");
det = simulate(120, 120, 60, 4, 0.4, [[30000, 90000]]);
near(det.state.coveredMs / 1000, 60, 1.5, "鎖屏 60 秒不算覆蓋");

/* ---- 強度判定 ---- */
const walk = C.defaultActivities().find((a) => a.id === "brisk-walk");
const ssj = C.defaultActivities().find((a) => a.id === "super-slow-jog");
let d = C.decideIntensity(walk, 600, { steps: 1150, coveredMs: 600000 });
ok(d.intensity === "moderate" && d.source === "auto" && d.avgCadence === 115, "健走 115 步/分 自動中強度");
d = C.decideIntensity(walk, 600, { steps: 1350, coveredMs: 600000 });
ok(d.intensity === "vigorous", "健走 135 步/分 高強度");
d = C.decideIntensity(walk, 600, { steps: 300, coveredMs: 200000 });
ok(d.needConfirm && d.source === "default", "覆蓋率 33% 不足，要使用者確認");
d = C.decideIntensity(ssj, 600, { steps: 1800, coveredMs: 600000 });
ok(d.intensity === "moderate" && !d.needConfirm, "超慢跑 180 步/分 仍是中強度（不依步頻）");

/* ---- 節拍器 ---- */
let s1 = C.scheduleTicks(10.0, 10.0, 0.12, 180);
ok(s1.times.length === 1, "lookahead 0.12 秒內 180bpm 排 1 拍");
let s2 = C.scheduleTicks(s1.nextTime, 10.3, 0.12, 180);
near(s2.times[0], s1.times[0] + 1 / 3, 1e-9, "拍距 60/180 秒");
let s3 = C.scheduleTicks(10.0, 300.0, 0.12, 180);
ok(s3.times.length === 1 && s3.times[0] >= 300, "落後時重設，不補放一長串");
ok(C.clampBpm(300) === 220 && C.clampBpm("abc") === 40 && C.clampBpm(179.6) === 180, "BPM 範圍");

/* ---- 備份 ---- */
const good = { id: "a", start: 1, durationSec: 60, dateKey: "2026-11-14", category: "meal", intensity: "light" };
const bk = C.parseBackup(JSON.stringify({ app: "workout-records", records: [good, { id: "b" }] }));
ok(bk.records.length === 1 && bk.skipped === 1, "備份逐筆驗證");
let threw = false;
try { C.parseBackup('{"records":[]}'); } catch (e) { threw = true; }
ok(threw, "非本 App 備份拒收");

console.log((fail ? "[X] " : "[O] ") + "core 單元測試：通過 " + pass + "，失敗 " + fail);
process.exit(fail ? 1 : 0);
