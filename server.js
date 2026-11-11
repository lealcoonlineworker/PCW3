const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "pathway-live.sqlite");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const questions = [
  {
    prompt: "What can you do when progress toward a goal becomes difficult?",
    options: ["Give up if the plan is no longer perfect.", "Remember why the goal matters, adjust the plan, and keep going.", "Wait until life becomes less busy."],
    correct: 1,
    feedback: "Sister Spannaus encouraged students to remember their goals, adjust when needed, and keep moving forward.",
  },
  {
    prompt: "How can we involve Heavenly Father in our goals?",
    options: ["Pray in faith, do our part, and look for His help.", "Wait for the Lord to complete every step for us.", "Never adjust a goal after praying about it."],
    correct: 0,
    feedback: "The devotional teaches us to do our part, pray in faith, and seek the Lord’s help.",
  },
  {
    prompt: "Which is an example of a top-level goal?",
    options: ["Study for 20 minutes tonight.", "Complete my education and prepare for the work I want to do.", "Download the spreadsheet template."],
    correct: 1,
    feedback: "A top-level goal describes a larger purpose. Smaller tasks, like studying tonight, help us work toward it.",
  },
  {
    prompt: "In the SMART model used in this lesson, what does T mean?",
    options: ["Trackable", "Time Bound", "Talented"],
    correct: 1,
    feedback: "Time Bound means a goal includes a clear period or deadline.",
  },
  {
    prompt: "What small step will you take this week?",
    options: ["Set and protect a 20-minute study block.", "Ask someone for help with one assignment.", "Review my goals and adjust one next step."],
    correct: null,
    feedback: "There is no single right answer. Choose a step you can realistically take this week, then follow through.",
  },
];

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    code TEXT PRIMARY KEY,
    host_key TEXT NOT NULL,
    active_question INTEGER NOT NULL DEFAULT 0,
    active_slide INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_code TEXT NOT NULL,
    question_index INTEGER NOT NULL,
    participant_id TEXT NOT NULL,
    choice_index INTEGER NOT NULL,
    is_correct INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_code, question_index, participant_id),
    FOREIGN KEY (session_code) REFERENCES sessions(code) ON DELETE CASCADE
  );
`);
if (!db.pragma("table_info(sessions)").some((column) => column.name === "active_slide")) {
  db.exec("ALTER TABLE sessions ADD COLUMN active_slide INTEGER NOT NULL DEFAULT 0");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public"), { etag: true, maxAge: "1h" }));

function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function getState(code, participantId = "") {
  const session = db.prepare("SELECT code, active_question AS activeQuestion, active_slide AS activeSlide, status FROM sessions WHERE code = ?").get(code);
  if (!session) return null;
  const counts = db.prepare("SELECT choice_index AS choiceIndex, COUNT(*) AS total FROM answers WHERE session_code = ? AND question_index = ? GROUP BY choice_index").all(code, session.activeQuestion);
  const responseCount = db.prepare("SELECT COUNT(DISTINCT participant_id) AS total FROM answers WHERE session_code = ? AND question_index = ?").get(code, session.activeQuestion).total;
  const graded = db.prepare(`SELECT
    SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
    SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS incorrect,
    SUM(CASE WHEN is_correct IS NULL THEN 1 ELSE 0 END) AS ungraded
    FROM answers WHERE session_code = ? AND question_index = ?`).get(code, session.activeQuestion);
  const questionStats = db.prepare(`SELECT question_index AS questionIndex,
    SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
    SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS incorrect,
    SUM(CASE WHEN is_correct IS NULL THEN 1 ELSE 0 END) AS ungraded,
    COUNT(*) AS responses FROM answers WHERE session_code = ? GROUP BY question_index ORDER BY question_index`).all(code);
  const myAnswers = participantId ? db.prepare(`SELECT question_index AS questionIndex, choice_index AS choiceIndex, is_correct AS isCorrect
    FROM answers WHERE session_code = ? AND participant_id = ? ORDER BY question_index`).all(code, participantId).map((a) => ({
      ...a,
      isCorrect: a.isCorrect === null ? null : a.isCorrect === 1,
    })) : [];
  const score = {
    correct: myAnswers.filter((a) => a.isCorrect === true).length,
    incorrect: myAnswers.filter((a) => a.isCorrect === false).length,
    answered: myAnswers.filter((a) => a.isCorrect !== null).length,
    total: 4,
  };
  return {
    session,
    questions,
    counts,
    responseCount,
    graded: { correct: graded.correct || 0, incorrect: graded.incorrect || 0, ungraded: graded.ungraded || 0 },
    questionStats,
    myAnswers,
    score,
  };
}

function emitState(code) {
  io.to(code).emit("session-update");
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/session", (req, res) => {
  try {
    let code;
    do {
      const bytes = crypto.randomBytes(6);
      code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    } while (db.prepare("SELECT code FROM sessions WHERE code = ?").get(code));
    const hostKey = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions (code, host_key, active_question, status) VALUES (?, ?, 0, 'active')").run(code, hostKey);
    res.status(201).json({ code, hostKey, state: getState(code) });
  } catch {
    sendError(res, 500, "Unable to create a session.");
  }
});

app.get("/api/session/:code", (req, res) => {
  const code = cleanCode(req.params.code);
  if (!code) return sendError(res, 400, "Enter a session code.");
  const state = getState(code, String(req.query.participantId || "").slice(0, 80));
  if (!state) return sendError(res, 404, "Session not found. Check the code with your facilitator.");
  res.set("Cache-Control", "no-store").json(state);
});

app.post("/api/session/:code/answer", (req, res) => {
  const code = cleanCode(req.params.code);
  const questionIndex = Number(req.body.questionIndex);
  const choiceIndex = Number(req.body.choiceIndex);
  const participantId = String(req.body.participantId || "").slice(0, 80);
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= questions.length ||
      !Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 2 || !participantId) {
    return sendError(res, 400, "Choose a valid answer and try again.");
  }
  const session = db.prepare("SELECT active_question AS activeQuestion, status FROM sessions WHERE code = ?").get(code);
  if (!session) return sendError(res, 404, "Session not found.");
  if (session.status !== "active" || session.activeQuestion !== questionIndex) return sendError(res, 409, "This question is no longer open.");

  const key = questions[questionIndex].correct;
  const isCorrect = key === null ? null : Number(choiceIndex === key);
  try {
    db.prepare(`INSERT INTO answers (session_code, question_index, participant_id, choice_index, is_correct)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_code, question_index, participant_id)
      DO UPDATE SET choice_index = excluded.choice_index, is_correct = excluded.is_correct, created_at = CURRENT_TIMESTAMP`)
      .run(code, questionIndex, participantId, choiceIndex, isCorrect);
    const state = getState(code, participantId);
    emitState(code);
    res.json({ saved: true, isCorrect: isCorrect === null ? null : isCorrect === 1, score: state.score });
  } catch {
    sendError(res, 500, "Unable to save your answer.");
  }
});

app.post("/api/session/:code/control", (req, res) => {
  const code = cleanCode(req.params.code);
  const { action, hostKey } = req.body || {};
  const session = db.prepare("SELECT host_key AS hostKey, active_question AS activeQuestion, status FROM sessions WHERE code = ?").get(code);
  if (!session) return sendError(res, 404, "Session not found.");
  if (!hostKey || hostKey !== session.hostKey) return sendError(res, 403, "Presenter key is not valid.");

  if (action === "set-slide") {
    const slideIndex = Number(req.body.slideIndex);
    if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex > 8) return sendError(res, 400, "Choose a valid slide.");
    db.prepare("UPDATE sessions SET active_slide = ? WHERE code = ?").run(slideIndex, code);
    emitState(code);
    return res.json({ saved: true, state: getState(code) });
  }

  if (action === "advance") {
    const lastQuestion = session.activeQuestion >= questions.length - 1;
    const next = lastQuestion ? session.activeQuestion : session.activeQuestion + 1;
    const status = lastQuestion ? "completed" : "active";
    db.prepare("UPDATE sessions SET active_question = ?, status = ? WHERE code = ?").run(next, status, code);
  } else if (action === "end") {
    db.prepare("UPDATE sessions SET status = 'ended' WHERE code = ?").run(code);
  } else {
    return sendError(res, 400, "Unknown session action.");
  }
  emitState(code);
  res.json({ saved: true, state: getState(code) });
});

io.on("connection", (socket) => {
  socket.on("join-session", (rawCode) => {
    const code = cleanCode(rawCode);
    if (code && db.prepare("SELECT code FROM sessions WHERE code = ?").get(code)) socket.join(code);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PathwayConnect W03 Live Q&A is listening on port ${PORT}`);
});
