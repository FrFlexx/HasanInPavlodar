const elements = {
  raceStage: document.querySelector("#raceStage"),
  trackBackground: document.querySelector(".moving-track-bg"),
  startButton: document.querySelector("#startButton"),
  resetButton: document.querySelector("#resetButton"),
  raceStatus: document.querySelector("#raceStatus"),
  winnerBanner: document.querySelector("#winnerBanner"),
  winnerText: document.querySelector("#winnerText"),
  countdownOverlay: document.querySelector("#countdownOverlay"),
  countdownText: document.querySelector("#countdownText"),
  countdownAudio: document.querySelector("#countdownAudio"),
  hostName: document.querySelector("[data-host-name]"),
  raceMusic: document.querySelector("#raceMusic")
};

const carAssets = {
  "2.2114": [
    { type: "video", src: "./assets/2.2114.webm?v=1" },
    { type: "image", src: "./assets/1.%202114.png?v=1" }
  ],
  bmw: [
    { type: "video", src: "./assets/BMW.webm?v=1" },
    { type: "image", src: "./assets/1.%20BMW.png?v=1" }
  ],
  "camry-70": [
    { type: "video", src: "./assets/Camry-70.webm?v=1" },
    { type: "image", src: "./assets/1.%20Camry%2070.png?v=1" }
  ],
  cobalt: [
    { type: "video", src: "./assets/Cobalt.webm?v=1" },
    { type: "image", src: "./assets/1.%20Cobalt.png?v=1" }
  ],
  elantra: [
    { type: "video", src: "./assets/elantra.webm?v=1" },
    { type: "image", src: "./assets/1.%20Elantra.png?v=1" }
  ],
  mers: [
    { type: "video", src: "./assets/mers.webm?v=1" },
    { type: "image", src: "./assets/1.%20Mers.png?v=1" }
  ]
};

const loadedCars = new Map();
const chromaFrames = new Map();
const requestTimeoutMs = 4000;
let mediaShouldPlay = false;
let raceHasFinished = false;
let pendingWinner = null;
let winnerRedirectTimer = null;
let winnerRedirected = false;
let countdownRunning = false;
let countdownTimers = [];
let raceMusicStarted = false;
let refreshInFlight = false;
const targetProgress = [0, 0];
const visualProgress = [0, 0];
const previousVisualProgress = [0, 0];

const trackImage = {
  width: 8192,
  height: 2728,
  finishX: 0.953,
  finishSegment: 4
};

function currentTrackTileWidth() {
  return window.innerHeight * (trackImage.width / trackImage.height);
}

function finishTargetX() {
  return window.innerWidth * 0.885;
}

function setTrackPosition(progress) {
  const clamped = percent(progress);
  const tileWidth = currentTrackTileWidth();
  const finishImageX = tileWidth * (trackImage.finishSegment + trackImage.finishX);
  const finalOffset = finishTargetX() - finishImageX;
  const offset = finalOffset * (clamped / 100);
  elements.trackBackground.style.setProperty("--track-loop-x", `${offset}px`);
  elements.trackBackground.style.setProperty("--track-finish-x", `${offset + trackImage.finishSegment * tileWidth}px`);
}

function imageSources(name) {
  return [
    { type: "image", src: `./assets/${name}.png?v=1` },
    { type: "image", src: `./assets/${name}.jpg?v=1` },
    { type: "image", src: `./assets/${name}.jpeg?v=1` },
    { type: "image", src: `./assets/${name}.webp?v=1` }
  ];
}

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

function percent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
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
  targetProgress[slot] = progress;

  setTextAll(`[data-progress-name="${slot}"]`, player.name);
  document.querySelector(`[data-progress="${slot}"]`).style.width = `${noise}%`;
  setTextAll(`[data-percent="${slot}"]`, Math.round(noise));

  const car = document.querySelector(`[data-car="${slot}"]`);
  setCarMedia(car, player.carId);
}

function renderHost(host) {
  if (!elements.hostName || !host || !host.name) return;
  elements.hostName.textContent = `Ведущий: ${host.name}`;
}

function updateCarPosition(slot, progress, cameraProgress) {
  const car = document.querySelector(`[data-car="${slot}"]`);
  const track = car.closest(".track");
  const left = parseFloat(getComputedStyle(car).left) || 0;
  const finishLineX = finishTargetX();
  const wheelOffset = car.offsetWidth * 0.82;
  const finishTravel = Math.max(0, finishLineX - left - wheelOffset);
  const worldTravel = finishTravel * (trackImage.finishSegment + trackImage.finishX);
  const cameraTravel = Math.max(0, worldTravel - finishTravel);
  const carWorldX = (progress / 100) * worldTravel;
  const cameraX = (cameraProgress / 100) * cameraTravel;
  car.style.setProperty("--x", `${carWorldX - cameraX}px`);
}

function setCarMedia(car, carId) {
  const img = car.querySelector("[data-car-image]");
  const video = car.querySelector("[data-car-video]");
  const canvas = car.querySelector("[data-car-canvas]");
  const effectiveCarId = carId && carAssets[carId] ? carId : "2.2114";
  if (loadedCars.get(car) === effectiveCarId) return;
  loadedCars.set(car, effectiveCarId);
  stopChromaCanvas(car);
  img.hidden = true;
  video.hidden = true;
  canvas.hidden = true;
  video.pause();
  video.removeAttribute("src");
  video.load();
  tryCarSource(car, carAssets[effectiveCarId]);
}

function renderStatus(state, connectedCount) {
  elements.startButton.disabled = connectedCount < 2 || state.started || countdownRunning;
  elements.raceStage.classList.toggle("is-running", state.started);
  mediaShouldPlay = state.started;
  raceHasFinished = state.winnerSlot !== null;
  syncCarMedia();

  if (state.winnerSlot !== null) {
    const winner = state.participants.find(player => player.slot === state.winnerSlot);
    if (!winner) return;
    pendingWinner = { slot: winner.slot, text: `${winner.name} победил!` };
    elements.raceStatus.textContent = "Финиш";
    updateWinnerBanner();
    return;
  }

  if (countdownRunning) {
    elements.winnerBanner.hidden = true;
    return;
  }

  pendingWinner = null;
  winnerRedirected = false;
  if (winnerRedirectTimer) {
    clearTimeout(winnerRedirectTimer);
    winnerRedirectTimer = null;
  }
  elements.winnerBanner.hidden = true;
  elements.raceStatus.textContent = state.started
    ? "Гонка идет"
    : connectedCount >= 2
      ? "Готово к старту"
      : "Ожидание игроков";
}

function renderState(state) {
  const connectedCount = state.participants.filter(player => player.connected).length;
  if (connectedCount < 2 && !state.started && state.winnerSlot === null) {
    window.location.href = "./index.html";
    return;
  }

  renderHost(state.host);
  state.participants.forEach(renderPlayer);
  renderStatus(state, connectedCount);
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    renderState(await api("/api/state"));
  } catch (error) {
    elements.raceStatus.textContent = "Сервер недоступен";
  } finally {
    refreshInFlight = false;
  }
}

function tryCarImage(img, sources, index = 0) {
  tryCarSource(img.closest(".car"), sources, index);
}

function tryCarSource(car, sources, index = 0) {
  const img = car.querySelector("[data-car-image]");
  const video = car.querySelector("[data-car-video]");
  const canvas = car.querySelector("[data-car-canvas]");
  if (index >= sources.length) {
    img.hidden = true;
    video.hidden = true;
    canvas.hidden = true;
    car.classList.add("fallback-car");
    return;
  }

  const source = sources[index];
  if (source.type === "video") {
    video.onloadeddata = () => {
      img.hidden = true;
      video.hidden = true;
      canvas.hidden = false;
      prepareChromaCanvas(car);
      car.classList.remove("fallback-car");
      syncCarMedia();
    };
    video.onerror = () => tryCarSource(car, sources, index + 1);
    video.src = source.src;
    video.load();
    return;
  }

  const probe = new Image();
  probe.onload = () => {
    stopChromaCanvas(car);
    canvas.hidden = true;
    video.hidden = true;
    video.pause();
    img.src = source.src;
    img.hidden = false;
    car.classList.remove("fallback-car");
  };
  probe.onerror = () => tryCarSource(car, sources, index + 1);
  probe.src = source.src;
}

function syncCarMedia() {
  document.querySelectorAll("[data-car-video]").forEach(video => {
    const car = video.closest(".car");
    const canvas = car.querySelector("[data-car-canvas]");
    if (canvas.hidden || !video.src) return;
    const slot = Number(car.dataset.car);
    const isCarMoving = mediaShouldPlay && Math.abs(visualProgress[slot] - previousVisualProgress[slot]) > 0.015;
    if (isCarMoving) {
      video.play().catch(() => {});
      startChromaCanvas(car);
      return;
    }

    video.pause();
    stopChromaCanvas(car);
    if (!raceHasFinished) {
      try {
        video.currentTime = 0;
      } catch (error) {
        // Some browsers disallow seeking until metadata is ready.
      }
    }
    drawChromaFrame(car);
  });
}

function prepareChromaCanvas(car) {
  const video = car.querySelector("[data-car-video]");
  const canvas = car.querySelector("[data-car-canvas]");
  if (!video.videoWidth || !video.videoHeight) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  drawChromaFrame(car);
}

function drawChromaFrame(car) {
  const video = car.querySelector("[data-car-video]");
  const canvas = car.querySelector("[data-car-canvas]");
  if (canvas.hidden || !video.videoWidth || !video.videoHeight) return;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = frame.data;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const greenDominates = green > 78 && green > red * 1.35 && green > blue * 1.35;
    const brightGreen = green > 120 && green - Math.max(red, blue) > 34;
    if (greenDominates || brightGreen) {
      data[index + 3] = 0;
    } else {
      data[index + 3] = 255;
    }
  }
  context.putImageData(frame, 0, 0);
}

function startChromaCanvas(car) {
  if (chromaFrames.has(car)) return;
  const tick = () => {
    drawChromaFrame(car);
    chromaFrames.set(car, requestAnimationFrame(tick));
  };
  chromaFrames.set(car, requestAnimationFrame(tick));
}

function stopChromaCanvas(car) {
  const frame = chromaFrames.get(car);
  if (frame) cancelAnimationFrame(frame);
  chromaFrames.delete(car);
}

function updateWinnerBanner() {
  if (!pendingWinner) return;
  const arrived = visualProgress[pendingWinner.slot] >= 99.2;
  elements.winnerText.textContent = pendingWinner.text;
  elements.winnerBanner.hidden = !arrived;
  if (arrived && !winnerRedirected && !winnerRedirectTimer) {
    stopRaceMusic();
    winnerRedirectTimer = setTimeout(() => {
      winnerRedirected = true;
      window.location.href = "./winner.html";
    }, 950);
  }
}

function clearCountdown() {
  countdownTimers.forEach(timer => clearTimeout(timer));
  countdownTimers = [];
  countdownRunning = false;
  elements.countdownOverlay.hidden = true;
  elements.countdownOverlay.classList.remove("is-go");
  elements.countdownText.textContent = "";
  elements.startButton.disabled = false;
  try {
    elements.countdownAudio.pause();
    elements.countdownAudio.currentTime = 0;
  } catch (error) {
    // Audio cleanup can fail if metadata is not loaded yet.
  }
}

function showCountdownStep(text) {
  elements.countdownText.textContent = text;
  elements.countdownOverlay.hidden = false;
  elements.countdownOverlay.classList.toggle("is-go", text === "ПОЕХАЛИ!");
  elements.countdownText.style.animation = "none";
  elements.countdownText.offsetHeight;
  elements.countdownText.style.animation = "";
}

async function playRaceMusic() {
  if (!elements.raceMusic || raceMusicStarted) return;
  try {
    elements.raceMusic.volume = 0.62;
    elements.raceMusic.currentTime = 0;
    await elements.raceMusic.play();
    raceMusicStarted = true;
  } catch (error) {
    // The race still works if the browser blocks music playback.
  }
}

function stopRaceMusic() {
  if (!elements.raceMusic) return;
  try {
    elements.raceMusic.pause();
    elements.raceMusic.currentTime = 0;
  } catch (error) {
    // Audio cleanup can fail if metadata is not loaded yet.
  }
  raceMusicStarted = false;
}

async function startRaceAfterCountdown() {
  countdownRunning = true;
  elements.startButton.disabled = true;
  elements.raceStatus.textContent = "Старт через 3";
  showCountdownStep("3");

  try {
    elements.countdownAudio.currentTime = 0;
    await elements.countdownAudio.play();
  } catch (error) {
    // The countdown should still work if the browser blocks or delays audio.
  }

  countdownTimers.push(setTimeout(() => {
    elements.raceStatus.textContent = "Старт через 2";
    showCountdownStep("2");
  }, 1000));

  countdownTimers.push(setTimeout(() => {
    elements.raceStatus.textContent = "Старт через 1";
    showCountdownStep("1");
  }, 2000));

  countdownTimers.push(setTimeout(async () => {
    showCountdownStep("ПОЕХАЛИ!");
    try {
      countdownRunning = false;
      renderState(await api("/api/control", {
        method: "POST",
        body: JSON.stringify({ action: "start" })
      }));
      countdownTimers.push(setTimeout(playRaceMusic, 420));
      countdownTimers.push(setTimeout(() => {
        elements.countdownOverlay.hidden = true;
        elements.countdownOverlay.classList.remove("is-go");
      }, 850));
    } catch (error) {
      clearCountdown();
      elements.raceStatus.textContent = "Сервер недоступен";
    }
  }, 3000));
}

function animateRaceView() {
  for (let slot = 0; slot < visualProgress.length; slot += 1) {
    previousVisualProgress[slot] = visualProgress[slot];
    const delta = targetProgress[slot] - visualProgress[slot];
    if (Math.abs(delta) < 0.04) {
      visualProgress[slot] = targetProgress[slot];
    } else {
      visualProgress[slot] += delta * 0.16;
    }
  }

  const cameraProgress = Math.max(...visualProgress);
  setTrackPosition(cameraProgress);
  for (let slot = 0; slot < visualProgress.length; slot += 1) {
    updateCarPosition(slot, visualProgress[slot], cameraProgress);
  }
  syncCarMedia();
  updateWinnerBanner();
  requestAnimationFrame(animateRaceView);
}

function initCustomCars() {
  document.querySelectorAll("[data-car-image]").forEach(img => {
    setCarMedia(img.closest(".car"), "2.2114");
  });
}

elements.startButton.addEventListener("click", () => {
  if (countdownRunning) return;
  startRaceAfterCountdown();
});

elements.resetButton.addEventListener("click", async () => {
  elements.resetButton.disabled = true;
  clearCountdown();
  stopRaceMusic();
  winnerRedirected = true;
  if (winnerRedirectTimer) clearTimeout(winnerRedirectTimer);
  try {
    await api("/api/control", {
      method: "POST",
      body: JSON.stringify({ action: "reset" })
    });
    window.location.href = "./index.html";
  } catch (error) {
    elements.raceStatus.textContent = error.message;
    elements.resetButton.disabled = false;
  }
});

initCustomCars();
refresh();
setInterval(refresh, 160);
requestAnimationFrame(animateRaceView);
