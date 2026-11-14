/* 端到端測試：真瀏覽器跑真頁面（puppeteer-core + chromium），假 Wake Lock，假時間用「把開始時間往前推」 */
const puppeteer = require(process.env.PUPPETEER_PATH || "/home/pi/WorkDir/browser-tool/node_modules/puppeteer-core");
const PORT = process.env.PORT || 8131;
const BASE = "http://localhost:" + PORT + "/";
const SHOT = __dirname + "/";
let fail = 0, pass = 0;
function ok(cond, msg) {
  console.log((cond ? "[O] " : "[X] ") + msg);
  if (cond) pass++; else fail++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stubs(page) {
  await page.evaluateOnNewDocument(() => {
    window.__wake = { requests: 0, locks: [] };
    window.__wake.held = () => window.__wake.locks.filter((l) => !l.released).length;
    const mk = () => {
      const l = { released: false, ls: [] };
      l.addEventListener = (t, f) => l.ls.push(f);
      l.release = () => { if (!l.released) { l.released = true; l.ls.forEach((f) => f()); } return Promise.resolve(); };
      return l;
    };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: () => { window.__wake.requests++; const l = mk(); window.__wake.locks.push(l); return Promise.resolve(l); } },
    });
  });
}

const ready = (page) => page.waitForFunction(() => document.body.getAttribute("data-ready") === "1" || !document.getElementById("welcome").hidden, { timeout: 10000 });
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const visible = (page, sel) => page.$eval(sel, (e) => !e.hidden && !e.closest("[hidden]"));
async function click(page, sel) { await page.click(sel); await sleep(150); }

/* 以 60Hz 餵入步伐訊號（時間軸對齊 performance.now），從 fromSec 秒前到 toSec 秒前 */
async function feedSteps(page, spm, fromSecAgo, toSecAgo) {
  await page.evaluate((spm, a, b) => {
    const now = performance.now();
    const f = spm / 60;
    for (let t = now - a * 1000; t < now - b * 1000; t += 1000 / 60) {
      const ph = Math.sin(2 * Math.PI * f * t / 1000);
      const pulse = 4 * Math.pow(Math.max(0, ph), 2) - 1;
      window.__wr.feedMotion(t, 0.3, 9.81 + pulse, 0.5);
    }
  }, spm, fromSecAgo, toSecAgo);
}

async function startActivity(page, id, minutesAgo) {
  await page.click('#tabbar [data-tab="start"]');
  await sleep(150);
  await click(page, '[data-action="pick"][data-id="' + id + '"]');
  await click(page, '[data-action="session-go"]');
  if (minutesAgo) {
    await page.evaluate((m) => { window.__wr.session.startedAt -= m * 60000; }, minutesAgo);
  }
}

async function finish(page, intensity) {
  await click(page, '[data-action="session-end"]');
  if (intensity) await page.click('#finIntensity input[value="' + intensity + '"]');
  await sleep(100);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    headless: "new",
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await stubs(page);
  await page.goto(BASE, { waitUntil: "load" });
  await ready(page);

  /* ---- 首次使用 ---- */
  ok(await visible(page, "#welcome"), "首次開啟顯示個人資料表單");
  await page.type("#welcomeForm [name=heightCm]", "175");
  await page.type("#welcomeForm [name=weightKg]", "70");
  await page.type("#welcomeForm [name=birthYear]", "1980");
  await page.click('#welcomeForm input[value="male"]');
  await click(page, "#welcomeForm button[type=submit]");
  await sleep(300);
  ok(!(await visible(page, "#welcome")), "填完後進入本週頁");
  ok((await text(page, "#cardAerobic")).includes("0 / 150 分鐘"), "BMI 22.9 目標 150 分鐘");
  ok((await text(page, "#cardMeal")).includes("今天 0 / 2 次"), "飯後每天 2 次");
  await page.screenshot({ path: SHOT + "shot_home_empty.png", fullPage: true });

  /* ---- 健走：IMU 完整覆蓋，自動判斷中強度 ---- */
  await startActivity(page, "brisk-walk", 10);
  ok(await page.evaluate(() => window.__wake.requests === 0), "螢幕常亮預設關閉，不要求 Wake Lock");
  ok((await text(page, "#wakeNote")).includes("可以鎖屏"), "提示可以鎖屏");
  await feedSteps(page, 115, 600, 0);
  await sleep(700);
  const steps = +(await text(page, "#stSteps"));
  ok(Math.abs(steps - 1150) < 60, "健走 10 分鐘計步約 1150（" + steps + "）");
  const cad = +(await text(page, "#stCadence"));
  ok(Math.abs(cad - 115) <= 5, "即時步頻約 115（" + cad + "）");
  ok((await text(page, "#stImu")) === "感測中", "動作感測狀態：感測中");
  ok((await text(page, "#timer")).startsWith("10:0"), "計時約 10 分鐘（" + (await text(page, "#timer")) + "）");
  await page.screenshot({ path: SHOT + "shot_session.png", fullPage: true });
  await finish(page);
  ok((await text(page, "#finHint")).includes("自動判斷為「中強度」"), "結束時自動判斷中強度");
  ok(await page.$eval('#finIntensity input[value="moderate"]', (e) => e.checked), "預選中強度");
  ok((await text(page, "#finCredit")).includes("計入有氧 10 分鐘"), "預覽計入有氧 10 分鐘");
  await page.screenshot({ path: SHOT + "shot_finish.png", fullPage: true });
  await click(page, '[data-action="finish-save"]');
  await sleep(300);
  ok(await page.evaluate(() => window.__wake.held() === 0), "結束後釋放螢幕常亮");
  ok((await text(page, "#cardAerobic")).includes("10 / 150"), "本週有氧 10 分鐘");

  /* ---- 真 DeviceMotionEvent 接線 ---- */
  await startActivity(page, "brisk-walk", 0);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new DeviceMotionEvent("devicemotion", { accelerationIncludingGravity: { x: 0, y: 9.8, z: 0 }, interval: 16 }));
    }
  });
  await sleep(700);
  ok((await text(page, "#stImu")) === "感測中", "真 devicemotion 事件有接上監聽");

  /* ---- 鎖屏缺口：20 分鐘只收到 3 分鐘資料，要使用者選強度 ---- */
  await page.evaluate(() => { window.__wr.session.startedAt -= 20 * 60000; });
  await feedSteps(page, 120, 180, 0);
  await finish(page);
  ok((await text(page, "#finHint")).includes("動作感測資料不足"), "感測不足時提示選強度");
  await page.click('#finIntensity input[value="vigorous"]');
  await sleep(100);
  ok((await text(page, "#finCredit")).includes("計入有氧 40 分鐘"), "改高強度預覽 40 分鐘");
  await click(page, '[data-action="finish-save"]');
  await sleep(300);
  ok((await text(page, "#cardAerobic")).includes("50 / 150"), "高強度 20 分鐘計 40，累計 50");

  /* ---- 暫停凍結計時 ---- */
  await startActivity(page, "str-upper", 30);
  await click(page, '[data-action="session-pause"]');
  const t1 = await text(page, "#timer");
  await sleep(1300);
  const t2 = await text(page, "#timer");
  ok(t1 === t2 && (await text(page, "#sessionState")) === "已暫停", "暫停時計時凍結（" + t1 + "）");
  await click(page, '[data-action="session-pause"]');
  ok((await text(page, "#sessionState")) === "計時中", "按繼續恢復計時");
  await finish(page);
  ok((await text(page, "#finCredit")).includes("計入肌力訓練天數"), "肌力不計有氧");
  await click(page, '[data-action="finish-save"]');
  await sleep(300);
  ok((await text(page, "#cardStrength")).includes("1 / 2 天"), "肌力 1 / 2 天");

  /* ---- 超慢跑 + 節拍器 + 重新載入接回 ---- */
  await startActivity(page, "super-slow-jog", 5);
  ok((await text(page, "#bpmVal")) === "180", "超慢跑預設 180 BPM");
  await click(page, '[data-action="bpm"][data-delta="-5"]');
  await click(page, '[data-action="bpm"][data-delta="1"]');
  ok((await text(page, "#bpmVal")) === "176", "BPM 調整 -5 +1 = 176");
  await click(page, '[data-action="bpm-set"][data-bpm="180"]');
  await click(page, '[data-action="metro-toggle"]');
  await sleep(1200);
  const au = () => page.evaluate(() => { const m = window.__wr.metro; const c = m.ctx; return { on: m.on, state: c && c.state, src: !!m.src, loop: m.src && m.src.loop, dur: m.buffer && m.buffer.duration, t: c && c.currentTime, loads: m.loads, btn: document.getElementById("metroToggle").textContent, audioEls: document.querySelectorAll("audio").length }; });
  let m = await au();
  ok(m.on && m.state === "running" && m.src && m.loop && Math.abs(m.dur - 60) < 0.001 && m.t > 0.5, "節拍以 Web Audio 原生循環播放（長度 " + m.dur + " 秒，音訊時鐘 " + m.t.toFixed(2) + " 秒）");
  ok(m.audioEls === 0, "不再使用 <audio loop>（接縫會停 1 秒的來源）");
  ok(await page.evaluate(() => { const b = window.__wr.metro.buffer; const f = b.getChannelData(0); let mx = 0; for (let i = 0; i < 3000; i++) mx = Math.max(mx, Math.abs(f[i])); return mx > 0.5 && b.length === Math.round(180 * b.sampleRate * 60 / 180); }), "音軌樣本與長度正確（整數拍）");
  ok(await page.evaluate(() => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === "節拍器 180 BPM"), "鎖屏畫面顯示節拍器資訊");
  /* 接縫實測：用 OfflineAudioContext 跑同樣的 loop 設定 2.5 輪（短音軌），檢查跨接縫拍距 */
  const seam = await page.evaluate(async () => {
    const sr = 8000, C = window.WRCore, f = C.metronomeSamples(150, 2, sr, 0.7);
    const oc = new OfflineAudioContext(1, Math.round(f.length * 2.5), sr);
    const b = oc.createBuffer(1, f.length, sr); b.getChannelData(0).set(f);
    const s = oc.createBufferSource(); s.buffer = b; s.loop = true; s.connect(oc.destination); s.start();
    const out = (await oc.startRendering()).getChannelData(0);
    const on = []; let last = -1e9;
    for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > 0.2 && i - last > 400) { on.push(i); last = i; }
    const gaps = on.slice(1).map((v, i) => v - on[i]);
    return { n: on.length, len: f.length, gaps };
  });
  ok(seam.n >= 12 && seam.gaps.every((g) => Math.abs(g - 3200) <= 2), "原生循環跨接縫拍距一致，無中斷（" + seam.n + " 拍，拍距 " + Math.min(...seam.gaps) + "–" + Math.max(...seam.gaps) + " 樣本）");
  await click(page, '[data-action="bpm"][data-delta="-5"]');
  await sleep(500);
  m = await au();
  ok(m.loads === 2 && m.src && m.on && Math.abs(m.dur - 60) < 0.001, "播放中改 BPM 會重新產生音軌並繼續播放");
  await click(page, '[data-action="bpm-set"][data-bpm="180"]');
  await sleep(300);
  await click(page, '[data-action="session-pause"]');
  await sleep(300);
  m = await au();
  ok(!m.src && !m.on, "暫停計時時節拍聲一起暫停");
  await click(page, '[data-action="session-pause"]');
  await sleep(500);
  m = await au();
  ok(m.src && m.on && m.state === "running", "繼續計時時節拍聲恢復");
  /* 模擬背景後回前景：音訊時鐘跟實際時間一致 → 提示持續；落後 → 提示中斷 */
  const visTest = (audioBehind) => page.evaluate(async (behind) => {
    const m = window.__wr.metro;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    m.hiddenAt.wall -= 30000;
    m.hiddenAt.audio -= 30 - behind;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.visibilityState;
    await new Promise((r) => setTimeout(r, 100));
    return document.getElementById("toast").textContent;
  }, audioBehind);
  let tt = await visTest(0);
  ok(tt.includes("[O]"), "回前景時確認背景期間節拍聲持續（" + tt + "）");
  tt = await visTest(30);
  ok(tt.includes("[!]") && tt.includes("30"), "回前景時偵測背景期間節拍聲中斷（" + tt + "）");
  await page.evaluate(() => window.__wr.metro.ctx.suspend());   /* 模擬來電打斷 */
  await sleep(300);
  m = await au();
  ok(!m.on && m.btn === "開啟", "被系統打斷時按鈕狀態同步（" + m.btn + "）");
  await click(page, '[data-action="metro-toggle"]');
  await sleep(400);
  m = await au();
  ok(m.src && m.on && m.state === "running", "再按開啟恢復播放");
  await feedSteps(page, 170, 15, 0);
  await sleep(700);
  ok((await text(page, "#cadenceCompare")).includes("偏慢 10"), "顯示實際步頻與目標差距（" + (await text(page, "#cadenceCompare")) + "）");
  const stepsBefore = await text(page, "#stSteps");
  await page.reload({ waitUntil: "load" });
  await ready(page);
  await sleep(300);
  ok(await visible(page, "#sessionScreen"), "重新開啟 App 接回進行中的運動");
  ok((await text(page, "#timer")).startsWith("05:"), "接回後計時延續（" + (await text(page, "#timer")) + "）");
  ok((await text(page, "#stSteps")) === stepsBefore && +stepsBefore > 0, "接回後步數延續（" + stepsBefore + "）");
  ok(await visible(page, "#motionRetry"), "接回後提供重新啟用動作感測按鈕");
  await finish(page);
  ok(await page.$eval('#finIntensity input[value="moderate"]', (e) => e.checked), "超慢跑步頻 180 仍是中強度");
  await click(page, '[data-action="finish-save"]');
  await sleep(300);
  const acts = await page.evaluate(() => window.__wr.state.activities.find((a) => a.id === "super-slow-jog").bpm);
  ok(acts === 180, "項目記住 BPM");

  /* ---- 飯後散步：15 分鐘門檻 ---- */
  await startActivity(page, "meal-walk", 16);
  await finish(page);
  ok((await text(page, "#finHint")).includes("動作感測資料不足"), "飯後散步沒帶手機要確認強度");
  ok((await text(page, "#finCredit")).includes("計入有氧 16 分鐘") && (await text(page, "#finCredit")).includes("算一次飯後運動"), "中強度飯後 16 分鐘：計入有氧且算一次");
  /* 連點兩下儲存只能存一筆 */
  await page.evaluate(() => { const b = document.querySelector('[data-action="finish-save"]'); b.click(); b.click(); });
  await sleep(300);
  await startActivity(page, "meal-walk", 14);
  await finish(page);
  ok((await text(page, "#finHint")).includes("未滿 15 分鐘"), "未滿 15 分鐘提示不算次數");
  await page.click('#finIntensity input[value="light"]');
  await sleep(100);
  ok((await text(page, "#finCredit")).includes("輕鬆強度不計入有氧分鐘數") && !(await text(page, "#finCredit")).includes("算一次"), "飯後輕鬆不計分鐘，未滿 15 分也不算次數");
  await click(page, '[data-action="finish-save"]');
  await sleep(300);
  ok((await text(page, "#cardMeal")).includes("今天 1 / 2 次"), "飯後今天 1 / 2 次");
  ok((await text(page, "#cardAerobic")).includes("71 / 150"), "有氧累計 10+40+5+16+0 = 71");
  /* 輕鬆但滿 15 分鐘的飯後散步：0 分鐘，但算一次 */
  await startActivity(page, "meal-walk", 20);
  await finish(page, "light");
  ok((await text(page, "#finCredit")).includes("輕鬆強度不計入有氧分鐘數") && (await text(page, "#finCredit")).includes("算一次飯後運動"), "輕鬆飯後 20 分鐘：不計分鐘但算一次");
  await click(page, '[data-action="finish-save"]');
  await sleep(300);
  ok((await text(page, "#cardMeal")).includes("今天 2 / 2 次") && (await text(page, "#cardAerobic")).includes("71 / 150"), "今天飯後 2 / 2 次，有氧仍 71");
  await page.screenshot({ path: SHOT + "shot_home.png", fullPage: true });

  /* ---- 取消準備中的運動不留紀錄 ---- */
  await page.click('#tabbar [data-tab="start"]');
  await sleep(150);
  await click(page, '[data-action="pick"][data-id="swim"]');
  await click(page, '[data-action="session-cancel"]');
  ok(!(await visible(page, "#sessionScreen")) && (await page.evaluate(() => localStorage.getItem("wr.session"))) === null, "取消後沒有殘留");

  /* ---- 歷史：月曆、單日明細、補登、修改、刪除 ---- */
  await page.click('#tabbar [data-tab="history"]');
  await sleep(400);
  const todayCell = await page.$eval(".cal-c.today .cal-m", (e) => e.textContent);
  ok(todayCell === "115", "月曆今天顯示 10+20+30+5+16+14+20 = 115 分鐘（" + todayCell + "）");
  const n = await page.$$eval("#dayDetail .rec", (l) => l.length);
  ok(n === 7, "今天 7 筆紀錄（" + n + "）");
  await page.screenshot({ path: SHOT + "shot_history.png", fullPage: true });
  /* 只改強度不可動到原本精確的時間（14 分多的飯後散步不能被進位成 15 分） */
  const mealRec = await page.evaluate(() => WRDB.allRecords().then((l) => {
    const r = l.find((x) => x.category === "meal" && x.durationSec < 900);
    r.durationSec = 880;   /* 14 分 40 秒 */
    return WRDB.putRecord(r).then(() => r);
  }));
  await page.evaluate((id) => document.querySelector('[data-action="edit-rec"][data-id="' + id + '"]').click(), mealRec.id);
  await sleep(300);
  await page.click('#editForm input[name="intensity"][value="moderate"]');
  await click(page, "#editForm button[type=submit]");
  await sleep(400);
  const mealAfter = await page.evaluate((id) => WRDB.getRecord(id), mealRec.id);
  ok(mealAfter.durationSec === mealRec.durationSec && mealAfter.start === mealRec.start && mealAfter.intensity === "moderate",
    "只改強度時保留精確時間（" + mealRec.durationSec + " 秒）");
  await page.evaluate(() => document.querySelector('#dayDetail [data-action="manual-add"]').click());
  await sleep(200);
  const yday = await page.evaluate(() => WRCore.addDays(WRCore.dateKey(Date.now()), -1));
  await page.$eval("#editForm [name=date]", (e, v) => { e.value = v; }, yday);
  await page.$eval("#editForm [name=time]", (e) => { e.value = "19:30"; });
  await page.select("#editActivity", "jog");
  await page.$eval("#editForm [name=minutes]", (e) => { e.value = "25"; });
  await page.click('#editForm input[name="intensity"][value="vigorous"]');
  await click(page, "#editForm button[type=submit]");
  await sleep(400);
  ok((await text(page, "#dayDetail")).includes("慢跑") && (await text(page, "#dayDetail")).includes("補登"), "補登昨天慢跑 25 分鐘");
  await page.click('#dayDetail [data-action="edit-rec"]');
  await sleep(300);
  await page.$eval("#editForm [name=minutes]", (e) => { e.value = "35"; });
  await click(page, "#editForm button[type=submit]");
  await sleep(400);
  ok((await text(page, "#dayDetail")).includes("35 分"), "修改為 35 分鐘");
  await page.click('#dayDetail [data-action="edit-rec"]');
  await sleep(300);
  await click(page, '[data-action="edit-delete"]');
  await sleep(400);
  ok((await text(page, "#dayDetail")).includes("這天沒有運動紀錄"), "刪除後該日無紀錄");
  await click(page, '[data-action="month-prev"]');
  await sleep(300);
  ok((await text(page, "#monthTitle")).length > 0 && (await page.$$(".cal-c:not(.empty)")).length >= 28, "可以切換到上個月");

  /* ---- 一年前的資料可查（不刪舊資料） ---- */
  await page.evaluate(() => {
    const ts = new Date(new Date().getFullYear() - 1, new Date().getMonth(), 3, 8, 0).getTime();
    return WRDB.putRecord({ id: "old1", start: ts, end: ts + 1800000, dateKey: WRCore.dateKey(ts), category: "aerobic",
      activityId: "jog", activityName: "慢跑", durationSec: 1800, intensity: "vigorous", kcal: 200, manual: true });
  });
  for (let i = 0; i < 11; i++) await click(page, '[data-action="month-prev"]');
  await sleep(300);
  const oldCell = await page.$eval('.cal-c[data-day$="-03"] .cal-m', (e) => e.textContent);
  ok(oldCell === "30", "一年前的紀錄仍可在月曆查到（" + oldCell + "）");

  /* ---- 設定：體重變更讓目標改變、舊紀錄熱量不變 ---- */
  await page.click('#tabbar [data-tab="settings"]');
  await sleep(400);
  await page.$eval("#profileForm [name=weightKg]", (e) => { e.value = "80"; });
  await click(page, "#profileForm button[type=submit]");
  await sleep(400);
  ok((await text(page, "#goalExplain")).includes("有氧 250 分鐘"), "BMI 26.1 目標改為 250");
  ok((await text(page, "#dataInfo")).includes("共 8 筆紀錄"), "資料筆數 8（" + (await text(page, "#dataInfo")) + "）");
  await page.screenshot({ path: SHOT + "shot_settings.png", fullPage: true });
  await page.type("#activityForm [name=name]", "跳繩");
  await click(page, "#activityForm button[type=submit]");
  await sleep(300);
  await page.click('#tabbar [data-tab="start"]');
  await sleep(200);
  ok((await text(page, "#activityGroups")).includes("跳繩"), "新增自訂項目出現在選單");
  await page.click('#tabbar [data-tab="home"]');
  await sleep(300);
  ok((await text(page, "#cardAerobic")).includes("/ 250 分鐘"), "本週頁目標同步更新");

  /* ---- 匯出 / 匯入 ---- */
  await page.click('#tabbar [data-tab="settings"]');
  await sleep(300);
  /* iOS 路徑：分享面板必須在點擊當下同步呼叫 */
  await page.evaluate(() => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = (d) => { window.__shared = { name: d.files[0].name, active: navigator.userActivation ? navigator.userActivation.isActive : true }; return Promise.resolve(); };
  });
  await click(page, '[data-action="export"]');
  const shared = await page.evaluate(() => window.__shared);
  ok(shared && /^workout-records-\d{4}-\d{2}-\d{2}\.json$/.test(shared.name) && shared.active, "匯出走分享面板且仍在使用者手勢內（" + JSON.stringify(shared) + "）");
  await page.evaluate(() => { navigator.canShare = undefined; });
  await click(page, '[data-action="export"]');
  await sleep(500);
  const exported = await page.evaluate(() => window.__lastExport);
  const ex = JSON.parse(exported);
  ok(ex.app === "workout-records" && ex.records.length === 8 && ex.profile.weightKg === 80, "匯出 8 筆與個人資料");

  /* ---- 離線 ---- */
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "load" });
  await ready(page);
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: "load" });
  await ready(page);
  ok((await text(page, "#cardAerobic")).includes("86 / 250"), "離線重新開啟仍可使用且資料還在（飯後改為 14 分 40 秒後累計 85.7）");
  await page.setOfflineMode(false);

  /* ---- 版面：手機寬度沒有橫向捲動 ---- */
  for (const w of [320, 375, 430]) {
    await page.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true });
    let worst = 0;
    for (const tab of ["home", "start", "history", "settings"]) {
      await page.click('#tabbar [data-tab="' + tab + '"]');
      await sleep(250);
      worst = Math.max(worst, await page.evaluate(() => document.documentElement.scrollWidth));
    }
    ok(worst <= w, "寬度 " + w + " 無橫向捲動（" + worst + "）");
  }
  await page.click('#tabbar [data-tab="settings"]');
  await sleep(300);
  await page.$eval("#settingsForm [name=keepAwake]", (e) => { e.checked = true; });
  await page.$eval("#settingsForm button[type=submit]", (e) => e.click());
  await sleep(400);
  await page.setViewport({ width: 320, height: 640, isMobile: true, hasTouch: true });
  await startActivity(page, "jog", 0);
  ok(await page.evaluate(() => window.__wake.held() === 1), "設定開啟螢幕常亮後，運動時取得 Wake Lock");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= 320), "計時畫面 320 寬不溢出");
  await page.screenshot({ path: SHOT + "shot_session_320.png", fullPage: true });
  await click(page, '[data-action="session-end"]');
  await click(page, '[data-action="finish-discard"]');
  ok(await page.evaluate(() => window.__wake.held() === 0), "結束後釋放 Wake Lock");

  /* ---- 匯入到全新的手機 ---- */
  const ctx2 = await browser.createBrowserContext();
  const p2 = await ctx2.newPage();
  p2.on("dialog", (d) => d.accept());
  p2.on("pageerror", (e) => errors.push(String(e)));
  await stubs(p2);
  await p2.goto(BASE, { waitUntil: "load" });
  await ready(p2);
  await p2.type("#welcomeForm [name=heightCm]", "175");
  await p2.type("#welcomeForm [name=weightKg]", "80");
  await p2.type("#welcomeForm [name=birthYear]", "1980");
  await p2.click('#welcomeForm input[value="male"]');
  await click(p2, "#welcomeForm button[type=submit]");
  await sleep(300);
  await p2.evaluate((t) => window.__wr.importText(t), exported);
  await sleep(300);
  await p2.evaluate((t) => window.__wr.importText(t), exported);   /* 重複匯入不會變兩倍 */
  await sleep(300);
  await p2.click('#tabbar [data-tab="settings"]');
  await sleep(400);
  ok((await text(p2, "#dataInfo")).includes("共 8 筆紀錄"), "新手機匯入 8 筆、重複匯入不重複");
  await p2.click('#tabbar [data-tab="start"]');
  await sleep(200);
  ok((await text(p2, "#activityGroups")).includes("跳繩"), "匯入帶回自訂項目");

  ok(errors.length === 0, "沒有 JavaScript 錯誤" + (errors.length ? "：" + errors.join(" | ") : ""));
  await browser.close();
  console.log((fail ? "[X] " : "[O] ") + "e2e：通過 " + pass + "，失敗 " + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[X] 測試中斷：", e); process.exit(1); });
