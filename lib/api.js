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
      redirect: "manual",
      // Sem cookies: se o user estiver logado no app NESTE browser, a sessão
      // autenticaria a request mesmo com token errado/revogado — auth vira
      // imprevisível e mascara má configuração (achado na bateria de 06/07).
      // A extensão fala SÓ Bearer, sempre.
      credentials: "omit"
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

  if (response.ok) {
    // Coleções JSON são paginadas (Pagy): metadados vêm em HEADERS, body é array
    // puro. Expõe a paginação pra quem precisa saber se há mais páginas (ledger).
    const totalCount = response.headers.get("X-Total-Count");
    const nextPage = response.headers.get("X-Next-Page");
    const page = totalCount == null ? undefined : {
      totalCount: Number(totalCount),
      totalPages: Number(response.headers.get("X-Total-Pages")),
      page: Number(response.headers.get("X-Page")),
      perPage: Number(response.headers.get("X-Per-Page")),
      nextPage: nextPage ? Number(nextPage) : null
    };
    return { ok: true, status: response.status, data: payload, page };
  }

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
  // Histórico paginado (Q73): teto do servidor é 100/página. Pedimos o máximo pra
  // o ledger por dia num fetch só; a paginação (X-Total-*) volta em `page`.
  recentEntries: (cfg, { page = 1, limit = 100 } = {}) =>
    request(cfg, "GET", `/time_entries?page=${page}&limit=${limit}`),
  duplicateEntry: (cfg, id) => request(cfg, "POST", `/time_entries/${id}/duplicate`),
  // Entry manual (lançar tempo esquecido): POST /time_entries com started_at/ended_at.
  // Mesmos params permitidos que o update; o servidor calcula duração/valor.
  createEntry: (cfg, attrs) => request(cfg, "POST", "/time_entries", { time_entry: attrs }),
  deleteEntry: (cfg, id) => request(cfg, "DELETE", `/time_entries/${id}`),
  // Split (Q48): divide a entry em duas no instante `cut` (ISO 8601). 204 no ok.
  splitEntry: (cfg, id, cut) => request(cfg, "POST", `/time_entries/${id}/split`, { split: { cut } }),
  projects: (cfg) => request(cfg, "GET", "/projects"),
  tasks: (cfg, projectId) => request(cfg, "GET", `/projects/${projectId}/tasks`),
  tags: (cfg) => request(cfg, "GET", "/tags"),
  // Preferências do user (locale/theme/accent/time_zone). Token `read` já basta.
  preferences: (cfg) => request(cfg, "GET", "/preferences")
};
