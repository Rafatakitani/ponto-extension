# Editar horário de início do timer rodando — Design

## Contexto

Hoje, quando um timer está rodando, a linha `#run-timer` mostra o tempo
decorrido e um texto read-only "iniciado às HH:MM". Se o usuário esqueceu de dar
start e só percebeu depois, não há como corrigir o horário de início pela
extensão — ele teria que parar, apagar e lançar manualmente, ou ir ao app.

A meta-row (projeto/task/tags/faturável) e a descrição **já são editáveis no meio
do timer** via PATCH na entry rodando (`patchRunning` → `entry:update` →
`PATCH /time_entries/:id`). Este trabalho estende esse mesmo padrão ao
`started_at`: tornar o "iniciado às HH:MM" editável in-place.

Resultado esperado: clicar no lápis ao lado do horário de início abre um campo
`datetime-local`; ao ajustar, o cronômetro recalcula o tempo decorrido e o novo
início é persistido no servidor.

## Comportamento

- **Elapsed recalcula.** Início mais cedo ⇒ mais tempo decorrido. Sai de graça: o
  `#clock` já deriva de `state.entry.started_at` a cada tick (popup.js:137).
  Basta atualizar `state.entry.started_at` que o próximo tick (≤500ms) reflete.
- **Não pode ser no futuro.** Um `started_at` posterior a agora daria elapsed
  negativo num timer rodando — não faz sentido. Validado no cliente antes do
  PATCH; se violar, toast de erro e nenhum request.
- **Edita data + hora + segundos.** O campo é um `<input type=datetime-local
  step="1">`, então o usuário pode ajustar o dia também (cobre "timer rodando
  desde ontem"), a hora e os segundos. Precisão total.

## UI (lápis + campo datetime inteiro)

- **Estado normal:** `#run-started` ("iniciado às HH:MM") ganha um ícone de lápis
  discreto ao lado (SVG Lucide, mesmo estilo dos outros ícones do popup — o modo
  manual já usa o ícone de lápis em `#btn-mode`). Clicar no lápis (ou no texto)
  entra em edição.
- **Em edição:** a linha do cronômetro (`#run-timer`) dá lugar a um
  `<input type=datetime-local step="1">` de largura total, com rótulo "Início"
  em cima. O elapsed some enquanto edita (foco total no campo; card não cresce).
- Confirma no `change`. `Esc` cancela e volta ao estado normal sem alterar nada.
  Após confirmar, volta à linha do cronômetro já com o elapsed recalculado.

## Dados / fluxo

- Reusa **`patchRunning({ started_at })`** (popup.js:144), que faz
  `Object.assign(state.entry, attrs)` + `send("entry:update", ...)`. O caminho no
  background (`entry:update`, background.js:122) já trata entry rodando: com
  `!res.data.ended_at`, chama `setTimerCache(res.data)`.
- `started_at` vai em ISO 8601 (`Date.toISOString()`), exatamente como o modo
  manual já envia em `saveManual` (popup.js:580). O endpoint aceita o atributo: é
  o mesmo `PATCH /time_entries/:id` do update e os mesmos params do create
  manual (ver lib/api.js:66,77-79).
- **Preenchimento do campo:** o `datetime-local` espera o formato local
  `YYYY-MM-DDTHH:MM:SS`. Reusa o helper `toLocalInput` (popup.js:646) — que já
  produz `YYYY-MM-DDTHH:MM` — estendido/adaptado para incluir segundos
  (`:SS`), a partir de `new Date(state.entry.started_at)`.
- **Leitura do valor:** o valor do `datetime-local` é interpretado como hora
  **local** (`new Date(inputValue)` já faz isso para esse formato) e serializado
  com `toISOString()` antes do PATCH.
- **Validação:** se o `Date` resultante > agora, rejeita com toast (reusa
  `toast()` + string i18n nova) e não faz PATCH.

## Ponto sutil — broadcast

`timerEntriesDiffer` (background.js:57) decide se uma mudança de cache dispara
`broadcast("timer:changed")`. A lista de campos comparados **não inclui
`started_at`**. Adicionar `"started_at"` à lista para que um ajuste de início
feito **por fora** (app/CLI) chegue a um popup aberto e re-renderize o
cronômetro.

Risco de atropelar edição local em andamento: baixo, porque a edição confirma no
`change` (instantânea), diferente do campo de descrição (digitação livre
demorada). Aceitável.

## i18n

Duas strings novas em `_locales/pt_BR/messages.json` e `_locales/en/messages.json`:

- `popup_start_edit_label` — rótulo do campo em edição (ex.: "Início" / "Start").
- `popup_start_future_error` — erro de validação (ex.: "O início não pode ser no
  futuro." / "Start time can't be in the future.").

A string existente `popup_started_at` ("iniciado às $TIME$") continua sendo usada
para o estado read-only.

## Arquivos afetados

- `popup/popup.html` — adicionar o lápis ao lado de `#run-started`; adicionar o
  `<input type=datetime-local>` de edição (escondido por padrão) e o rótulo na
  linha `#run-timer`.
- `popup/popup.css` — estilo do lápis (opacidade/hover) e do campo datetime
  inline (largura total, `color-scheme: dark` pra picker no tema escuro).
- `popup/popup.js` — handlers de entrar/confirmar/cancelar edição; preenchimento
  do campo (`toLocalInput` com segundos); leitura + validação do novo
  `started_at`; chamada a `patchRunning`; alternância de visibilidade
  cronômetro↔campo.
- `background.js` — adicionar `"started_at"` a `timerEntriesDiffer`.
- `_locales/pt_BR/messages.json`, `_locales/en/messages.json` — 2 strings novas.

## Fora de escopo

- Editar horário de início de entries **finalizadas** no ledger (só o timer
  rodando).
- Editar horário de **fim** de um timer rodando (não existe fim enquanto roda).

## Verificação

1. Carregar a extensão sem empacotar (`chrome://extensions` → "Carregar sem
   compactação" apontando pra raiz do repo) com um servidor Ponto configurado.
2. Iniciar um timer. Abrir o popup: o "iniciado às HH:MM" deve ter o lápis ao
   lado.
3. Clicar no lápis → a linha vira o `datetime-local` com data+hora+segundos
   atuais do início. Mudar para um horário **mais cedo** → confirmar. O
   cronômetro deve **pular pra cima** (mais tempo) e seguir ticando.
4. Recarregar o popup (ou clicar em atualizar) → o novo início persiste (veio do
   servidor).
5. Editar o **dia** para ontem → o elapsed deve refletir mais de 24h.
6. Tentar um horário **no futuro** → toast de erro, sem alteração.
7. `Esc` durante a edição → volta ao cronômetro sem mudar nada.
8. Ajustar o início do mesmo timer **pelo app web** com o popup aberto → o popup
   deve refletir (graças ao `started_at` no diff do broadcast) no próximo tick.
