// Cliente da API JSON do Ponto (contrato Q73). Usado SÓ pelo background —
// host permissions fazem o fetch passar sem CORS. Envelope uniforme:
// {ok:true, status, data} | {ok:false, status, error}.

async function request(config, method, path, body = undefined) {
  const url = config.apiUrl.replace(/\/+$/, "") + path;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.token}`
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Redirect = página de login HTML; nunca é sucesso pra um client JSON.
      redirect: "manual"
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }

  if (response.type === "opaqueredirect") return { ok: false, status: 401, error: "auth" };
  if (response.status === 401) return { ok: false, status: 401, error: "auth" };
  if (response.status === 204) return { ok: true, status: 204, data: null };

  let payload = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); }
    catch { return { ok: false, status: response.status, error: "badresponse" }; }
  }

  if (response.ok) return { ok: true, status: response.status, data: payload };

  const error = payload?.error || (payload?.errors || []).join(", ") || `HTTP ${response.status}`;
  return { ok: false, status: response.status, error };
}

export const api = {
  getTimer: (cfg) => request(cfg, "GET", "/timer"),
  // Chave project_id SEMPRE presente (contrato de 06/07: ausente ativaria o
  // projeto-padrão do servidor; a extensão manda a escolha explícita, mesmo null).
  startTimer: (cfg, { description, project_id, task_id }) =>
    request(cfg, "POST", "/timer", { timer: { description: description ?? "", project_id: project_id ?? null, task_id: task_id ?? null } }),
  stopTimer: (cfg) => request(cfg, "DELETE", "/timer"),
  updateEntry: (cfg, id, attrs) => request(cfg, "PATCH", `/time_entries/${id}`, { time_entry: attrs }),
  recentEntries: (cfg) => request(cfg, "GET", "/time_entries"),
  duplicateEntry: (cfg, id) => request(cfg, "POST", `/time_entries/${id}/duplicate`),
  projects: (cfg) => request(cfg, "GET", "/projects"),
  tasks: (cfg, projectId) => request(cfg, "GET", `/projects/${projectId}/tasks`),
  tags: (cfg) => request(cfg, "GET", "/tags")
};
