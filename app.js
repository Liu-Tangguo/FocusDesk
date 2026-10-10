(function () {
  "use strict";

  /* ================= utils ================= */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function pad2(n) { n = Number(n) || 0; return (n < 10 ? "0" : "") + n; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function numOr(v, def, min, max) { v = Number(v); if (!isFinite(v)) v = def; return clamp(v, min, max); }

  var params = new URLSearchParams(location.search);
  var PROBE = params.get("probe") === "1";
  var NOMOTION = params.get("nomotion") === "1" || PROBE;
  var SEED = params.get("seed") === "1";
  var AUTO = params.get("auto") === "1";
  var WAKE_SUPPORTED = (typeof navigator !== "undefined") && ("wakeLock" in navigator);

  /* ================= date ================= */
  var WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseHM(hm) {
    var p = String(hm || "").split(":");
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (isNaN(h)) h = 0; if (isNaN(m)) m = 0;
    return clamp(h, 0, 24) * 60 + clamp(m, 0, 59);
  }
  function toHM(min) { min = clamp(Math.round(min), 0, 1440); return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60); }
  function fmtDate(d) { return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + WEEK[d.getDay()]; }

  /* ================= storage ================= */
  var STORE_KEY = "focusdesk.v1";
  function defaults() {
    return {
      version: 1,
      settings: { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, shift: true, shiftSec: 75, theme: "dark", timelineFrom: 0, timelineTo: 24, sound: true },
      todos: [],
      blocks: {},
      timer: { phase: "focus", running: false, endsAt: 0, remainMs: 25 * 60000, cycleDone: 0, currentTodoId: "" },
      stats: {}
    };
  }
  function sanitize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== "object") return d;
    var s = raw.settings || {};
    d.settings.focusMin = numOr(s.focusMin, 25, 1, 180);
    d.settings.shortMin = numOr(s.shortMin, 5, 1, 120);
    d.settings.longMin = numOr(s.longMin, 15, 1, 180);
    d.settings.longEvery = numOr(s.longEvery, 4, 1, 12);
    d.settings.shift = s.shift !== false;
    d.settings.shiftSec = numOr(s.shiftSec, 75, 20, 900);
    d.settings.theme = (s.theme === "light") ? "light" : "dark";
    d.settings.sound = s.sound !== false;
    d.settings.timelineFrom = numOr(s.timelineFrom, 0, 0, 23);
    d.settings.timelineTo = numOr(s.timelineTo, 24, 1, 24);
    if (d.settings.timelineTo <= d.settings.timelineFrom) d.settings.timelineTo = Math.min(24, d.settings.timelineFrom + 1);

    if (Array.isArray(raw.todos)) {
      d.todos = raw.todos.filter(function (t) { return t && typeof t === "object" && typeof t.text === "string"; })
        .map(function (t) {
          return { id: String(t.id || uid()), text: String(t.text).slice(0, 200), done: !!t.done, createdAt: Number(t.createdAt) || Date.now(), doneAt: Number(t.doneAt) || 0 };
        });
    }
    if (raw.blocks && typeof raw.blocks === "object") {
      Object.keys(raw.blocks).forEach(function (k) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
        var list = raw.blocks[k];
        if (!Array.isArray(list)) return;
        d.blocks[k] = list.filter(function (b) { return b && b.start && b.end && parseHM(b.end) > parseHM(b.start); })
          .map(function (b) {
            return { id: String(b.id || uid()), title: String(b.title || "未命名").slice(0, 120), start: toHM(parseHM(b.start)), end: toHM(parseHM(b.end)), todoId: b.todoId ? String(b.todoId) : "" };
          });
      });
    }
    var t = raw.timer || {};
    d.timer.phase = (t.phase === "short" || t.phase === "long") ? t.phase : "focus";
    d.timer.running = !!t.running;
    d.timer.endsAt = Number(t.endsAt) || 0;
    d.timer.remainMs = Number(t.remainMs) > 0 ? Number(t.remainMs) : 0;
    d.timer.cycleDone = Number(t.cycleDone) > 0 ? Math.floor(Number(t.cycleDone)) : 0;
    d.timer.currentTodoId = t.currentTodoId ? String(t.currentTodoId) : "";
    if (raw.stats && typeof raw.stats === "object") {
      Object.keys(raw.stats).forEach(function (k) {
        var v = raw.stats[k]; if (!v || typeof v !== "object") return;
        d.stats[k] = { count: Math.max(0, Math.floor(Number(v.count) || 0)), ms: Math.max(0, Number(v.ms) || 0) };
      });
    }
    return d;
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaults();
      return sanitize(JSON.parse(raw));
    } catch (e) {
      try { localStorage.setItem(STORE_KEY + ".broken." + Date.now(), localStorage.getItem(STORE_KEY) || ""); } catch (e2) {}
      return defaults();
    }
  }
  var saveTimer = null;
  function save(now) { if (now) { writeState(); return; } if (saveTimer) return; saveTimer = setTimeout(function () { saveTimer = null; writeState(); }, 250); }
  function writeState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast("本地保存失败（可能存储空间不足或处于隐私模式）", "danger"); }
  }
  var state = loadState();

  /* ================= toast / modal ================= */
  function toast(msg, kind) {
    var box = $("#toasts"); if (!box) return;
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = String(msg);
    box.appendChild(el);
    setTimeout(function () {
      el.style.opacity = "0"; el.style.transition = "opacity .3s";
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, 3200);
    while (box.children.length > 4) box.removeChild(box.firstChild);
  }
  var modalOpen = false;
  function showModal(content) { var box = $("#modalBox"); box.innerHTML = ""; box.appendChild(content); $("#modal").classList.remove("hidden"); modalOpen = true; }
  function hideModal() { $("#modal").classList.add("hidden"); $("#modalBox").innerHTML = ""; modalOpen = false; }

  var actx = null;
  function beep() {
    if (!state.settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.4);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + 0.42);
    } catch (e) {}
  }

  /* ================= pomodoro ================= */
  var PHASE_NAME = { focus: "专注", short: "短休息", long: "长休息" };
  var PHASE_CLS = { focus: "phase-focus", short: "phase-short", long: "phase-long" };
  var RING_C = 2 * Math.PI * 54;
  function phaseDurMs(phase) {
    var m = state.settings.focusMin;
    if (phase === "short") m = state.settings.shortMin;
    else if (phase === "long") m = state.settings.longMin;
    return Math.max(1, m) * 60000;
  }
  function nextPhaseName() {
    var t = state.timer;
    if (t.phase !== "focus") return "focus";
    var every = Math.max(1, state.settings.longEvery);
    return (t.cycleDone > 0 && (t.cycleDone % every) === 0) ? "long" : "short";
  }
  function remainingMs() {
    var t = state.timer;
    if (t.running && t.endsAt) return Math.max(0, t.endsAt - Date.now());
    return Math.max(0, t.remainMs || 0);
  }
  function startTimer() {
    var t = state.timer;
    if (t.running) return;
    var rem = t.remainMs > 0 ? t.remainMs : phaseDurMs(t.phase);
    t.running = true; t.endsAt = Date.now() + rem; t.remainMs = rem;
    save(); renderTimer();
  }
  function pauseTimer() {
    var t = state.timer;
    if (!t.running) return;
    t.remainMs = Math.max(0, t.endsAt - Date.now());
    t.running = false; t.endsAt = 0; save(); renderTimer();
  }
  function finishPhase() {
    var t = state.timer;
    var phase = t.phase;
    var dur = phaseDurMs(phase);
    var rem = remainingMs();
    var elapsedMin = Math.round(Math.max(0, dur - rem) / 60000);
    if (phase === "focus") {
      if (elapsedMin >= 1) { t.cycleDone = (t.cycleDone || 0) + 1; addFocusStat(elapsedMin); }
      else toast("专注不足 1 分钟，未计入统计", "warn");
    }
    var nxt = nextPhaseName();
    t.phase = nxt; t.remainMs = phaseDurMs(nxt); t.endsAt = 0; t.running = false;
    if (nxt !== "focus") { t.running = true; t.endsAt = Date.now() + t.remainMs; }
    save(); renderTimer();
    toast(phase === "focus" ? ("专注完成 ✓ 进入" + PHASE_NAME[nxt]) : "休息结束，可以开始下一轮", "ok");
    beep();
  }
  function skipPhase() {
    var t = state.timer;
    var nxt = (t.phase === "focus") ? "short" : "focus";
    t.phase = nxt; t.remainMs = phaseDurMs(nxt); t.endsAt = 0; t.running = false;
    save(); renderTimer(); toast("已跳过，切换到" + PHASE_NAME[nxt]);
  }
  function addFocusStat(minutes) {
    var k = dayKey();
    var s = state.stats[k] || { count: 0, ms: 0 };
    s.count += 1; s.ms += Math.max(0, minutes) * 60000;
    state.stats[k] = s; save();
  }
  function renderTimer() {
    var t = state.timer;
    var rem = remainingMs();
    var dur = phaseDurMs(t.phase);
    var secs = Math.ceil(rem / 1000);
    var mm = Math.floor(secs / 60), ss = secs % 60;
    $("#pomoTime").textContent = pad2(mm) + ":" + pad2(ss);
    var stText = "未开始";
    if (t.running) stText = "进行中…";
    else if (rem > 0 && rem < dur) stText = "已暂停";
    $("#pomoRunState").textContent = stText;
    var pill = $("#pomoPhase");
    pill.textContent = PHASE_NAME[t.phase];
    pill.className = "phase-pill " + PHASE_CLS[t.phase];
    $("#pomoCard").classList.toggle("running", !!t.running);
    var frac = dur > 0 ? clamp(rem / dur, 0, 1) : 0;
    var fg = $("#ringFg");
    fg.style.strokeDasharray = RING_C.toFixed(2);
    fg.style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(2);
    fg.style.stroke = (t.phase === "focus") ? "var(--focus)" : (t.phase === "short" ? "var(--short)" : "var(--long)");
    $("#btnStart").textContent = t.running ? "暂停" : (rem > 0 && rem < dur ? "继续" : "开始专注");
    var st = state.stats[dayKey()] || { count: 0, ms: 0 };
    $("#statCount").textContent = st.count;
    $("#statMin").textContent = Math.round(st.ms / 60000);
    $("#pomoCycle").textContent = t.cycleDone || 0;
    renderCurrentTask();
  }
  function recoverTimer() {
    var t = state.timer;
    if (!t.remainMs || t.remainMs <= 0) t.remainMs = phaseDurMs(t.phase);
    if (!t.running || !t.endsAt) { t.running = false; return; }
    var now = Date.now();
    if (now < t.endsAt) return;
    var overdue = now - t.endsAt;
    if (t.phase === "focus") { t.cycleDone = (t.cycleDone || 0) + 1; addFocusStat(state.settings.focusMin); }
    var nxt = nextPhaseName();
    t.endsAt = 0; t.running = false;
    if (nxt === "focus") { t.phase = "focus"; t.remainMs = phaseDurMs("focus"); }
    else {
      var bdur = phaseDurMs(nxt);
      if (overdue < bdur) { t.phase = nxt; t.remainMs = bdur - overdue; t.running = true; t.endsAt = now + t.remainMs; }
      else { t.phase = "focus"; t.remainMs = phaseDurMs("focus"); }
    }
    save(true);
    toast("检测到离线期间计时已走完，已按规则恢复", "warn");
  }

  /* ================= todos ================= */
  var todoFilter = "all";
  function findTodo(id) { for (var i = 0; i < state.todos.length; i++) if (state.todos[i].id === id) return state.todos[i]; return null; }
  function currentTodo() { return state.timer.currentTodoId ? findTodo(state.timer.currentTodoId) : null; }
  function addTodo(text) {
    text = String(text || "").trim(); if (!text) return;
    state.todos.unshift({ id: uid(), text: text.slice(0, 200), done: false, createdAt: Date.now(), doneAt: 0 });
    save(); renderTodos(); renderTaskSelect(); renderTimeline();
  }
  function toggleTodo(id) { var t = findTodo(id); if (!t) return; t.done = !t.done; t.doneAt = t.done ? Date.now() : 0; save(); renderTodos(); renderCurrentTask(); }
  function renameTodo(id, text) {
    var t = findTodo(id); if (!t) return;
    text = String(text || "").trim(); if (!text) return;
    t.text = text.slice(0, 200); save(); renderTodos(); renderTaskSelect(); renderTimeline();
  }
  function deleteTodo(id) {
    state.todos = state.todos.filter(function (t) { return t.id !== id; });
    if (state.timer.currentTodoId === id) state.timer.currentTodoId = "";
    Object.keys(state.blocks).forEach(function (k) {
      state.blocks[k] = state.blocks[k].filter(function (b) { return b.todoId !== id; });
    });
    save(); renderTodos(); renderTaskSelect(); renderTimeline();
  }
  function setCurrentTodo(id) {
    state.timer.currentTodoId = id || "";
    save(); renderTodos(); renderTaskSelect(); renderCurrentTask();
    var t = currentTodo();
    if (t) toast("已设为当前专注任务：" + t.text);
  }
  function startRename(li, t) {
    var span = li.querySelector(".t-text"); if (!span) return;
    var input = document.createElement("input"); input.className = "t-edit"; input.value = t.text; input.maxLength = 200;
    li.replaceChild(input, span); input.focus(); input.select();
    var done = false;
    function commit(ok) { if (done) return; done = true; if (ok) renameTodo(t.id, input.value); else renderTodos(); }
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(true); else if (e.key === "Escape") commit(false); });
    input.addEventListener("blur", function () { commit(true); });
  }
  function renderTodos() {
    var list = $("#todoList"); if (!list) return;
    var items = state.todos.filter(function (t) {
      if (todoFilter === "active") return !t.done;
      if (todoFilter === "done") return !!t.done;
      return true;
    });
    list.innerHTML = "";
    $("#todoCount").textContent = state.todos.filter(function (t) { return !t.done; }).length + " 项未完成";
    if (!items.length) {
      var e = document.createElement("li"); e.className = "empty";
      e.textContent = (todoFilter === "done" ? "还没有已完成任务" : "暂无任务，先加一条吧");
      list.appendChild(e); return;
    }
    items.forEach(function (t) {
      var li = document.createElement("li");
      li.className = "todo-item" + (t.done ? " done" : "") + (state.timer.currentTodoId === t.id ? " current" : "");
      li.dataset.id = t.id;
      var chk = document.createElement("button"); chk.className = "t-check"; chk.type = "button"; chk.textContent = "✓"; chk.setAttribute("aria-label", "完成");
      chk.addEventListener("click", function () { toggleTodo(t.id); });
      var span = document.createElement("span"); span.className = "t-text"; span.textContent = t.text; span.title = "双击改名";
      span.addEventListener("dblclick", function () { startRename(li, t); });
      li.appendChild(chk); li.appendChild(span);
      if (state.timer.currentTodoId === t.id) { var bg = document.createElement("span"); bg.className = "t-badge"; bg.textContent = "专注中"; li.appendChild(bg); }
      var acts = document.createElement("div"); acts.className = "t-actions";
      var bFocus = document.createElement("button"); bFocus.className = "icon-btn"; bFocus.type = "button"; bFocus.textContent = "专注"; bFocus.title = "设为当前番茄任务";
      bFocus.addEventListener("click", function () { setCurrentTodo(state.timer.currentTodoId === t.id ? "" : t.id); });
      var bEdit = document.createElement("button"); bEdit.className = "icon-btn"; bEdit.type = "button"; bEdit.textContent = "改名";
      bEdit.addEventListener("click", function () { startRename(li, t); });
      var bDel = document.createElement("button"); bDel.className = "icon-btn"; bDel.type = "button"; bDel.textContent = "删除";
      bDel.addEventListener("click", function () { deleteTodo(t.id); });
      acts.appendChild(bFocus); acts.appendChild(bEdit); acts.appendChild(bDel);
      li.appendChild(acts);
      list.appendChild(li);
    });
  }
  function renderTaskSelect() {
    var sel = $("#pomoTask"); if (!sel) return;
    sel.innerHTML = "";
    var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "（未选择）"; sel.appendChild(o0);
    var active = state.todos.filter(function (t) { return !t.done; });
    var rest = state.todos.filter(function (t) { return t.done; });
    active.concat(rest).forEach(function (t) {
      var o = document.createElement("option"); o.value = t.id; o.textContent = t.text + (t.done ? "（已完成）" : ""); sel.appendChild(o);
    });
    sel.value = state.timer.currentTodoId || "";
    if (sel.selectedIndex < 0) sel.value = "";
  }
  function renderCurrentTask() {
    var el = $("#curTask"); var t = currentTodo();
    if (el) { if (t) { el.textContent = "当前：" + t.text + (t.done ? "（已完成）" : ""); el.classList.remove("hidden"); } else el.classList.add("hidden"); }
    var sel = $("#pomoTask"); if (sel) sel.value = state.timer.currentTodoId || "";
  }
  function ensureCurTaskEl() {
    var host = document.querySelector(".pomo-task"); if (!host || document.getElementById("curTask")) return;
    var d = document.createElement("div"); d.id = "curTask"; d.className = "hint hidden";
    host.appendChild(d);
  }

  /* ================= timeline ================= */
  var PPM = 1.2, SNAP = 5, MIN_BLOCK = 15;
  var rangeFrom = 0, rangeTo = 24;
  var currentDate = dayKey();
  var drag = null;
  function blocksFor(k) { return state.blocks[k] || []; }
  function findBlock(id) { var l = blocksFor(currentDate); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function minToPx(min) { return (min - rangeFrom * 60) * PPM; }
  function pxToMin(px) { return rangeFrom * 60 + px / PPM; }
  function snapMin(m) { return Math.round(m / SNAP) * SNAP; }
  function overlapIds(list) {
    var ids = {};
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var a = list[i], b = list[j];
      var as = parseHM(a.start), ae = parseHM(a.end), bs = parseHM(b.start), be = parseHM(b.end);
      if (as < be && bs < ae) { ids[a.id] = 1; ids[b.id] = 1; }
    }
    return ids;
  }
  function blockEl(b) {
    var el = document.createElement("div");
    el.className = "tl-block"; el.dataset.id = b.id;
    var s = parseHM(b.start), e = parseHM(b.end);
    el.style.top = minToPx(s) + "px";
    el.style.height = Math.max(18, (e - s) * PPM) + "px";
    var t = document.createElement("div"); t.className = "b-title"; t.textContent = b.title || "未命名"; el.appendChild(t);
    var tm = document.createElement("div"); tm.className = "b-time"; tm.textContent = b.start + "–" + b.end; el.appendChild(tm);
    if (b.todoId) { var td = findTodo(b.todoId); if (td) { var x = document.createElement("div"); x.className = "b-todo"; x.textContent = "↳ " + td.text; el.appendChild(x); } }
    if ((e - s) * PPM > 30) {
      var rt = document.createElement("div"); rt.className = "rz top"; rt.dataset.rz = "start"; el.appendChild(rt);
      var rb = document.createElement("div"); rb.className = "rz bot"; rb.dataset.rz = "end"; el.appendChild(rb);
    }
    return el;
  }
  function nowLineEl() { var el = document.createElement("div"); el.className = "tl-now"; el.id = "tlNow"; el.style.display = "none"; return el; }
  function updateNowLine() {
    var el = $("#tlNow"); if (!el) return;
    if (currentDate !== dayKey()) { el.style.display = "none"; return; }
    var d = new Date();
    var nowMin = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    if (nowMin < rangeFrom * 60 || nowMin > rangeTo * 60) { el.style.display = "none"; return; }
    el.style.display = "block"; el.style.top = minToPx(nowMin) + "px";
  }
  function renderTimeline() {
    rangeFrom = clamp(state.settings.timelineFrom, 0, 23);
    rangeTo = clamp(state.settings.timelineTo, rangeFrom + 1, 24);
    var hours = $("#tlHours"), track = $("#tlTrack");
    if (!hours || !track) return;
    hours.innerHTML = "";
    for (var h = rangeFrom; h < rangeTo; h++) {
      var hd = document.createElement("div"); hd.className = "tl-hour";
      var hs = document.createElement("span"); hs.textContent = pad2(h) + ":00"; hd.appendChild(hs);
      hours.appendChild(hd);
    }
    var totalMin = (rangeTo - rangeFrom) * 60;
    track.style.height = (totalMin * PPM) + "px";
    var frag = document.createDocumentFragment();
    for (var m = rangeFrom * 60; m <= rangeTo * 60; m += 30) {
      var g = document.createElement("div");
      g.className = "tl-gridline" + ((m % 60) ? " half" : "");
      g.style.top = minToPx(m) + "px";
      frag.appendChild(g);
    }
    var list = blocksFor(currentDate);
    var ov = overlapIds(list);
    var dd = new Date();
    var nowMin = dd.getHours() * 60 + dd.getMinutes();
    var isToday = currentDate === dayKey();
    list.slice().sort(function (a, b) { return parseHM(a.start) - parseHM(b.start); }).forEach(function (b) {
      var el = blockEl(b);
      if (ov[b.id]) el.classList.add("overlap");
      if (isToday && nowMin >= parseHM(b.start) && nowMin < parseHM(b.end)) el.classList.add("now");
      frag.appendChild(el);
    });
    track.innerHTML = "";
    track.appendChild(frag);
    track.appendChild(nowLineEl());
    updateNowLine();
    if ($("#dayPicker")) $("#dayPicker").value = currentDate;
    var scroll = $("#timelineScroll");
    if (scroll && isToday && !scroll.dataset.scrolled) {
      scroll.dataset.scrolled = "1";
      var target = minToPx(nowMin) - scroll.clientHeight / 2 + 40;
      scroll.scrollTop = clamp(target, 0, Math.max(0, track.clientHeight - scroll.clientHeight));
    }
  }
  function makeGhost(a, b) {
    var track = $("#tlTrack"); if (!track) return;
    var g = $("#tlGhost");
    if (!g) { g = document.createElement("div"); g.className = "tl-ghost"; g.id = "tlGhost"; track.appendChild(g); }
    g.style.top = minToPx(a) + "px";
    g.style.height = Math.max(6, (b - a) * PPM) + "px";
  }
  function removeGhost() { var g = $("#tlGhost"); if (g && g.parentNode) g.parentNode.removeChild(g); }
  function onTrackDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (drag) return;
    var track = $("#tlTrack");
    var rect = track.getBoundingClientRect();
    var y = e.clientY - rect.top;
    var atMin = pxToMin(y);
    var node = e.target;
    var blockNode = node && node.closest ? node.closest(".tl-block") : null;
    if (blockNode) {
      var b = findBlock(blockNode.dataset.id);
      if (!b) return;
      var rz = node.closest(".rz");
      drag = {
        mode: rz ? (rz.dataset.rz === "start" ? "resizeTop" : "resizeBot") : "move",
        id: b.id, el: blockNode, s0: parseHM(b.start), e0: parseHM(b.end),
        grab: snapMin(atMin), moved: false, ns: parseHM(b.start), ne: parseHM(b.end)
      };
    } else {
      var f = snapMin(atMin);
      drag = { mode: "create", f0: f, cur: f, moved: false };
      makeGhost(f, f + 60);
    }
    window.addEventListener("pointermove", onTrackMove);
    window.addEventListener("pointerup", onTrackUp);
    window.addEventListener("pointercancel", onTrackUp);
    e.preventDefault();
  }
  function onTrackMove(e) {
    if (!drag) return;
    var rect = $("#tlTrack").getBoundingClientRect();
    var at = pxToMin(e.clientY - rect.top);
    if (drag.mode === "create") {
      drag.cur = snapMin(at); drag.moved = true;
      makeGhost(Math.min(drag.f0, drag.cur), Math.max(drag.f0, drag.cur));
      return;
    }
    var d = snapMin(at) - drag.grab;
    if (Math.abs(d) >= SNAP) drag.moved = true;
    var lo = rangeFrom * 60, hi = rangeTo * 60;
    if (drag.mode === "move") {
      var len = drag.e0 - drag.s0;
      var ns = clamp(drag.s0 + d, lo, hi - len);
      drag.ns = ns; drag.ne = ns + len; drag.el.style.top = minToPx(ns) + "px";
    } else if (drag.mode === "resizeTop") {
      var ns2 = clamp(drag.s0 + d, lo, drag.e0 - MIN_BLOCK);
      drag.ns = ns2; drag.ne = drag.e0;
      drag.el.style.top = minToPx(ns2) + "px"; drag.el.style.height = Math.max(18, (drag.e0 - ns2) * PPM) + "px";
    } else if (drag.mode === "resizeBot") {
      var ne2 = clamp(drag.e0 + d, drag.s0 + MIN_BLOCK, hi);
      drag.ns = drag.s0; drag.ne = ne2;
      drag.el.style.height = Math.max(18, (ne2 - drag.s0) * PPM) + "px";
    }
  }
  function onTrackUp() {
    if (!drag) return;
    window.removeEventListener("pointermove", onTrackMove);
    window.removeEventListener("pointerup", onTrackUp);
    window.removeEventListener("pointercancel", onTrackUp);
    var d = drag; drag = null;
    removeGhost();
    if (d.mode === "create") {
      var a = Math.min(d.f0, d.cur), b = Math.max(d.f0, d.cur);
      if (b - a < MIN_BLOCK) { a = d.f0; b = a + 60; }
      a = clamp(a, rangeFrom * 60, rangeTo * 60 - MIN_BLOCK);
      b = clamp(b, a + MIN_BLOCK, rangeTo * 60);
      openBlockModal({ date: currentDate, start: toHM(a), end: toHM(b) });
      return;
    }
    if (!d.moved) { openBlockModal({ id: d.id, date: currentDate }); return; }
    var list = blocksFor(currentDate), blk = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === d.id) blk = list[i];
    if (!blk) { renderTimeline(); return; }
    blk.start = toHM(d.ns); blk.end = toHM(d.ne);
    save(); renderTimeline();
    if (overlapIds(blocksFor(currentDate))[blk.id]) toast("提示：该时间块与其它安排重叠，未自动覆盖", "warn");
  }
  function initTimeline() {
    var track = $("#tlTrack");
    if (track && !track.dataset.bound) { track.dataset.bound = "1"; track.addEventListener("pointerdown", onTrackDown); }
    renderTimeline();
  }
  function openBlockModal(init) {
    init = init || {};
    var editing = !!init.id;
    var src = editing ? findBlock(init.id) : null;
    var box = document.createElement("div");
    box.innerHTML =
      "<h3>" + (editing ? "编辑时间块" : "新建时间块") + "</h3>" +
      "<div class=\"field\"><label class=\"lbl\">任务名称</label><input id=\"mTitle\" class=\"input\" list=\"mTodoList\" maxlength=\"80\" placeholder=\"例如：写代码\"></div>" +
      "<datalist id=\"mTodoList\"></datalist>" +
      "<div class=\"field-row\">" +
      "<div class=\"field\"><label class=\"lbl\">开始</label><input id=\"mStart\" class=\"input\" type=\"time\" step=\"300\"></div>" +
      "<div class=\"field\"><label class=\"lbl\">结束</label><input id=\"mEnd\" class=\"input\" type=\"time\" step=\"300\"></div>" +
      "</div>" +
      "<div class=\"field\"><label class=\"lbl\">日期</label><input id=\"mDate\" class=\"input\" type=\"date\"></div>" +
      "<div class=\"field\"><label class=\"lbl\">关联待办</label><select id=\"mTodo\" class=\"select\"></select></div>" +
      "<div class=\"modal-actions\">" +
      "<button class=\"btn danger\" id=\"mDelete\" type=\"button\"" + (editing ? "" : " style=\"display:none\"") + ">删除</button>" +
      "<button class=\"btn ghost\" id=\"mFocus\" type=\"button\">用关联待办专注</button>" +
      "<button class=\"btn ghost\" id=\"mCancel\" type=\"button\">取消</button>" +
      "<button class=\"btn primary\" id=\"mSave\" type=\"button\">保存</button>" +
      "</div>";
    showModal(box);
    var date = src ? init.date : (init.date || currentDate);
    $("#mTitle").value = src ? src.title : "";
    $("#mStart").value = src ? src.start : (init.start || "09:00");
    $("#mEnd").value = src ? src.end : (init.end || "10:00");
    $("#mDate").value = date;
    var dl = $("#mTodoList");
    state.todos.forEach(function (t) { var o = document.createElement("option"); o.value = t.text; dl.appendChild(o); });
    var sel = $("#mTodo"), o0 = document.createElement("option"); o0.value = ""; o0.textContent = "（不关联）"; sel.appendChild(o0);
    state.todos.forEach(function (t) { var o = document.createElement("option"); o.value = t.id; o.textContent = t.text; sel.appendChild(o); });
    sel.value = src && src.todoId ? src.todoId : "";
    if (!sel.value && src) { var m = state.todos.filter(function (t) { return t.text === src.title; })[0]; if (m) sel.value = m.id; }
    $("#mTitle").focus();
    $("#mCancel").addEventListener("click", hideModal);
    $("#mFocus").addEventListener("click", function () {
      if (!sel.value) { toast("请先选择要关联的待办", "warn"); return; }
      setCurrentTodo(sel.value); hideModal();
    });
    $("#mDelete").addEventListener("click", function () {
      if (!editing) return;
      var k = init.date || currentDate;
      state.blocks[k] = blocksFor(k).filter(function (b) { return b.id !== init.id; });
      save(); hideModal(); renderTimeline(); toast("已删除时间块");
    });
    $("#mSave").addEventListener("click", function () {
      var title = $("#mTitle").value.trim() || "未命名";
      var s = $("#mStart").value || "09:00";
      var e2 = $("#mEnd").value || "";
      var dk = $("#mDate").value || currentDate;
      var todoId = $("#mTodo").value || "";
      if (parseHM(e2) <= parseHM(s)) { toast("结束时间必须晚于开始时间", "danger"); return; }
      if (editing) {
        var origK = init.date || currentDate;
        var rest = blocksFor(origK).filter(function (b) { return b.id !== init.id; });
        var target = (origK === dk) ? rest : blocksFor(dk).slice();
        target.push({ id: init.id, title: title, start: toHM(parseHM(s)), end: toHM(parseHM(e2)), todoId: todoId });
        state.blocks[origK] = rest; state.blocks[dk] = target;
      } else {
        var list = blocksFor(dk).slice();
        list.push({ id: uid(), title: title, start: toHM(parseHM(s)), end: toHM(parseHM(e2)), todoId: todoId });
        state.blocks[dk] = list;
      }
      save(); hideModal();
      if (dk !== currentDate) currentDate = dk;
      renderTimeline();
      var ov = overlapIds(blocksFor(dk));
      if (Object.keys(ov).length) toast("提示：新安排与已有时间块重叠，请确认是否需要调整", "warn");
      else toast(editing ? "已保存时间块" : "已创建时间块", "ok");
    });
  }

  /* ================= settings / backup ================= */
  function openSettings() {
    var s = state.settings;
    var box = document.createElement("div");
    box.innerHTML =
      "<h3>设置</h3>" +
      "<div class=\"field-row\">" +
      "<div class=\"field\"><label class=\"lbl\">专注（分钟）</label><input id=\"sFocus\" class=\"input\" type=\"number\" min=\"1\" max=\"180\"></div>" +
      "<div class=\"field\"><label class=\"lbl\">短休息</label><input id=\"sShort\" class=\"input\" type=\"number\" min=\"1\" max=\"120\"></div>" +
      "<div class=\"field\"><label class=\"lbl\">长休息</label><input id=\"sLong\" class=\"input\" type=\"number\" min=\"1\" max=\"180\"></div>" +
      "</div>" +
      "<div class=\"field-row\">" +
      "<div class=\"field\"><label class=\"lbl\">每几轮进长休息</label><input id=\"sEvery\" class=\"input\" type=\"number\" min=\"1\" max=\"12\"></div>" +
      "<div class=\"field\"><label class=\"lbl\">位移间隔（秒）</label><input id=\"sShiftSec\" class=\"input\" type=\"number\" min=\"20\" max=\"900\"></div>" +
      "</div>" +
      "<div class=\"field-row\">" +
      "<div class=\"field\"><label class=\"lbl\">时间轴起点（时）</label><input id=\"sFrom\" class=\"input\" type=\"number\" min=\"0\" max=\"23\"></div>" +
      "<div class=\"field\"><label class=\"lbl\">时间轴终点（时）</label><input id=\"sTo\" class=\"input\" type=\"number\" min=\"1\" max=\"24\"></div>" +
      "</div>" +
      "<div class=\"field switch\"><input id=\"sShift\" type=\"checkbox\"><label for=\"sShift\">启用界面轻微位移（LCD 防灼屏，仅装饰元素）</label></div>" +
      "<div class=\"field switch\"><input id=\"sSound\" type=\"checkbox\"><label for=\"sSound\">阶段结束提示音</label></div>" +
      "<div class=\"field switch\"><input id=\"sLight\" type=\"checkbox\"><label for=\"sLight\">浅色主题</label></div>" +
      "<div class=\"modal-actions\"><button class=\"btn ghost\" id=\"sCancel\" type=\"button\">取消</button><button class=\"btn primary\" id=\"sSave\" type=\"button\">保存</button></div>";
    showModal(box);
    $("#sFocus").value = s.focusMin; $("#sShort").value = s.shortMin; $("#sLong").value = s.longMin;
    $("#sEvery").value = s.longEvery; $("#sShiftSec").value = s.shiftSec;
    $("#sFrom").value = s.timelineFrom; $("#sTo").value = s.timelineTo;
    $("#sShift").checked = !!s.shift; $("#sSound").checked = !!s.sound; $("#sLight").checked = (s.theme === "light");
    $("#sCancel").addEventListener("click", hideModal);
    $("#sSave").addEventListener("click", function () {
      var before = phaseDurMs(state.timer.phase);
      s.focusMin = numOr($("#sFocus").value, 25, 1, 180);
      s.shortMin = numOr($("#sShort").value, 5, 1, 120);
      s.longMin = numOr($("#sLong").value, 15, 1, 180);
      s.longEvery = numOr($("#sEvery").value, 4, 1, 12);
      s.shiftSec = numOr($("#sShiftSec").value, 75, 20, 900);
      s.timelineFrom = numOr($("#sFrom").value, 0, 0, 23);
      s.timelineTo = numOr($("#sTo").value, 24, s.timelineFrom + 1, 24);
      s.shift = $("#sShift").checked; s.sound = $("#sSound").checked;
      s.theme = $("#sLight").checked ? "light" : "dark";
      if (!state.timer.running && state.timer.remainMs >= before) state.timer.remainMs = phaseDurMs(state.timer.phase);
      save(); applyTheme(); initShift(); renderTimeline(); renderTimer(); hideModal();
      toast("设置已保存", "ok");
    });
  }
  function exportData() {
    try {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "focusdesk-backup-" + dayKey() + ".json";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
      toast("已导出备份文件", "ok");
    } catch (e) { toast("导出失败：" + e.message, "danger"); }
  }
  function importData(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var raw = JSON.parse(String(fr.result));
        if (!raw || typeof raw !== "object") throw new Error("格式不正确");
        if (!window.confirm("导入将覆盖当前所有数据，确定继续？")) return;
        state = sanitize(raw);
        save(true); applyTheme(); initShift(); renderAll(); toast("导入成功", "ok");
      } catch (e) { toast("导入失败：" + (e && e.message ? e.message : "无法解析"), "danger"); }
    };
    fr.onerror = function () { toast("读取文件失败", "danger"); };
    fr.readAsText(file);
  }

  /* ================= wake lock ================= */
  var wakeSentinel = null;
  function setWake(text, cls) { var el = $("#wakeStatus"); if (!el) return; el.textContent = text; el.className = "chip " + (cls || "chip-warn"); }
  function requestWake() {
    if (!WAKE_SUPPORTED) { setWake("屏幕常亮：浏览器不支持（请手动设置不息屏）", "chip-warn"); return; }
    if (document.visibilityState === "hidden") return;
    if (wakeSentinel) { try { wakeSentinel.release(); } catch (e) {} wakeSentinel = null; }
    try {
      navigator.wakeLock.request("screen").then(function (lock) {
        wakeSentinel = lock;
        setWake("屏幕常亮：已开启", "chip-ok");
        lock.addEventListener("release", function () {
          wakeSentinel = null;
          if (document.visibilityState === "visible") setWake("屏幕常亮：已释放（可能被省电策略回收）", "chip-warn");
        });
      }).catch(function (err) {
        setWake("屏幕常亮：申请被拒绝（" + (err && err.name ? err.name : "Error") + "）", "chip-warn");
      });
    } catch (e) { setWake("屏幕常亮：申请异常", "chip-warn"); }
  }
  function initWakeLock() {
    if (!WAKE_SUPPORTED) { setWake("屏幕常亮：浏览器不支持（请手动设置不息屏）", "chip-warn"); return; }
    requestWake();
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") requestWake(); });
    window.addEventListener("focus", function () { requestWake(); });
    window.addEventListener("pointerdown", function once() { requestWake(); window.removeEventListener("pointerdown", once); });
  }

  /* ================= micro shift ================= */
  var shiftTimer = null;
  function stopShift() { if (shiftTimer) { clearTimeout(shiftTimer); shiftTimer = null; } }
  function initShift() {
    stopShift();
    if (NOMOTION || !state.settings.shift) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var targets = $$("[data-shift], [data-shift-slow]");
    if (!targets.length) return;
    var base = Math.max(20, state.settings.shiftSec || 75) * 1000;
    function step() {
      targets.forEach(function (el) {
        var amp = el.hasAttribute("data-shift-slow") ? 2 : 6;
        var x = (Math.random() * 2 - 1) * amp;
        var y = (Math.random() * 2 - 1) * amp;
        el.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
      });
      schedule();
    }
    function schedule() { shiftTimer = setTimeout(step, base + Math.random() * base * 0.5); }
    schedule();
  }

  /* ================= clock / theme ================= */
  function renderClock() {
    var d = new Date();
    var el = $("#nowTime"); if (el) el.textContent = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    var ed = $("#nowDate"); if (ed) ed.textContent = fmtDate(d);
  }
  function applyTheme() {
    var t = state.settings.theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    var m = document.querySelector("meta[name=\"theme-color\"]");
    if (m) m.setAttribute("content", t === "light" ? "#f3f5f9" : "#0e1116");
  }

  /* ================= pwa ================= */
  var deferredPrompt = null;
  function bindInstall() {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault(); deferredPrompt = e;
      var b = $("#btnInstall"); if (b) b.classList.remove("hidden");
    });
    var b = $("#btnInstall");
    if (b) b.addEventListener("click", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; b.classList.add("hidden"); });
    });
    window.addEventListener("appinstalled", function () { toast("已安装到桌面", "ok"); });
  }
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) {}
  }

  /* ================= misc ================= */
  function renderAll() { renderClock(); renderTimer(); renderTodos(); renderTaskSelect(); renderTimeline(); renderCurrentTask(); }
  function shiftDate(delta) {
    var p = currentDate.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + delta);
    currentDate = dayKey(d); renderTimeline();
  }
  function bindUI() {
    $("#btnStart").addEventListener("click", function () { if (state.timer.running) pauseTimer(); else startTimer(); });
    $("#btnSkip").addEventListener("click", skipPhase);
    $("#btnEnd").addEventListener("click", finishPhase);
    $("#todoForm").addEventListener("submit", function (e) { e.preventDefault(); addTodo($("#todoInput").value); $("#todoInput").value = ""; });
    $("#todoFilters").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".filter") : null; if (!b) return;
      todoFilter = b.dataset.filter;
      $$(".filter").forEach(function (x) { x.classList.toggle("active", x === b); });
      renderTodos();
    });
    $("#pomoTask").addEventListener("change", function () { setCurrentTodo($("#pomoTask").value); });
    $("#btnSettings").addEventListener("click", openSettings);
    $("#btnExport").addEventListener("click", exportData);
    $("#btnImport").addEventListener("click", function () { $("#fileImport").click(); });
    $("#fileImport").addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; if (f) importData(f); e.target.value = ""; });
    $("#btnPrevDay").addEventListener("click", function () { shiftDate(-1); });
    $("#btnNextDay").addEventListener("click", function () { shiftDate(1); });
    $("#btnToday").addEventListener("click", function () { currentDate = dayKey(); renderTimeline(); });
    $("#dayPicker").addEventListener("change", function () { if (this.value) { currentDate = this.value; renderTimeline(); } });
    $("#modal").addEventListener("pointerdown", function (e) { if (e.target === this) hideModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modalOpen) hideModal(); });
  }
  function seedDemo() {
    if (!state.todos.length) {
      state.todos = [
        { id: uid(), text: "整理项目笔记", done: false, createdAt: Date.now(), doneAt: 0 },
        { id: uid(), text: "写周报", done: false, createdAt: Date.now(), doneAt: 0 },
        { id: uid(), text: "回复邮件", done: true, createdAt: Date.now(), doneAt: Date.now() }
      ];
    }
    var k = dayKey();
    if (!blocksFor(k).length) {
      state.blocks[k] = [
        { id: uid(), title: "学习", start: "09:00", end: "10:00", todoId: "" },
        { id: uid(), title: "休息", start: "10:00", end: "10:30", todoId: "" },
        { id: uid(), title: "写代码", start: "10:30", end: "11:30", todoId: "" },
        { id: uid(), title: "阅读", start: "14:00", end: "15:00", todoId: "" }
      ];
    }
    save(true);
  }
  function runProbe() {
    if (!PROBE) return;
    var k = dayKey();
    var info = "PROBE-OK todos=" + state.todos.length + " blocks=" + blocksFor(k).length +
      " phase=" + state.timer.phase + " running=" + (state.timer.running ? 1 : 0) +
      " wake=" + (WAKE_SUPPORTED ? "yes" : "no") +
      " sw=" + (("serviceWorker" in navigator) ? "yes" : "no") +
      " theme=" + state.settings.theme;
    document.title = info;
    try { document.body.setAttribute("data-probe", info); } catch (e) {}
  }
  var tickCount = 0;
  function tick() {
    var t = state.timer;
    if (t.running && t.endsAt && Date.now() >= t.endsAt) { finishPhase(); return; }
    renderTimer();
    updateNowLine();
    tickCount++;
    if (tickCount % 60 === 0) renderTimeline();
  }
  function init() {
    applyTheme();
    recoverTimer();
    if (SEED) seedDemo();
    ensureCurTaskEl();
    renderAll();
    bindUI();
    initTimeline();
    initShift();
    initWakeLock();
    registerSW();
    bindInstall();
    setInterval(tick, 500);
    setInterval(renderClock, 1000);
    if (AUTO) startTimer();
    setTimeout(runProbe, 0);
  }
  window.addEventListener("error", function (e) { try { toast("脚本错误：" + (e.message || "unknown"), "danger"); } catch (x) {} });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
