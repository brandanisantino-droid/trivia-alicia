const os = require("os");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const questions = require("./questions.js");

const PORT = process.env.PORT || 3000;

// WiFi del salón - cambiá esto si la red cambia antes de la fiesta.
const WIFI_SSID = "CasaMeraki2";
const WIFI_PASSWORD = "thames1951";

const TIME_PER_QUESTION_MS = 15000; // 15 segundos por pregunta de opción múltiple
const WORD_ROUND_DURATION_MS = 30000; // más tiempo para escribir una palabra
const MULTI_ROUND_DURATION_MS = 20000; // más tiempo para elegir varias opciones
const REVEAL_PAUSE_MS = 4000; // cuánto se muestra la respuesta correcta antes de pasar al ranking
const STANDINGS_PAUSE_MS = 3000; // cuánto se muestra el ranking antes de la siguiente pregunta

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/player.html")));
app.get("/anfitrion", (req, res) => res.sendFile(path.join(__dirname, "public/host.html")));

function escapeWifiField(s) {
  return s.replace(/([\\;,:"])/g, "\\$1");
}

app.get("/api/info", async (req, res) => {
  const ip = getLocalIp();
  const url = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, "")}/` : `http://${ip}:${PORT}/`;
  const qrOpts = { margin: 1, width: 480, color: { dark: "#52305a", light: "#f8ecf1" } };

  const qr = await QRCode.toDataURL(url, qrOpts);
  const wifiUri = `WIFI:T:WPA;S:${escapeWifiField(WIFI_SSID)};P:${escapeWifiField(WIFI_PASSWORD)};;`;
  const wifiQr = await QRCode.toDataURL(wifiUri, qrOpts);

  res.json({ ip, url, qr, port: PORT, wifiSsid: WIFI_SSID, wifiPassword: WIFI_PASSWORD, wifiQr });
});

const server = app.listen(PORT, () => {
  const base = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, "") : `http://${getLocalIp()}:${PORT}`;
  console.log("");
  console.log("  Juego de trivia de Alicia listo.");
  console.log(`  Anfitrión (pantalla grande): ${base}/anfitrion`);
  console.log(`  Invitados (celular / QR):    ${base}/`);
  console.log("");
});

const io = new Server(server);

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

// ---------- Estado del juego (en memoria, una sola partida a la vez) ----------

const TOTAL_QUESTIONS = questions.length;

/** @type {Map<string, {id:string, name:string, score:number, connected:boolean, socketId:string}>} */
const players = new Map();

let state = {
  status: "lobby", // lobby | question | reveal | standings | ended
  currentIndex: -1,
  questionStartAt: 0,
  duration: TIME_PER_QUESTION_MS,
  answers: new Map(), // playerId -> {optionIndex, atMs} (mc), {word, atMs} (word), o {selected, atMs} (multi)
  timer: null,
};

function durationFor(q) {
  if (q.type === "word") return WORD_ROUND_DURATION_MS;
  if (q.type === "multi") return MULTI_ROUND_DURATION_MS;
  return TIME_PER_QUESTION_MS;
}

function publicPlayerList() {
  return Array.from(players.values())
    .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }))
    .sort((a, b) => b.score - a.score);
}

function broadcastLobby() {
  io.emit("lobby:players", publicPlayerList());
}

function currentQuestion() {
  return questions[state.currentIndex];
}

function questionPayload(index) {
  const q = questions[index];
  return {
    index,
    total: TOTAL_QUESTIONS,
    type: q.type === "word" ? "word" : q.type === "multi" ? "multi" : "mc",
    text: q.text,
    options: q.options || [],
    duration: durationFor(q),
    startAt: state.questionStartAt,
  };
}

function startQuestion(index) {
  clearTimeout(state.timer);
  state.status = "question";
  state.currentIndex = index;
  state.answers = new Map();
  state.questionStartAt = Date.now();

  const q = questions[index];
  state.duration = durationFor(q);

  io.emit("game:question", questionPayload(index));

  state.timer = setTimeout(() => revealQuestion(), state.duration + 300);
}

function maybeAutoReveal() {
  if (state.status !== "question") return;
  const connectedCount = Array.from(players.values()).filter((p) => p.connected).length;
  if (connectedCount > 0 && state.answers.size >= connectedCount) {
    revealQuestion();
  }
}

function revealQuestion() {
  if (state.status !== "question") return;
  clearTimeout(state.timer);
  state.status = "reveal";

  const q = currentQuestion();

  if (q.type === "word") {
    const groups = new Map(); // clave normalizada -> {display, count}
    let answeredCount = 0;
    for (const [playerId, ans] of state.answers.entries()) {
      if (!players.has(playerId)) continue;
      const raw = (ans.word || "").toString().trim().slice(0, 24);
      if (!raw) continue;
      answeredCount++;
      const key = raw.toLowerCase();
      if (!groups.has(key)) groups.set(key, { word: raw, count: 0 });
      groups.get(key).count++;
    }
    const ranking = Array.from(groups.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    io.emit("game:revealWords", {
      index: state.currentIndex,
      total: TOTAL_QUESTIONS,
      ranking,
      answeredCount,
      totalPlayers: Array.from(players.values()).filter((p) => p.connected).length,
      leaderboard: publicPlayerList(),
    });
    scheduleStandings();
    return;
  }

  if (q.type === "multi") {
    const counts = q.options.map(() => 0);
    let answeredCount = 0;
    for (const [playerId, ans] of state.answers.entries()) {
      if (!players.has(playerId)) continue;
      answeredCount++;
      (ans.selected || []).forEach((i) => {
        if (counts[i] !== undefined) counts[i]++;
      });
    }

    io.emit("game:reveal", {
      index: state.currentIndex,
      total: TOTAL_QUESTIONS,
      correctIndex: null,
      pending: false,
      isPoll: true,
      options: q.options,
      counts,
      answeredCount,
      totalPlayers: Array.from(players.values()).filter((p) => p.connected).length,
      leaderboard: publicPlayerList(),
    });
    scheduleStandings();
    return;
  }

  const counts = q.options.map(() => 0);
  let answeredCount = 0;

  for (const [playerId, ans] of state.answers.entries()) {
    const player = players.get(playerId);
    if (!player) continue;
    answeredCount++;
    counts[ans.optionIndex] = (counts[ans.optionIndex] || 0) + 1;

    let correct = false;
    let points = 0;
    if (q.correctIndex !== null && q.correctIndex !== undefined) {
      correct = ans.optionIndex === q.correctIndex;
      if (correct) {
        const elapsed = ans.atMs - state.questionStartAt;
        const remainingFrac = Math.max(0, 1 - elapsed / state.duration);
        points = Math.round(500 + 500 * remainingFrac);
      }
    }
    player.score += points;

    io.to(player.socketId).emit("game:yourResult", {
      picked: ans.optionIndex,
      correctIndex: q.correctIndex,
      correct,
      points,
      totalScore: player.score,
      answered: true,
      pending: q.correctIndex === null || q.correctIndex === undefined,
    });
  }

  // Jugadores que no contestaron a tiempo
  for (const player of players.values()) {
    if (!state.answers.has(player.id) && player.connected) {
      io.to(player.socketId).emit("game:yourResult", {
        picked: null,
        correctIndex: q.correctIndex,
        correct: false,
        points: 0,
        totalScore: player.score,
        answered: false,
        pending: q.correctIndex === null || q.correctIndex === undefined,
      });
    }
  }

  io.emit("game:reveal", {
    index: state.currentIndex,
    total: TOTAL_QUESTIONS,
    correctIndex: q.correctIndex,
    pending: q.correctIndex === null || q.correctIndex === undefined,
    options: q.options,
    counts,
    answeredCount,
    totalPlayers: Array.from(players.values()).filter((p) => p.connected).length,
    leaderboard: publicPlayerList(),
  });
  scheduleStandings();
}

function scheduleStandings() {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => showStandings(), REVEAL_PAUSE_MS);
}

function showStandings() {
  if (state.status !== "reveal") return;
  clearTimeout(state.timer);
  state.status = "standings";
  io.emit("game:showStandings", {
    index: state.currentIndex,
    total: TOTAL_QUESTIONS,
    leaderboard: publicPlayerList(),
  });
  state.timer = setTimeout(() => advanceQuestion(), STANDINGS_PAUSE_MS);
}

function advanceQuestion() {
  if (state.status !== "standings") return;
  clearTimeout(state.timer);
  const next = state.currentIndex + 1;
  if (next >= TOTAL_QUESTIONS) endGame();
  else startQuestion(next);
}

function endGame() {
  state.status = "ended";
  io.emit("game:over", { leaderboard: publicPlayerList() });
}

function resetGame() {
  clearTimeout(state.timer);
  state = { status: "lobby", currentIndex: -1, questionStartAt: 0, answers: new Map(), timer: null };
  for (const p of players.values()) p.score = 0;
  io.emit("game:reset");
  broadcastLobby();
}

// ---------- Socket.IO ----------

io.on("connection", (socket) => {
  socket.on("player:join", ({ name, playerId }, ack) => {
    const trimmed = (name || "").toString().trim().slice(0, 24) || "Invitado";
    let id = playerId && players.has(playerId) ? playerId : null;

    if (id) {
      const p = players.get(id);
      p.connected = true;
      p.socketId = socket.id;
      p.name = trimmed || p.name;
    } else {
      id = Math.random().toString(36).slice(2, 10);
      players.set(id, { id, name: trimmed, score: 0, connected: true, socketId: socket.id });
    }

    socket.data.playerId = id;
    socket.join("players");

    const player = players.get(id);
    ack && ack({ playerId: id, name: player.name, score: player.score });
    broadcastLobby();

    // Si se reconecta en medio de una pregunta/revelación, lo pone al día.
    if (state.status === "question") {
      const q = currentQuestion();
      socket.emit("game:question", questionPayload(state.currentIndex));
      if (state.answers.has(id)) {
        const ans = state.answers.get(id);
        if (q.type === "word") socket.emit("game:answeredWord", { word: ans.word });
        else if (q.type === "multi") socket.emit("game:answeredMulti", { selected: ans.selected });
        else socket.emit("game:answered", { optionIndex: ans.optionIndex });
      }
    } else if (state.status === "reveal" || state.status === "standings") {
      const q = currentQuestion();
      if (q.type === "word") {
        socket.emit("game:revealWords", {
          index: state.currentIndex,
          total: TOTAL_QUESTIONS,
          ranking: [],
          answeredCount: 0,
          totalPlayers: 0,
        });
      } else {
        socket.emit("game:reveal", {
          index: state.currentIndex,
          total: TOTAL_QUESTIONS,
          correctIndex: q.type === "multi" ? null : q.correctIndex,
          pending: q.type === "multi" ? false : q.correctIndex === null || q.correctIndex === undefined,
          isPoll: q.type === "multi",
          options: q.options,
          counts: [],
          answeredCount: 0,
          totalPlayers: 0,
          leaderboard: publicPlayerList(),
        });
      }
    } else if (state.status === "ended") {
      socket.emit("game:over", { leaderboard: publicPlayerList() });
    }
  });

  socket.on("player:answer", ({ optionIndex }) => {
    const id = socket.data.playerId;
    if (!id || state.status !== "question") return;
    if (state.answers.has(id)) return;
    state.answers.set(id, { optionIndex, atMs: Date.now() });
    socket.emit("game:answered", { optionIndex });

    const connectedCount = Array.from(players.values()).filter((p) => p.connected).length;
    io.to("host").emit("game:answerProgress", { answeredCount: state.answers.size, totalPlayers: connectedCount });
    maybeAutoReveal();
  });

  socket.on("player:answerMulti", ({ selected }) => {
    const id = socket.data.playerId;
    if (!id || state.status !== "question") return;
    if (state.answers.has(id)) return;
    const clean = Array.isArray(selected)
      ? [...new Set(selected.filter((i) => Number.isInteger(i) && i >= 0))].slice(0, 10)
      : [];
    if (clean.length === 0) return;
    state.answers.set(id, { selected: clean, atMs: Date.now() });
    socket.emit("game:answeredMulti", { selected: clean });

    const connectedCount = Array.from(players.values()).filter((p) => p.connected).length;
    io.to("host").emit("game:answerProgress", { answeredCount: state.answers.size, totalPlayers: connectedCount });
    maybeAutoReveal();
  });

  socket.on("player:answerWord", ({ word }) => {
    const id = socket.data.playerId;
    if (!id || state.status !== "question") return;
    if (state.answers.has(id)) return;
    const clean = (word || "").toString().trim().slice(0, 24);
    if (!clean) return;
    state.answers.set(id, { word: clean, atMs: Date.now() });
    socket.emit("game:answeredWord", { word: clean });

    const connectedCount = Array.from(players.values()).filter((p) => p.connected).length;
    io.to("host").emit("game:answerProgress", { answeredCount: state.answers.size, totalPlayers: connectedCount });
    maybeAutoReveal();
  });

  socket.on("host:join", () => {
    socket.join("host");
    broadcastLobby();
  });

  socket.on("host:start", () => {
    if (state.status !== "lobby") return;
    startQuestion(0);
  });

  socket.on("host:reveal", () => revealQuestion());

  socket.on("host:next", () => {
    // Botón de "saltar": adelanta ya mismo la fase automática en curso.
    if (state.status === "reveal") showStandings();
    else if (state.status === "standings") advanceQuestion();
  });

  socket.on("host:restart", () => resetGame());

  socket.on("disconnect", () => {
    const id = socket.data.playerId;
    if (id && players.has(id)) {
      players.get(id).connected = false;
      broadcastLobby();
      const connectedCount = Array.from(players.values()).filter((p) => p.connected).length;
      io.to("host").emit("game:answerProgress", { answeredCount: state.answers.size, totalPlayers: connectedCount });
    }
  });
});
