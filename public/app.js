const questionList = [
  { prompt: "What can you do when progress toward a goal becomes difficult?", options: ["Give up if the plan is no longer perfect.", "Remember why the goal matters, adjust the plan, and keep going.", "Wait until life becomes less busy."], correct: 1, feedback: "Sister Spannaus encouraged students to remember their goals, adjust when needed, and keep moving forward." },
  { prompt: "How can we involve Heavenly Father in our goals?", options: ["Pray in faith, do our part, and look for His help.", "Wait for the Lord to complete every step for us.", "Never adjust a goal after praying about it."], correct: 0, feedback: "The devotional teaches us to do our part, pray in faith, and seek the Lord’s help." },
  { prompt: "Which is an example of a top-level goal?", options: ["Study for 20 minutes tonight.", "Complete my education and prepare for the work I want to do.", "Download the spreadsheet template."], correct: 1, feedback: "A top-level goal describes a larger purpose. Smaller tasks, like studying tonight, help us work toward it." },
  { prompt: "In the SMART model used in this lesson, what does T mean?", options: ["Trackable", "Time Bound", "Talented"], correct: 1, feedback: "Time Bound means a goal includes a clear period or deadline." },
  { prompt: "What small step will you take this week?", options: ["Set and protect a 20-minute study block.", "Ask someone for help with one assignment.", "Review my goals and adjust one next step."], correct: null, feedback: "There is no single right answer. Choose a step you can realistically take this week, then follow through." },
];

const appRoot = document.querySelector("#app");
const socket = window.io ? io() : null;
let mode = "home";
let code = "";
let hostKey = "";
let state = null;
let selected = null;
let notice = "";
let busy = false;
let lastSocketRoom = "";
let activeTab = "activity";

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function getParticipantId() {
  let id = localStorage.getItem("pathway-live-participant");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("pathway-live-participant", id);
  }
  return id;
}

function setQuery(params) {
  const url = new URL(window.location.href);
  url.search = "";
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  history.replaceState({}, "", url);
}

async function request(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

async function refresh(sessionCode, participantView = false) {
  if (!sessionCode) return;
  try {
    const extra = participantView ? `?participantId=${encodeURIComponent(getParticipantId())}` : "";
    state = await request(`/api/session/${encodeURIComponent(sessionCode)}${extra}`);
    code = state.session.code;
    const mine = (state.myAnswers || []).find((answer) => answer.questionIndex === state.session.activeQuestion);
    selected = mine ? mine.choiceIndex : null;
    notice = "";
    if (socket && lastSocketRoom !== code) {
      socket.emit("join-session", code);
      lastSocketRoom = code;
    }
    render();
  } catch (error) {
    state = null;
    notice = error.message;
    render();
  }
}


function slideMarkup(index, presenter) {
  const slide = window.gatheringSlides[index] || window.gatheringSlides[0];
  const items = (slide.items || []).map((item) => `<article class="slide-item"><span>${esc(item.label)}</span><p>${esc(item.text)}</p></article>`).join("");
  const prompts = (slide.prompts || []).map((prompt, i) => `<div><span>DISCUSS ${String(i + 1).padStart(2, "0")}</span><p>${esc(prompt)}</p></div>`).join("");
  return `<section class="shared-slides"><div class="slide-topline"><span>${esc(slide.section)}</span><span>SLIDE ${index + 1} / ${window.gatheringSlides.length}</span></div><div class="slide-content"><h2>${esc(slide.title).replace(/\n/g, "<br>")}</h2>${slide.subtitle ? `<p class="slide-subtitle">${esc(slide.subtitle)}</p>` : ""}${items ? `<div class="slide-items ${slide.items.length === 2 ? "two" : ""}">${items}</div>` : ""}${prompts ? `<div class="slide-prompts">${prompts}</div>` : ""}${slide.note ? `<p class="slide-note">${esc(slide.note)}</p>` : ""}</div><div class="slide-controls"><span>${presenter ? "Your slide is shared live with participants." : "The facilitator controls the shared slide."}</span>${presenter ? `<div class="slide-nav-buttons"><button class="button quiet" data-slide="${index - 1}" ${index === 0 ? "disabled" : ""}>← Previous</button><button class="button primary" data-slide="${index + 1}" ${index === window.gatheringSlides.length - 1 ? "disabled" : ""}>Next slide →</button></div>` : ""}</div><div class="slide-progress"><span style="width:${((index + 1) / window.gatheringSlides.length) * 100}%"></span></div></section>`;
}

function bindSlideButtons() {
  document.querySelectorAll("[data-slide]").forEach((button) => button.addEventListener("click", () => hostAction("set-slide", Number(button.dataset.slide))));
}

function bindViewTabs() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { activeTab = button.dataset.view; render(); }));
}

function homeView() {
  appRoot.innerHTML = `<section class="home">
    <div class="hero"><p class="eyebrow">TIME MANAGEMENT &amp; GOALS</p><h1>Keep moving.<br><em>Learn together.</em></h1><p class="intro">Join the live Week 3 activity. Answer each question, see why it matters, and learn from the group.</p>
      <form class="joinbox" id="join-form"><label for="session-code">SESSION CODE</label><div class="joinrow"><input id="session-code" placeholder="Enter code" maxlength="6" autocomplete="off" required><button class="button primary">Join session <span>→</span></button></div>${notice ? `<p class="notice">${esc(notice)}</p>` : ""}</form>
      <p class="privacy">No account or name is needed to participate.</p>
    </div>
    <aside class="side"><div class="orbit">W03</div><p class="eyebrow">TONIGHT’S FOCUS</p><h2>Big goals.<br>Small steps.</h2><p>Remember why your goal matters. Choose a next step you can take this week.</p><div class="rule"></div><button class="textbutton" id="facilitator-link">Facilitator? Start a session ↗</button></aside>
  </section>`;
  document.querySelector("#join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const joinCode = document.querySelector("#session-code").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!joinCode) return;
    mode = "join"; code = joinCode; selected = null; state = null; notice = ""; setQuery({ join: code }); refresh(code, true);
  });
  document.querySelector("#facilitator-link").addEventListener("click", () => {
    mode = "host"; code = localStorage.getItem("pathway-live-host-code") || ""; hostKey = localStorage.getItem("pathway-live-host-key") || ""; state = null; notice = ""; setQuery({ view: "host" });
    if (code) refresh(code); else render();
  });
}

function hostView() {
  if (!code) {
    appRoot.innerHTML = `<section class="panel"><div class="startcard"><p class="eyebrow">FACILITATOR VIEW</p><h1>Start a live session</h1><p class="intro">Create a room, share the six-character code, and guide the class through five questions.</p><button class="button primary large" id="create-session" ${busy ? "disabled" : ""}>${busy ? "Creating…" : "Create session"} <span>→</span></button>${notice ? `<p class="notice">${esc(notice)}</p>` : ""}</div></section>`;
    document.querySelector("#create-session").addEventListener("click", createSession);
    return;
  }
  if (!state) {
    appRoot.innerHTML = `<section class="panel"><div class="startcard"><p class="eyebrow">FACILITATOR VIEW · SESSION ${esc(code)}</p><h1>${notice ? "Session unavailable" : "Connecting…"}</h1>${notice ? `<p class="intro">${esc(notice)}</p>` : ""}</div></section>`;
    return;
  }
  const qIndex = state.session.activeQuestion;
  const question = questionList[qIndex];
  const totalAnswers = state.questionStats.reduce((sum, row) => sum + row.correct, 0);
  const totalMissed = state.questionStats.reduce((sum, row) => sum + row.incorrect, 0);
  const counts = [0, 0, 0];
  for (const row of state.counts) counts[row.choiceIndex] = row.total;
  const bars = question.options.map((option, i) => {
    const percent = state.responseCount ? Math.round(counts[i] / state.responseCount * 100) : 0;
    return `<div><div class="resultlabel"><span>${esc(option)}</span><strong>${counts[i]} <small>(${percent}%)</small></strong></div><div class="track"><div class="fill" style="width:${percent}%"></div></div></div>`;
  }).join("");
  const history = questionList.map((item, i) => {
    const row = state.questionStats.find((item) => item.questionIndex === i);
    return `<div class="historyrow"><span>Q${i + 1}</span><span>${item.correct === null ? `${row?.ungraded || 0} reflections` : `<b class="good">${row?.correct || 0} correct</b><b class="bad">${row?.incorrect || 0} incorrect</b>`}</span></div>`;
  }).join("");
  appRoot.innerHTML = `<section class="panel"><div class="hosttop"><div><p class="eyebrow">FACILITATOR VIEW</p><h1>Live session</h1></div><span class="pill"><i></i> ${state.session.status === "active" ? "SESSION OPEN" : state.session.status.toUpperCase()}</span></div>
    <div class="room"><div><span class="roomlabel">SESSION CODE</span><strong class="roomcode">${esc(code)}</strong></div><div class="actions"><button class="button secondary" id="copy-link">Copy join link</button><button class="button quiet" id="new-session">New session</button></div></div>
    <div class="view-tabs"><button class="${activeTab === "activity" ? "selected" : ""}" data-view="activity">Live Q&amp;A</button><button class="${activeTab === "slides" ? "selected" : ""}" data-view="slides">Shared slides</button></div>
    <div class="slide-container ${activeTab === "slides" ? "" : "hidden"}">${slideMarkup(Math.max(0, Math.min(window.gatheringSlides.length - 1, state.session.activeSlide || 0)), true)}</div><div class="activity-container ${activeTab === "activity" ? "" : "hidden"}">
    <div class="question"><div class="meta"><span>QUESTION ${qIndex + 1} OF ${questionList.length}</span><span>${state.responseCount} responses</span></div><h2>${esc(question.prompt)}</h2><div class="scorestrip">${question.correct === null ? `<span><strong>${state.graded.ungraded}</strong> reflections</span>` : `<span class="good"><strong>${state.graded.correct}</strong> correct</span><span class="bad"><strong>${state.graded.incorrect}</strong> incorrect</span>`}<span><strong>${state.responseCount}</strong> total responses</span></div><div class="results">${bars}</div><div class="hostfooter"><p>Results refresh automatically as students respond.</p><div class="actions"><button class="button quiet" id="end-session" ${state.session.status !== "active" || busy ? "disabled" : ""}>End session</button><button class="button primary" id="next-question" ${state.session.status !== "active" || busy ? "disabled" : ""}>${qIndex === questionList.length - 1 ? "Finish session" : "Open next question"} <span>→</span></button></div></div></div>
    <div class="history"><div class="meta"><span>SESSION SCOREBOARD</span><span>ANONYMOUS TOTALS</span></div><div class="historylist">${history}</div></div></div>
    ${state.session.status === "completed" ? `<div class="complete"><p class="eyebrow">ALL QUESTIONS COMPLETE</p><h2>Thank you for learning together.</h2><p><b class="good">${totalAnswers} correct</b> · <b class="bad">${totalMissed} incorrect</b> across the four scored questions. Invite students to share one takeaway.</p></div>` : ""}${notice ? `<p class="notice">${esc(notice)}</p>` : ""}</section>`;
  bindViewTabs(); bindSlideButtons();
  document.querySelector("#copy-link").addEventListener("click", async () => { await navigator.clipboard.writeText(`${location.origin}/?join=${code}`); notice = "Join link copied."; render(); });
  document.querySelector("#new-session").addEventListener("click", () => { code = ""; hostKey = ""; state = null; localStorage.removeItem("pathway-live-host-code"); localStorage.removeItem("pathway-live-host-key"); setQuery({ view: "host" }); render(); });
  document.querySelector("#end-session").addEventListener("click", () => hostAction("end"));
  document.querySelector("#next-question").addEventListener("click", () => hostAction("advance"));
}

function studentView() {
  if (!state) {
    appRoot.innerHTML = `<section class="panel studentwrap"><div class="startcard"><p class="eyebrow">JOINING SESSION ${esc(code)}</p><h1>${notice ? "Check your session code" : "Connecting…"}</h1>${notice ? `<p class="intro">${esc(notice)}</p><button class="button secondary" id="back-home">Back to join</button>` : ""}</div></section>`;
    document.querySelector("#back-home")?.addEventListener("click", () => { mode = "home"; code = ""; state = null; notice = ""; setQuery({}); render(); });
    return;
  }
  const score = state.score;
  if (state.session.status !== "active") {
    appRoot.innerHTML = `<section class="panel studentwrap"><div class="startcard"><p class="eyebrow">SESSION ${esc(state.session.status.toUpperCase())}</p><h1>Thanks for participating.</h1><div class="finalscore"><span>FINAL SCORE</span><strong>${score.correct} <small>/ ${score.total}</small></strong><p>${score.incorrect} incorrect · ${score.answered} questions scored</p></div><p class="intro">Stay with the group for the discussion and closing reflection.</p></div></section>`;
    return;
  }
  const i = state.session.activeQuestion;
  const question = questionList[i];
  const choiceHtml = question.options.map((option, index) => {
    const chosen = selected === index;
    const right = question.correct === index;
    let cls = "choice";
    if (chosen) cls += question.correct === null ? " chosen" : right ? " correct" : " incorrect";
    if (selected !== null && question.correct !== null && right) cls += " reveal";
    const check = chosen ? `<span class="check">${question.correct === null || right ? "✓" : "×"}</span>` : "";
    return `<button class="${cls}" data-choice="${index}" ${selected !== null || busy ? "disabled" : ""}><span class="letter">${String.fromCharCode(65 + index)}</span><span>${esc(option)}</span>${check}</button>`;
  }).join("");
  const feedback = selected === null ? "" : `<div class="feedback ${question.correct === null ? "neutral" : selected === question.correct ? "" : "gentle"}"><strong>${question.correct === null ? "Your next step" : selected === question.correct ? "That’s right" : "Think it through"}</strong><p>${esc(question.feedback)}</p></div>`;
  const scoreHtml = selected === null ? "" : `<div class="scorecard"><span>YOUR SCORE SO FAR</span><strong>${score.correct} <small>/ ${score.total}</small></strong><span>${score.incorrect} incorrect · ${score.answered} questions scored</span></div>`;
  appRoot.innerHTML = `<section class="panel studentwrap"><div class="view-tabs"><button class="${activeTab === "activity" ? "selected" : ""}" data-view="activity">Live Q&amp;A</button><button class="${activeTab === "slides" ? "selected" : ""}" data-view="slides">Shared slides</button></div><div class="slide-container ${activeTab === "slides" ? "" : "hidden"}">${slideMarkup(Math.max(0, Math.min(window.gatheringSlides.length - 1, state.session.activeSlide || 0)), false)}</div><div class="activity-container ${activeTab === "activity" ? "" : "hidden"}"><div class="student"><div class="meta"><span>QUESTION ${i + 1} OF ${questionList.length}</span><span class="live"><i></i> LIVE</span></div><h1>${esc(question.prompt)}</h1><p class="studenthelp">Choose one answer. You’ll see an explanation right away.</p><div class="choices">${choiceHtml}</div>${feedback}${scoreHtml}${notice ? `<p class="notice">${esc(notice)}</p>` : ""}<p class="response-note">Your response is anonymous. The facilitator sees group totals, not names.</p></div></div></section>`;
  bindViewTabs();
  document.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", () => submitAnswer(Number(button.dataset.choice))));
}

function render() {
  if (mode === "host") return hostView();
  if (mode === "join") return studentView();
  return homeView();
}

async function createSession() {
  busy = true; notice = ""; render();
  try {
    const data = await request("/api/session", { method: "POST", body: JSON.stringify({}) });
    code = data.code; hostKey = data.hostKey; state = data.state;
    localStorage.setItem("pathway-live-host-code", code);
    localStorage.setItem("pathway-live-host-key", hostKey);
    setQuery({ view: "host" });
  } catch (error) { notice = error.message; }
  busy = false; render();
}

async function hostAction(action, slideIndex) {
  busy = true; notice = ""; render();
  try {
    const data = await request(`/api/session/${encodeURIComponent(code)}/control`, { method: "POST", body: JSON.stringify({ action, hostKey, slideIndex }) });
    state = data.state;
  } catch (error) { notice = error.message; }
  busy = false; render();
}

async function submitAnswer(choiceIndex) {
  if (selected !== null || busy) return;
  busy = true; notice = "";
  try {
    await request(`/api/session/${encodeURIComponent(code)}/answer`, {
      method: "POST",
      body: JSON.stringify({ questionIndex: state.session.activeQuestion, choiceIndex, participantId: getParticipantId() }),
    });
    await refresh(code, true);
  } catch (error) { notice = error.message; }
  busy = false; render();
}

if (socket) socket.on("session-update", () => { if (code && mode !== "home") refresh(code, mode === "join"); });

const params = new URLSearchParams(location.search);
const joinCode = params.get("join");
if (joinCode) {
  mode = "join"; code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, ""); setQuery({ join: code }); render(); refresh(code, true);
} else if (params.get("view") === "host") {
  mode = "host"; code = localStorage.getItem("pathway-live-host-code") || ""; hostKey = localStorage.getItem("pathway-live-host-key") || ""; render(); if (code) refresh(code);
} else {
  render();
}

window.setInterval(() => { if (code && mode !== "home") refresh(code, mode === "join"); }, 4000);
