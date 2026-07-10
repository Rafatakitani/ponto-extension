# Privacy Policy — Ponto (Chrome extension)

_Last updated: July 10, 2026_

The **Ponto** extension is a browser client for the self-hosted time tracker
[Ponto](https://github.com/alextakitani/ponto). This policy describes how the
extension handles your data.

_Também disponível em português: [PRIVACY](PRIVACY)._

## Summary

The extension **does not collect, sell, or share** any personal data with the
developer or with third parties. It communicates **exclusively** with the Ponto
server that **you** configure.

## Data stored

The extension stores, **only locally in your browser** (`chrome.storage.local`):

- The **server URL** you provide.
- The **access token** you generate on your server.
- **Usage preferences**: reminder hours, and a cache of the timer state and your
  theme preferences.

This data never leaves your browser except through the requests made to your own
Ponto server (see below). No developer-operated servers are involved.

## Network communication

The extension makes HTTP requests **only** to the Ponto server address you have
configured, sending your access token to authenticate. No other destination is
contacted. No analytics, tracking, or advertising services are used.

## Data that is NOT collected

The extension does **not** collect browsing history, page content, form data from
other sites, location, or any personally identifiable information. The site-access
permission is **optional** and used only to reach your server's URL.

## Deleting your data

To remove all stored data, simply **uninstall the extension** or clear its data in
your Chrome settings. There is no copy anywhere else.

## Code

The extension is open source. All code runs locally in your browser; there is no
remote code execution. The source code is available at:
https://github.com/Rafatakitani/ponto-extension

## Contact

Questions about this policy: open an issue on the repository above.
