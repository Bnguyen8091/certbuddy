// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const api = async (path, body) => {
  const res = await fetch(path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  return res.json();
};
const show = (el, on = true) => el.classList.toggle("hidden", !on);

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    $(`view-${btn.dataset.view}`).classList.add("active");
    if (btn.dataset.view === "cards") loadCards();
    if (btn.dataset.view === "stats") loadStats();
    if (btn.dataset.view === "plan") loadPlan();
  });
});
const goTab = (view) => document.querySelector(`.tab[data-view="${view}"]`).click();

// ---------- domains ----------
async function loadDomains() {
  const domains = await api("/api/domains");
  domains.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.domain;
    opt.textContent = d.domain;
    $("quiz-domain").appendChild(opt);
  });
  domainSelect.sync();
}

// ---------- quiz ----------
let quiz = [], qi = 0, score = 0, lastChoice = null;

$("start-quiz").onclick = () => startQuiz($("quiz-domain").value, 10);

async function startQuiz(domain, n) {
  quiz = await api(`/api/quiz?n=${n}${domain ? `&domain=${encodeURIComponent(domain)}` : ""}`);
  qi = 0; score = 0;
  show($("quiz-setup"), false); show($("quiz-done"), false); show($("quiz-play"));
  renderQuestion();
}

function renderQuestion() {
  const q = quiz[qi];
  lastChoice = null;
  $("quiz-domain-tag").textContent = q.domain;
  $("quiz-progress").textContent = `Question ${qi + 1} of ${quiz.length}`;
  $("quiz-bar").style.width = `${(qi / quiz.length) * 100}%`;
  $("quiz-prompt").textContent = q.prompt;
  show($("quiz-feedback"), false); show($("next-btn"), false); show($("explain-btn"), false);

  const box = $("quiz-choices");
  box.innerHTML = "";
  q.choices.forEach((text, i) => {
    const b = document.createElement("button");
    b.className = "choice";
    const key = document.createElement("span");
    key.className = "key";
    key.textContent = "abcd"[i];
    b.append(key, document.createTextNode(text));
    b.onclick = () => submitAnswer(i);
    box.appendChild(b);
  });
}

async function submitAnswer(i) {
  const q = quiz[qi];
  lastChoice = i;
  const res = await api("/api/answer", { question_id: q.id, chosen_index: i });
  const buttons = [...$("quiz-choices").children];
  buttons.forEach((b) => (b.disabled = true));
  buttons[res.correct_index].classList.add("correct");
  if (!res.correct) buttons[i].classList.add("wrong");
  if (res.correct) score++;

  const fb = $("quiz-feedback");
  fb.className = `feedback ${res.correct ? "good" : "bad"}`;
  fb.innerHTML = `<strong>${res.correct ? "correct." : "incorrect."}</strong> `;
  fb.appendChild(document.createTextNode(res.explanation));
  show(fb);
  show($("explain-btn"), !res.correct);
  $("next-btn").innerHTML = `${qi === quiz.length - 1 ? "see results" : "next"} <kbd>enter</kbd>`;
  show($("next-btn"));
}

const EXPLAIN_LABEL = "ask tutor <kbd>?</kbd>";
$("explain-btn").onclick = async () => {
  const btn = $("explain-btn");
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = "thinking...";
  const res = await api("/api/explain", { question_id: quiz[qi].id, chosen_index: lastChoice });
  const div = document.createElement("div");
  div.className = "ai";
  div.innerHTML = `<strong>tutor${res.source === "ai" ? "" : " (offline)"}:</strong> `;
  div.appendChild(document.createTextNode(res.text));
  $("quiz-feedback").appendChild(div);
  show(btn, false); btn.disabled = false; btn.innerHTML = EXPLAIN_LABEL;
};

$("next-btn").onclick = () => {
  qi++;
  if (qi < quiz.length) return renderQuestion();
  show($("quiz-play"), false); show($("quiz-done"));
  const pct = Math.round((score / quiz.length) * 100);
  $("quiz-score").textContent = `${score}/${quiz.length}  ${pct}%`;
  $("quiz-score").style.color = pct >= 80 ? "var(--accent)" : pct >= 60 ? "var(--warn)" : "var(--bad)";
  loadStatus();
};

$("again-btn").onclick = () => { show($("quiz-done"), false); show($("quiz-setup")); };

// ---------- flashcards ----------
let cards = [], ci = 0;

async function loadCards() {
  cards = await api("/api/flashcards/due");
  ci = 0;
  renderCard();
}

function renderCard() {
  const has = ci < cards.length;
  show($("card"), has); show($("cards-empty"), !has); show($("card-actions"), false);
  $("cards-left").textContent = has ? `${cards.length - ci} due` : "";
  if (!has) return;
  const c = cards[ci];
  $("card").classList.remove("flipped");
  $("card-domain").textContent = `${c.domain} · Box ${c.box}`;
  $("card-front").textContent = c.prompt;
  $("card-answer").textContent = c.choices[c.correct_index];
  $("card-expl").textContent = c.explanation;
}

$("card").onclick = () => {
  $("card").classList.toggle("flipped");
  show($("card-actions"), $("card").classList.contains("flipped"));
};

async function reviewCard(correct) {
  await api("/api/flashcards/review", { question_id: cards[ci].id, correct });
  ci++;
  renderCard();
  loadStatus();
}
$("card-right").onclick = () => reviewCard(true);
$("card-wrong").onclick = () => reviewCard(false);

// ---------- progress ----------
let domainChart, boxChart;

async function loadStats() {
  const s = await api("/api/stats");
  $("s-total").textContent = s.total_attempts;
  $("s-acc").textContent = s.overall_accuracy == null ? "–" : `${s.overall_accuracy}%`;
  $("s-due").textContent = s.due_now;
  $("s-weak").textContent = s.weakest || "Answer some questions first";

  const labels = s.domains.map((d) => d.domain);
  const data = s.domains.map((d) => d.accuracy ?? 0);
  const colors = s.domains.map((d) =>
    d.accuracy == null ? THEME.border : d.accuracy >= 80 ? THEME.accent : d.accuracy >= 60 ? THEME.warn : THEME.bad);

  domainChart?.destroy();
  domainChart = new Chart($("domain-chart"), {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: colors }] },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } } },
    },
  });

  const boxLabels = ["Box 1", "Box 2", "Box 3", "Box 4", "Box 5"];
  boxChart?.destroy();
  boxChart = new Chart($("box-chart"), {
    type: "bar",
    data: {
      labels: boxLabels,
      datasets: [{
        data: [1, 2, 3, 4, 5].map((b) => s.boxes[b] || 0),
        // dim -> bright green as memory gets stronger
        backgroundColor: ["#24402f", "#2f5c41", "#3f8159", "#55b07a", THEME.accent],
      }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}

// ---------- study plan ----------
const fmtDate = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, opts);

function taskButton(task) {
  const b = document.createElement("button");
  b.className = "task";
  b.textContent = task.label;
  b.onclick = () => {
    if (task.type === "cards") return goTab("cards");
    goTab("quiz");
    startQuiz(task.domain, task.n);
  };
  return b;
}

function renderPlan(p) {
  show($("plan-result"), p.configured);
  if (!p.configured) return;

  setPlanDate(p.exam_date);
  $("plan-minutes").value = String(p.minutes);
  $("plan-minutes").dispatchEvent(new Event("change"));
  $("plan-submit").textContent = "Update my plan";
  $("p-days").textContent = p.days_left;
  $("p-date").textContent = fmtDate(p.exam_date, { month: "long", day: "numeric", year: "numeric" });
  $("p-top").textContent = p.priorities[0]?.domain || "–";

  const today = p.days.find((d) => d.is_today);
  show($("plan-today"), !!today);
  if (today) {
    $("today-title").textContent = today.title;
    $("today-reason").textContent = today.reason;
    $("today-tasks").replaceChildren(...today.tasks.map(taskButton));
  }

  const max = Math.max(...p.priorities.map((x) => x.share), 1);
  $("plan-priorities").replaceChildren(...p.priorities.map((x) => {
    const row = document.createElement("div");
    row.className = "prio";
    row.innerHTML = `<span class="prio-name"></span><div class="prio-bar"><div></div></div><span class="prio-pct"></span>`;
    row.querySelector(".prio-name").textContent = x.domain;
    row.querySelector(".prio-bar div").style.width = `${(x.share / max) * 100}%`;
    row.querySelector(".prio-pct").textContent = `${x.share}%`;
    return row;
  }));

  $("plan-days").replaceChildren(...p.days.map((d) => {
    const li = document.createElement("li");
    li.className = `day ${d.kind}${d.is_today ? " is-today" : ""}`;
    li.innerHTML = `<div class="day-date"></div><div class="day-body"><strong></strong><span class="muted small"></span><ul></ul></div>`;
    li.querySelector(".day-date").textContent = d.is_today ? "Today" : fmtDate(d.date);
    li.querySelector("strong").textContent = d.title;
    li.querySelector(".day-body > span").textContent = d.reason;
    li.querySelector("ul").replaceChildren(...d.tasks.map((t) => {
      const item = document.createElement("li");
      item.textContent = t.label;
      return item;
    }));
    return li;
  }));
}

async function loadPlan() {
  renderPlan(await api("/api/plan"));
}

$("plan-form").onsubmit = async (e) => {
  e.preventDefault();
  show($("plan-error"), false);
  const res = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exam_date: $("plan-date").value, minutes: Number($("plan-minutes").value) }),
  });
  const p = await res.json();
  if (!res.ok) {
    $("plan-error").textContent = p.error;
    return show($("plan-error"));
  }
  renderPlan(p);
};

// ---------- themed date picker (replaces the browser's native calendar) ----------
const toISO = (d) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
const fromISO = (iso) => new Date(`${iso}T00:00:00`);
const todayISO = () => toISO(new Date());
let calMonth = new Date(); // any date inside the month being shown
let calFocus = null;       // ISO date highlighted by the keyboard

function setPlanDate(iso) {
  $("plan-date").value = iso;
  const label = $("plan-date-label");
  label.textContent = fmtDate(iso, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  label.classList.remove("muted");
}

function renderCal() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayISO(), selected = $("plan-date").value;
  const atCurrentMonth = y === new Date().getFullYear() && m === new Date().getMonth();

  const cal = $("cal");
  cal.innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-step="-1" ${atCurrentMonth ? "disabled" : ""}>&lt;</button>
      <span>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toLowerCase()}</span>
      <button type="button" class="cal-nav" data-step="1">&gt;</button>
    </div>
    <div class="cal-grid">${["su", "mo", "tu", "we", "th", "fr", "sa"].map((d) => `<span class="cal-dow">${d}</span>`).join("")}</div>`;
  const grid = cal.querySelector(".cal-grid");
  for (let i = 0; i < first.getDay(); i++) grid.appendChild(document.createElement("span"));
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = toISO(new Date(y, m, day));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cal-day";
    b.textContent = day;
    b.dataset.iso = iso;
    b.disabled = iso < today;
    if (iso === today) b.classList.add("is-today");
    if (iso === selected) b.classList.add("is-selected");
    if (iso === calFocus) b.classList.add("is-focus");
    grid.appendChild(b);
  }
  cal.querySelectorAll(".cal-nav").forEach((b) => (b.onclick = () => {
    calMonth = new Date(y, m + Number(b.dataset.step), 1);
    renderCal();
  }));
  cal.querySelectorAll(".cal-day:not(:disabled)").forEach((b) => (b.onclick = () => pickDate(b.dataset.iso)));
}

function openCal() {
  closeAllPopups();
  calFocus = $("plan-date").value || todayISO();
  calMonth = fromISO(calFocus);
  renderCal();
  show($("cal"));
  $("plan-date-btn").setAttribute("aria-expanded", "true");
}
function closeCal() {
  show($("cal"), false);
  $("plan-date-btn").setAttribute("aria-expanded", "false");
}
function pickDate(iso) {
  setPlanDate(iso);
  closeCal();
  $("plan-date-btn").focus();
}

$("plan-date-btn").onclick = () => ($("cal").classList.contains("hidden") ? openCal() : closeCal());
// ---------- themed dropdowns (replace the browser's native <select> popup) ----------
// The real <select> stays in the page (hidden) and holds the value, so the rest of
// the code can keep reading/setting select.value. Fire a "change" event after
// setting .value from code so the button label updates.
const popupClosers = [closeCal];
const closeAllPopups = () => popupClosers.forEach((fn) => fn());

function themeSelect(sel) {
  const wrap = document.createElement("div");
  wrap.className = "datepick select";
  wrap.innerHTML = `
    <button type="button" class="date-btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="select-label"></span><span class="caret">v</span>
    </button>
    <ul class="menu hidden" role="listbox"></ul>`;
  sel.classList.add("hidden");
  sel.after(wrap);
  const btn = wrap.querySelector("button"), menu = wrap.querySelector(".menu");
  let focus = 0;

  const sync = () => { wrap.querySelector(".select-label").textContent = sel.selectedOptions[0]?.text ?? ""; };
  const isOpen = () => !menu.classList.contains("hidden");
  const render = () => {
    menu.replaceChildren(...[...sel.options].map((o, i) => {
      const li = document.createElement("li");
      li.role = "option";
      li.textContent = o.text;
      li.classList.toggle("is-selected", i === sel.selectedIndex);
      li.classList.toggle("is-focus", i === focus);
      li.onclick = () => choose(i);
      return li;
    }));
  };
  const open = () => {
    closeAllPopups();
    focus = Math.max(sel.selectedIndex, 0);
    render();
    show(menu);
    btn.setAttribute("aria-expanded", "true");
  };
  const close = () => { show(menu, false); btn.setAttribute("aria-expanded", "false"); };
  const choose = (i) => {
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event("change"));
    close();
    btn.focus();
  };

  btn.onclick = () => (isOpen() ? close() : open());
  btn.addEventListener("keydown", (e) => {
    const n = sel.options.length;
    if (e.key === "Escape" && isOpen()) { e.preventDefault(); return close(); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen()) return open();
      focus = (focus + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      render();
    } else if ((e.key === "Enter" || e.key === " ") && isOpen()) {
      e.preventDefault();
      choose(focus);
    }
  });
  sel.addEventListener("change", sync);
  popupClosers.push(close);
  sync();
  return { sync };
}

const domainSelect = themeSelect($("quiz-domain"));
themeSelect($("plan-minutes"));

// Clicks inside a picker never reach the document, so "click outside" closes them.
// (Checking e.target there breaks when a re-render replaces the clicked element.)
document.querySelectorAll(".datepick").forEach((el) => el.addEventListener("click", (e) => e.stopPropagation()));
document.addEventListener("click", closeAllPopups);
$("plan-date-btn").addEventListener("keydown", (e) => {
  const open = !$("cal").classList.contains("hidden");
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (e.key === "Escape" && open) { e.preventDefault(); return closeCal(); }
  if (!open) {
    if (e.key === "ArrowDown") { e.preventDefault(); openCal(); }
    return;
  }
  if (moves[e.key]) {
    e.preventDefault();
    const d = fromISO(calFocus);
    d.setDate(d.getDate() + moves[e.key]);
    if (toISO(d) < todayISO()) return;
    calFocus = toISO(d);
    calMonth = d;
    renderCal();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pickDate(calFocus);
  }
});

// ---------- status bar ----------
async function loadStatus() {
  const s = await api("/api/status");
  $("sb-exam").textContent = s.exam;
  $("sb-questions").textContent = `${s.questions} questions`;
  $("sb-due").textContent = `${s.due} cards due`;
  $("sb-ai").innerHTML = s.ai
    ? `tutor: <span class="online">online</span>`
    : `tutor: <span class="offline">offline</span>`;
}

// ---------- keyboard shortcuts ----------
const visible = (id) => !$(id).classList.contains("hidden") && $(id).offsetParent !== null;
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.target.closest(".datepick")) return; // pickers handle their own keys
  const k = e.key.toLowerCase();

  if (visible("view-home") && k === "enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); return goTab("quiz"); }
  if (visible("quiz-setup") && k === "enter") { e.preventDefault(); return $("start-quiz").click(); }
  if (visible("quiz-done") && k === "enter") { e.preventDefault(); return $("again-btn").click(); }
  if (visible("quiz-play")) {
    const i = "abcd".indexOf(k) >= 0 ? "abcd".indexOf(k) : "1234".indexOf(k);
    const btn = $("quiz-choices").children[i];
    if (i >= 0 && btn && !btn.disabled) return btn.click();
    if (k === "?" && visible("explain-btn")) return $("explain-btn").click();
    if (k === "enter" && visible("next-btn")) { e.preventDefault(); return $("next-btn").click(); }
  }
  if (visible("card")) {
    if (k === " ") { e.preventDefault(); return $("card").click(); }
    if (visible("card-actions") && k === "1") return $("card-wrong").click();
    if (visible("card-actions") && k === "2") return $("card-right").click();
  }
});

// ---------- chart theme ----------
const css = getComputedStyle(document.documentElement);
const THEME = Object.fromEntries(["accent", "warn", "bad", "border", "muted", "text"]
  .map((n) => [n, css.getPropertyValue(`--${n}`).trim()]));
Chart.defaults.font.family = css.getPropertyValue("--mono");
Chart.defaults.font.size = 12;
Chart.defaults.color = THEME.muted;
Chart.defaults.borderColor = THEME.border;

// ---------- start screen ----------
function goHome() {
  document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("view-home").classList.add("active");
}
$("brand").onclick = goHome;
$("home-start").onclick = () => goTab("quiz");
$("home-plan").onclick = () => goTab("plan");

// A short "boot log" built from real app data, then the title fades in.
async function bootSequence() {
  const s = await api("/api/status").catch(() => null);
  const pad = (label) => `> ${label} `.padEnd(34, ".");
  const lines = [
    [pad("loading question bank"), s ? `${s.questions} questions` : "ok", "ok"],
    [pad("spaced repetition engine"), s ? `${s.due} cards due` : "ok", "ok"],
    [pad("study planner"), "ready", "ok"],
    [pad("ai tutor"), s?.ai ? "online" : "offline (fallback on)", s?.ai ? "ok" : "warn"],
  ];
  const boot = $("boot");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));

  boot.textContent = "";
  for (const [label, result, kind] of lines) {
    const line = document.createElement("div");
    line.textContent = label + " ";
    const res = document.createElement("span");
    res.className = kind;
    res.textContent = result;
    boot.appendChild(line);
    await wait(220);
    line.appendChild(res);
  }
  await wait(250);
  $("home-main").classList.add("in");
}

loadDomains();
loadStatus();
bootSequence();
