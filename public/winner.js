const winnerName = document.querySelector("#winnerName");
const winnerCar = document.querySelector("#winnerCar");
const newRaceButton = document.querySelector("#newRaceButton");
const winnerMusic = document.querySelector("#winnerMusic");
const requestTimeoutMs = 4000;
let winnerMusicStarted = false;

const winnerCars = {
  "2.2114": "./assets/Winers/2114-cutout.png?v=3",
  bmw: "./assets/Winers/BMW-cutout.png?v=3",
  "camry-70": "./assets/Winers/Camry-cutout.png?v=3",
  cobalt: "./assets/Winers/Cobalt-cutout.png?v=3",
  elantra: "./assets/Winers/Elantra-cutout.png?v=3",
  mers: "./assets/Winers/Mers-cutout.png?v=3"
};

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

function renderWinner(state) {
  if (state.winnerSlot === null || state.winnerSlot === undefined) {
    window.location.href = "./index.html";
    return;
  }

  const winner = state.participants.find(player => player.slot === state.winnerSlot);
  if (!winner) {
    window.location.href = "./index.html";
    return;
  }

  winnerName.textContent = winner.name || `Игрок ${winner.slot + 1}`;
  const winnerSrc = winnerCars[winner.carId] || winnerCars["2.2114"];
  winnerCar.hidden = true;
  winnerCar.onload = () => {
    winnerCar.hidden = false;
  };
  winnerCar.src = winnerSrc;
}

async function loadWinner() {
  try {
    renderWinner(await api("/api/state"));
  } catch (error) {
    winnerName.textContent = "Победитель";
  }
}

async function playWinnerMusic() {
  if (!winnerMusic || winnerMusicStarted) return;
  try {
    winnerMusic.volume = 0.66;
    await winnerMusic.play();
    winnerMusicStarted = true;
  } catch (error) {
    // Browsers can block audio until the first click/tap.
  }
}

function stopWinnerMusic() {
  if (!winnerMusic) return;
  try {
    winnerMusic.pause();
    winnerMusic.currentTime = 0;
  } catch (error) {
    // Audio cleanup can fail if metadata is not loaded yet.
  }
  winnerMusicStarted = false;
}

newRaceButton.addEventListener("click", async () => {
  newRaceButton.disabled = true;
  stopWinnerMusic();
  try {
    await api("/api/control", {
      method: "POST",
      body: JSON.stringify({ action: "reset" })
    });
    window.location.href = "./index.html";
  } catch (error) {
    newRaceButton.disabled = false;
  }
});

loadWinner();
playWinnerMusic();
["pointerdown", "click", "keydown"].forEach(eventName => {
  window.addEventListener(eventName, playWinnerMusic, { once: true });
});
