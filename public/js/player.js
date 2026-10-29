const socket = io();

const views = {
  join: document.getElementById("view-join"),
  waiting: document.getElementById("view-waiting"),
  question: document.getElementById("view-question"),
  result: document.getElementById("view-result"),
  final: document.getElementById("view-final"),
};

function showView(name) {
  Object.entries(views).forEach(([key, el]) => (el.hidden = key !== name));
}

const STORAGE_KEY = "alicia80_player";
let myPlayerId = null;
let myScore = 0;
let answeredThisRound = false;
let gotPersonalResult = false;
let timerRaf = null;

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function storedPlayer() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveStoredPlayer(id, name) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, name }));
}

function showWaiting(subText) {
  document.getElementById("waiting-sub").textContent = subText;
  showView("waiting");
}

function join(name, playerId) {
  socket.emit("player:join", { name, playerId }, (res) => {
    myPlayerId = res.playerId;
    myScore = res.score;
    saveStoredPlayer(res.playerId, res.name);
    document.getElementById("waiting-name").textContent = res.name;
    showWaiting("Esperando a que el anfitrión arranque el juego…");
  });
}

const existing = storedPlayer();
if (existing && existing.id) {
  document.getElementById("name-input").value = existing.name;
}

document.getElementById("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("name-input").value.trim();
  if (!name) return;
  window.AliciaSounds && window.AliciaSounds.unlock();
  join(name, existing ? existing.id : null);
});

socket.on("connect", () => {
  // Reconexión automática si ya nos habíamos unido antes.
  if (existing && existing.id && views.join && !views.join.hidden) {
    join(existing.name, existing.id);
  }
});

// ---------- Pregunta ----------

function renderOptions(options) {
  const grid = document.getElementById("q-options");
  grid.innerHTML = "";
  grid.className = options.length > 2 ? "option-grid cols-4" : "option-grid";
  options.forEach((text, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `option-btn ${window.OPTION_CLASSES[i]}`;
    btn.innerHTML = `<span class="option-shape">${window.optionShapeSVG(i)}</span><span>${escapeHtml(text)}</span>`;
    btn.addEventListener("click", () => {
      if (answeredThisRound) return;
      answeredThisRound = true;
      window.AliciaSounds && window.AliciaSounds.unlock();
      socket.emit("player:answer", { optionIndex: i });
      lockOptions(i);
    });
    grid.appendChild(btn);
  });
}

function lockOptions(pickedIndex) {
  const grid = document.getElementById("q-options");
  [...grid.children].forEach((btn, i) => {
    btn.disabled = true;
    if (i === pickedIndex) btn.classList.add("is-picked");
    else btn.classList.add("is-dimmed");
  });
  document.getElementById("q-waiting-note").hidden = false;
}

function revealOptionColors(correctIndex, pickedIndex) {
  const grid = document.getElementById("q-options");
  [...grid.children].forEach((btn, i) => {
    btn.classList.remove("is-dimmed", "is-picked");
    if (i === correctIndex) btn.classList.add("is-correct");
    else if (i === pickedIndex) btn.classList.add("is-wrong");
    else btn.classList.add("is-dimmed");
  });
}

// ---------- Pregunta de selección múltiple ----------

let selectedMulti = new Set();
const multiSubmitBtn = document.getElementById("multi-submit");

function renderMultiOptions(options) {
  const grid = document.getElementById("q-options");
  grid.innerHTML = "";
  grid.className = options.length > 2 ? "option-grid cols-4" : "option-grid";
  selectedMulti = new Set();
  multiSubmitBtn.disabled = true;
  options.forEach((text, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `option-btn ${window.OPTION_CLASSES[i]}`;
    btn.innerHTML = `<span class="option-shape">${window.optionShapeSVG(i)}</span><span>${escapeHtml(text)}</span><span class="option-check">✓</span>`;
    btn.addEventListener("click", () => {
      if (answeredThisRound) return;
      if (selectedMulti.has(i)) {
        selectedMulti.delete(i);
        btn.classList.remove("is-selected");
      } else {
        selectedMulti.add(i);
        btn.classList.add("is-selected");
      }
      multiSubmitBtn.disabled = selectedMulti.size === 0;
    });
    grid.appendChild(btn);
  });
}

function lockMultiOptions(selected) {
  const grid = document.getElementById("q-options");
  const picked = new Set(selected);
  [...grid.children].forEach((btn, i) => {
    btn.disabled = true;
    if (picked.has(i)) btn.classList.add("is-selected");
    else btn.classList.add("is-dimmed");
  });
  multiSubmitBtn.hidden = true;
  document.getElementById("q-waiting-note").hidden = false;
}

multiSubmitBtn.addEventListener("click", () => {
  if (answeredThisRound || selectedMulti.size === 0) return;
  answeredThisRound = true;
  socket.emit("player:answerMulti", { selected: [...selectedMulti] });
  lockMultiOptions([...selectedMulti]);
});

function lockWordForm() {
  document.getElementById("word-input").disabled = true;
  document.getElementById("word-form").querySelector("button").disabled = true;
  document.getElementById("q-waiting-note").hidden = false;
}

const wordForm = document.getElementById("word-form");
wordForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (answeredThisRound) return;
  const word = document.getElementById("word-input").value.trim();
  if (!word) return;
  answeredThisRound = true;
  socket.emit("player:answerWord", { word });
  lockWordForm();
});

socket.on("game:question", (q) => {
  cancelAnimationFrame(timerRaf);
  answeredThisRound = false;
  gotPersonalResult = false;
  showView("question");
  document.getElementById("q-text").textContent = q.text;
  document.getElementById("q-waiting-note").hidden = true;

  const isWord = q.type === "word";
  const isMulti = q.type === "multi";
  document.getElementById("q-options").hidden = isWord;
  document.getElementById("q-multi-hint").hidden = !isMulti;
  wordForm.hidden = !isWord;
  multiSubmitBtn.hidden = !isMulti;
  if (isWord) {
    document.getElementById("word-input").value = "";
    document.getElementById("word-input").disabled = false;
    wordForm.querySelector("button").disabled = false;
  } else if (isMulti) {
    renderMultiOptions(q.options);
  } else {
    renderOptions(q.options);
  }

  const RING_CIRCUMFERENCE = 163.4;
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

socket.on("game:answered", ({ optionIndex }) => {
  // Confirma un estado ya enviado (por ejemplo tras reconectar).
  answeredThisRound = true;
  if (!views.question.hidden) lockOptions(optionIndex);
});

socket.on("game:answeredWord", () => {
  answeredThisRound = true;
  if (!views.question.hidden) lockWordForm();
});

socket.on("game:answeredMulti", ({ selected }) => {
  answeredThisRound = true;
  if (!views.question.hidden) lockMultiOptions(selected || []);
});

// ---------- Resultado individual ----------

socket.on("game:yourResult", (r) => {
  cancelAnimationFrame(timerRaf);
  myScore = r.totalScore;

  if (window.AliciaSounds && !r.pending) {
    if (r.answered && r.correct) window.AliciaSounds.correct();
    else window.AliciaSounds.wrong();
  }

  const grid = document.getElementById("q-options");
  const canColor = !views.question.hidden && !grid.hidden && !r.pending;
  if (canColor) {
    gotPersonalResult = true;
    document.getElementById("q-waiting-note").hidden = true;
    revealOptionColors(r.correctIndex, r.picked);
  }

  const showResult = () => {
    const badge = document.getElementById("result-badge");
    const points = document.getElementById("result-points");

    badge.classList.remove("good", "bad", "pending");
    if (!r.answered) {
      badge.textContent = "¡Se acabó el tiempo!";
      badge.classList.add("bad");
      points.textContent = "No llegaste a responder.";
    } else if (r.pending) {
      badge.textContent = "Respuesta registrada";
      badge.classList.add("pending");
      points.textContent = "Todavía no se definió la respuesta correcta.";
    } else if (r.correct) {
      badge.textContent = "¡Correcto! 🎉";
      badge.classList.add("good");
      points.textContent = `+${r.points} puntos`;
    } else {
      badge.textContent = "Esta vez no";
      badge.classList.add("bad");
      points.textContent = "0 puntos";
    }

    document.getElementById("result-score").textContent = myScore;
    showView("result");
  };

  if (canColor) setTimeout(showResult, 1800);
  else showResult();
});

// Si llegamos (o nos reconectamos) justo durante una revelación sin resultado propio.
socket.on("game:reveal", () => {
  if (views.question.hidden || gotPersonalResult) return;
  cancelAnimationFrame(timerRaf);
  showWaiting("Mirá la pantalla grande para ver el resultado 👀");
});

// Ronda de palabra: no hay puntaje individual, solo agradecer y mandar a mirar la pantalla.
socket.on("game:revealWords", () => {
  cancelAnimationFrame(timerRaf);
  showWaiting("¡Gracias! Mirá la pantalla grande para ver qué palabra dijo más gente 👀");
});

// ---------- Final ----------

socket.on("game:over", ({ leaderboard }) => {
  window.AliciaSounds && window.AliciaSounds.finale();
  showView("final");
  const myIndex = leaderboard.findIndex((p) => p.id === myPlayerId);
  const place = myIndex >= 0 ? myIndex + 1 : null;
  document.getElementById("final-rank").textContent = place ? `Terminaste en el puesto #${place}` : "¡Gracias por jugar!";
  document.getElementById("final-score").textContent = myIndex >= 0 ? leaderboard[myIndex].score : myScore;
  if (place && place <= 3) window.AliciaConfetti.burst(160);
});

socket.on("game:reset", () => {
  answeredThisRound = false;
  showWaiting("Esperando a que el anfitrión arranque el juego…");
});
