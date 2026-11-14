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
ok(C.aerobicCredit(rec({ category: "meal", intensity: "light" })) === 0, "飯後散步輕鬆（步頻不到 100）也算 0 分鐘");
ok(C.aerobicCredit(rec({ category: "meal", intensity: "moderate" })) === 30, "飯後散步中強度計 1 倍");
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

/* ---- 強度預選 ---- */
const acts = C.defaultActivities();
const walk = acts.find((a) => a.id === "brisk-walk");
const mealWalk = acts.find((a) => a.category === "meal");
const ssj = acts.find((a) => a.id === "super-slow-jog");
let d = C.decideIntensity(walk);
ok(d.intensity === null && d.needConfirm, "健走不預選強度，要自己選");
d = C.decideIntensity(mealWalk);
ok(d.intensity === null && d.needConfirm, "飯後散步不預選強度，要自己選");
d = C.decideIntensity(ssj);
ok(d.intensity === "moderate" && !d.needConfirm, "超慢跑預選中強度");
ok(C.createStepDetector === undefined && C.intensityFromCadence === undefined, "計步功能已移除");
ok(!("keepAwake" in C.defaultSettings()), "螢幕常亮設定已移除");

/* ---- 節拍器 ---- */
[180, 173, 160, 101].forEach((bpm) => {
  const cp = C.clickPositions(bpm, 60, 16000);
  ok(cp.positions.length === bpm && cp.totalSamples === 960000, bpm + " BPM：60 秒剛好 " + bpm + " 拍，循環長度 960000 樣本");
  const per = 16000 * 60 / bpm;
  const worst = Math.max(...cp.positions.map((p, i) => Math.abs(p - i * per)));
  ok(worst <= 0.5, bpm + " BPM 拍點誤差不超過半個樣本");
  /* 循環接縫：最後一拍到下一輪第一拍的間隔等於正常拍距 */
  const seam = cp.totalSamples - cp.positions[cp.positions.length - 1];
  ok(Math.abs(seam - per) <= 1, bpm + " BPM 循環接縫拍距正確");
});
const wav = C.buildMetronomeWav(180, 60, 16000, 0.7);
const dv = new DataView(wav);
const tag = (o) => String.fromCharCode(...new Uint8Array(wav, o, 4));
ok(tag(0) === "RIFF" && tag(8) === "WAVE" && tag(36) === "data" && dv.getUint32(24, true) === 16000 && dv.getUint16(34, true) === 16, "WAV 標頭正確");
ok(dv.getUint32(40, true) === 960000 * 2 && wav.byteLength === 44 + 960000 * 2, "WAV 資料長度 60 秒");
const sAt = (i) => dv.getInt16(44 + i * 2, true);
const peak = (from, to) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, Math.abs(sAt(i))); return m; };
const p2 = C.clickPositions(180, 60, 16000).positions[2];
ok(peak(p2, p2 + 200) > 20000 && peak(p2 + 1000, p2 + 5000) === 0, "每拍有滴答聲，拍與拍之間安靜");
const quiet = C.buildMetronomeWav(180, 60, 16000, 0.2);
ok(new DataView(quiet).getInt16(44 + 40 * 2, true) !== 0 && Math.abs(peak(0, 300)) > Math.abs((() => { const d = new DataView(quiet); let m = 0; for (let i = 0; i < 300; i++) m = Math.max(m, Math.abs(d.getInt16(44 + i * 2, true))); return m; })()), "音量寫進樣本");
[44100, 48000].forEach((sr) => {
  const f = C.metronomeSamples(173, 60, sr, 0.7);
  const cp2 = C.clickPositions(173, 60, sr);
  ok(f instanceof Float32Array && f.length === cp2.totalSamples, sr + " Hz 樣本長度等於整數拍循環長度");
  let mx = 0; for (let i = 0; i < 2000; i++) mx = Math.max(mx, Math.abs(f[i]));
  ok(mx > 0.6 && mx <= 0.7, sr + " Hz 樣本峰值依音量");
  /* 模擬原生循環：把兩輪接起來，找出所有拍點，間隔要一致（接縫不中斷） */
  const loops = 2, onsets = [];
  for (let k = 0; k < loops * f.length; k++) {
    const i = k % f.length, prev = (k - 1 + f.length) % f.length;
    if (k > 0 && f[i] !== 0 && f[prev] === 0 && (k < 50 || f[(k - 50 + f.length) % f.length] === 0)) onsets.push(k);
  }
  const gaps = onsets.slice(1).map((v, i) => v - onsets[i]);
  const per = sr * 60 / 173;
  ok(onsets.length >= 173 * 2 - 2 && gaps.every((g) => Math.abs(g - per) <= 1), sr + " Hz 跨循環接縫拍距一致");
});
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
