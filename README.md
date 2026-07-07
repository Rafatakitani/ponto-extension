# Ponto — extensão para Chrome

**🇧🇷 Português** · [🇺🇸 English](#-english)

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
3. Clique em **Testar conexão** e depois em **Salvar**. Na primeira vez, o
   navegador pede permissão de acesso ao endereço do servidor (necessária para o
   teste e para o funcionamento) — aceite. O pedido aparece tanto em **Testar
   conexão** quanto em **Salvar**.

## Licença

O'Saasy — mesma licença do app Ponto. Código aberto, mas **proibido revender como
SaaS**. Veja o `LICENSE.md` do app para os termos completos.

---

## 🇺🇸 English

[🇧🇷 Português](#ponto--extensão-para-chrome) · **🇺🇸 English**

Companion to [Ponto](https://github.com/alextakitani/ponto), the self-hosted time
tracker. It brings the timer into your browser:

- **Timer popup** — start/stop from any tab, with project, task, tags and billable.
- **Badge** on the icon shows the running timer.
- **Global shortcut** (`Ctrl+Shift+Space`) to start/stop without opening the popup.
- **Forgotten-timer reminder** — warns when the timer has been running past N hours.
- **Buttons injected into GitHub and Linear** — start a timer pre-filled with the
  issue/PR description.

Manifest V3 extension, zero-build (no Node, no bundler — files served as-is).

### Install

1. Download/clone this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked** and point it at the repository folder.
5. Ponto's teal icon shows up in the toolbar.

### Configuration

The extension needs to know where your server is and a write token:

1. In the Ponto app, go to **Preferences → Tokens** and generate a token with
   **write** permission.
2. In the extension options (right-click the icon → **Options**, or
   `chrome://extensions` → Ponto → **Details** → **Extension options**), fill in:
   - **Server URL** — e.g. `https://ponto.example.dev`
   - **Access token** — the token generated above
3. Click **Test connection** and then **Save**. The first time, the browser asks
   for permission to access the server's address (required for the test and for it
   to work) — accept it. The prompt appears both on **Test connection** and on
   **Save**.

### License

O'Saasy — same license as the Ponto app. Open source, but **you may not resell it as
a SaaS**. See the app's `LICENSE.md` for the full terms.
