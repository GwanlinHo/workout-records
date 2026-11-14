/* 運動紀錄 App 主程式 */
(function () {
  "use strict";
  var C = window.WRCore;
  var DB = window.WRDB;
  var SESSION_KEY = "wr.session";

  var state = {
    profile: null,
    settings: C.defaultSettings(),
    activities: C.defaultActivities(),
    tab: "home",
    month: null,          /* "YYYY-MM" */
    selectedDay: null,
    editingId: null,
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function now() { return Date.now(); }
  function todayKey() { return C.dateKey(now()); }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function activityById(id) {
    for (var i = 0; i < state.activities.length; i++) {
      if (state.activities[i].id === id) return state.activities[i];
    }
    return null;
  }

  function goals() {
    return C.weeklyGoals(state.profile, state.settings, now());
  }

  /* ================= 本週 ================= */
  function statusMark(met) {
    return met ? '<span class="status good">[O] 已達標</span>' : '<span class="status warn">[!] 未達標</span>';
  }

  function progressBar(value, target) {
    var pct = Math.max(0, Math.min(100, target > 0 ? value / target * 100 : 0));
    return '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + target +
      '" aria-valuenow="' + Math.round(value) + '"><div style="width:' + pct.toFixed(1) + '%"></div></div>';
  }

  function dayLabel(key) {
    var d = new Date(C.parseDateKey(key));
    return (d.getMonth() + 1) + "/" + d.getDate() + "（" + "日一二三四五六".charAt(d.getDay()) + "）";
  }

  function renderHome() {
    if (!state.profile) return Promise.resolve();
    var g = goals();
    var start = C.weekStartKey(now(), state.settings.weekStart);
    var days = C.weekDays(start);
    return DB.rangeRecords(days[0], days[6]).then(function (recs) {
      var w = C.weekSummary(recs, start, g);
      var tk = todayKey();
      $("weekRange").textContent = "本週 " + dayLabel(days[0]) + " 到 " + dayLabel(days[6]);

      var credit = Math.round(w.aerobicCredit);
      $("cardAerobic").innerHTML =
        '<div class="card-head"><h2>有氧運動</h2>' + statusMark(w.aerobicMet) + "</div>" +
        '<p class="big-num"><b class="mono">' + credit + '</b> / ' + g.aerobicMinutes + " 分鐘</p>" +
        progressBar(credit, g.aerobicMinutes) +
        '<p class="small muted">' + (w.aerobicMet ? "本週有氧已達標。" : "還差 " + (g.aerobicMinutes - credit) + " 分鐘中強度（或 " + Math.ceil((g.aerobicMinutes - credit) / 2) + " 分鐘高強度）。") +
        "含飯後運動，高強度 1 分鐘算 2 分鐘。</p>";

      var today = w.perDay[tk] || { mealCount: 0 };
      var dots = days.map(function (k) {
        var n = w.perDay[k].mealCount;
        var cls = n >= g.mealPerDay ? "dot full" : n > 0 ? "dot half" : "dot";
        if (k > tk) cls += " future";
        return '<div class="daycell"><span class="' + cls + '" title="' + n + ' 次"></span><span class="small">' +
          "日一二三四五六".charAt(new Date(C.parseDateKey(k)).getDay()) + "</span></div>";
      }).join("");
      $("cardMeal").innerHTML =
        '<div class="card-head"><h2>飯後運動</h2>' + statusMark(w.mealMet) + "</div>" +
        '<p class="big-num">今天 <b class="mono">' + Math.min(today.mealCount, g.mealPerDay) + "</b> / " + g.mealPerDay + " 次" +
        (today.mealCount >= g.mealPerDay ? '　<span class="status good">[O]</span>' : "") + "</p>" +
        '<div class="days">' + dots + "</div>" +
        '<p class="small muted">本週 ' + w.mealCount + " / " + w.mealTarget + " 次，達標 " + w.mealDaysMet + " 天。每次至少 " + g.mealMinMinutes + " 分鐘才算一次。</p>";

      var sdots = days.map(function (k) {
        var cls = w.perDay[k].strength ? "dot full" : "dot";
        if (k > tk) cls += " future";
        return '<div class="daycell"><span class="' + cls + '"></span><span class="small">' +
          "日一二三四五六".charAt(new Date(C.parseDateKey(k)).getDay()) + "</span></div>";
      }).join("");
      $("cardStrength").innerHTML =
        '<div class="card-head"><h2>肌力訓練</h2>' + statusMark(w.strengthMet) + "</div>" +
        '<p class="big-num"><b class="mono">' + w.strengthDays + "</b> / " + g.strengthDays + " 天</p>" +
        '<div class="days">' + sdots + "</div>" +
        (g.balanceReminder ? '<p class="small muted">65 歲以上建議同時做平衡訓練。</p>' : "");

      var maxSec = Math.max(1800, Math.max.apply(null, days.map(function (k) { return w.perDay[k].totalSec; })));
      var cols = days.map(function (k) {
        var sec = w.perDay[k].totalSec;
        var h = sec / maxSec * 100;
        return '<button class="dcol' + (k === tk ? " today" : "") + '" data-action="open-day" data-day="' + k + '" title="' +
          dayLabel(k) + " " + C.formatMinutes(sec) + '"><span class="dval mono">' + (sec ? Math.round(sec / 60) : "") +
          '</span><span class="dbar"><span style="height:' + h.toFixed(1) + '%"></span></span><span class="small">' +
          "日一二三四五六".charAt(new Date(C.parseDateKey(k)).getDay()) + "</span></button>";
      }).join("");
      $("cardDays").innerHTML = '<div class="card-head"><h2>每日運動分鐘數</h2><span class="small muted">共 ' +
        C.formatMinutes(w.totalSec) + "，約 " + w.kcal + " 大卡</span></div>" +
        '<div class="dcols">' + cols + "</div>";
    });
  }

  /* ================= 選運動 ================= */
  function renderStart() {
    var html = ["meal", "aerobic", "strength"].map(function (cat) {
      var items = state.activities.filter(function (a) { return a.category === cat; });
      return '<div class="card"><h2>' + C.CATEGORY_NAME[cat] + '</h2><div class="act-grid">' +
        items.map(function (a) {
          return '<button class="btn act" data-action="pick" data-id="' + esc(a.id) + '">' + esc(a.name) +
            '<small>' + C.INTENSITY_NAME[a.defaultIntensity] + (a.autoIntensity ? "・依步頻" : "") + "</small></button>";
        }).join("") + "</div></div>";
    }).join("");
    $("activityGroups").innerHTML = html;
  }

  /* ================= 計時 ================= */
  var session = null;      /* 見 saveSession */
  var detector = null;
  var tickTimer = null;
  var lastMotionT = 0;
  var motionState = "off"; /* off | asking | on | denied | unsupported */

  function saveSession() {
    if (!session) { try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* 忽略 */ } return; }
    if (detector) session.imu = detector.snapshot();
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* 忽略 */ }
  }

  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && s.activityId && activityById(s.activityId)) return s;
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function pickActivity(id) {
    if (session && session.startedAt) {
      openSessionScreen();
      toast("已有運動正在計時");
      return;
    }
    var a = activityById(id);
    session = { activityId: id, startedAt: null, pauses: [], pausedAt: null, imu: { steps: 0, coveredMs: 0 },
      bpm: a.bpm || 180 };
    metro.bpm = C.clampBpm(session.bpm);
    openSessionScreen();
  }

  function openSessionScreen() {
    var a = activityById(session.activityId);
    $("sessionName").textContent = a.name;
    $("sessionCat").textContent = C.CATEGORY_NAME[a.category];
    var running = !!session.startedAt;
    $("readyPanel").hidden = running;
    $("runPanel").hidden = !running;
    $("sessionActions").hidden = !running;
    $("cancelReady").hidden = running;
    $("sessionScreen").hidden = false;
    updateMetroUI();
    updateTimer();
  }

  function sessionGo() {
    /* 都在使用者點擊的當下：動作權限、音訊解鎖、Wake Lock 第一次要求 */
    session.startedAt = now();
    session.pauses = [];
    session.pausedAt = null;
    detector = C.createStepDetector();
    startMotion();
    saveSession();
    openSessionScreen();
    startTicking();
    requestWake();
    if (metro.wanted) metroStart();
  }

  function startTicking() {
    clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      updateTimer();
      wakeKeepAlive();
    }, 500);
    updateTimer();
  }

  var lastPersist = 0;
  function updateTimer() {
    if (!session) return;
    var ms = session.startedAt ? C.activeMs(session, now()) : 0;
    $("timer").textContent = C.formatDuration(ms / 1000);
    if (!session.startedAt) {
      $("sessionState").textContent = "準備開始";
      return;
    }
    $("sessionState").textContent = session.pausedAt ? "已暫停" : "計時中";
    $("pauseBtn").textContent = session.pausedAt ? "繼續" : "暫停";
    var a = activityById(session.activityId);
    $("bannerName").textContent = a.name;
    $("bannerTime").textContent = C.formatDuration(ms / 1000);
    if (detector) {
      var t = performance.now();
      $("stSteps").textContent = detector.state.steps;
      var cad = detector.cadence(lastMotionT || t);
      if (t - lastMotionT > 3000) cad = 0;
      $("stCadence").textContent = cad ? cad : "-";
      var cmp = "";
      if (metro.on && cad) {
        var diff = cad - metro.bpm;
        cmp = "實際步頻 " + cad + "，目標 " + metro.bpm + (Math.abs(diff) <= 5 ? "　[O] 跟上節奏" :
          diff > 0 ? "　[!] 偏快 " + diff : "　[!] 偏慢 " + (-diff));
      }
      $("cadenceCompare").textContent = cmp;
    }
    var imuText = { off: "未啟用", asking: "要求權限中", denied: "未授權", unsupported: "不支援" }[motionState];
    if (motionState === "on") imuText = performance.now() - lastMotionT < 2000 ? "感測中" : "沒有收到資料";
    $("stImu").textContent = imuText || "-";
    $("motionRetry").hidden = !(motionState === "off" || motionState === "denied");
    var t2 = now();
    if (t2 - lastPersist > 5000) { lastPersist = t2; saveSession(); }
  }

  function togglePause() {
    if (!session || !session.startedAt) return;
    if (session.pausedAt) {
      session.pauses.push({ from: session.pausedAt, to: now() });
      session.pausedAt = null;
      if (metro.resumeOnContinue) { metro.resumeOnContinue = false; metroPlay(); }
    } else {
      session.pausedAt = now();
      if (metro.on) { metro.resumeOnContinue = true; metroHalt(); }
    }
    saveSession();
    updateTimer();
  }

  /* ---------- 動作感測 ---------- */
  function onMotion(e) {
    if (!session || !session.startedAt || session.pausedAt || !detector) return;
    var a = e.accelerationIncludingGravity;
    if (!a) return;
    lastMotionT = e.timeStamp || performance.now();
    detector.push(lastMotionT, a.x, a.y, a.z);
  }

  function attachMotion() {
    window.removeEventListener("devicemotion", onMotion);
    window.addEventListener("devicemotion", onMotion);
    motionState = "on";
  }

  function startMotion() {
    if (typeof window.DeviceMotionEvent === "undefined") { motionState = "unsupported"; return; }
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      motionState = "asking";
      try {
        DeviceMotionEvent.requestPermission().then(function (p) {
          if (p === "granted") attachMotion();
          else motionState = "denied";
          updateTimer();
        }, function () { motionState = "off"; updateTimer(); });
      } catch (err) { motionState = "off"; }
    } else {
      attachMotion();
    }
  }

  function stopMotion() {
    window.removeEventListener("devicemotion", onMotion);
    motionState = "off";
  }

  /* ---------- 節拍器 ----------
   * 依 BPM 預先產生 60 秒（整數拍）的滴答聲，交給 Web Audio 的 AudioBufferSourceNode 以 loop 原生循環：
   * 循環在音訊執行緒進行，不靠 JS 計時（鎖屏後 JS 會被凍結），接縫也不像 <audio loop> 會停約 1 秒。
   * audioSession 設為 playback（使用者選定）：鎖屏、靜音開關都不影響，但會暫停其他 App 的音樂。
   * 鎖屏時 iOS 是否讓 AudioContext 繼續跑需實機確認；回到前景時會比對音訊時鐘與實際時間並提示結果。 */
  var TRACK_SECONDS = 60, TRACK_RATE = 16000;
  var metro = { ctx: null, src: null, buffer: null, on: false, wanted: false, bpm: 180, trackKey: "", resumeOnContinue: false, loads: 0, hiddenAt: null };

  function setAudioSessionType() {
    if (navigator.audioSession) {
      try { navigator.audioSession.type = "playback"; } catch (e) { /* 忽略 */ }
    }
  }

  /* 整個 App 只用一個 AudioContext，第一次在使用者點擊當下建立 */
  function ensureCtx() {
    if (metro.ctx) return metro.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ctx = new AC();
    /* 被系統打斷（來電等）時同步按鈕狀態；鎖屏造成的暫停留給回前景時處理 */
    ctx.onstatechange = function () {
      if (ctx.state === "running" || !metro.on || document.visibilityState !== "visible") return;
      metro.on = false;
      metro.resumeOnContinue = false;
      stopSource();
      updateMetroUI();
    };
    metro.ctx = ctx;
    return ctx;
  }

  function loadBuffer(ctx) {
    var vol = state.settings.metronomeVolume || 0.7;
    var key = metro.bpm + "@" + vol + "@" + ctx.sampleRate;
    if (key === metro.trackKey && metro.buffer) return metro.buffer;
    var f = C.metronomeSamples(metro.bpm, TRACK_SECONDS, ctx.sampleRate, vol);
    var buf = ctx.createBuffer(1, f.length, ctx.sampleRate);
    buf.getChannelData(0).set(f);
    metro.buffer = buf;
    metro.trackKey = key;
    metro.loads++;
    return buf;
  }

  function stopSource() {
    if (!metro.src) return;
    try { metro.src.stop(); } catch (e) { /* 忽略 */ }
    try { metro.src.disconnect(); } catch (e) { /* 忽略 */ }
    metro.src = null;
  }

  /* 必須在使用者點擊（或鎖屏畫面的播放鍵）當下呼叫 */
  function metroPlay() {
    setAudioSessionType();
    var ctx = ensureCtx();
    if (!ctx) { toast("這個瀏覽器不支援節拍聲"); return; }
    var buf = loadBuffer(ctx);
    stopSource();
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(ctx.destination);
    src.start();
    metro.src = src;
    metro.on = true;
    metro.wanted = true;
    if (ctx.state !== "running") {
      ctx.resume().catch(function () {
        if (metro.src !== src) return;
        stopSource();
        metro.on = false;
        updateMetroUI();
        toast("無法播放節拍聲，請再按一次開啟");
      });
    }
    setMediaSession();
    updateMetroUI();
  }

  function metroStart() { metroPlay(); }

  function metroHalt() {
    metro.on = false;
    stopSource();
    updateMetroUI();
  }

  function metroStop() {
    metro.wanted = false;
    metro.resumeOnContinue = false;
    metroHalt();
    /* 結束後讓出音訊，其他 App 的音樂才能繼續 */
    if (metro.ctx && metro.ctx.state === "running") metro.ctx.suspend().catch(function () { /* 忽略 */ });
    if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = "none"; } catch (e) { /* 忽略 */ } }
  }

  /* 回到前景：檢查鎖屏期間節拍聲有沒有持續，必要時接回 */
  function metroOnVisible() {
    var h = metro.hiddenAt;
    metro.hiddenAt = null;
    if (!metro.on || !metro.ctx) return;
    var ctx = metro.ctx;
    if (h && Date.now() - h.wall > 10000) {
      var wallSec = (Date.now() - h.wall) / 1000;
      var lost = Math.max(0, wallSec - (ctx.currentTime - h.audio));
      if (lost > 3) toast("[!] 背景期間節拍聲中斷約 " + Math.round(lost) + " 秒");
      else toast("[O] 背景期間節拍聲持續播放");
    }
    if (ctx.state !== "running") {
      ctx.resume().catch(function () {
        metro.on = false;
        stopSource();
        updateMetroUI();
        toast("節拍聲已停止，請再按一次開啟");
      });
    }
  }

  function metroOnHidden() {
    if (metro.on && metro.ctx) metro.hiddenAt = { wall: Date.now(), audio: metro.ctx.currentTime };
  }

  /* 鎖屏畫面顯示節拍器與播放、暫停鍵 */
  function setMediaSession() {
    if (!("mediaSession" in navigator)) return;
    try {
      if (window.MediaMetadata) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: "節拍器 " + metro.bpm + " BPM", artist: "運動紀錄" });
      }
      navigator.mediaSession.setActionHandler("play", function () { metroPlay(); });
      navigator.mediaSession.setActionHandler("pause", function () { metroStop(); });
      navigator.mediaSession.playbackState = "playing";
    } catch (e) { /* 忽略 */ }
  }

  function testTick() {
    state.settings.metronomeVolume = +$("settingsForm").metronomeVolume.value;
    setAudioSessionType();
    var wav = C.buildMetronomeWav(120, 2, TRACK_RATE, state.settings.metronomeVolume);
    var url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    var a = new Audio(url);
    a.addEventListener("ended", function () { URL.revokeObjectURL(url); });
    a.play().catch(function () { toast("無法播放"); });
  }

  function setBpm(v) {
    metro.bpm = C.clampBpm(v);
    if (metro.on) metroPlay();   /* 重新產生音軌，用新速度播放 */
    if (session) {
      session.bpm = metro.bpm;
      saveSession();
      var a = activityById(session.activityId);
      if (a && a.bpm !== metro.bpm) {
        a.bpm = metro.bpm;   /* 每個項目記住上次用的 BPM */
        DB.setKV("activities", state.activities);
      }
    }
    updateMetroUI();
  }

  function updateMetroUI() {
    $("bpmVal").textContent = metro.bpm;
    var b = $("metroToggle");
    b.textContent = metro.on ? "關閉" : "開啟";
    b.setAttribute("aria-pressed", metro.on ? "true" : "false");
    b.classList.toggle("primary", metro.on);
  }

  /* ---------- 螢幕常亮（只用 Screen Wake Lock，沿用金剛經 App 的作法） ---------- */
  var wakeLock = null;
  var wakePending = false;
  var lastWakeTry = 0;

  function wakeWanted() {
    return state.settings.keepAwake && session && session.startedAt;
  }

  function requestWake() {
    if (!wakeWanted()) { releaseWake(); return; }
    if (!("wakeLock" in navigator) || wakeLock || wakePending || document.visibilityState === "hidden") {
      updateWakeNote();
      return;
    }
    wakePending = true;
    lastWakeTry = now();
    try {
      navigator.wakeLock.request("screen").then(function (lock) {
        wakePending = false;
        if (!wakeWanted()) {
          try { lock.release(); } catch (e) { /* 忽略 */ }
          updateWakeNote();
          return;
        }
        wakeLock = lock;
        lock.addEventListener("release", function () {
          if (wakeLock === lock) wakeLock = null;
          updateWakeNote();
        });
        updateWakeNote();
      }, function () {
        wakePending = false;
        updateWakeNote();
      });
    } catch (e) {
      wakePending = false;
    }
    updateWakeNote();
  }

  function wakeKeepAlive() {
    if (wakeWanted() && !wakeLock && !wakePending && now() - lastWakeTry > 10000) requestWake();
  }

  function releaseWake() {
    var lock = wakeLock;
    wakeLock = null;
    try { if (lock) lock.release(); } catch (e) { /* 忽略 */ }
    updateWakeNote();
  }

  function updateWakeNote() {
    var t;
    if (!state.settings.keepAwake) t = "可以鎖屏：計時與節拍聲會繼續，但鎖屏期間不會計步。";
    else if (!("wakeLock" in navigator)) t = "此裝置不支援螢幕常亮，請把系統的自動鎖定時間調長。";
    else if (wakeLock) t = "螢幕常亮中。";
    else if (wakePending) t = "正在取得螢幕常亮…";
    else t = "螢幕常亮取得失敗，會每 10 秒重試。";
    $("wakeNote").textContent = t;
  }

  /* ---------- 結束 ---------- */
  var finishInfo = null;

  function sessionEnd() {
    if (!session.pausedAt) session.pausedAt = now();
    saveSession();
    var a = activityById(session.activityId);
    var durationSec = Math.round(C.activeMs(session, now()) / 1000);
    var imu = detector ? detector.snapshot() : session.imu;
    var d = C.decideIntensity(a, durationSec, imu);
    finishInfo = { activity: a, durationSec: durationSec, imu: imu, decision: d };
    $("finName").textContent = a.name;
    $("finDur").textContent = C.formatDuration(durationSec);
    $("finImu").textContent = imu.steps ? "步數 " + imu.steps + "，平均步頻 " + d.avgCadence + " 步/分，動作感測涵蓋 " +
      Math.round(d.coverage * 100) + "% 的時間" : "這次沒有收到計步資料";
    var hint = "";
    if (d.source === "auto") hint = "已依步頻自動判斷為「" + C.INTENSITY_NAME[d.intensity] + "」，可以修改。";
    else if (d.needConfirm) hint = "[!] 動作感測資料不足（例如鎖屏或手機沒帶在身上），請選擇這次的強度。";
    else hint = "已套用此項目的預設強度，可以修改。";
    if (a.category === "meal" && durationSec < state.settings.mealMinMinutes * 60) {
      hint += " 這次未滿 " + state.settings.mealMinMinutes + " 分鐘，不算一次飯後運動（有氧分鐘數照強度計算）。";
    }
    $("finHint").textContent = hint;
    $("finHint").classList.toggle("warn-text", d.needConfirm);
    var radios = document.querySelectorAll('input[name="finInt"]');
    radios.forEach(function (r) { r.checked = r.value === d.intensity; });
    updateFinCredit();
    $("finishSheet").hidden = false;
  }

  function updateFinCredit() {
    if (!finishInfo) return;
    var sel = document.querySelector('input[name="finInt"]:checked');
    var intensity = sel ? sel.value : finishInfo.decision.intensity;
    var rec = { category: finishInfo.activity.category, intensity: intensity, durationSec: finishInfo.durationSec };
    var cr = C.aerobicCredit(rec);
    var k = C.kcal(C.metFor(finishInfo.activity, intensity), state.profile.weightKg, finishInfo.durationSec);
    var txt = finishInfo.activity.category === "strength" ? "計入肌力訓練天數。" :
      cr > 0 ? "計入有氧 " + Math.round(cr) + " 分鐘。" : "輕鬆強度不計入有氧分鐘數。";
    if (finishInfo.activity.category === "meal" && finishInfo.durationSec >= state.settings.mealMinMinutes * 60) txt += "算一次飯後運動。";
    $("finCredit").textContent = txt + "約消耗 " + k + " 大卡。";
  }

  var saving = false;
  function finishSave() {
    if (saving || !finishInfo) return;
    saving = true;
    var sel = document.querySelector('input[name="finInt"]:checked');
    var a = finishInfo.activity;
    var intensity = sel ? sel.value : finishInfo.decision.intensity;
    var d = finishInfo.decision;
    var rec = {
      id: C.newId(session.startedAt),
      start: session.startedAt,
      end: now(),
      dateKey: C.dateKey(session.startedAt),
      category: a.category,
      activityId: a.id,
      activityName: a.name,
      durationSec: finishInfo.durationSec,
      intensity: intensity,
      intensitySource: intensity === d.intensity ? d.source : "manual",
      steps: finishInfo.imu.steps || 0,
      avgCadence: d.avgCadence || 0,
      imuCoverage: Math.round(d.coverage * 100) / 100,
      bpm: metro.wanted ? metro.bpm : 0,
      kcal: C.kcal(C.metFor(a, intensity), state.profile.weightKg, finishInfo.durationSec),
      weightKg: state.profile.weightKg,
      manual: false,
    };
    return DB.putRecord(rec).then(function () {
      closeSession();
      saving = false;
      toast("已儲存：" + a.name + " " + C.formatMinutes(rec.durationSec));
      showTab("home");
    }).catch(function (e) {
      saving = false;
      toast("儲存失敗：" + e);
    });
  }

  function finishBack() {
    $("finishSheet").hidden = true;
    finishInfo = null;
    if (session.pausedAt) {
      session.pauses.push({ from: session.pausedAt, to: now() });
      session.pausedAt = null;
    }
    saveSession();
    updateTimer();
  }

  function closeSession() {
    clearInterval(tickTimer);
    stopMotion();
    metroStop();
    session = null;
    detector = null;
    finishInfo = null;
    saveSession();
    releaseWake();
    $("finishSheet").hidden = true;
    $("sessionScreen").hidden = true;
    $("sessionBanner").hidden = true;
  }

  /* 重新開啟 App 時接回進行中的運動（iOS 可能在鎖屏時把 App 關掉） */
  function restoreSession() {
    var s = loadSession();
    if (!s) return;
    session = s;
    metro.bpm = C.clampBpm(s.bpm || 180);
    if (!s.startedAt) { session = null; saveSession(); return; }
    detector = C.createStepDetector();
    detector.restore(s.imu || {});
    motionState = "off";      /* iOS 權限要在點擊中重新要求 */
    startTicking();
    openSessionScreen();
    toast("已接回進行中的運動");
  }

  /* ================= 歷史 ================= */
  function monthKeyOf(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + C.pad2(d.getMonth() + 1);
  }

  function shiftMonth(mk, n) {
    var p = mk.split("-");
    var d = new Date(+p[0], +p[1] - 1 + n, 1);
    return monthKeyOf(d.getTime());
  }

  var HEAT_STEPS = [1, 15, 30, 60];   /* 分鐘門檻 → 5 級色階 */
  function heatLevel(min) {
    var lv = 0;
    HEAT_STEPS.forEach(function (s, i) { if (min >= s) lv = i + 1; });
    return lv;
  }

  function renderHistory() {
    if (!state.month) state.month = monthKeyOf(now());
    if (!state.selectedDay) state.selectedDay = todayKey();
    var p = state.month.split("-");
    var y = +p[0], m = +p[1];
    var first = state.month + "-01";
    var daysIn = new Date(y, m, 0).getDate();
    var last = state.month + "-" + C.pad2(daysIn);
    $("monthTitle").textContent = y + " 年 " + m + " 月";
    var ws = state.settings.weekStart;
    return DB.rangeRecords(first, last).then(function (recs) {
      var per = {};
      recs.forEach(function (r) { per[r.dateKey] = (per[r.dateKey] || 0) + r.durationSec; });
      var head = [];
      for (var i = 0; i < 7; i++) head.push('<div class="cal-h">' + "日一二三四五六".charAt((ws + i) % 7) + "</div>");
      var lead = (new Date(y, m - 1, 1).getDay() - ws + 7) % 7;
      var cells = [];
      for (var j = 0; j < lead; j++) cells.push('<div class="cal-c empty"></div>');
      var tk = todayKey();
      var monthSec = 0, activeDays = 0;
      for (var dd = 1; dd <= daysIn; dd++) {
        var k = state.month + "-" + C.pad2(dd);
        var sec = per[k] || 0;
        monthSec += sec;
        if (sec > 0) activeDays++;
        var min = Math.round(sec / 60);
        cells.push('<button class="cal-c lv' + heatLevel(min) + (k === tk ? " today" : "") + (k === state.selectedDay ? " sel" : "") +
          (k > tk ? " future" : "") + '" data-action="open-day" data-day="' + k + '" aria-label="' + m + "月" + dd + "日 " +
          (min ? min + " 分鐘" : "沒有運動") + '"><span class="cal-d">' + dd + '</span><span class="cal-m mono">' +
          (min ? min : "") + "</span></button>");
      }
      $("calendar").innerHTML = head.join("") + cells.join("");
      $("calLegend").innerHTML = '<span class="small muted">每日分鐘數</span>' +
        ["0", "1+", "15+", "30+", "60+"].map(function (t, i) {
          return '<span class="lg"><span class="sw lv' + i + '"></span>' + t + "</span>";
        }).join("");
      $("monthSummary").textContent = "本月運動 " + activeDays + " 天，共 " + C.formatMinutes(monthSec) + "。";
      return Promise.all([renderDayDetail(), renderWeekChart()]);
    });
  }

  function renderDayDetail() {
    var k = state.selectedDay;
    return DB.rangeRecords(k, k).then(function (recs) {
      var total = recs.reduce(function (s, r) { return s + r.durationSec; }, 0);
      var rows = recs.map(function (r) {
        var t = new Date(r.start);
        var info = [];
        if (r.steps) info.push(r.steps + " 步");
        if (r.bpm) info.push("節拍 " + r.bpm);
        if (r.manual) info.push("補登");
        return '<li class="rec"><button class="rec-btn" data-action="edit-rec" data-id="' + esc(r.id) + '">' +
          '<span class="rec-time mono">' + C.pad2(t.getHours()) + ":" + C.pad2(t.getMinutes()) + "</span>" +
          '<span class="rec-main"><b>' + esc(r.activityName) + '</b><small>' + C.CATEGORY_NAME[r.category] + "・" +
          C.INTENSITY_NAME[r.intensity] + (info.length ? "・" + info.join("・") : "") + "</small></span>" +
          '<span class="rec-dur mono">' + C.formatMinutes(r.durationSec) + "</span></button></li>";
      }).join("");
      $("dayDetail").innerHTML = '<div class="card-head"><h2>' + dayLabel(k) + "</h2>" +
        '<span class="small muted">共 ' + C.formatMinutes(total) + "</span></div>" +
        (rows ? '<ul class="rec-list">' + rows + "</ul>" : '<p class="muted">這天沒有運動紀錄。</p>') +
        '<button class="btn small" data-action="manual-add" data-day="' + k + '">補登這天</button>';
    });
  }

  function renderWeekChart() {
    var g = goals();
    var thisStart = C.weekStartKey(now(), state.settings.weekStart);
    var firstStart = C.addDays(thisStart, -7 * 11);
    return DB.rangeRecords(firstStart, C.addDays(thisStart, 6)).then(function (recs) {
      var weeks = [];
      for (var i = 0; i < 12; i++) {
        var s = C.addDays(firstStart, i * 7);
        weeks.push({ start: s, sum: C.weekSummary(recs, s, g) });
      }
      var maxV = Math.max(g.aerobicMinutes * 1.25, Math.max.apply(null, weeks.map(function (w) { return w.sum.aerobicCredit; })));
      var goalPct = g.aerobicMinutes / maxV * 100;
      var bars = weeks.map(function (w, idx) {
        var v = Math.round(w.sum.aerobicCredit);
        var d = new Date(C.parseDateKey(w.start));
        var label = (d.getMonth() + 1) + "/" + d.getDate();
        var tip = label + " 起的一週：有氧 " + v + " 分鐘" + (w.sum.aerobicMet ? "，已達標" : "") +
          "；肌力 " + w.sum.strengthDays + " 天；飯後 " + w.sum.mealCount + " 次";
        return '<div class="wk" tabindex="0" title="' + tip + '" aria-label="' + tip + '">' +
          '<span class="wk-bar"><span class="fill' + (w.sum.aerobicMet ? " met" : "") + '" style="height:' + (v / maxV * 100).toFixed(1) + '%"></span>' +
          (v ? '<span class="wk-v mono" style="bottom:calc(' + (v / maxV * 100).toFixed(1) + '% + 2px)">' + v + "</span>" : "") + "</span>" +
          '<span class="wk-l">' + ((11 - idx) % 2 === 0 ? label : "") + "</span></div>";
      }).join("");
      $("weekChart").innerHTML = '<div class="wk-plot"><div class="goal-area"><div class="goal-line" style="bottom:' + goalPct.toFixed(1) + '%"><span>' +
        g.aerobicMinutes + "</span></div></div>" + bars + "</div>";
    });
  }

  /* ================= 補登 / 編輯 ================= */
  function fillActivitySelect(selectedId) {
    $("editActivity").innerHTML = ["meal", "aerobic", "strength"].map(function (cat) {
      return '<optgroup label="' + C.CATEGORY_NAME[cat] + '">' + state.activities.filter(function (a) { return a.category === cat; })
        .map(function (a) {
          return '<option value="' + esc(a.id) + '"' + (a.id === selectedId ? " selected" : "") + ">" + esc(a.name) + "</option>";
        }).join("") + "</optgroup>";
    }).join("");
  }

  function openEdit(rec, dayKey) {
    var f = $("editForm");
    state.editingId = rec ? rec.id : null;
    $("editTitle").textContent = rec ? "修改紀錄" : "補登紀錄";
    $("editDelete").hidden = !rec;
    var t = rec ? new Date(rec.start) : new Date();
    var actId = rec ? rec.activityId : state.activities[0].id;
    if (rec && !activityById(rec.activityId)) actId = state.activities.filter(function (a) { return a.category === rec.category; })[0].id;
    fillActivitySelect(actId);
    f.date.value = rec ? rec.dateKey : (dayKey || todayKey());
    f.time.value = C.pad2(t.getHours()) + ":" + C.pad2(t.getMinutes());
    f.minutes.value = rec ? Math.max(1, Math.round(rec.durationSec / 60)) : 30;
    var intensity = rec ? rec.intensity : activityById(actId).defaultIntensity;
    f.querySelectorAll('input[name="intensity"]').forEach(function (r) { r.checked = r.value === intensity; });
    $("editSheet").hidden = false;
  }

  function saveEdit(ev) {
    ev.preventDefault();
    var f = $("editForm");
    var a = activityById(f.activityId.value);
    var dp = f.date.value.split("-"), tp = f.time.value.split(":");
    var start = new Date(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1]).getTime();
    var durationSec = Math.round(+f.minutes.value * 60);
    var minutesInput = +f.minutes.value;
    var intensity = (f.querySelector('input[name="intensity"]:checked') || {}).value || a.defaultIntensity;
    if (!(durationSec > 0)) { toast("請輸入時間"); return; }
    var p = state.editingId ? DB.getRecord(state.editingId) : Promise.resolve(null);
    p.then(function (old) {
      var rec = old ? Object.assign({}, old) : { id: C.newId(start), manual: true, steps: 0, avgCadence: 0, imuCoverage: 0, bpm: 0 };
      var sameActivity = old && old.activityId === a.id;
      /* 沒改的欄位保留原始精確值，避免 14 分 40 秒被改成 15 分 */
      if (old) {
        var ot = new Date(old.start);
        if (f.date.value === old.dateKey && f.time.value === C.pad2(ot.getHours()) + ":" + C.pad2(ot.getMinutes())) start = old.start;
        if (minutesInput === Math.max(1, Math.round(old.durationSec / 60))) durationSec = old.durationSec;
      }
      rec.start = start;
      rec.end = start + durationSec * 1000;
      rec.dateKey = C.dateKey(start);
      rec.category = a.category;
      rec.activityId = a.id;
      rec.activityName = sameActivity ? old.activityName : a.name;
      if (old && rec.intensity !== intensity) rec.intensitySource = "manual";
      if (!old) rec.intensitySource = "manual";
      rec.intensity = intensity;
      rec.durationSec = durationSec;
      var w = old && old.weightKg ? old.weightKg : state.profile.weightKg;
      rec.weightKg = w;
      rec.kcal = C.kcal(C.metFor(a, intensity), w, durationSec);
      return DB.putRecord(rec).then(function () {
        $("editSheet").hidden = true;
        state.selectedDay = rec.dateKey;
        state.month = rec.dateKey.slice(0, 7);
        toast(old ? "已修改" : "已補登");
        showTab("history");
      });
    });
  }

  function deleteEdit() {
    if (!state.editingId) return;
    if (!confirm("確定刪除這筆紀錄？刪除後無法復原。")) return;
    DB.deleteRecord(state.editingId).then(function () {
      $("editSheet").hidden = true;
      toast("已刪除");
      renderHistory();
    });
  }

  /* ================= 設定 ================= */
  function fillProfileForm(f) {
    var p = state.profile || {};
    f.heightCm.value = p.heightCm || "";
    f.weightKg.value = p.weightKg || "";
    f.birthYear.value = p.birthYear || "";
    f.querySelectorAll('input[name="sex"]').forEach(function (r) { r.checked = r.value === p.sex; });
  }

  function readProfileForm(f) {
    var sex = (f.querySelector('input[name="sex"]:checked') || {}).value;
    return { heightCm: +f.heightCm.value, weightKg: +f.weightKg.value, birthYear: Math.round(+f.birthYear.value), sex: sex };
  }

  function renderSettings() {
    fillProfileForm($("profileForm"));
    var s = state.settings, f = $("settingsForm");
    f.querySelectorAll('input[name="weekStart"]').forEach(function (r) { r.checked = +r.value === s.weekStart; });
    f.mealPerDay.value = s.mealPerDay;
    f.mealMinMinutes.value = s.mealMinMinutes;
    f.keepAwake.checked = !!s.keepAwake;
    f.metronomeVolume.value = s.metronomeVolume;
    if (state.profile) {
      var g = goals();
      $("goalExplain").innerHTML = "<p>年齡 " + g.age + " 歲，BMI " + g.bmi.toFixed(1) + "（" + C.bmiLevel(g.bmi) + "），基礎代謝率約 " +
        C.bmr(state.profile, now()) + " 大卡/日。</p><p><b>每週目標</b>：有氧 " + g.aerobicMinutes + " 分鐘、肌力 " +
        g.strengthDays + " 天、飯後運動每天 " + g.mealPerDay + " 次（每次至少 " + g.mealMinMinutes + " 分鐘）。</p>" +
        '<p class="small muted">' + g.reasons.map(esc).join("；") + (g.balanceReminder ? "；65 歲以上建議加做平衡訓練" : "") + "。</p>";
    }
    var builtin = C.defaultActivities().map(function (a) { return a.id; });
    $("activityList").innerHTML = ["meal", "aerobic", "strength"].map(function (cat) {
      return "<h3>" + C.CATEGORY_NAME[cat] + '</h3><ul class="act-list">' + state.activities.filter(function (a) { return a.category === cat; })
        .map(function (a) {
          return '<li><span>' + esc(a.name) + ' <small class="muted">' + C.INTENSITY_NAME[a.defaultIntensity] +
            (a.autoIntensity ? "・依步頻" : "") + "</small></span>" +
            (builtin.indexOf(a.id) >= 0 ? '<small class="muted">內建</small>' :
              '<button class="btn small" data-action="del-activity" data-id="' + esc(a.id) + '">刪除</button>') + "</li>";
        }).join("") + "</ul>";
    }).join("");
    exportCache = null;
    return DB.allRecords().then(function (all) {
      prepareExport(all);
      var first = all.length ? all[0].dateKey : null;
      return DB.persist().then(function (persisted) {
        $("dataInfo").textContent = "共 " + all.length + " 筆紀錄" + (first ? "，最早 " + first : "") + "。" +
          (persisted ? "瀏覽器已將資料標記為持久保存。" : "");
      });
    });
  }

  function saveProfile(f) {
    var p = readProfileForm(f);
    if (!p.sex || !(p.heightCm > 0) || !(p.weightKg > 0) || !(p.birthYear > 1900)) { toast("請完整填寫個人資料"); return null; }
    state.profile = p;
    return DB.setKV("profile", p);
  }

  function saveSettings(ev) {
    ev.preventDefault();
    var f = $("settingsForm");
    var s = state.settings;
    s.weekStart = +((f.querySelector('input[name="weekStart"]:checked') || {}).value || 1);
    s.mealPerDay = Math.max(1, Math.min(3, Math.round(+f.mealPerDay.value || 2)));
    s.mealMinMinutes = Math.max(5, Math.min(60, Math.round(+f.mealMinMinutes.value || 15)));
    s.keepAwake = f.keepAwake.checked;
    s.metronomeVolume = +f.metronomeVolume.value;
    DB.setKV("settings", s).then(function () {
      toast("設定已儲存");
      renderSettings();
    });
  }

  function addActivity(ev) {
    ev.preventDefault();
    var f = $("activityForm");
    var name = f.name.value.trim();
    if (!name) return;
    var cat = f.category.value;
    var base = C.defaultActivities().filter(function (a) { return a.category === cat; }).pop();
    var a = { id: "custom-" + C.newId(now()), name: name, category: cat, defaultIntensity: f.defaultIntensity.value,
      autoIntensity: false, bpm: 0, met: base.met };
    state.activities.push(a);
    DB.setKV("activities", state.activities).then(function () {
      f.reset();
      toast("已新增「" + name + "」");
      renderSettings();
    });
  }

  function delActivity(id) {
    var a = activityById(id);
    if (!a || !confirm("刪除項目「" + a.name + "」？已存的紀錄不受影響。")) return;
    state.activities = state.activities.filter(function (x) { return x.id !== id; });
    DB.setKV("activities", state.activities).then(renderSettings);
  }

  /* ---------- 備份 ---------- */
  /* 備份檔在打開設定頁時就先準備好：iOS 要求 navigator.share 必須在點擊當下同步呼叫，
   * 若先等 IndexedDB 讀取再分享，會因為失去使用者手勢而被拒絕 */
  var exportCache = null;
  function prepareExport(records) {
    var data = { app: "workout-records", version: 1, exportedAt: new Date().toISOString(),
      profile: state.profile, settings: state.settings, activities: state.activities, records: records };
    var text = JSON.stringify(data, null, 1);
    var name = "workout-records-" + todayKey() + ".json";
    var blob = new Blob([text], { type: "application/json" });
    var file = null;
    try { file = new File([blob], name, { type: "application/json" }); } catch (e) { file = null; }
    exportCache = { text: text, name: name, blob: blob, file: file };
  }

  function exportData() {
    if (!exportCache) { toast("備份檔準備中，請稍後再按一次"); return; }
    var c = exportCache;
    window.__lastExport = c.text;
    /* iOS 主畫面模式下 a[download] 不可靠，優先用分享面板（可存到「檔案」） */
    if (c.file && navigator.canShare && navigator.canShare({ files: [c.file] })) {
      navigator.share({ files: [c.file], title: c.name }).catch(function (e) {
        if (e && e.name !== "AbortError") downloadBlob(c.blob, c.name);
      });
    } else {
      downloadBlob(c.blob, c.name);
    }
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function importText(text) {
    var bk;
    try { bk = C.parseBackup(text); } catch (e) { toast("匯入失敗：" + e.message); return Promise.resolve(); }
    if (!confirm("匯入 " + bk.records.length + " 筆紀錄？相同的紀錄會被覆蓋，其他現有紀錄保留。")) return Promise.resolve();
    var tasks = [DB.putRecords(bk.records)];
    if (bk.profile && !state.profile) { state.profile = bk.profile; tasks.push(DB.setKV("profile", bk.profile)); }
    if (bk.activities) {
      bk.activities.forEach(function (a) { if (a && a.id && !activityById(a.id)) state.activities.push(a); });
      tasks.push(DB.setKV("activities", state.activities));
    }
    return Promise.all(tasks).then(function () {
      toast("已匯入 " + bk.records.length + " 筆" + (bk.skipped ? "，略過 " + bk.skipped + " 筆格式不符" : ""));
      renderSettings();
    });
  }

  /* ================= 導覽 ================= */
  var TAB_TITLE = { home: "本週", start: "開始運動", history: "歷史紀錄", settings: "設定" };

  function showTab(tab) {
    state.tab = tab;
    ["home", "start", "history", "settings"].forEach(function (t) {
      $("view-" + t).hidden = t !== tab;
    });
    document.querySelectorAll("#tabbar button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    $("pageTitle").textContent = TAB_TITLE[tab];
    $("sessionBanner").hidden = !(session && session.startedAt);
    window.scrollTo(0, 0);
    if (tab === "home") return renderHome();
    if (tab === "start") return renderStart();
    if (tab === "history") return renderHistory();
    if (tab === "settings") return renderSettings();
  }

  function onClick(ev) {
    var el = ev.target.closest("[data-action],[data-tab]");
    if (!el) return;
    var tab = el.getAttribute("data-tab");
    if (tab) { showTab(tab); return; }
    var act = el.getAttribute("data-action");
    switch (act) {
      case "go-start": showTab("start"); break;
      case "pick": pickActivity(el.getAttribute("data-id")); break;
      case "session-go": sessionGo(); break;
      case "session-cancel": session = null; saveSession(); $("sessionScreen").hidden = true; metroStop(); break;
      case "session-minimize":
        if (!session.startedAt) { session = null; saveSession(); metroStop(); }
        $("sessionScreen").hidden = true;
        showTab("home");
        break;
      case "open-session": openSessionScreen(); break;
      case "session-pause": togglePause(); break;
      case "session-end": sessionEnd(); break;
      case "motion-retry": startMotion(); requestWake(); updateTimer(); break;
      case "metro-toggle":
        if (metro.on) metroStop();
        else metroStart();
        break;
      case "bpm": setBpm(metro.bpm + (+el.getAttribute("data-delta"))); break;
      case "bpm-set": setBpm(+el.getAttribute("data-bpm")); break;
      case "finish-save": finishSave(); break;
      case "finish-back": finishBack(); break;
      case "finish-discard":
        if (confirm("確定不儲存這次運動？")) { closeSession(); showTab("home"); }
        break;
      case "manual-add": openEdit(null, el.getAttribute("data-day")); break;
      case "edit-close": $("editSheet").hidden = true; break;
      case "edit-delete": deleteEdit(); break;
      case "edit-rec":
        DB.getRecord(el.getAttribute("data-id")).then(function (r) { if (r) openEdit(r); });
        break;
      case "open-day":
        state.selectedDay = el.getAttribute("data-day");
        state.month = state.selectedDay.slice(0, 7);
        showTab("history").then(function () {
          var d = $("dayDetail");
          if (d.scrollIntoView) d.scrollIntoView({ block: "start" });
        });
        break;
      case "month-prev": state.month = shiftMonth(state.month, -1); renderHistory(); break;
      case "month-next": state.month = shiftMonth(state.month, 1); renderHistory(); break;
      case "export": exportData(); break;
      case "del-activity": delActivity(el.getAttribute("data-id")); break;
      case "test-tick": testTick(); break;
    }
  }

  function onVisibility() {
    if (document.visibilityState === "visible") {
      if (session && session.startedAt) {
        updateTimer();
        requestWake();
      }
      if (state.tab === "home") renderHome();
      metroOnVisible();
    } else {
      metroOnHidden();
      saveSession();
    }
  }

  function bind() {
    document.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", saveSession);
    document.querySelectorAll('input[name="finInt"]').forEach(function (r) { r.addEventListener("change", updateFinCredit); });
    $("editForm").addEventListener("submit", saveEdit);
    $("editForm").activityId.addEventListener("change", function () {
      var a = activityById(this.value);
      if (!state.editingId && a) {
        $("editForm").querySelectorAll('input[name="intensity"]').forEach(function (r) { r.checked = r.value === a.defaultIntensity; });
      }
    });
    $("profileForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var p = saveProfile(this);
      if (p) p.then(function () { toast("個人資料已儲存"); renderSettings(); });
    });
    $("welcomeForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var p = saveProfile(this);
      if (p) p.then(function () { $("welcome").hidden = true; showTab("home"); });
    });
    $("settingsForm").addEventListener("submit", saveSettings);
    $("activityForm").addEventListener("submit", addActivity);
    $("importFile").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var input = this;
      file.text().then(importText).then(function () { input.value = ""; });
    });
  }

  function init() {
    bind();
    return Promise.all([DB.getKV("profile"), DB.getKV("settings"), DB.getKV("activities")]).then(function (v) {
      state.profile = v[0] || null;
      if (v[1]) state.settings = Object.assign(C.defaultSettings(), v[1]);
      if (v[2] && v[2].length) state.activities = v[2];
      DB.persist();
      if (!state.profile) {
        $("welcome").hidden = false;
        return;
      }
      restoreSession();
      return showTab("home");
    }).then(function () {
      document.body.setAttribute("data-ready", "1");
    }).catch(function (e) {
      document.body.setAttribute("data-ready", "error");
      toast("資料庫開啟失敗：" + e);
    });
  }

  /* 測試用掛鉤：直接餵入動作感測樣本（瀏覽器無法偽造 DeviceMotionEvent 的時間戳） */
  window.__wr = {
    feedMotion: function (t, x, y, z) {
      if (!detector || !session || session.pausedAt) return;
      lastMotionT = t;
      detector.push(t, x, y, z);
    },
    get session() { return session; },
    get metro() { return metro; },
    get motionState() { return motionState; },
    importText: importText,
    state: state,
  };

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* 離線快取失敗不影響使用 */ });
  }
  init();
})();
