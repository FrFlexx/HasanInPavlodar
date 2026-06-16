const elements = {
  qrCode: document.querySelector("#qrCode"),
  joinUrl: document.querySelector("#joinUrl"),
  copyLinkButton: document.querySelector("#copyLinkButton"),
  logoutButton: document.querySelector("#logoutButton"),
  lobbyResetButton: document.querySelector("#lobbyResetButton"),
  lobbyStatus: document.querySelector("#lobbyStatus"),
  hostName: document.querySelector("[data-host-name]"),
  homeMusic: document.querySelector("#homeMusic")
};

const requestTimeoutMs = 4000;
let lastJoinUrl = "";
let redirectTimer = null;
let homeMusicStarted = false;
let refreshInFlight = false;

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      ...options
    });
    if (response.status === 401) {
      window.location.href = "./login.html";
      throw new Error("Требуется вход ведущего");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data && data.error ? data.error : await response.text());
    }
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Сервер не ответил");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
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

function renderPlayer(player) {
  const slot = player.slot;
  document.querySelector(`[data-player-name="${slot}"]`).textContent = player.name;
  document.querySelector(`[data-player-state="${slot}"]`).textContent = player.connected ? "подключен" : "не подключен";
  document.querySelector(`[data-player-card="${slot}"]`).classList.toggle("connected", player.connected);
}

function renderHost(host) {
  if (!elements.hostName || !host || !host.name) return;
  elements.hostName.textContent = `Ведущий: ${host.name}`;
}

function scheduleRaceRedirect() {
  if (redirectTimer) return;
  redirectTimer = setTimeout(() => {
    if (elements.homeMusic) elements.homeMusic.pause();
    window.location.href = "./race.html";
  }, 900);
}

function setLobbyStatus(text) {
  if (elements.lobbyStatus) elements.lobbyStatus.textContent = text;
}

async function playHomeMusic() {
  if (!elements.homeMusic || homeMusicStarted) return;
  try {
    elements.homeMusic.volume = 0.58;
    await elements.homeMusic.play();
    homeMusicStarted = true;
  } catch (error) {
    // Browsers can block audio until the first click/tap.
  }
}

function renderState(state) {
  renderQr(state.joinUrl);
  renderHost(state.host);
  state.participants.forEach(renderPlayer);

  const connectedCount = state.participants.filter(player => player.connected).length;
  setLobbyStatus(connectedCount === 0
    ? "Отсканируйте QR-код и выберите машину на телефоне."
    : connectedCount === 1
      ? "Первый участник подключен. Ждем второго участника."
      : "Оба участника подключены. Переходим на трассу.");

  if (connectedCount >= 2 || state.started || state.winnerSlot !== null) {
    scheduleRaceRedirect();
  }
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    renderState(await api("/api/state"));
  } catch (error) {
    setLobbyStatus("Сервер недоступен");
  } finally {
    refreshInFlight = false;
  }
}

elements.copyLinkButton.addEventListener("click", async () => {
  if (!lastJoinUrl) return;
  try {
    await copyText(lastJoinUrl);
    elements.copyLinkButton.textContent = "Ссылка скопирована";
  } catch (error) {
    elements.copyLinkButton.textContent = "Не удалось скопировать";
  }
  setTimeout(() => {
    elements.copyLinkButton.textContent = "Скопировать ссылку";
  }, 1300);
});

elements.logoutButton.addEventListener("click", async () => {
  if (elements.homeMusic) elements.homeMusic.pause();
  await api("/api/logout", { method: "POST" });
  window.location.href = "./login.html";
});

elements.lobbyResetButton.addEventListener("click", async () => {
  elements.lobbyResetButton.disabled = true;
  if (redirectTimer) {
    clearTimeout(redirectTimer);
    redirectTimer = null;
  }
  lastJoinUrl = "";
  try {
    renderState(await api("/api/control", {
      method: "POST",
      body: JSON.stringify({ action: "reset" })
    }));
  } catch (error) {
    setLobbyStatus(error.message);
  } finally {
    elements.lobbyResetButton.disabled = false;
  }
});

refresh();
playHomeMusic();
["pointerdown", "click", "keydown"].forEach(eventName => {
  window.addEventListener(eventName, playHomeMusic, { once: true });
});
setInterval(refresh, 180);
