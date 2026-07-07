// Popup do Ponto — timer completo (start/stop, projeto/task/tags/faturável, recentes).
// Fala com o service worker via chrome.runtime.sendMessage; sem estado remoto próprio.

const t = (key, subs) => chrome.i18n.getMessage(key, subs);
const $ = (sel) => document.querySelector(sel);
const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });

// Ícones do Lucide (mesmos do app Ponto); currentColor herda a cor do texto.
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICON_SCISSORS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>';

// Traduz textos e placeholders declarados no HTML (sem string de UI hardcoded).
document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });

// Rótulos acessíveis para controles sem <label> visível (aria-label via I18n).
$("#project-trigger").setAttribute("aria-label", t("popup_project_label"));
$("#task-select").setAttribute("aria-label", t("popup_task_label"));
$("#tag-chips").setAttribute("aria-label", t("popup_tags_label"));
$("#btn-options").title = t("popup_preferences");
$("#btn-options").setAttribute("aria-label", t("popup_preferences"));

const state = {
  entry: null,            // entry rodando ou null
  catalog: { projects: [], tags: [] },
  tasks: [],              // tasks do projeto selecionado
  recent: [],
  projectId: null, taskId: null, tagIds: new Set(),
  clockHandle: null
};

function show(viewId) {
  for (const id of ["view-setup", "view-error", "view-running", "view-idle"]) $("#" + id).hidden = id !== viewId;
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function projectOf(entry) { return state.catalog.projects.find((p) => p.id === entry?.project_id) || null; }

// --- Render -----------------------------------------------------------------

function renderRunning() {
  show("view-running");
  const entry = state.entry;
  $("#running-description").value = entry.description || "";
  const project = projectOf(entry);
  $("#running-dot").hidden = !project;
  if (project) $("#running-dot").style.background = project.color;
  $("#running-project-name").textContent = project ? project.name : t("popup_no_project");
  clearInterval(state.clockHandle);
  const tick = () => { $("#clock").textContent = formatDuration((Date.now() - new Date(entry.started_at).getTime()) / 1000); };
  tick();
  state.clockHandle = setInterval(tick, 500);
}

function renderIdle() {
  show("view-idle");
  clearInterval(state.clockHandle);
  renderProjectCombo();
  renderTaskSelect();
  renderTagChips();
  renderRecent();
  updateBillableDefault();
  // O form manual começa fechado a cada entrada na tela idle (start/stop/split).
  $("#manual-form").hidden = true;
  $("#btn-manual-toggle").hidden = false;
  $("#start-description").focus();
}

// Combobox de projeto: lista com "(sem projeto)" + projetos ativos (bolinha na
// cor); busca por substring case/acento-insensitive; setas/Enter/Esc.
const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function renderProjectCombo(filter = "") {
  const selected = state.catalog.projects.find((p) => p.id === state.projectId) || null;
  $("#project-dot").hidden = !selected;
  if (selected) $("#project-dot").style.background = selected.color;
  $("#project-label").textContent = selected ? selected.name : t("popup_no_project");

  const list = $("#project-list");
  list.innerHTML = "";
  const items = [{ id: null, name: t("popup_no_project"), color: null }]
    .concat(state.catalog.projects)
    .filter((p) => !filter || normalize(p.name).includes(normalize(filter)));
  for (const p of items) {
    const li = document.createElement("li");
    li.tabIndex = -1;
    li.dataset.id = p.id ?? "";
    if (p.color) {
      const dot = document.createElement("i"); dot.className = "dot"; dot.style.background = p.color; li.appendChild(dot);
    }
    li.appendChild(document.createTextNode(p.name));
    if ((p.id ?? null) === state.projectId) li.setAttribute("aria-selected", "true");
    li.addEventListener("click", () => selectProject(p.id ?? null));
    list.appendChild(li);
  }
}

async function selectProject(projectId) {
  state.projectId = projectId;
  state.taskId = null;
  state.tasks = [];
  $("#project-panel").hidden = true;
  if (projectId != null) {
    const res = await send("tasks:get", { projectId });
    if (res.ok) state.tasks = res.data;
  }
  renderProjectCombo();
  renderTaskSelect();
  updateBillableDefault();
}

// Select de task: só aparece com projeto escolhido E tasks disponíveis.
// Opção "(sem task)" no topo; troca atualiza state.taskId.
function renderTaskSelect() {
  const select = $("#task-select");
  const hasTasks = state.projectId != null && state.tasks.length > 0;
  select.hidden = !hasTasks;
  select.innerHTML = "";
  if (!hasTasks) return;
  const none = document.createElement("option");
  none.value = "";
  none.textContent = t("popup_no_task");
  select.appendChild(none);
  for (const task of state.tasks) {
    const opt = document.createElement("option");
    opt.value = String(task.id);
    opt.textContent = task.name;
    select.appendChild(opt);
  }
  select.value = state.taskId != null ? String(state.taskId) : "";
}

// Chips de tags ativas; clique alterna a seleção (state.tagIds + classe .chip--on).
function renderTagChips() {
  const container = $("#tag-chips");
  container.innerHTML = "";
  const tags = state.catalog.tags.filter((tag) => !tag.archived_at);
  for (const tag of tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.id = String(tag.id);
    chip.textContent = tag.name;
    if (state.tagIds.has(tag.id)) chip.classList.add("chip--on");
    chip.addEventListener("click", () => {
      if (state.tagIds.has(tag.id)) state.tagIds.delete(tag.id);
      else state.tagIds.add(tag.id);
      chip.classList.toggle("chip--on");
    });
    container.appendChild(chip);
  }
}

function updateBillableDefault() {
  // Espelha o default do servidor: billable segue a existência de rate efetiva.
  const project = state.catalog.projects.find((p) => p.id === state.projectId);
  $("#billable").checked = Boolean(project && project.effective_rate_cents != null);
}

function renderRecent() {
  // Só finalizadas; dedup por descrição+projeto mantendo a mais recente; 8 linhas.
  const seen = new Set();
  const rows = state.recent.filter((e) => e.ended_at).filter((e) => {
    const key = `${e.description || ""}|${e.project_id ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  const list = $("#recent-list");
  list.innerHTML = "";
  $("#recent-section").hidden = rows.length === 0;
  for (const e of rows) {
    const li = document.createElement("li");
    li.className = "recent-row";
    li.tabIndex = 0;
    li.title = t("popup_resume_title");

    const desc = document.createElement("span");
    desc.className = "recent-desc";
    if (e.description) {
      desc.textContent = e.description;
    } else {
      desc.textContent = t("popup_no_description");
      desc.classList.add("subtle");
    }

    const proj = document.createElement("span");
    proj.className = "recent-project";
    const p = state.catalog.projects.find((x) => x.id === e.project_id) || null;
    if (p) {
      const dot = document.createElement("i"); dot.className = "dot"; dot.style.background = p.color; proj.appendChild(dot);
    }
    proj.appendChild(document.createTextNode(p ? p.name : t("popup_no_project")));

    const dur = document.createElement("span");
    dur.className = "recent-duration tabular-nums";
    dur.textContent = formatDuration(e.duration_seconds);

    // Ícone ▶ no hover é puramente decorativo (vem via CSS ::after, aria-hidden).
    const play = document.createElement("span");
    play.className = "recent-play";
    play.setAttribute("aria-hidden", "true");

    // Ações só-hover (scissors + trash-2 do app). Dividir espelha o menu ⋮ do
    // webapp: só entries finalizadas (todas aqui são). Clica → form inline.
    const actions = document.createElement("span");
    actions.className = "recent-actions";

    const split = document.createElement("button");
    split.type = "button";
    split.className = "recent-icon recent-split-btn";
    split.title = t("popup_split_action");
    split.setAttribute("aria-label", t("popup_split_action"));
    split.innerHTML = ICON_SCISSORS;
    split.addEventListener("click", (ev) => { ev.stopPropagation(); askSplit(e, li); });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "recent-icon recent-delete";
    del.title = t("popup_delete_action");
    del.setAttribute("aria-label", t("popup_delete_action"));
    del.innerHTML = ICON_TRASH;
    del.addEventListener("click", (ev) => { ev.stopPropagation(); askDelete(e.id, li, del); });

    actions.append(split, del);
    li.append(desc, proj, dur, play, actions);
    li.addEventListener("click", () => resume(e.id));
    li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") resume(e.id); });
    list.appendChild(li);
  }
}

// Split inline (mesmo modelo do webapp: "Cortar em" + datetime-local com default
// no ponto médio + botão Dividir). Só entries finalizadas; o corte precisa cair
// ESTRITAMENTE entre started_at e ended_at (validação espelha o servidor → 422).
function askSplit(entry, li) {
  if (li.querySelector(".recent-split")) return;   // já aberto
  const started = new Date(entry.started_at), ended = new Date(entry.ended_at);
  const midpoint = new Date((started.getTime() + ended.getTime()) / 2);

  const form = document.createElement("form");
  form.className = "recent-split";
  const label = document.createElement("span");
  label.textContent = t("popup_split_at_label");
  const input = document.createElement("input");
  input.type = "datetime-local";
  input.value = toLocalInput(midpoint);
  input.min = toLocalInput(started);
  input.max = toLocalInput(ended);
  const btn = document.createElement("button");
  btn.type = "submit"; btn.textContent = t("popup_split_action");
  form.append(label, input, btn);
  form.addEventListener("click", (ev) => ev.stopPropagation());

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const cut = new Date(input.value);
    if (!(cut > started && cut < ended)) return toast(t("popup_split_bad_cut"));
    const res = await send("entry:split", { id: entry.id, cut: cut.toISOString() });
    if (res.ok) {                     // 204: re-buscar entries (o servidor não os retorna)
      toast(t("popup_split_done"));
      await loadRecent();
      renderRecent();
    } else if (res.status === 422) { toast(t("popup_split_bad_cut")); }
    else fail(res);
  });

  li.appendChild(form);
  input.focus();
}

// Troca a lixeira por "Apagar? Sim Não" na própria linha; nada de dialog nativo
// (bloqueia o service worker). Sim → DELETE; Não/blur → volta pra lixeira.
function askDelete(id, li, delBtn) {
  const confirm = document.createElement("span");
  confirm.className = "recent-confirm";
  const label = document.createElement("span");
  label.textContent = t("popup_delete_confirm");
  const yes = document.createElement("button");
  yes.type = "button"; yes.className = "yes"; yes.textContent = t("popup_delete_yes");
  const no = document.createElement("button");
  no.type = "button"; no.className = "no"; no.textContent = t("popup_delete_no");
  confirm.append(label, yes, no);

  const restore = () => { confirm.replaceWith(delBtn); };
  no.addEventListener("click", (ev) => { ev.stopPropagation(); restore(); });
  yes.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const res = await send("entry:delete", { id });
    if (res.ok) { state.recent = state.recent.filter((r) => r.id !== id); renderRecent(); toast(t("popup_deleted")); }
    else { restore(); fail(res); }
  });
  // Impede que o clique na linha (resume) dispare enquanto confirma.
  confirm.addEventListener("click", (ev) => ev.stopPropagation());
  delBtn.replaceWith(confirm);
  yes.focus();
}

async function resume(id) {
  const res = await send("entry:duplicate", { id });
  if (res.ok) { state.entry = res.data; renderRunning(); }
  else if (res.status === 409) toast(t("popup_error_conflict"));
  else fail(res);
}

// --- Ações --------------------------------------------------------------------

async function start() {
  const res = await send("timer:start", {
    description: $("#start-description").value.trim(),
    project_id: state.projectId,           // null explícito quando "(sem projeto)"
    task_id: state.taskId,
    tag_ids: [...state.tagIds],
    billable: $("#billable").checked
  });
  if (res.ok) {
    state.entry = res.data;
    if (res.warning === "extras") toast(t("popup_error_extras"));
    renderRunning();
  } else if (res.status === 409) {
    toast(t("popup_error_conflict"));      // o broadcast timer:changed re-renderiza
  } else fail(res);
}

async function stop() {
  const res = await send("timer:stop");
  if (res.ok) {
    state.entry = null;
    if (res.status === 204) toast(t("popup_discarded"));
    await loadRecent();
    renderIdle();
  } else if (res.status === 404) { state.entry = null; renderIdle(); }
  else fail(res);
}

// --- Lançamento manual de tempo ----------------------------------------------

function openManual() {
  $("#manual-form").hidden = false;
  $("#btn-manual-toggle").hidden = true;
  // Sugestão gentil: fim = agora, início = 1h atrás (valores locais pro input).
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3600 * 1000);
  $("#manual-start").value = toLocalInput(hourAgo);
  $("#manual-end").value = toLocalInput(now);
  syncDurationFromRange();
  $("#manual-description").focus();
}

function closeManual() {
  $("#manual-form").hidden = true;
  $("#btn-manual-toggle").hidden = false;
  $("#manual-form").reset();
}

// --- Campos ligados início·fim·duração (porta fiel do duration-fields do webapp)
// Editar início/fim → recalcula duração. Editar duração → recalcula fim. O campo
// duração é auxiliar: NÃO é enviado ao servidor (só início/fim reais viajam).

// Editou início ou fim: se ambos válidos e fim>início, atualiza a duração exibida.
function syncDurationFromRange() {
  const start = parseLocal($("#manual-start").value);
  const end = parseLocal($("#manual-end").value);
  if (!start || !end || end <= start) return;
  $("#manual-duration").value = formatDurationClock(Math.round((end - start) / 60000));
}

// Editou a duração: se início e duração válidos, recalcula fim = início + duração.
function syncEndFromDuration() {
  const start = parseLocal($("#manual-start").value);
  const minutes = parseDuration($("#manual-duration").value);
  if (!start || minutes === null) return;
  $("#manual-end").value = toLocalInput(new Date(start.getTime() + minutes * 60000));
}

function parseLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// "2:30" · "2h30" · "2h30m" · "2h" · "30m" · "90" · "2.5h" → minutos | null.
function parseDuration(raw) {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const clock = text.match(/^(\d+):([0-5]?\d)$/);
  if (clock) return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);
  const hm = text.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m?)?$/);
  if (hm && (hm[1] || hm[2])) {
    const total = Math.round((hm[1] ? parseFloat(hm[1]) : 0) * 60) + (hm[2] ? parseInt(hm[2], 10) : 0);
    return total > 0 ? total : null;
  }
  return null;
}

function formatDurationClock(totalMinutes) {
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

// datetime-local usa horário LOCAL sem timezone; o input devolve "YYYY-MM-DDTHH:mm".
// Convertemos pra Date (interpretada como local) e mandamos ISO com offset pro servidor.
function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function saveManual(ev) {
  ev.preventDefault();
  const startRaw = $("#manual-start").value;
  const endRaw = $("#manual-end").value;
  if (!startRaw || !endRaw) return toast(t("popup_manual_incomplete"));
  const started = new Date(startRaw), ended = new Date(endRaw);
  if (!(ended > started)) return toast(t("popup_manual_bad_range"));

  const attrs = {
    description: $("#manual-description").value.trim(),
    project_id: state.projectId,
    task_id: state.taskId,
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    billable: $("#billable").checked
  };
  const tagIds = [...state.tagIds];
  if (tagIds.length) attrs.tag_ids = tagIds;

  const res = await send("entry:create", { attrs });
  if (res.ok) {
    toast(t("popup_manual_saved"));
    closeManual();
    await loadRecent();
    renderRecent();
  } else fail(res);
}

function fail(res) {
  // Sem config: manda pro setup, não pra tela de erro.
  if (res.error === "unconfigured") return show("view-setup");
  show("view-error");
  const auth = res.error === "auth";
  // Erros conhecidos têm cópia própria; para os demais, mostra a mensagem crua
  // do servidor (ex.: motivos de 422) em vez do genérico de rede.
  let message;
  if (auth) message = t("popup_error_auth");
  else if (!res.error || res.error === "network" || res.error === "badresponse") message = t("popup_error_network");
  else message = res.error;
  $("#error-message").textContent = message;
  $("#btn-error-configure").hidden = !auth;
}

let toastHandle;
function toast(text) {
  const el = $("#toast");
  el.textContent = text; el.hidden = false;
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => { el.hidden = true; }, 2500);
}

// --- Boot ---------------------------------------------------------------------

async function loadRecent() { const r = await send("entries:recent"); if (r.ok) state.recent = r.data; }

// Aplica tema/acento do servidor no <html>. theme "system" (ou ausente) remove o
// override e deixa o color-scheme seguir o SO. Tolera prefs parciais/ausentes.
function applyPrefs(prefs) {
  const root = document.documentElement;
  const theme = prefs?.theme;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  const accent = prefs?.accent;
  if (accent && accent !== "teal") root.setAttribute("data-accent", accent);
  else root.removeAttribute("data-accent");
}

// Tema na abertura: aplica o cache na hora (sem flash) e revalida com o servidor.
async function bootPrefs() {
  const { prefsCache } = await chrome.storage.local.get("prefsCache");
  if (prefsCache?.data) applyPrefs(prefsCache.data);
  const res = await send("prefs:get");
  if (res.ok) applyPrefs(res.data);
}

async function boot() {
  bootPrefs();                 // não bloqueia o resto do boot; tema entra assim que resolver
  const cfg = await send("config:get");
  if (!cfg.ok || !cfg.data.configured) {
    // Sem config o link do rodapé não tem destino: esconde pra não ficar morto.
    $("#link-app").hidden = true;
    return show("view-setup");
  }
  send("app:url").then((res) => { if (res.ok) $("#link-app").href = res.data; });
  const [timer, catalog] = await Promise.all([send("timer:get"), send("catalog:get")]);
  if (!timer.ok) return fail(timer);
  if (catalog.ok) state.catalog = catalog.data;
  const defaultProject = state.catalog.projects.find((p) => p.default);
  if (defaultProject) await selectProject(defaultProject.id);
  await loadRecent();
  state.entry = timer.data;
  state.entry ? renderRunning() : renderIdle();
}

// Mudança vinda de fora (atalho, app, 409 re-sync): re-renderizar.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "timer:changed") return;
  state.entry = msg.data;
  state.entry ? renderRunning() : (loadRecent().then(renderIdle));
});

// --- Listeners ----------------------------------------------------------------

// Botões que abrem as Preferências (options): setup, erro de auth e engrenagem.
for (const id of ["btn-configure", "btn-error-configure", "btn-options"]) {
  $("#" + id).addEventListener("click", () => chrome.runtime.openOptionsPage());
}
$("#btn-retry").addEventListener("click", boot);
$("#btn-start").addEventListener("click", start);
$("#btn-stop").addEventListener("click", stop);
$("#btn-manual-toggle").addEventListener("click", openManual);
$("#btn-manual-cancel").addEventListener("click", closeManual);
$("#manual-form").addEventListener("submit", saveManual);
// Campos ligados: início/fim recalculam duração; duração recalcula fim.
$("#manual-start").addEventListener("input", syncDurationFromRange);
$("#manual-end").addEventListener("input", syncDurationFromRange);
$("#manual-duration").addEventListener("input", syncEndFromDuration);

// Enter na descrição (parado) dispara o start.
$("#start-description").addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });

// Descrição da entry rodando: blur/Enter (change) persiste via entry:update.
$("#running-description").addEventListener("change", () => {
  const description = $("#running-description").value.trim();
  if (state.entry) {
    state.entry.description = description;
    send("entry:update", { id: state.entry.id, attrs: { description } });
  }
});

// Troca de task atualiza o state (delegado uma vez; o select é reconstruído a cada render).
$("#task-select").addEventListener("change", (e) => {
  state.taskId = e.target.value ? Number(e.target.value) : null;
});

// Combobox de projeto: abre/fecha o painel e foca a busca.
const projectPanel = $("#project-panel");
$("#project-trigger").addEventListener("click", () => {
  const willOpen = projectPanel.hidden;
  projectPanel.hidden = !willOpen;
  if (willOpen) {
    $("#project-search").value = "";
    renderProjectCombo();
    $("#project-search").focus();
  }
});
$("#project-search").addEventListener("input", (e) => renderProjectCombo(e.target.value));

// Teclado no combo: ArrowDown/Up movem o foco entre os <li>, Enter seleciona, Esc fecha.
projectPanel.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    projectPanel.hidden = true;
    $("#project-trigger").focus();
    return;
  }
  const items = [...$("#project-list").querySelectorAll("li")];
  if (items.length === 0) return;
  const current = document.activeElement.closest ? document.activeElement.closest("li") : null;
  let idx = items.indexOf(current);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    idx = idx < items.length - 1 ? idx + 1 : 0;
    items[idx].focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    idx = idx > 0 ? idx - 1 : items.length - 1;
    items[idx].focus();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const target = current || items[0];
    selectProject(target.dataset.id ? Number(target.dataset.id) : null);
  }
});

// Clique fora do combo fecha o painel.
document.addEventListener("click", (e) => {
  if (!$("#project-combo").contains(e.target)) projectPanel.hidden = true;
});

boot();
