const form = document.querySelector("#joinForm");
const joinButton = document.querySelector("#joinButton");
const nameInput = document.querySelector("#nameInput");
const meterSection = document.querySelector("#meterSection");
const meterFill = document.querySelector("#meterFill");
const meterValue = document.querySelector("#meterValue");
const micButton = document.querySelector("#micButton");
const tapButton = document.querySelector("#tapButton");
const phoneStatus = document.querySelector("#phoneStatus");
const slotPill = document.querySelector("#slotPill");
const phoneHint = document.querySelector("#phoneHint");
const switchButton = document.querySelector("#switchButton");
const readyTitle = document.querySelector("#readyTitle");
const slotButtons = Array.from(document.querySelectorAll("[data-slot-choice]"));
const carButtons = Array.from(document.querySelectorAll("[data-car-choice]"));

const storagePrefix = "noise-race-player-id-slot-";
const carStorageKey = "noise-race-selected-car";
const defaultCarId = "2.2114";
const validCarIds = ["2.2114", "bmw", "camry-70", "cobalt", "elantra", "mers"];
const requestTimeoutMs = 3500;
let playerId = "";
let selectedSlot = 0;
let selectedCarId = normalizeCarId(localStorage.getItem(carStorageKey));
let joined = false;
let manualBoost = 0;
let latestLevel = 0;
let audioContext = null;
let analyser = null;
let source = null;
let sending = false;
let micStarting = false;
let levelFailures = 0;
let wakeLock = null;

async function post(path, body, timeoutMs = requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Ошибка подключения");
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Сервер не ответил. Проверьте Wi-Fi и попробуйте снова.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestScreenWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (error) {
    // The game works without Wake Lock; it only helps phones stay awake.
  }
}

function setSelectedSlot(slot) {
  selectedSlot = Number(slot) === 1 ? 1 : 0;
  playerId = localStorage.getItem(`${storagePrefix}${selectedSlot}`) || "";
  slotButtons.forEach(button => {
    button.classList.toggle("active", Number(button.dataset.slotChoice) === selectedSlot);
  });
}

function normalizeCarId(carId) {
  return validCarIds.includes(carId) ? carId : defaultCarId;
}

function setSelectedCar(carId) {
  selectedCarId = normalizeCarId(carId);
  localStorage.setItem(carStorageKey, selectedCarId);
  carButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.carChoice === selectedCarId);
  });
}

function setLevel(level) {
  latestLevel = Math.max(0, Math.min(1, level));
  const display = Math.round(latestLevel * 100);
  meterFill.style.width = `${display}%`;
  meterValue.textContent = display;
}

async function join(name) {
  joinButton.disabled = true;
  joinButton.textContent = "Подключаю...";
  phoneStatus.textContent = "Подключаю телефон к гонке...";

  const data = await post("/api/join", { id: playerId, name, slot: selectedSlot, carId: selectedCarId });
  playerId = data.id;
  selectedSlot = data.slot;
  localStorage.setItem(`${storagePrefix}${selectedSlot}`, playerId);
  joined = true;
  levelFailures = 0;
  requestScreenWakeLock();

  form.hidden = true;
  form.style.display = "none";
  meterSection.hidden = false;
  meterSection.style.display = "grid";
  slotPill.hidden = false;
  slotPill.textContent = `Машина ${data.slot + 1}`;
  slotPill.classList.toggle("cyan", data.slot === 1);
  readyTitle.textContent = `${name || "Игрок"} подключен`;
  joinButton.disabled = false;
  joinButton.textContent = "Подключено";
  phoneStatus.textContent = "Готово. Включите микрофон.";
}

async function startMic() {
  if (analyser) return;
  if (!window.isSecureContext) {
    throw new Error("Микрофон работает только на HTTPS-странице.");
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Браузер не поддерживает доступ к микрофону.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.62;
  source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  micButton.textContent = "Микрофон включен";
  micButton.disabled = true;
  phoneHint.textContent = "Шумите громче, чтобы машина ускорялась.";
  readMic();
}

function readMic() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);

  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    const centered = (data[index] - 128) / 128;
    sum += centered * centered;
  }

  const rms = Math.sqrt(sum / data.length);
  const boosted = Math.min(1, Math.max(0, (rms - 0.018) * 9.8));
  setLevel(Math.max(boosted, manualBoost));
  manualBoost *= 0.88;
  requestAnimationFrame(readMic);
}

async function sendLevel() {
  if (!joined || sending) return;
  sending = true;
  try {
    await post("/api/level", { id: playerId, level: latestLevel });
    if (levelFailures >= 4) {
      phoneStatus.textContent = analyser ? "Связь восстановлена. Микрофон работает." : "Связь восстановлена. Включите микрофон.";
    }
    levelFailures = 0;
  } catch (error) {
    levelFailures += 1;
    if (levelFailures >= 4) {
      phoneStatus.textContent = "Связь с сервером восстанавливается...";
    }
  } finally {
    sending = false;
  }
}

async function handleJoin(event) {
  if (event) event.preventDefault();
  try {
    await join(nameInput.value.trim() || "Игрок");
  } catch (error) {
    phoneStatus.textContent = error.message;
    joinButton.disabled = false;
    joinButton.textContent = "Подключиться";
  }
}

function boost(event) {
  if (event) event.preventDefault();
  if (!joined) {
    phoneStatus.textContent = "Сначала нажмите «Подключиться».";
    return;
  }
  manualBoost = Math.min(1, manualBoost + 0.42);
  setLevel(Math.max(latestLevel, manualBoost));
  phoneStatus.textContent = "Сигнал отправляется.";
  sendLevel();
}

slotButtons.forEach(button => {
  button.addEventListener("click", () => setSelectedSlot(button.dataset.slotChoice));
});

carButtons.forEach(button => {
  button.addEventListener("click", () => setSelectedCar(button.dataset.carChoice));
});

form.addEventListener("submit", handleJoin);
joinButton.addEventListener("click", handleJoin);

if (switchButton) {
  switchButton.addEventListener("click", () => {
    joined = false;
    slotPill.hidden = true;
    meterSection.hidden = true;
    meterSection.style.display = "";
    form.hidden = false;
    form.style.display = "";
    joinButton.disabled = false;
    joinButton.textContent = "Подключиться";
    setSelectedSlot(selectedSlot === 0 ? 1 : 0);
    phoneStatus.textContent = "Выберите машину и подключитесь заново.";
  });
}

micButton.addEventListener("click", async () => {
  if (micStarting || analyser) return;
  micStarting = true;
  micButton.disabled = true;
  try {
    await startMic();
  } catch (error) {
    phoneStatus.textContent = error.message;
    phoneHint.textContent = "Для микрофона откройте QR по HTTPS и подтвердите доступ.";
    micButton.disabled = false;
  } finally {
    micStarting = false;
  }
});

if (tapButton) {
  tapButton.addEventListener("click", boost);
  tapButton.addEventListener("pointerdown", boost);
  tapButton.addEventListener("touchstart", boost, { passive: false });
}

setInterval(() => {
  manualBoost *= 0.82;
  if (!analyser) setLevel(manualBoost);
}, 80);

setInterval(sendLevel, 120);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && joined) requestScreenWakeLock();
});

setSelectedSlot(0);
setSelectedCar(selectedCarId);
