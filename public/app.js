const elements = {
  raceStage: document.querySelector("#raceStage"),
  qrCode: document.querySelector("#qrCode"),
  joinUrl: document.querySelector("#joinUrl"),
  copyLinkButton: document.querySelector("#copyLinkButton"),
  startButton: document.querySelector("#startButton"),
  resetButton: document.querySelector("#resetButton"),
  lobbyResetButton: document.querySelector("#lobbyResetButton"),
  raceStatus: document.querySelector("#raceStatus"),
  lobbyStatus: document.querySelector("#lobbyStatus"),
  winnerBanner: document.querySelector("#winnerBanner"),
  winnerText: document.querySelector("#winnerText")
};

let lastJoinUrl = "";
let currentMode = "lobby";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function percent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;
  elements.raceStage.classList.toggle("lobby-mode", mode === "lobby");
  elements.raceStage.classList.toggle("race-mode", mode === "race");
}

function renderQr(joinUrl) {
  if (!joinUrl || joinUrl === lastJoinUrl) return;
  lastJoinUrl = joinUrl;
  elements.qrCode.innerHTML = "";
  try {
    elements.qrCode.appendChild(window.QrLite.createSvg(joinUrl, {
      margin: 2,
      foreground: "#061018",
      background: "#f7fff9"
    }));
  } catch (error) {
    elements.qrCode.textContent = "QR не создан";
    elements.qrCode.title = error.message;
  }
  elements.joinUrl.textContent = joinUrl;
}

function setTextAll(selector, text) {
  document.querySelectorAll(selector).forEach(node => {
    node.textContent = text;
  });
}

function renderPlayer(player) {
  const slot = player.slot;
  const progress = percent(player.progress);
  const noise = percent((player.level || 0) * 100);

  setTextAll(`[data-player-name="${slot}"]`, player.name);
  setTextAll(`[data-player-state="${slot}"]`, player.connected ? "подключен" : "не подключен");
  document.querySelectorAll(`[data-player-card="${slot}"]`).forEach(card => {
    card.classList.toggle("connected", player.connected);
  });

  setTextAll(`[data-progress-name="${slot}"]`, player.name);
  document.querySelector(`[data-progress="${slot}"]`).style.width = `${noise}%`;
  setTextAll(`[data-percent="${slot}"]`, Math.round(noise));

  const car = document.querySelector(`[data-car="${slot}"]`);
  const track = car.closest(".track");
  const left = parseFloat(getComputedStyle(car).left) || 0;
  const finishGap = track.clientWidth * 0.095;
  const maxTravel = Math.max(0, track.clientWidth - car.offsetWidth - left - finishGap);
  car.style.setProperty("--x", `${(progress / 100) * maxTravel}px`);
}

function renderStatus(state, connectedCount) {
  elements.startButton.disabled = connectedCount < 2 || state.started;

  if (state.winnerSlot !== null) {
    const winner = state.participants.find(player => player.slot === state.winnerSlot);
    elements.raceStatus.textContent = "Финиш";
    elements.winnerText.textContent = `${winner.name} победил!`;
    elements.winnerBanner.hidden = false;
    return;
  }

  elements.winnerBanner.hidden = true;
  elements.raceStatus.textContent = state.started ? "Гонка идет" : "Готово к старту";
  elements.lobbyStatus.textContent = connectedCount === 0
    ? "Отсканируйте QR-код и выберите машину на телефоне."
    : connectedCount === 1
      ? "Первый участник подключен. Ждем второго участника."
      : "Оба участника подключены. Переходим на трассу.";
}

function renderState(state) {
  renderQr(state.joinUrl);
  const connectedCount = state.participants.filter(player => player.connected).length;
  const shouldShowRace = connectedCount >= 2 || state.started || state.winnerSlot !== null;
  setMode(shouldShowRace ? "race" : "lobby");
  elements.raceStage.classList.toggle("is-running", state.started);
  state.participants.forEach(renderPlayer);
  renderStatus(state, connectedCount);
}

async function refresh() {
  try {
    renderState(await api("/api/state"));
  } catch (error) {
    elements.lobbyStatus.textContent = "Сервер недоступен";
    elements.raceStatus.textContent = "Сервер недоступен";
  }
}

function tryCarImage(img, sources, index = 0) {
  if (index >= sources.length) {
    img.hidden = true;
    img.closest(".car").classList.add("fallback-car");
    return;
  }

  const probe = new Image();
  probe.onload = () => {
    img.src = sources[index];
    img.hidden = false;
    img.closest(".car").classList.remove("fallback-car");
  };
  probe.onerror = () => tryCarImage(img, sources, index + 1);
  probe.src = sources[index];
}

function initCustomCars() {
  document.querySelectorAll("[data-car-image]").forEach(img => {
    const number = Number(img.dataset.carImage) + 1;
    const base = `./assets/car-${number}`;
    tryCarImage(img, [
      `${base}.png?v=5`,
      `${base}.jpg?v=5`,
      `${base}.jpeg?v=5`,
      `${base}.webp?v=5`
    ]);
  });
}

async function resetRace() {
  lastJoinUrl = "";
  renderState(await api("/api/control", {
    method: "POST",
    body: JSON.stringify({ action: "reset" })
  }));
}

elements.startButton.addEventListener("click", async () => {
  renderState(await api("/api/control", {
    method: "POST",
    body: JSON.stringify({ action: "start" })
  }));
});

elements.resetButton.addEventListener("click", resetRace);
elements.lobbyResetButton.addEventListener("click", resetRace);

elements.copyLinkButton.addEventListener("click", async () => {
  if (!lastJoinUrl) return;
  await navigator.clipboard.writeText(lastJoinUrl);
  elements.copyLinkButton.textContent = "Ссылка скопирована";
  setTimeout(() => {
    elements.copyLinkButton.textContent = "Скопировать ссылку";
  }, 1300);
});

initCustomCars();
refresh();
setInterval(refresh, 160);
