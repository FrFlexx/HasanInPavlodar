const loginForm = document.querySelector("#loginForm");
const loginInput = document.querySelector("#loginInput");
const passwordInput = document.querySelector("#passwordInput");
const loginButton = document.querySelector("#loginButton");
const loginStatus = document.querySelector("#loginStatus");
const requestTimeoutMs = 5000;

async function post(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Ошибка входа");
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Сервер не ответил. Проверьте, что игра запущена.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginButton.disabled = true;
  loginButton.textContent = "Входим...";
  loginStatus.textContent = "Проверяю данные...";

  try {
    await post("/api/login", {
      login: loginInput.value.trim(),
      password: passwordInput.value
    });
    window.location.href = "./index.html";
  } catch (error) {
    loginStatus.textContent = error.message;
    loginButton.disabled = false;
    loginButton.textContent = "Войти";
  }
});
