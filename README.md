<!-- Docs em português. Docs are in Portuguese. -->

# Ponto — extensão para Chrome

Companheira do [Ponto](https://github.com/alextakitani/ponto), o time-tracker
self-hosted. Traz o timer pra dentro do navegador:

- **Popup com timer** — inicie/pare de qualquer aba, com projeto, task, tags e
  faturável.
- **Badge** no ícone mostra o timer rodando.
- **Atalho global** (`Ctrl+Shift+Space`) pra iniciar/parar sem abrir o popup.
- **Lembrete de timer esquecido** — avisa quando o timer passa de N horas rodando.
- **Botões injetados no GitHub e no Linear** — inicia um timer já com a descrição
  da issue/PR.

Extensão Manifest V3, zero-build (sem Node, sem bundler — arquivos servidos como
estão).

## Instalação

1. Baixe/clone este repositório.
2. Abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** (*Load unpacked*) e aponte pra pasta
   do repositório.
5. O ícone teal do Ponto aparece na barra de ferramentas.

## Configuração

A extensão precisa saber onde está o seu servidor e de um token de escrita:

1. No app do Ponto, vá em **Preferências → Tokens** e gere um token com permissão
   de **escrita** (*write*).
2. Nas opções da extensão (clique com o botão direito no ícone → **Opções**, ou
   `chrome://extensions` → Ponto → **Detalhes** → **Opções da extensão**),
   preencha:
   - **URL do servidor** — ex.: `https://ponto.exemplo.dev`
   - **Token de acesso** — o token gerado acima
3. Clique em **Testar conexão** e depois em **Salvar**.

## Licença

O'Saasy — mesma licença do app Ponto. Código aberto, mas **proibido revender como
SaaS**. Veja o `LICENSE.md` do app para os termos completos.
