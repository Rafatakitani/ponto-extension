// i18n da UI sincronizado com o LOCALE DO APP, não com o do browser.
//
// chrome.i18n.getMessage() resolve contra o idioma do BROWSER e não aceita
// override em runtime. Mas o app expõe o locale que o user escolheu
// (GET /preferences → locale ∈ {null, "pt-BR", "en"}). Este módulo é uma fina
// camada de tradução por cima dos MESMOS _locales/ que servem o chrome.i18n:
//
//   • locale null (auto)  → sem override; t() delega pro chrome.i18n (browser).
//   • "pt-BR" / "en"      → carrega _locales/<code>/messages.json e traduz na mão.
//
// Fonte de verdade única: os arquivos _locales/. Nada de dicionário duplicado.

// app locale ("pt-BR"/"en"/null) → pasta em _locales/ (mesmos nomes do manifest).
const LOCALE_DIRS = { "pt-BR": "pt_BR", "en": "en" };

// Dict do override ativo (null = sem override, cai pro browser via chrome.i18n).
// { key: { message, placeholders } } — o shape cru do messages.json.
let active = null;
const cache = new Map(); // dir → dict (carrega cada messages.json uma vez só)

// Substitui $NAME$ pelos args ($1,$2…) exatamente como o chrome.i18n faria.
// entry.placeholders mapeia nome→{content:"$1"}; sem placeholders, texto literal.
function fill(entry, subs) {
  let msg = entry.message;
  const ph = entry.placeholders;
  if (ph) {
    for (const [name, def] of Object.entries(ph)) {
      const idx = Number(String(def.content).replace("$", "")) - 1;
      const val = Array.isArray(subs) ? (subs[idx] ?? "") : (subs ?? "");
      msg = msg.replaceAll(`$${name.toUpperCase()}$`, val);
    }
  }
  return msg;
}

// Tradução síncrona. Com override ativo, usa o dict do app; senão (ou chave
// ausente no dict) cai pro chrome.i18n — mantém o comportamento atual intacto.
export function t(key, subs) {
  if (active && active[key]) return fill(active[key], subs);
  return chrome.i18n.getMessage(key, subs);
}

// Lê o messages.json do locale (fetch do próprio pacote da extensão; páginas de
// extensão têm acesso same-origin aos seus recursos — sem web_accessible_resources).
async function loadDict(dir) {
  if (cache.has(dir)) return cache.get(dir);
  const res = await fetch(chrome.runtime.getURL(`_locales/${dir}/messages.json`));
  const dict = await res.json();
  cache.set(dir, dict);
  return dict;
}

// Aplica o locale das preferências do app. Retorna true se o override MUDOU
// (chamador re-renderiza os textos); false se nada mudou (evita repaint à toa).
export async function applyLocale(prefs) {
  const dir = LOCALE_DIRS[prefs?.locale] || null; // null/desconhecido → browser
  if (!dir) {
    const changed = active !== null;
    active = null;
    return changed;
  }
  const dict = await loadDict(dir);
  const changed = active !== dict;
  active = dict;
  return changed;
}
