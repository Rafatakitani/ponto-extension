// Service worker do ponto-extension: TODOS os fetch moram aqui (sem CORS via
// host permissions). Popup/options/content falam por mensagens; o protocolo
// está em docs/plans/2026-07-06-ponto-extension.md. A Task 5 acrescenta badge,
// alarmes, lembrete e atalho (tudo abaixo do router).
import { api } from "./lib/api.js";

async function getConfig() {
  const { apiUrl, token, reminderHours } = await chrome.storage.local.get(["apiUrl", "token", "reminderHours"]);
  return { apiUrl, token, reminderHours: reminderHours ?? 2, configured: Boolean(apiUrl && token) };
}

// Cache do timer: o badge e os content scripts leem daqui entre syncs.
// Fonte da verdade continua o servidor — isto é descartável. Toda escrita
// mantém badge/alarme coerentes (Task 5) e avisa quem escuta (broadcast).
async function setTimerCache(entry) {
  await chrome.storage.local.set({ timerCache: { entry, fetchedAt: Date.now() } });
  await updateBadge(entry);
  await scheduleTick(entry);
  broadcast({ type: "timer:changed", data: entry });
}

async function refreshTimer(cfg) {
  const res = await api.getTimer(cfg);
  if (res.ok) await setTimerCache(res.data);
  return res;
}

// Avisa popup (runtime) e abas com content script (tabs). Erros de "nenhum
// receptor" são esperados (popup fechado, aba sem script) — engolir.
function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
  chrome.tabs.query({ url: ["https://github.com/*", "https://linear.app/*"] })
    .then((tabs) => { for (const tab of tabs) chrome.tabs.sendMessage(tab.id, message).catch(() => {}); })
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, status: 0, error: String(e) }));
  return true; // resposta assíncrona
});

async function handle(msg) {
  if (msg.type === "config:get") return { ok: true, data: await getConfig() };
  if (msg.type === "config:test") return api.getTimer({ apiUrl: msg.payload.apiUrl, token: msg.payload.token });

  const cfg = await getConfig();
  if (!cfg.configured) return { ok: false, status: 0, error: "unconfigured" };

  switch (msg.type) {
    case "timer:get":
      return refreshTimer(cfg);

    case "timer:start": {
      const { description, project_id, task_id, tag_ids, billable } = msg.payload;
      const res = await api.startTimer(cfg, { description, project_id, task_id });
      if (res.status === 409) { await refreshTimer(cfg); return res; }
      if (!res.ok) return res;

      // POST /timer não aceita tags/billable — segundo passo via PATCH (spec).
      // Falha no PATCH não desfaz o start: devolve warning pro popup avisar.
      let entry = res.data, warning;
      const extras = {};
      if (Array.isArray(tag_ids) && tag_ids.length) extras.tag_ids = tag_ids;
      if (billable !== undefined && billable !== entry.billable) extras.billable = billable;
      if (Object.keys(extras).length) {
        const patch = await api.updateEntry(cfg, entry.id, extras);
        if (patch.ok) entry = patch.data; else warning = "extras";
      }
      await setTimerCache(entry);
      return { ok: true, status: res.status, data: entry, warning };
    }

    case "timer:stop": {
      const res = await api.stopTimer(cfg);
      if (res.ok || res.status === 404) await setTimerCache(null);
      return res;
    }

    case "entry:update": {
      const res = await api.updateEntry(cfg, msg.payload.id, msg.payload.attrs);
      if (res.ok && res.data && !res.data.ended_at) await setTimerCache(res.data);
      return res;
    }

    case "entries:recent": {
      const res = await api.recentEntries(cfg);
      if (res.ok) res.data = (res.data || []).slice(0, 30);
      return res;
    }

    case "entry:duplicate": {
      const res = await api.duplicateEntry(cfg, msg.payload.id);
      if (res.ok) await setTimerCache(res.data);
      if (res.status === 409) await refreshTimer(cfg);
      return res;
    }

    case "catalog:get": {
      const [projects, tags] = await Promise.all([api.projects(cfg), api.tags(cfg)]);
      if (!projects.ok) return projects;
      if (!tags.ok) return tags;
      return {
        ok: true,
        data: {
          projects: (projects.data || []).filter((p) => !p.archived_at),
          tags: (tags.data || []).filter((t) => !t.archived_at)
        }
      };
    }

    case "tasks:get": {
      const res = await api.tasks(cfg, msg.payload.projectId);
      if (res.ok) res.data = (res.data || []).filter((t) => !t.archived_at);
      return res;
    }

    case "app:url":
      return { ok: true, data: cfg.apiUrl.replace(/\/+$/, "") + "/home" };
  }
  return { ok: false, status: 0, error: `unknown message: ${msg.type}` };
}

// --- Badge (QoL: o decorrido no ícone, sem abrir o popup) ---------------------

function badgeText(entry) {
  if (!entry) return "";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(entry.started_at).getTime()) / 1000));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (h < 10) return `${h}h${String(m).padStart(2, "0")}`; // 4 chars: "2h05"
  return `${h}h`;
}

async function updateBadge(entry) {
  await chrome.action.setBadgeBackgroundColor({ color: "#0d7379" });
  await chrome.action.setBadgeText({ text: badgeText(entry) });
  await chrome.action.setTitle({
    title: entry ? `${chrome.i18n.getMessage("ext_name")} — ${entry.description || chrome.i18n.getMessage("notif_no_description")}` : chrome.i18n.getMessage("ext_name")
  });
}

// Rodando → tick de 1 min (badge + lembrete). Parado → poll de 5 min pra pegar
// timer iniciado por fora (app/CLI) e manter badge/content scripts honestos.
async function scheduleTick(entry) {
  await chrome.alarms.clear("ponto-tick");
  chrome.alarms.create("ponto-tick", { periodInMinutes: entry ? 1 : 5 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "ponto-tick") return;
  const cfg = await getConfig();
  if (!cfg.configured) return;
  const res = await api.getTimer(cfg);
  if (!res.ok) return; // rede fora: mantém o cache, tenta no próximo tick
  await setTimerCache(res.data);
  await maybeRemind(cfg, res.data);
});

// --- Lembrete de timer esquecido (QoL) ----------------------------------------

function formatElapsed(ms) {
  const mins = Math.floor(ms / 60000), h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
}

async function maybeRemind(cfg, entry) {
  if (!entry || !cfg.reminderHours) return;
  const { snoozeUntil = 0 } = await chrome.storage.local.get("snoozeUntil");
  if (Date.now() < snoozeUntil) return;
  const elapsed = Date.now() - new Date(entry.started_at).getTime();
  if (elapsed < cfg.reminderHours * 3600000) return;
  chrome.notifications.create("ponto-reminder", {
    type: "basic",
    iconUrl: "assets/icon128.png",
    title: chrome.i18n.getMessage("notif_reminder_title"),
    message: chrome.i18n.getMessage("notif_reminder_message", [entry.description || chrome.i18n.getMessage("notif_no_description"), formatElapsed(elapsed)]),
    buttons: [{ title: chrome.i18n.getMessage("notif_reminder_stop") }, { title: chrome.i18n.getMessage("notif_reminder_continue") }],
    requireInteraction: true
  });
}

chrome.notifications.onButtonClicked.addListener(async (id, buttonIndex) => {
  if (id !== "ponto-reminder") return;
  chrome.notifications.clear("ponto-reminder");
  const cfg = await getConfig();
  if (buttonIndex === 0) {
    const res = await api.stopTimer(cfg);
    if (res.ok || res.status === 404) await setTimerCache(null);
  } else {
    // "Continuar" silencia por mais uma janela inteira de reminderHours.
    await chrome.storage.local.set({ snoozeUntil: Date.now() + cfg.reminderHours * 3600000 });
  }
});

// --- Atalho global (QoL: toggle sem abrir popup) -------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-timer") return;
  const cfg = await getConfig();
  if (!cfg.configured) return chrome.runtime.openOptionsPage();

  const current = await api.getTimer(cfg);
  if (!current.ok) return;

  if (current.data) {
    const res = await api.stopTimer(cfg);
    if (res.ok || res.status === 404) {
      await setTimerCache(null);
      notify(res.status === 204
        ? chrome.i18n.getMessage("notif_discarded")
        : chrome.i18n.getMessage("notif_stopped", [formatElapsed(res.data ? new Date(res.data.ended_at) - new Date(res.data.started_at) : 0)]));
    }
  } else {
    // Mesma regra do popup: projeto default explícito no project_id.
    const projects = await api.projects(cfg);
    const def = projects.ok ? (projects.data || []).find((p) => p.default && !p.archived_at) : null;
    const res = await api.startTimer(cfg, { description: "", project_id: def ? def.id : null, task_id: null });
    if (res.ok) { await setTimerCache(res.data); notify(chrome.i18n.getMessage("notif_started")); }
    else if (res.status === 409) await refreshTimer(cfg);
  }
});

function notify(message) {
  chrome.notifications.create({ type: "basic", iconUrl: "assets/icon128.png", title: chrome.i18n.getMessage("ext_name"), message });
}

// --- Boot do SW: badge/alarme coerentes já na carga ----------------------------

async function init() {
  const { timerCache } = await chrome.storage.local.get("timerCache");
  const entry = timerCache?.entry ?? null;
  await updateBadge(entry);
  await scheduleTick(entry);
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
