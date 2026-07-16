// Service worker do ponto-extension: TODOS os fetch moram aqui (sem CORS via
// host permissions). Popup/options falam por mensagens. Abaixo do router:
// badge, alarmes, lembrete e atalho global.
import { api } from "./lib/api.js";
import { t, applyLocale } from "./shared/i18n.js";

// Lembrete de timer esquecido: default 9h (era 2h). 0 desliga. Ver getConfig.
const DEFAULT_REMINDER_HOURS = 9;

async function getConfig() {
  const { apiUrl, token, reminderHours } = await chrome.storage.local.get(["apiUrl", "token", "reminderHours"]);
  return { apiUrl, token, reminderHours: reminderHours ?? DEFAULT_REMINDER_HOURS, configured: Boolean(apiUrl && token) };
}

// O service worker é efêmero: pode morrer e renascer entre o fetch das prefs e o
// disparo de uma notificação, zerando o `active` do i18n em memória. Antes de
// qualquer texto localizado (notificações), reaplica o locale a partir do
// prefsCache (persistido em storage) — assim a notificação sai na língua do APP,
// não na do browser. Sem prefs em cache, applyLocale cai no default (pt-BR).
async function ensureLocale() {
  const { prefsCache } = await chrome.storage.local.get("prefsCache");
  await applyLocale(prefsCache?.data);
}

// Segunda-feira 00:00 no horário LOCAL, em ISO 8601 COM offset (o servidor exige
// hora completa + offset; só-data é rejeitada). Usado como `?since=` do ledger.
function startOfWeekISO(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // 0 = segunda
  const pad = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();                // minutos a leste de UTC
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Cache do timer: o badge lê daqui entre syncs. Fonte da verdade continua o
// servidor — isto é descartável. Toda escrita mantém badge/alarme coerentes e
// avisa o popup (broadcast).
async function setTimerCache(entry) {
  // Só faz broadcast quando a entry MUDA de fato: o tick de 1 min reescreve o
  // cache toda vez, e um broadcast redundante faz o popup re-renderizar,
  // atropelando edições em andamento (descrição) e roubando o foco do usuário.
  const { timerCache } = await chrome.storage.local.get("timerCache");
  const prev = timerCache?.entry ?? null;
  const changed = timerEntriesDiffer(prev, entry);

  await chrome.storage.local.set({ timerCache: { entry, fetchedAt: Date.now() } });
  await updateBadge(entry);
  await scheduleTick(entry);
  if (changed) broadcast({ type: "timer:changed", data: entry });
}

// Compara duas entries pelos campos que o popup renderiza (presença/ausência
// inclusa). Mudança de tempo decorrido NÃO conta — o cronômetro tica sozinho.
function timerEntriesDiffer(a, b) {
  if (Boolean(a) !== Boolean(b)) return true;
  if (!a && !b) return false;
  for (const key of ["id", "description", "project_id", "task_id", "started_at", "ended_at", "billable"]) {
    if (a[key] !== b[key]) return true;
  }
  return false;
}

async function refreshTimer(cfg) {
  const res = await api.getTimer(cfg);
  if (res.ok) await setTimerCache(res.data);
  return res;
}

// Avisa o popup (runtime) de mudanças no timer. Erro de "nenhum receptor" é
// esperado quando o popup está fechado — engolir.
function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
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
      // Ledger da SEMANA atual: filtra no servidor por `since` = segunda 00:00 local
      // (ISO completo com offset, que o servidor exige — só-data é rejeitada). Assim
      // o total da semana é sempre exato e trafega só a semana. A paginação sobe em
      // `res.page`. Semana raramente passa de 100 entries; se passar, o popup segue
      // a próxima página, mas o total já bate porque a janela é fechada no servidor.
      return api.recentEntries(cfg, { page: 1, limit: 100, since: startOfWeekISO() });
    }

    case "entry:duplicate": {
      const res = await api.duplicateEntry(cfg, msg.payload.id);
      if (res.ok) await setTimerCache(res.data);
      if (res.status === 409) await refreshTimer(cfg);
      return res;
    }

    // Lançar tempo manualmente (entry finalizada: started_at + ended_at). Não toca
    // no timer rodando — o popup recarrega os recentes ao voltar pra tela idle.
    case "entry:create": {
      return api.createEntry(cfg, msg.payload.attrs);
    }

    // Apagar uma entry. O popup só oferece delete em entries finalizadas, mas se
    // por acaso for a que está no cache (a rodando), limpamos badge/alarme.
    case "entry:delete": {
      const res = await api.deleteEntry(cfg, msg.payload.id);
      if (res.ok) {
        const { timerCache } = await chrome.storage.local.get("timerCache");
        if (timerCache?.entry?.id === msg.payload.id) await setTimerCache(null);
      }
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

    // Cria uma tag nova pela extensão (POST /tags). 201 devolve a tag; o popup a
    // adiciona ao catálogo e já marca na seleção. 422 = nome inválido/duplicado.
    case "tag:create": {
      return api.createTag(cfg, msg.payload.name);
    }

    // Preferências (theme/accent/locale/time_zone) do servidor. Cacheadas pra o
    // popup/options aplicarem o tema na hora, sem esperar a rede a cada abertura.
    case "prefs:get": {
      const res = await api.preferences(cfg);
      if (res.ok) {
        await chrome.storage.local.set({ prefsCache: { data: res.data, fetchedAt: Date.now() } });
        // Aplica já no SW vivo: as notificações que ele disparar em seguida saem
        // no idioma do app sem esperar o próximo ensureLocale.
        await applyLocale(res.data);
      }
      return res;
    }

    case "app:url":
      return { ok: true, data: cfg.apiUrl.replace(/\/+$/, "") + "/home" };
  }
  return { ok: false, status: 0, error: `unknown message: ${msg.type}` };
}

// --- Ícone de estado (aceso rodando ↔ apagado parado) -------------------------

// Sets de ícone: aceso (rodando) e apagado/cinza (parado). Trocados via setIcon
// conforme o estado do timer. Antes o tempo decorrido ia no BADGE, mas o badge do
// Chrome só cabe ~4 chars e truncava em números grandes ("4h05" -> "4h0C"). O
// tempo agora vive no popup/app; o ícone só sinaliza rodando ↔ parado.
const ICON_RUNNING = { 16: "assets/icon16.png", 32: "assets/icon32.png", 48: "assets/icon48.png", 128: "assets/icon128.png" };
const ICON_IDLE = { 16: "assets/icon16-idle.png", 32: "assets/icon32-idle.png", 48: "assets/icon48-idle.png", 128: "assets/icon128-idle.png" };

async function updateBadge(entry) {
  await chrome.action.setIcon({ path: entry ? ICON_RUNNING : ICON_IDLE });
  await ensureLocale();
  await chrome.action.setTitle({
    title: entry ? `${t("ext_name")} — ${entry.description || t("notif_no_description")}` : t("ext_name")
  });
}

// Rodando → tick de 1 min (badge + lembrete). Parado → poll de 5 min pra pegar
// timer iniciado por fora (app/CLI) e manter o badge honesto.
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

  // Silencia por uma janela inteira JÁ NA CRIAÇÃO: sem isso, o tick de 1 min
  // recria a notificação toda vez após o limite (e fechar não adianta). Com o
  // snooze aqui, cutuca uma vez por janela mesmo que o usuário só dispense.
  await chrome.storage.local.set({ snoozeUntil: Date.now() + cfg.reminderHours * 3600000 });

  // Idioma do app (não do browser) — o SW pode ter renascido desde o prefs:get.
  await ensureLocale();
  chrome.notifications.create("ponto-reminder", {
    type: "basic",
    iconUrl: "assets/icon128.png",
    title: t("notif_reminder_title"),
    message: t("notif_reminder_message", [entry.description || t("notif_no_description"), formatElapsed(elapsed)]),
    buttons: [{ title: t("notif_reminder_stop") }, { title: t("notif_reminder_continue") }],
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

  // Idioma do app antes de qualquer notify() deste handler (o SW pode ter
  // renascido). Aplicado uma vez; os t() abaixo já resolvem no locale certo.
  await ensureLocale();
  if (current.data) {
    const res = await api.stopTimer(cfg);
    if (res.ok || res.status === 404) {
      await setTimerCache(null);
      notify(res.status === 204
        ? t("notif_discarded")
        : t("notif_stopped", [formatElapsed(res.data ? new Date(res.data.ended_at) - new Date(res.data.started_at) : 0)]));
    }
  } else {
    // Mesma regra do popup: projeto default explícito no project_id.
    const projects = await api.projects(cfg);
    const def = projects.ok ? (projects.data || []).find((p) => p.default && !p.archived_at) : null;
    const res = await api.startTimer(cfg, { description: "", project_id: def ? def.id : null, task_id: null });
    if (res.ok) { await setTimerCache(res.data); notify(t("notif_started")); }
    else if (res.status === 409) await refreshTimer(cfg);
  }
});

function notify(message) {
  chrome.notifications.create({ type: "basic", iconUrl: "assets/icon128.png", title: t("ext_name"), message });
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
