// Popup do Ponto — timer + ledger por dia. Um compose card que morfa entre
// timer / rodando / manual; abaixo, o histórico agrupado por dia (Clockify-like).
// Fala com o service worker via chrome.runtime.sendMessage; sem estado remoto próprio.

const t = (key, subs) => chrome.i18n.getMessage(key, subs);
const $ = (sel) => document.querySelector(sel);
const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });

// Ícones do Lucide (mesmos do app Ponto); currentColor herda a cor do texto.
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICON_SCISSORS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';

// Traduz textos e placeholders declarados no HTML (sem string de UI hardcoded).
document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });

// Rótulos acessíveis para controles sem <label> visível.
$("#description").setAttribute("aria-label", t("popup_description_placeholder"));
$("#project-trigger").setAttribute("aria-label", t("popup_project_label"));
$("#tags-trigger").setAttribute("aria-label", t("popup_tags_label"));
$("#btn-billable").setAttribute("aria-label", t("popup_billable"));
$("#btn-billable").title = t("popup_billable");
$("#btn-refresh").setAttribute("aria-label", t("popup_refresh"));
$("#btn-refresh").title = t("popup_refresh");
$("#link-app").setAttribute("aria-label", t("popup_open_app"));
$("#link-app").title = t("popup_open_app");
$("#btn-options").title = t("popup_preferences");
$("#btn-options").setAttribute("aria-label", t("popup_preferences"));
$("#manual-start-time").setAttribute("aria-label", t("popup_manual_start"));
$("#manual-end-time").setAttribute("aria-label", t("popup_manual_end"));
$("#manual-date").setAttribute("aria-label", t("popup_manual_start"));
$("#manual-duration").setAttribute("aria-label", t("popup_manual_duration"));

const state = {
  entry: null,            // entry rodando ou null
  catalog: { projects: [], tags: [] },
  tasks: [],              // tasks do projeto selecionado
  entries: [],            // 1ª página do histórico (finalizadas), started_at DESC
  entriesPage: null,      // paginação do /time_entries (X-Total-*) ou null
  projectId: null, taskId: null, tagIds: new Set(),
  mode: "timer",          // "timer" | "manual"
  clockHandle: null
};

function show(viewId) {
  for (const id of ["view-setup", "view-error", "view-main"]) $("#" + id).hidden = id !== viewId;
}

// --- Formatação ---------------------------------------------------------------

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
// Total de dia/semana: "18:42" (sem segundos).
function formatHM(totalSeconds) {
  const m = Math.round(totalSeconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
function formatClockTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function projectOf(entry) { return state.catalog.projects.find((p) => p.id === entry?.project_id) || null; }

// --- Compose card: estados (timer / rodando / manual) -------------------------

function renderCompose() {
  const card = $("#compose");
  const running = Boolean(state.entry);
  card.dataset.running = running ? "true" : "false";
  card.dataset.mode = state.mode;

  // Visibilidade por estado.
  $("#compose-eyebrow").hidden = !(state.mode === "manual" && !running);
  $("#meta-row").hidden = running;                 // rodando → resumo read-only
  $("#run-summary").hidden = !running;
  $("#run-timer").hidden = !running;
  $("#manual-times").hidden = running || state.mode !== "manual";
  $("#btn-primary").hidden = false;

  // Ícone do botão redondo: ■ rodando · ＋ manual · ▶ timer.
  const play = $("#btn-primary .ico-play");
  const stop = $("#btn-primary .ico-stop");
  const add = $("#btn-primary .ico-add");
  play.hidden = running || state.mode === "manual";
  stop.hidden = !running;
  add.hidden = running || state.mode !== "manual";
  $("#btn-primary").setAttribute("aria-label",
    running ? t("popup_stop") : state.mode === "manual" ? t("popup_manual_save") : t("popup_start"));

  // Ícone do toggle de modo (relógio no manual → volta pro timer).
  $("#btn-mode .ico-mode-manual").hidden = state.mode === "manual";
  $("#btn-mode .ico-mode-timer").hidden = state.mode !== "manual";
  $("#btn-mode").setAttribute("aria-label", state.mode === "manual" ? t("popup_mode_timer") : t("popup_mode_manual"));
  $("#btn-mode").title = $("#btn-mode").getAttribute("aria-label");
  $("#btn-mode").hidden = running;

  if (running) renderRunning();
  else { renderProjectChip(); renderTagsChip(); renderBillableChip(); }
}

function renderRunning() {
  const entry = state.entry;
  $("#description").value = entry.description || "";

  // Resumo read-only: dot · projeto · tags · $
  const summary = $("#run-summary");
  summary.innerHTML = "";
  const project = projectOf(entry);
  if (project) {
    const dot = document.createElement("i"); dot.className = "dot"; dot.style.background = project.color;
    summary.appendChild(dot);
  }
  const parts = [project ? project.name : t("popup_no_project")];
  const tagNames = (entry.tags || []).map((x) => x.name);
  if (tagNames.length) parts.push(tagNames.join(", "));
  if (entry.billable) parts.push("$");
  summary.appendChild(document.createTextNode(parts.join(" · ")));

  $("#run-started").textContent = t("popup_started_at", formatClockTime(new Date(entry.started_at)));

  clearInterval(state.clockHandle);
  const tick = () => { $("#clock").textContent = formatDuration((Date.now() - new Date(entry.started_at).getTime()) / 1000); };
  tick();
  state.clockHandle = setInterval(tick, 500);
}

// --- Meta chips ---------------------------------------------------------------

function renderProjectChip() {
  const selected = state.catalog.projects.find((p) => p.id === state.projectId) || null;
  const task = selected && state.taskId != null ? state.tasks.find((x) => x.id === state.taskId) : null;
  $("#project-dot").hidden = !selected;
  if (selected) $("#project-dot").style.background = selected.color;
  const label = $("#project-label");
  const trigger = $("#project-trigger");
  if (selected) {
    label.textContent = task ? `${selected.name} · ${task.name}` : selected.name;
    trigger.classList.remove("is-empty");
  } else {
    label.textContent = t("popup_project_label");
    trigger.classList.add("is-empty");
  }
}

function renderTagsChip() {
  const chip = $("#tags-trigger");
  const label = $("#tags-label");
  const selected = state.catalog.tags.filter((tag) => state.tagIds.has(tag.id));
  if (selected.length === 0) {
    label.textContent = "";
    chip.classList.add("is-empty");
  } else if (selected.length <= 2) {
    label.textContent = selected.map((x) => x.name).join(", ");
    chip.classList.remove("is-empty");
  } else {
    label.textContent = `${selected[0].name} +${selected.length - 1}`;
    chip.classList.remove("is-empty");
  }
}

function renderBillableChip() {
  const project = state.catalog.projects.find((p) => p.id === state.projectId);
  const on = $("#btn-billable").getAttribute("aria-pressed") === "true";
  // Só define default automaticamente quando não houve toque manual (data-touched).
  if (!$("#btn-billable").dataset.touched) {
    const def = Boolean(project && project.effective_rate_cents != null);
    $("#btn-billable").setAttribute("aria-pressed", def ? "true" : "false");
  } else {
    $("#btn-billable").setAttribute("aria-pressed", on ? "true" : "false");
  }
}
function billableOn() { return $("#btn-billable").getAttribute("aria-pressed") === "true"; }

// --- Combobox de projeto (dobra em tasks) -------------------------------------

const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// O painel de projeto tem duas telas: "projects" e "tasks" (após escolher um
// projeto com tasks). state guardado no dataset do painel.
function renderProjectPanel(filter = "") {
  const panel = $("#project-panel");
  const list = $("#project-list");
  list.innerHTML = "";

  if (panel.dataset.screen === "tasks") {
    const sub = document.createElement("li");
    sub.className = "combo-subhead";
    sub.textContent = t("popup_tasks_head");
    sub.style.cursor = "default";
    list.appendChild(sub);
    const items = [{ id: null, name: t("popup_no_task") }].concat(state.tasks)
      .filter((x) => !filter || normalize(x.name).includes(normalize(filter)));
    for (const task of items) {
      const li = document.createElement("li");
      li.tabIndex = -1;
      li.dataset.taskId = task.id ?? "";
      li.appendChild(document.createTextNode(task.name));
      if ((task.id ?? null) === state.taskId) li.setAttribute("aria-selected", "true");
      const check = document.createElement("span"); check.className = "check"; check.textContent = "✓";
      li.appendChild(check);
      li.addEventListener("click", () => selectTask(task.id ?? null));
      list.appendChild(li);
    }
    return;
  }

  const items = [{ id: null, name: t("popup_no_project"), color: null }]
    .concat(state.catalog.projects)
    .filter((p) => !filter || normalize(p.name).includes(normalize(filter)));
  for (const p of items) {
    const li = document.createElement("li");
    li.tabIndex = -1;
    li.dataset.id = p.id ?? "";
    if (p.color) { const dot = document.createElement("i"); dot.className = "dot"; dot.style.background = p.color; li.appendChild(dot); }
    li.appendChild(document.createTextNode(p.name));
    if ((p.id ?? null) === state.projectId) li.setAttribute("aria-selected", "true");
    const check = document.createElement("span"); check.className = "check"; check.textContent = "✓";
    li.appendChild(check);
    li.addEventListener("click", () => selectProject(p.id ?? null));
    list.appendChild(li);
  }
}

async function selectProject(projectId) {
  state.projectId = projectId;
  state.taskId = null;
  state.tasks = [];
  if (projectId != null) {
    const res = await send("tasks:get", { projectId });
    if (res.ok) state.tasks = res.data;
  }
  renderProjectChip();
  renderBillableChip();
  // Se o projeto tem tasks, dobra o painel pra escolher a task; senão fecha.
  const panel = $("#project-panel");
  if (state.tasks.length > 0) {
    panel.dataset.screen = "tasks";
    $("#project-search").value = "";
    renderProjectPanel();
    $("#project-search").focus();
  } else {
    panel.hidden = true;
    panel.dataset.screen = "projects";
  }
}

function selectTask(taskId) {
  state.taskId = taskId;
  const panel = $("#project-panel");
  panel.hidden = true;
  panel.dataset.screen = "projects";
  renderProjectChip();
}

// --- Painel de tags (checklist) ----------------------------------------------

function renderTagsPanel(filter = "") {
  const list = $("#tags-list");
  list.innerHTML = "";
  const tags = state.catalog.tags.filter((tag) => !tag.archived_at)
    .filter((tag) => !filter || normalize(tag.name).includes(normalize(filter)));
  for (const tag of tags) {
    const li = document.createElement("li");
    li.tabIndex = -1;
    li.dataset.id = String(tag.id);
    li.appendChild(document.createTextNode(tag.name));
    if (state.tagIds.has(tag.id)) li.setAttribute("aria-selected", "true");
    const check = document.createElement("span"); check.className = "check"; check.textContent = "✓";
    li.appendChild(check);
    li.addEventListener("click", () => {
      if (state.tagIds.has(tag.id)) { state.tagIds.delete(tag.id); li.removeAttribute("aria-selected"); }
      else { state.tagIds.add(tag.id); li.setAttribute("aria-selected", "true"); }
      renderTagsChip();
    });
    list.appendChild(li);
  }
}

// --- Ledger por dia -----------------------------------------------------------

function dayKey(date) { return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }

function dayLabel(date) {
  const now = new Date();
  const today = dayKey(now);
  const yest = dayKey(new Date(now.getTime() - 86400000));
  const k = dayKey(date);
  if (k === today) return t("popup_today");
  if (k === yest) return t("popup_yesterday");
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

// Semana começa na segunda (padrão do app). Retorna epoch ms do início da semana.
function startOfWeek(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7;         // 0 = segunda
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

function renderLedger() {
  const ledger = $("#ledger");
  ledger.innerHTML = "";
  const finished = state.entries.filter((e) => e.ended_at && e.duration_seconds != null);

  $("#ledger-empty").hidden = finished.length > 0;
  $("#week-line").hidden = finished.length === 0;
  if (finished.length === 0) return;

  // Total da semana atual. O /time_entries é PAGINADO (Q73): temos só a 1ª página
  // (started_at DESC, até 100). A semana atual é a mais recente → coberta, EXCETO
  // se a página foi truncada E a entry mais antiga ainda cai dentro da semana (a
  // própria semana passou de uma página). Nesse caso não afirmamos total errado:
  // rotula "Recentes" sem número. Na prática, com 100 entries, quase nunca dispara.
  const weekStart = startOfWeek(new Date());
  const oldest = new Date(finished[finished.length - 1].started_at).getTime();
  const truncated = state.entriesPage?.nextPage != null;
  const weekCovered = !truncated || oldest < weekStart;

  const label = $("#week-line").querySelector(".week-label");
  const totalEl = $("#week-total");
  if (weekCovered) {
    const weekTotal = finished
      .filter((e) => new Date(e.started_at).getTime() >= weekStart)
      .reduce((sum, e) => sum + e.duration_seconds, 0);
    label.textContent = t("popup_this_week");
    totalEl.textContent = formatHM(weekTotal);
    totalEl.hidden = false;
  } else {
    label.textContent = t("popup_recent_label");
    totalEl.hidden = true;
  }

  // Agrupa por dia (started_at DESC já vem do servidor).
  const groups = new Map();
  for (const e of finished) {
    const k = dayKey(new Date(e.started_at));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  for (const [, rows] of groups) {
    const group = document.createElement("div");
    group.className = "day-group";
    const total = rows.reduce((sum, e) => sum + e.duration_seconds, 0);

    const head = document.createElement("div");
    head.className = "day-header";
    const name = document.createElement("span");
    name.className = "day-name";
    name.textContent = dayLabel(new Date(rows[0].started_at));
    const dtot = document.createElement("span");
    dtot.className = "day-total tabular-nums";
    dtot.textContent = formatHM(total);
    head.append(name, dtot);
    group.appendChild(head);

    for (const e of rows) group.appendChild(renderEntryRow(e));
    ledger.appendChild(group);
  }
}

function renderEntryRow(e) {
  const li = document.createElement("div");
  li.className = "entry-row";
  li.tabIndex = 0;
  li.title = t("popup_resume_title");

  const desc = document.createElement("span");
  desc.className = "entry-desc";
  if (e.description) desc.textContent = e.description;
  else { desc.textContent = t("popup_no_description"); desc.classList.add("subtle"); }

  const proj = document.createElement("span");
  proj.className = "entry-project";
  const p = state.catalog.projects.find((x) => x.id === e.project_id) || null;
  if (p) { const dot = document.createElement("i"); dot.className = "dot"; dot.style.background = p.color; proj.appendChild(dot); }
  proj.appendChild(document.createTextNode(p ? p.name : t("popup_no_project")));

  const dur = document.createElement("span");
  dur.className = "entry-duration tabular-nums";
  dur.textContent = formatDuration(e.duration_seconds);

  // Ações sobre o hover (scrim): ▶ retomar + ⋮ menu.
  const actions = document.createElement("span");
  actions.className = "entry-actions";

  const resume = document.createElement("button");
  resume.type = "button";
  resume.className = "entry-icon entry-resume";
  resume.title = t("popup_resume_action");
  resume.setAttribute("aria-label", t("popup_resume_action"));
  resume.innerHTML = ICON_PLAY;
  resume.addEventListener("click", (ev) => { ev.stopPropagation(); resumeEntry(e.id); });

  const more = document.createElement("button");
  more.type = "button";
  more.className = "entry-icon entry-more";
  more.title = t("popup_menu_more");
  more.setAttribute("aria-label", t("popup_menu_more"));
  more.innerHTML = ICON_MORE;
  more.addEventListener("click", (ev) => { ev.stopPropagation(); toggleEntryMenu(e, li, more); });

  actions.append(resume, more);
  li.append(desc, proj, dur, actions);
  li.addEventListener("click", () => resumeEntry(e.id));
  li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") resumeEntry(e.id); });
  return li;
}

// Menu ⋮: Continuar / Dividir / Excluir. Fecha ao clicar fora.
function toggleEntryMenu(entry, row, anchor) {
  const existing = row.querySelector(".entry-menu");
  if (existing) { existing.remove(); return; }
  document.querySelectorAll(".entry-menu").forEach((m) => m.remove());

  const menu = document.createElement("div");
  menu.className = "entry-menu";
  menu.addEventListener("click", (ev) => ev.stopPropagation());

  const mkBtn = (label, icon, cls, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    if (cls) b.className = cls;
    b.innerHTML = (icon || "") + `<span>${label}</span>`;
    b.addEventListener("click", fn);
    return b;
  };

  const cont = mkBtn(t("popup_resume_action"), ICON_PLAY, "", () => { menu.remove(); resumeEntry(entry.id); });
  const split = mkBtn(t("popup_split_action"), ICON_SCISSORS, "", () => { menu.remove(); askSplit(entry, row); });
  const del = mkBtn(t("popup_delete_action"), ICON_TRASH, "danger", () => {
    menu.innerHTML = "";
    const confirm = document.createElement("div");
    confirm.className = "entry-confirm";
    const q = document.createElement("div"); q.textContent = t("popup_delete_confirm");
    const acts = document.createElement("div"); acts.className = "actions";
    const yes = document.createElement("button"); yes.className = "yes"; yes.textContent = t("popup_delete_yes");
    const no = document.createElement("button"); no.textContent = t("popup_delete_no");
    no.addEventListener("click", () => menu.remove());
    yes.addEventListener("click", async () => {
      const res = await send("entry:delete", { id: entry.id });
      menu.remove();
      if (res.ok) { state.entries = state.entries.filter((r) => r.id !== entry.id); renderLedger(); toast(t("popup_deleted")); }
      else fail(res);
    });
    acts.append(yes, no); confirm.append(q, acts); menu.append(confirm); yes.focus();
  });

  menu.append(cont, split, del);
  row.appendChild(menu);
}

// Split inline (mesmo modelo do webapp: "Cortar em" + datetime-local no ponto
// médio + botão Dividir). O corte precisa cair ESTRITAMENTE entre início e fim.
function askSplit(entry, row) {
  if (row.querySelector(".entry-split")) return;
  const started = new Date(entry.started_at), ended = new Date(entry.ended_at);
  const midpoint = new Date((started.getTime() + ended.getTime()) / 2);

  const form = document.createElement("form");
  form.className = "entry-split";
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
    if (res.ok) { toast(t("popup_split_done")); await loadEntries(); renderLedger(); }
    else if (res.status === 422) toast(t("popup_split_bad_cut"));
    else fail(res);
  });

  row.appendChild(form);
  input.focus();
}

async function resumeEntry(id) {
  const res = await send("entry:duplicate", { id });
  if (res.ok) { state.entry = res.data; renderCompose(); }
  else if (res.status === 409) toast(t("popup_error_conflict"));
  else fail(res);
}

// --- Ações do timer -----------------------------------------------------------

async function start() {
  const res = await send("timer:start", {
    description: $("#description").value.trim(),
    project_id: state.projectId,
    task_id: state.taskId,
    tag_ids: [...state.tagIds],
    billable: billableOn()
  });
  if (res.ok) {
    state.entry = res.data;
    if (res.warning === "extras") toast(t("popup_error_extras"));
    renderCompose();
  } else if (res.status === 409) toast(t("popup_error_conflict"));
  else fail(res);
}

async function stop() {
  const res = await send("timer:stop");
  if (res.ok) {
    state.entry = null;
    if (res.status === 204) toast(t("popup_discarded"));
    await loadEntries();
    enterIdle();
  } else if (res.status === 404) { state.entry = null; enterIdle(); }
  else fail(res);
}

// --- Modo manual --------------------------------------------------------------

function toggleMode() {
  state.mode = state.mode === "manual" ? "timer" : "manual";
  if (state.mode === "manual") {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600 * 1000);
    $("#manual-start-time").value = toTimeInput(hourAgo);
    $("#manual-end-time").value = toTimeInput(now);
    $("#manual-date").value = toDateInput(now);
    syncDurationFromRange();
  }
  renderCompose();
  $("#description").focus();
}

async function saveManual() {
  const date = $("#manual-date").value;
  const st = $("#manual-start-time").value;
  const et = $("#manual-end-time").value;
  if (!date || !st || !et) return toast(t("popup_manual_incomplete"));
  const started = new Date(`${date}T${st}`);
  let ended = new Date(`${date}T${et}`);
  // Fim antes do início ⇒ atravessou meia-noite: soma 1 dia.
  if (ended <= started) ended = new Date(ended.getTime() + 86400000);
  if (!(ended > started)) return toast(t("popup_manual_bad_range"));

  const attrs = {
    description: $("#description").value.trim(),
    project_id: state.projectId,
    task_id: state.taskId,
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    billable: billableOn()
  };
  const tagIds = [...state.tagIds];
  if (tagIds.length) attrs.tag_ids = tagIds;

  const res = await send("entry:create", { attrs });
  if (res.ok) {
    toast(t("popup_manual_saved"));
    state.mode = "timer";
    $("#description").value = "";
    await loadEntries();
    renderCompose();
    renderLedger();
  } else fail(res);
}

// Botão redondo: despacha conforme o estado.
function primaryAction() {
  if (state.entry) return stop();
  if (state.mode === "manual") return saveManual();
  return start();
}

// --- Campos ligados início·fim·duração (porta fiel do duration-fields) --------

function syncDurationFromRange() {
  const start = timeToMinutes($("#manual-start-time").value);
  let end = timeToMinutes($("#manual-end-time").value);
  if (start == null || end == null) return;
  if (end <= start) end += 1440;              // atravessa meia-noite
  $("#manual-duration").value = formatDurationClock(end - start);
}
function syncEndFromDuration() {
  const start = timeToMinutes($("#manual-start-time").value);
  const minutes = parseDuration($("#manual-duration").value);
  if (start == null || minutes == null) return;
  $("#manual-end-time").value = minutesToTime((start + minutes) % 1440);
}
function timeToMinutes(v) {
  if (!v) return null;
  const [h, m] = v.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}
function minutesToTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// "2:30" · "2h30" · "2h" · "30m" · "90" · "2.5h" → minutos | null.
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
function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toTimeInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toDateInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// --- Erros / toast ------------------------------------------------------------

function fail(res) {
  if (res.error === "unconfigured") return show("view-setup");
  show("view-error");
  const auth = res.error === "auth";
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

async function loadEntries() {
  const r = await send("entries:recent");
  if (r.ok) { state.entries = r.data; state.entriesPage = r.page || null; }
}

function enterIdle() {
  clearInterval(state.clockHandle);
  show("view-main");
  renderCompose();
  renderLedger();
  $("#description").focus();
}

function applyPrefs(prefs) {
  const root = document.documentElement;
  const theme = prefs?.theme;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  const accent = prefs?.accent;
  if (accent && accent !== "teal") root.setAttribute("data-accent", accent);
  else root.removeAttribute("data-accent");
}

async function bootPrefs() {
  const { prefsCache } = await chrome.storage.local.get("prefsCache");
  if (prefsCache?.data) applyPrefs(prefsCache.data);
  const res = await send("prefs:get");
  if (res.ok) applyPrefs(res.data);
}

async function boot() {
  bootPrefs();
  const cfg = await send("config:get");
  if (!cfg.ok || !cfg.data.configured) return show("view-setup");
  send("app:url").then((res) => { if (res.ok) $("#link-app").href = res.data; });
  const [timer, catalog] = await Promise.all([send("timer:get"), send("catalog:get")]);
  if (!timer.ok) return fail(timer);
  if (catalog.ok) state.catalog = catalog.data;
  const defaultProject = state.catalog.projects.find((p) => p.default);
  if (defaultProject) await selectProject(defaultProject.id);
  await loadEntries();
  state.entry = timer.data;
  show("view-main");
  renderCompose();
  renderLedger();
  if (!state.entry) $("#description").focus();
}

// Mudança externa (atalho, app, 409 re-sync): re-render.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "timer:changed") return;
  state.entry = msg.data;
  if (state.entry) { show("view-main"); renderCompose(); }
  else loadEntries().then(enterIdle);
});

// --- Listeners ----------------------------------------------------------------

for (const id of ["btn-configure", "btn-error-configure", "btn-options"]) {
  $("#" + id).addEventListener("click", () => chrome.runtime.openOptionsPage());
}
$("#btn-retry").addEventListener("click", boot);
$("#btn-refresh").addEventListener("click", async () => {
  const [timer, catalog] = await Promise.all([send("timer:get"), send("catalog:get")]);
  if (catalog.ok) state.catalog = catalog.data;
  if (timer.ok) state.entry = timer.data;
  await loadEntries();
  renderCompose();
  renderLedger();
  toast(t("popup_refresh"));
});
$("#btn-primary").addEventListener("click", primaryAction);
$("#btn-mode").addEventListener("click", toggleMode);

$("#btn-billable").addEventListener("click", () => {
  const on = billableOn();
  $("#btn-billable").dataset.touched = "1";
  $("#btn-billable").setAttribute("aria-pressed", on ? "false" : "true");
});

// Campos manuais ligados.
$("#manual-start-time").addEventListener("input", syncDurationFromRange);
$("#manual-end-time").addEventListener("input", syncDurationFromRange);
$("#manual-duration").addEventListener("input", syncEndFromDuration);

// Enter na descrição: dispara a ação primária do modo atual.
$("#description").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (state.entry) {
    // Rodando: Enter persiste a descrição (blur também persiste via change).
    $("#description").blur();
  } else primaryAction();
});
// Descrição da entry rodando: persiste via entry:update.
$("#description").addEventListener("change", () => {
  if (!state.entry) return;
  const description = $("#description").value.trim();
  state.entry.description = description;
  send("entry:update", { id: state.entry.id, attrs: { description } });
});

// Combobox de projeto: abre/fecha (sempre volta pra tela de projetos ao abrir).
const projectPanel = $("#project-panel");
$("#project-trigger").addEventListener("click", () => {
  const willOpen = projectPanel.hidden;
  $("#tags-panel").hidden = true;
  projectPanel.hidden = !willOpen;
  if (willOpen) {
    projectPanel.dataset.screen = "projects";
    $("#project-search").value = "";
    renderProjectPanel();
    $("#project-search").focus();
  }
});
$("#project-search").addEventListener("input", (e) => renderProjectPanel(e.target.value));

// Painel de tags.
const tagsPanel = $("#tags-panel");
$("#tags-trigger").addEventListener("click", () => {
  const willOpen = tagsPanel.hidden;
  projectPanel.hidden = true;
  tagsPanel.hidden = !willOpen;
  if (willOpen) { $("#tags-search").value = ""; renderTagsPanel(); $("#tags-search").focus(); }
});
$("#tags-search").addEventListener("input", (e) => renderTagsPanel(e.target.value));

// Teclado no combo de projeto: setas/Enter/Esc.
projectPanel.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); projectPanel.hidden = true; $("#project-trigger").focus(); return; }
  const items = [...$("#project-list").querySelectorAll("li:not(.combo-subhead)")];
  if (items.length === 0) return;
  const current = document.activeElement.closest ? document.activeElement.closest("li") : null;
  let idx = items.indexOf(current);
  if (e.key === "ArrowDown") { e.preventDefault(); idx = idx < items.length - 1 ? idx + 1 : 0; items[idx].focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); idx = idx > 0 ? idx - 1 : items.length - 1; items[idx].focus(); }
  else if (e.key === "Enter") { e.preventDefault(); (current || items[0]).click(); }
});
tagsPanel.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); tagsPanel.hidden = true; $("#tags-trigger").focus(); }
});

// Clique fora fecha painéis e menus de linha.
document.addEventListener("click", (e) => {
  if (!$("#project-combo").contains(e.target)) { projectPanel.hidden = true; projectPanel.dataset.screen = "projects"; }
  if (!$("#tags-combo").contains(e.target)) tagsPanel.hidden = true;
  if (!e.target.closest(".entry-row")) document.querySelectorAll(".entry-menu").forEach((m) => m.remove());
});

boot();
