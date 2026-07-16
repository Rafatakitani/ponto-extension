# Editar horário de início do timer rodando — Design

## Contexto

Hoje, quando um timer está rodando, a linha `#run-timer` mostra o tempo
decorrido e um texto read-only "iniciado às HH:MM". Se o usuário esqueceu de dar
start e só percebeu depois, não há como corrigir o horário de início pela
extensão — ele teria que parar, apagar e lançar manualmente, ou ir ao app.

A meta-row (projeto/task/tags/faturável) e a descrição **já são editáveis no meio
do timer** via PATCH na entry rodando (`patchRunning` → `entry:update` →
`PATCH /time_entries/:id`). Este trabalho estende esse mesmo padrão ao
`started_at`: tornar o "iniciado às HH:MM" um campo editável in-place.

Resultado esperado: clicar no horário de início vira um campo de hora; ao
ajustar, o cronômetro recalcula o tempo decorrido e o novo início é persistido no
servidor.

## Comportamento

- **Elapsed recalcula.** Início mais cedo ⇒ mais tempo decorrido. Sai de graça: o
  `#clock` já deriva de `state.entry.started_at` a cada tick (popup.js:137).
  Basta atualizar `state.entry.started_at` que o próximo tick (≤500ms) reflete.
- **Não pode ser no futuro.** Um `started_at` posterior a agora daria elapsed
  negativo num timer rodando — não faz sentido. Validado no cliente antes do
  PATCH; se violar, toast de erro e nenhum request.
- **Preserva o dia.** O `<input type=time>` só edita HH:MM. A hora escolhida é
  combinada com a **data do `started_at` atual da entry**, trocando apenas
  hora/minuto. Editar o dia está fora de escopo (o caso de uso é ajustar
  minutos/horas do mesmo dia). Consequência: não dá pra "puxar" o início pra
  ontem por aqui — aceitável para a v1.

## UI (opção A — texto vira campo)

- O `#run-started` ("iniciado às HH:MM") ganha um sublinhado pontilhado sutil,
  sinalizando que é clicável. Sem ícone de lápis — coerente com a edição in-place
  de descrição/projeto/tags, que não usam affordance extra.
- Clicar troca o texto por um `<input type=time>` inline (mesmo controle já usado
  no modo manual, `#manual-start-time`), pré-preenchido com a hora atual do
  início.
- Confirma no `change`/`blur`. `Esc` cancela e volta ao texto sem alterar nada.
- Após confirmar, volta ao texto read-only já mostrando o novo horário.

## Dados / fluxo

- Reusa **`patchRunning({ started_at })`** (popup.js:144), que faz
  `Object.assign(state.entry, attrs)` + `send("entry:update", ...)`. O caminho no
  background (`entry:update`, background.js:122) já trata entry rodando: com
  `!res.data.ended_at`, chama `setTimerCache(res.data)`.
- `started_at` vai em ISO 8601 (`Date.toISOString()`), exatamente como o modo
  manual já envia em `saveManual` (popup.js:580). O endpoint aceita o atributo: é
  o mesmo `PATCH /time_entries/:id` do update e os mesmos params do create
  manual (ver lib/api.js:66,77-79).
- Construção do novo `started_at`: pega a data local do `started_at` atual, aplica
  as HH:MM do input, gera um `Date` local e serializa com `toISOString()`. Reusa
  os helpers de tempo existentes (`timeToMinutes`, e o padrão de
  `new Date(\`${date}T${time}\`)` de `saveManual`).

## Ponto sutil — broadcast

`timerEntriesDiffer` (background.js:57) decide se uma mudança de cache dispara
`broadcast("timer:changed")`. A lista de campos comparados **não inclui
`started_at`**. Adicionar `"started_at"` à lista para que um ajuste de início
feito **por fora** (app/CLI) chegue a um popup aberto e re-renderize o
cronômetro.

Risco de atropelar edição local em andamento: baixo, porque a edição via
`type=time` é instantânea (confirma no change/blur), diferente do campo de
descrição (digitação livre demorada). Aceitável.

## i18n

Duas strings novas em `_locales/pt_BR/messages.json` e `_locales/en/messages.json`:

- `popup_start_edit_label` — rótulo do campo em edição (ex.: "início" / "start").
- `popup_start_future_error` — erro de validação (ex.: "O início não pode ser no
  futuro." / "Start time can't be in the future.").

A string existente `popup_started_at` ("iniciado às $TIME$") continua sendo usada
para o estado read-only.

## Arquivos afetados

- `popup/popup.html` — tornar `#run-started` um controle clicável; adicionar o
  `<input type=time>` de edição (escondido por padrão) na linha `#run-timer`.
- `popup/popup.css` — estilo do sublinhado pontilhado no `#run-started` e do campo
  inline em edição.
- `popup/popup.js` — handlers de entrar/confirmar/cancelar edição; construção e
  validação do novo `started_at`; chamada a `patchRunning`.
- `background.js` — adicionar `"started_at"` a `timerEntriesDiffer`.
- `_locales/pt_BR/messages.json`, `_locales/en/messages.json` — 2 strings novas.

## Fora de escopo

- Editar o **dia** do início (só HH:MM na v1).
- Editar horário de início de entries **finalizadas** no ledger (só o timer
  rodando).
- Editar horário de **fim** de um timer rodando (não existe fim enquanto roda).

## Verificação

1. Carregar a extensão sem empacotar (`chrome://extensions` → "Carregar sem
   compactação" apontando pra raiz do repo) com um servidor Ponto configurado.
2. Iniciar um timer. Abrir o popup: o "iniciado às HH:MM" deve ter o sublinhado
   pontilhado.
3. Clicar nele → vira `<input type=time>` com a hora atual. Mudar para um horário
   **mais cedo** → confirmar (blur/Enter). O cronômetro deve **pular pra cima**
   (mais tempo) e seguir ticando; o texto volta mostrando o novo horário.
4. Recarregar o popup (ou clicar em atualizar) → o novo início persiste (veio do
   servidor).
5. Tentar um horário **no futuro** → toast de erro, sem alteração.
6. `Esc` durante a edição → volta ao texto sem mudar nada.
7. Ajustar o início do mesmo timer **pelo app web** com o popup aberto → o popup
   deve refletir (graças ao `started_at` no diff do broadcast) no próximo tick.
