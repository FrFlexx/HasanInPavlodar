const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const CERT_DIR = path.join(__dirname, "cert");
const CERT_PATH = path.join(CERT_DIR, "cert.pem");
const KEY_PATH = path.join(CERT_DIR, "key.pem");
const PFX_PATH = path.join(CERT_DIR, "noise-race.pfx");
const PFX_PASSPHRASE = "noise-race";
const ENABLE_LOCAL_HTTPS = process.env.ENABLE_LOCAL_HTTPS !== "0" && process.env.NODE_ENV !== "production" && !process.env.RENDER;
const DEFAULT_NAMES = ["Игрок 1", "Игрок 2"];
const CAR_IDS = ["2.2114", "bmw", "camry-70", "cobalt", "elantra", "mers"];
const DEFAULT_CAR_ID = CAR_IDS[0];
const FINISH_PROGRESS = 100;
const RACE_LENGTH_MULTIPLIER = 4.8;
const CONNECTED_TIMEOUT_MS = 8000;
const SLOT_STALE_MS = 25_000;
const HOST_ACCOUNTS = [
  {
    login: "Kalinin",
    password: "K7182",
    name: "Дмитрий Калинин"
  },
  {
    login: "Smirnov",
    password: "S7182",
    name: "Виталий Смирнов"
  }
];
const AUTH_COOKIE = "noise_race_auth";
const AUTH_MAX_AGE = 12 * 60 * 60;

let httpsEnabled = false;
const hostSessions = new Map();
const rooms = new Map();

function createRoom(host) {
  const id = crypto.randomBytes(8).toString("hex");
  const room = {
    id,
    host,
    state: {
      started: false,
      winnerSlot: null,
      startedAt: null,
      participants: [
        createParticipant(0, DEFAULT_NAMES[0], "#16e572"),
        createParticipant(1, DEFAULT_NAMES[1], "#3ad6ff")
      ]
    }
  };
  rooms.set(id, room);
  return room;
}

function createParticipant(slot, name, color) {
  return {
    slot,
    id: null,
    name,
    color,
    connected: false,
    level: 0,
    peak: 0,
    progress: 0,
    carId: DEFAULT_CAR_ID,
    lastSeen: 0
  };
}

function resetParticipant(player) {
  player.id = null;
  player.name = DEFAULT_NAMES[player.slot];
  player.connected = false;
  player.level = 0;
  player.peak = 0;
  player.progress = 0;
  player.carId = DEFAULT_CAR_ID;
  player.lastSeen = 0;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map(item => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separator = item.indexOf("=");
      if (separator === -1) return cookies;
      cookies[decodeURIComponent(item.slice(0, separator))] = decodeURIComponent(item.slice(separator + 1));
      return cookies;
    }, {});
}

function isHostAuthenticated(req) {
  const token = parseCookies(req)[AUTH_COOKIE];
  return Boolean(token && hostSessions.has(token));
}

function publicHost(host) {
  return {
    login: host.login,
    name: host.name
  };
}

function currentSession(req) {
  const token = parseCookies(req)[AUTH_COOKIE];
  return token ? hostSessions.get(token) || null : null;
}

function currentHost(req) {
  const session = currentSession(req);
  return session ? session.host : null;
}

function currentRoom(req) {
  const session = currentSession(req);
  return session ? rooms.get(session.roomId) || null : null;
}

function authCookie(token) {
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE}`;
}

function clearAuthCookie() {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store"
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("Payload is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(item => item && item.family === "IPv4" && !item.internal)
    .map(item => item.address);
}

function publicState(req, room) {
  const requestedProtocol = req.socket.encrypted ? "https" : (req.headers["x-forwarded-proto"] || "http");
  const rawHost = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`).split(",")[0].trim();
  const hostname = rawHost.split(":")[0];
  const requestPort = rawHost.includes(":") ? rawHost.split(":").pop() : "";
  const isLocalHost = /^(localhost|127\.|0\.0\.0\.0|::1)/.test(hostname);
  const protocol = isLocalHost && httpsEnabled ? "https" : requestedProtocol;
  const port = isLocalHost ? (httpsEnabled ? HTTPS_PORT : requestPort || PORT) : requestPort;
  const phoneHost = /^(localhost|127\.|0\.0\.0\.0|::1)/.test(hostname)
    ? localAddresses()[0] || hostname
    : hostname;
  const portSuffix = port && !((protocol === "https" && port === "443") || (protocol === "http" && port === "80"))
    ? `:${port}`
    : "";

  return {
    ...room.state,
    roomId: room.id,
    host: room.host,
    joinUrl: `${protocol}://${phoneHost}${portSuffix}/phone.html?room=${encodeURIComponent(room.id)}`,
    now: Date.now()
  };
}

function getRoomById(roomId) {
  return typeof roomId === "string" ? rooms.get(roomId) || null : null;
}

function getRoomFromRequest(req, body = {}) {
  const url = new URL(req.url, "http://localhost");
  return currentRoom(req) || getRoomById(String(body.roomId || body.room || url.searchParams.get("room") || ""));
}

function findRoomByPlayerId(id) {
  if (!id) return null;
  for (const room of rooms.values()) {
    if (room.state.participants.some(player => player.id === id)) return room;
  }
  return null;
}

function getOpenSlot(room, id, requestedSlot) {
  const staleCutoff = Date.now() - SLOT_STALE_MS;
  const known = room.state.participants.find(player => player.id === id);

  if (requestedSlot === 0 || requestedSlot === 1) {
    const requested = room.state.participants[requestedSlot];
    if (requested.id && requested.id !== id && requested.lastSeen >= staleCutoff) return null;
    return requested;
  }

  if (known) return known;
  return room.state.participants.find(player => !player.id || player.lastSeen < staleCutoff) || null;
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/auth") {
    const session = currentSession(req);
    sendJson(res, 200, {
      authenticated: isHostAuthenticated(req),
      host: session ? session.host : null,
      roomId: session ? session.roomId : null
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/login") {
    const body = await readBody(req);
    const login = String(body.login || "").trim();
    const password = String(body.password || "");

    const host = HOST_ACCOUNTS.find(account => account.login === login && account.password === password);
    if (!host) {
      sendJson(res, 401, { error: "Неверный логин или пароль" });
      return;
    }

    const token = crypto.randomBytes(24).toString("hex");
    const hostData = publicHost(host);
    const room = createRoom(hostData);
    hostSessions.set(token, { host: hostData, roomId: room.id });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": authCookie(token)
    });
    res.end(JSON.stringify({ ok: true, host: hostData, roomId: room.id }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/logout") {
    const token = parseCookies(req)[AUTH_COOKIE];
    if (token) hostSessions.delete(token);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": clearAuthCookie()
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/state")) {
    const room = getRoomFromRequest(req);
    if (!room) {
      sendJson(res, 404, { error: "Комната не найдена. Откройте свежий QR-код." });
      return;
    }
    sendJson(res, 200, publicState(req, room));
    return;
  }

  if (req.method === "POST" && req.url === "/api/join") {
    const body = await readBody(req);
    const room = getRoomFromRequest(req, body);
    if (!room) {
      sendJson(res, 404, { error: "Комната не найдена. Откройте свежий QR-код." });
      return;
    }
    let id = typeof body.id === "string" && body.id.length > 8
      ? body.id
      : crypto.randomBytes(8).toString("hex");
    const requestedSlot = Number.isInteger(Number(body.slot)) ? Number(body.slot) : null;

    const known = room.state.participants.find(player => player.id === id);
    if ((requestedSlot === 0 || requestedSlot === 1) && known && known.slot !== requestedSlot) {
      id = crypto.randomBytes(8).toString("hex");
    }

    const slot = getOpenSlot(room, id, requestedSlot);

    if (!slot) {
      sendJson(res, 409, {
        error: requestedSlot === 0 || requestedSlot === 1
          ? `Машина ${requestedSlot + 1} уже занята. Выберите другую машину или нажмите «Сброс» на главном экране.`
          : "Все две машины уже заняты. Нажмите «Сброс» на главном экране."
      });
      return;
    }

    slot.id = id;
    slot.name = String(body.name || slot.name || `Игрок ${slot.slot + 1}`).trim().slice(0, 24);
    slot.carId = CAR_IDS.includes(body.carId) ? body.carId : DEFAULT_CAR_ID;
    slot.connected = true;
    slot.lastSeen = Date.now();
    sendJson(res, 200, { id, slot: slot.slot, roomId: room.id, state: publicState(req, room) });
    return;
  }

  if (req.method === "POST" && req.url === "/api/level") {
    const body = await readBody(req);
    const room = getRoomFromRequest(req, body) || findRoomByPlayerId(body.id);
    if (!room) {
      sendJson(res, 404, { error: "Комната не найдена. Подключитесь заново по QR-коду." });
      return;
    }
    const player = room.state.participants.find(item => item.id === body.id);
    if (!player) {
      sendJson(res, 404, { error: "Участник не найден. Подключитесь заново." });
      return;
    }

    const level = Math.max(0, Math.min(1, Number(body.level) || 0));
    player.level = Math.max(level, player.level * 0.72);
    player.peak = Math.max(player.peak * 0.992, player.level);
    player.connected = true;
    player.lastSeen = Date.now();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && req.url === "/api/control") {
    if (!isHostAuthenticated(req)) {
      sendJson(res, 401, { error: "Требуется вход ведущего" });
      return;
    }

    const body = await readBody(req);
    const room = currentRoom(req);
    if (!room) {
      sendJson(res, 404, { error: "Комната ведущего не найдена. Войдите заново." });
      return;
    }
    const state = room.state;
    if (body.action === "start") {
      const connectedCount = state.participants.filter(player => player.connected).length;
      if (connectedCount < 2) {
        sendJson(res, 409, { error: "Для старта нужны два подключенных участника" });
        return;
      }
      state.started = true;
      state.winnerSlot = null;
      state.startedAt = Date.now();
      state.participants.forEach(player => {
        player.progress = 0;
        player.level = 0;
        player.peak = 0;
      });
      sendJson(res, 200, publicState(req, room));
      return;
    }

    if (body.action === "reset") {
      state.started = false;
      state.winnerSlot = null;
      state.startedAt = null;
      state.participants.forEach(resetParticipant);
      sendJson(res, 200, publicState(req, room));
      return;
    }

    sendJson(res, 400, { error: "Неизвестная команда" });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const protectedPages = new Set(["/index.html", "/race.html", "/winner.html"]);
  if (protectedPages.has(pathname) && !isHostAuthenticated(req)) {
    sendRedirect(res, "/login.html");
    return;
  }

  if (pathname === "/login.html" && isHostAuthenticated(req)) {
    sendRedirect(res, "/index.html");
    return;
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".webm": "video/webm",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
      ".ico": "image/x-icon"
    }[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function tickRace() {
  const now = Date.now();
  rooms.forEach(room => {
    const state = room.state;
    state.participants.forEach(player => {
      player.connected = Boolean(player.id && now - player.lastSeen < CONNECTED_TIMEOUT_MS);
      if (!player.connected) player.level *= 0.84;
    });

    if (!state.started || state.winnerSlot !== null) return;

    state.participants.forEach(player => {
      const usableLevel = Math.max(0, player.level - 0.035);
      const speed = (Math.pow(usableLevel, 1.08) * 1.28) / RACE_LENGTH_MULTIPLIER;
      player.progress = Math.min(FINISH_PROGRESS, player.progress + speed);
      player.level *= 0.94;
    });

    const winner = state.participants.find(player => player.progress >= FINISH_PROGRESS);
    if (winner) {
      state.winnerSlot = winner.slot;
      state.started = false;
    }
  });
}

function app(req, res) {
  Promise.resolve()
    .then(() => {
      if (req.url.startsWith("/api/")) return handleApi(req, res);
      return serveStatic(req, res);
    })
    .catch(error => {
      sendJson(res, 500, { error: error.message });
    });
}

function readHttpsOptions() {
  if (!ENABLE_LOCAL_HTTPS) return null;

  if (fs.existsSync(PFX_PATH)) {
    return {
      pfx: fs.readFileSync(PFX_PATH),
      passphrase: PFX_PASSPHRASE
    };
  }

  if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) return null;
  return {
    cert: fs.readFileSync(CERT_PATH),
    key: fs.readFileSync(KEY_PATH)
  };
}

setInterval(tickRace, 90);

const httpServer = http.createServer(app);
const httpsOptions = readHttpsOptions();
const httpsServer = httpsOptions ? https.createServer(httpsOptions, app) : null;

httpServer.on("clientError", (error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

if (httpsServer) {
  httpsServer.on("clientError", (error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
}

httpServer.listen(PORT, HOST, () => {
  const addresses = localAddresses();
  console.log("Hasan in Pavlodar is running:");
  console.log(`  Host screen: http://localhost:${PORT}`);
  addresses.forEach(address => console.log(`  Phone fallback: http://${address}:${PORT}/phone.html`));
  if (!httpsServer) {
    console.log("  HTTPS phone mode is disabled. Run make-cert.ps1, then restart.");
  }
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, HOST, () => {
    httpsEnabled = true;
    localAddresses().forEach(address => console.log(`  Phone microphone QR target: https://${address}:${HTTPS_PORT}/phone.html`));
  });
}
