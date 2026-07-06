// Options: única tela que ESCREVE a config. Salvar pede a host permission da
// api_url (optional_host_permissions) — precisa acontecer no gesto do usuário.
const t = (key, subs) => chrome.i18n.getMessage(key, subs);
const $ = (sel) => document.querySelector(sel);

document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });

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

$("#btn-reveal").addEventListener("click", () => {
  const input = $("#token");
  input.type = input.type === "password" ? "text" : "password";
});

$("#btn-test").addEventListener("click", async () => {
  const apiUrl = normalizedUrl();
  if (!apiUrl) return setStatus(t("options_invalid_url"), "error");
  setStatus("…");
  const res = await chrome.runtime.sendMessage({ type: "config:test", payload: { apiUrl, token: $("#token").value.trim() } });
  if (res.ok) {
    setStatus(res.data ? t("options_test_ok_running", [res.data.description || t("notif_no_description")]) : t("options_test_ok_idle"), "ok");
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
  setStatus(t("options_saved"), "ok");
});
