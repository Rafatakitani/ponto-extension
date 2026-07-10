// Options: única tela que ESCREVE a config. Salvar pede a host permission da
// api_url (optional_host_permissions) — precisa acontecer no gesto do usuário.
import { t, applyLocale } from "../shared/i18n.js";
const $ = (sel) => document.querySelector(sel);

// Reexecutável: roda no boot (locale do browser) e de novo quando o locale do
// app chega/muda. As mensagens de status vêm de t() na hora, então já respeitam.
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
}
applyI18n();

const statusEl = $("#status");
function setStatus(text, kind = "") { statusEl.textContent = text; statusEl.className = kind; }

function normalizedUrl() {
  const raw = $("#api-url").value.trim().replace(/\/+$/, "");
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  return raw;
}

chrome.storage.local.get(["apiUrl", "token", "reminderHours"]).then((cfg) => {
  if (cfg.apiUrl) $("#api-url").value = cfg.apiUrl;
  if (cfg.token) $("#token").value = cfg.token;
  $("#reminder-hours").value = cfg.reminderHours ?? 2;
});

// Tema/acento do servidor no <html> (mesmo modelo do popup): cache na hora,
// revalida com o servidor. theme "system"/ausente segue o SO.
function applyPrefs(prefs) {
  const root = document.documentElement;
  const theme = prefs?.theme;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  const accent = prefs?.accent;
  if (accent && accent !== "teal") root.setAttribute("data-accent", accent);
  else root.removeAttribute("data-accent");
}
// Reaplica tema/acento + locale (i18n). Se o idioma mudou, repinta os textos.
async function applyPrefsAll(prefs) {
  applyPrefs(prefs);
  if (await applyLocale(prefs)) applyI18n();
}
chrome.storage.local.get("prefsCache").then(async ({ prefsCache }) => {
  if (prefsCache?.data) await applyPrefsAll(prefsCache.data);
  chrome.runtime.sendMessage({ type: "prefs:get" }).then((res) => { if (res?.ok) applyPrefsAll(res.data); }).catch(() => {});
});

$("#btn-reveal").addEventListener("click", () => {
  const input = $("#token");
  input.type = input.type === "password" ? "text" : "password";
});

$("#btn-test").addEventListener("click", async () => {
  const apiUrl = normalizedUrl();
  if (!apiUrl) return setStatus(t("options_invalid_url"), "error");

  // Host permission ANTES do fetch: sem ela, o fetch do SW bate em CORS e
  // reporta "network" mesmo com URL/token válidos. O clique é gesto do usuário,
  // então o request tem que ser o PRIMEIRO await (senão o gesto é perdido).
  const granted = await chrome.permissions.request({ origins: [new URL(apiUrl).origin + "/*"] });
  if (!granted) return setStatus(t("options_perm_denied"), "error");

  setStatus("…");
  const res = await chrome.runtime.sendMessage({ type: "config:test", payload: { apiUrl, token: $("#token").value.trim() } });
  if (res.ok) {
    setStatus(res.data ? t("options_test_ok_running", [res.data.description || t("popup_no_description")]) : t("options_test_ok_idle"), "ok");
  } else if (res.error === "auth") setStatus(t("options_test_fail_auth"), "error");
  else if (res.error === "network") setStatus(t("options_test_fail_network"), "error");
  else setStatus(t("options_test_fail_badresponse"), "error");
});

$("#form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiUrl = normalizedUrl();
  if (!apiUrl) return setStatus(t("options_invalid_url"), "error");

  // Host permission do servidor do usuário (self-hosted → não dá pra pré-declarar).
  const origin = new URL(apiUrl).origin + "/*";
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) return setStatus(t("options_perm_denied"), "error");

  await chrome.storage.local.set({
    apiUrl,
    token: $("#token").value.trim(),
    reminderHours: Number($("#reminder-hours").value)
  });

  // Config nova pode apontar pra outro servidor: descarta cache/snooze antigos e
  // força um re-sync imediato contra o servidor (possivelmente novo).
  await chrome.storage.local.remove(["timerCache", "snoozeUntil", "prefsCache"]);
  chrome.runtime.sendMessage({ type: "timer:get" }).catch(() => {});
  // Re-lê preferências do novo servidor e reaplica tema + idioma já nesta tela.
  chrome.runtime.sendMessage({ type: "prefs:get" }).then((res) => { if (res?.ok) applyPrefsAll(res.data); }).catch(() => {});

  setStatus(t("options_saved"), "ok");
});
