const socket = io();

const views = {
  lobby: document.getElementById("view-lobby"),
  question: document.getElementById("view-question"),
  reveal: document.getElementById("view-reveal"),
  standings: document.getElementById("view-standings"),
  final: document.getElementById("view-final"),
};

function showView(name) {
  Object.entries(views).forEach(([key, el]) => (el.hidden = key !== name));
}

// ---------- Lobby ----------

fetch("/api/info")
  .then((r) => r.json())
  .then(({ url, qr, wifiQr, wifiSsid, wifiPassword }) => {
    document.getElementById("qr-img").src = qr;
    document.getElementById("join-url").textContent = url;
    document.getElementById("wifi-qr-img").src = wifiQr;
    document.getElementById("wifi-detail").textContent = `${wifiSsid} · ${wifiPassword}`;
  })
  .catch(() => {
    document.getElementById("join-url").textContent = "No se pudo generar el enlace. Revisá la red.";
    document.getElementById("wifi-detail").textContent = "No se pudo generar el QR del WiFi.";
  });

socket.on("connect", () => socket.emit("host:join"));

socket.on("lobby:players", (players) => {
  document.getElementById("players-count-num").textContent = players.filter((p) => p.connected).length;
  const list = document.getElementById("players-list");
  list.innerHTML = "";
  players.forEach((p) => {
    const chip = document.createElement("span");
    chip.className = "chip player-chip";
    chip.style.opacity = p.connected ? "1" : "0.45";
    chip.textContent = p.name;
    list.appendChild(chip);
  });
  document.getElementById("btn-start").disabled = players.filter((p) => p.connected).length === 0;
});

document.getElementById("btn-start").addEventListener("click", () => socket.emit("host:start"));
document.getElementById("btn-restart").addEventListener("click", () => socket.emit("host:restart"));
// Ambos botones son "saltar": el juego avanza solo, esto solo lo acelera.
document.getElementById("btn-show-standings").addEventListener("click", () => socket.emit("host:next"));
document.getElementById("btn-next").addEventListener("click", () => socket.emit("host:next"));

function renderRanking(container, leaderboard, { limit, extraNote } = {}) {
  container.innerHTML = "";
  const shown = limit ? leaderboard.slice(0, limit) : leaderboard;
  shown.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `<span class="rank-num">${i + 1}</span><span>${escapeHtml(p.name)}</span><span class="rank-score tabular">${p.score}</span>`;
    container.appendChild(row);
  });
  if (limit && leaderboard.length > limit) {
    const rest = leaderboard.length - limit;
    const note = document.createElement("p");
    note.className = "ranking-rest-note";
    note.textContent = `+ ${rest} jugador${rest === 1 ? "" : "es"} más`;
    container.appendChild(note);
  }
  if (extraNote) {
    const note = document.createElement("p");
    note.className = "ranking-rest-note";
    note.textContent = extraNote;
    container.appendChild(note);
  }
}

const STANDINGS_TOP_N = 7;

socket.on("game:showStandings", (data) => {
  showView("standings");
  document.getElementById("standings-progress").textContent = `Después de la pregunta ${data.index + 1} de ${data.total}`;
  renderRanking(document.getElementById("standings-ranking"), data.leaderboard, { limit: STANDINGS_TOP_N });
  setNextButtonLabel(data.index, data.total);
  tickMiniTimer(document.getElementById("s-timer-fill"), document.getElementById("s-timer-number"), data.standingsAt, data.standingsDuration);
});

// ---------- Pregunta ----------

let timerRaf = null;
let miniTimerRaf = null;
const MINI_RING_CIRCUMFERENCE = 163.4;

function tickMiniTimer(fillEl, numberEl, startAt, duration) {
  cancelAnimationFrame(miniTimerRaf);
  if (!fillEl || !numberEl || !startAt || !duration) return;
  function tick() {
    const elapsed = Date.now() - startAt;
    const frac = Math.max(0, Math.min(1, 1 - elapsed / duration));
    const secondsLeft = Math.max(0, Math.ceil((duration - elapsed) / 1000));
    fillEl.style.strokeDashoffset = String(MINI_RING_CIRCUMFERENCE * (1 - frac));
    numberEl.textContent = secondsLeft;
    if (frac > 0) miniTimerRaf = requestAnimationFrame(tick);
  }
  tick();
}

function renderOptionsStatic(container, options, { withCounts } = {}) {
  container.innerHTML = "";
  container.className = "option-grid cols-4";
  options.forEach((text, i) => {
    const btn = document.createElement("div");
    btn.className = `option-btn ${window.OPTION_CLASSES[i]}`;
    btn.innerHTML = `<span class="option-shape">${window.optionShapeSVG(i)}</span><span>${escapeHtml(text)}</span>${
      withCounts ? `<span class="opt-count tabular" data-count-for="${i}">0</span>` : ""
    }`;
    container.appendChild(btn);
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function setNextButtonLabel(index, total) {
  const isLast = index + 1 >= total;
  document.getElementById("btn-next").textContent = isLast ? "Ver ranking final" : "Siguiente pregunta";
}

socket.on("game:question", (q) => {
  cancelAnimationFrame(timerRaf);
  cancelAnimationFrame(miniTimerRaf);
  showView("question");
  document.getElementById("q-progress").textContent = `Pregunta ${q.index + 1} de ${q.total}`;
  document.getElementById("q-text").textContent = q.text;
  document.getElementById("q-answered").textContent = "0 respondieron";

  const isWord = q.type === "word";
  document.getElementById("q-options").hidden = isWord;
  document.getElementById("q-word-panel").hidden = !isWord;
  document.getElementById("q-multi-hint").hidden = q.type !== "multi";
  if (!isWord) renderOptionsStatic(document.getElementById("q-options"), q.options);

  const RING_CIRCUMFERENCE = 339.3;
  const ringFill = document.getElementById("q-timer-fill");
  const ringNumber = document.getElementById("q-timer-number");

  function tick() {
    const elapsed = Date.now() - q.startAt;
    const frac = Math.max(0, Math.min(1, 1 - elapsed / q.duration));
    const secondsLeft = Math.max(0, Math.ceil((q.duration - elapsed) / 1000));
    ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - frac));
    ringFill.classList.toggle("is-urgent", secondsLeft <= 3);
    ringNumber.textContent = secondsLeft;
    if (frac > 0) timerRaf = requestAnimationFrame(tick);
  }
  tick();
});

socket.on("game:answerProgress", ({ answeredCount, totalPlayers }) => {
  document.getElementById("q-answered").textContent = `${answeredCount} / ${totalPlayers} respondieron`;
});

// ---------- Revelación ----------

socket.on("game:reveal", (data) => {
  cancelAnimationFrame(timerRaf);
  showView("reveal");
  document.getElementById("r-progress").textContent = `Pregunta ${data.index + 1} de ${data.total}`;
  document.getElementById("r-text").textContent = document.getElementById("q-text").textContent;

  document.getElementById("r-options").hidden = false;
  document.getElementById("r-word-ranking").hidden = true;

  const container = document.getElementById("r-options");
  renderOptionsStatic(container, data.options, { withCounts: true });

  [...container.children].forEach((btn, i) => {
    const countEl = btn.querySelector(`[data-count-for="${i}"]`);
    if (countEl) countEl.textContent = data.counts[i] ?? 0;
    if (!data.pending && !data.isPoll) {
      if (i === data.correctIndex) btn.classList.add("is-correct");
      else btn.classList.add("is-gray-reveal");
    }
  });

  const note = document.getElementById("r-pending-note");
  note.classList.toggle("is-poll-note", !!data.isPoll);
  if (data.isPoll) {
    note.hidden = false;
    note.textContent = "💬 Pregunta de opinión — no reparte puntos, solo mostramos qué eligió la gente.";
  } else if (data.pending) {
    note.hidden = false;
    note.textContent = "⚠ Todavía no se definió la respuesta correcta de esta pregunta — no se asignaron puntos.";
  } else {
    note.hidden = true;
  }

  tickMiniTimer(document.getElementById("r-timer-fill"), document.getElementById("r-timer-number"), data.revealAt, data.revealDuration);
});

socket.on("game:revealWords", (data) => {
  cancelAnimationFrame(timerRaf);
  showView("reveal");
  document.getElementById("r-progress").textContent = `Pregunta ${data.index + 1} de ${data.total}`;
  document.getElementById("r-text").textContent = document.getElementById("q-text").textContent;

  document.getElementById("r-options").hidden = true;
  document.getElementById("r-pending-note").hidden = true;

  const ranking = document.getElementById("r-word-ranking");
  ranking.hidden = false;
  ranking.innerHTML = "";
  const maxCount = Math.max(1, ...data.ranking.map((r) => r.count));
  data.ranking.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "word-rank-row";
    const widthPct = Math.max(18, Math.round((r.count / maxCount) * 100));
    row.innerHTML = `
      <span class="wr-num">${i + 1}</span>
      <span class="wr-bar-track"><span class="wr-bar-fill" style="width:${widthPct}%">${escapeHtml(r.word)}</span></span>
      <span class="wr-count tabular">${r.count}</span>`;
    ranking.appendChild(row);
  });
  if (data.ranking.length === 0) {
    ranking.innerHTML = '<p class="pending-note">Nadie llegó a escribir una palabra.</p>';
  }

  tickMiniTimer(document.getElementById("r-timer-fill"), document.getElementById("r-timer-number"), data.revealAt, data.revealDuration);
});

// ---------- Final ----------

socket.on("game:over", ({ leaderboard }) => {
  showView("final");
  const podium = document.getElementById("podium");
  const order = [1, 0, 2]; // 2do, 1ro, 3ro para el efecto de podio
  podium.innerHTML = "";
  order.forEach((idx) => {
    const p = leaderboard[idx];
    const step = document.createElement("div");
    step.className = `podium-step rank-${idx + 1}`;
    step.innerHTML = `
      <div class="podium-name">${p ? escapeHtml(p.name) : "—"}</div>
      <div class="podium-block">${idx + 1}</div>
      <div class="podium-score tabular">${p ? p.score : ""}</div>`;
    podium.appendChild(step);
  });

  renderRanking(document.getElementById("full-ranking"), leaderboard);

  window.AliciaConfetti.burst(220);
});

socket.on("game:reset", () => {
  showView("lobby");
});
