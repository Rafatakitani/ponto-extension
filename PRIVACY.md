# Política de Privacidade — Ponto (extensão para Chrome)

_Última atualização: 10 de julho de 2026_

A extensão **Ponto** é um cliente de navegador para o time-tracker self-hosted
[Ponto](https://github.com/alextakitani/ponto). Esta política descreve como a
extensão lida com seus dados.

_Also available in English: [PRIVACY-EN](PRIVACY-EN)._

## Resumo

A extensão **não coleta, não vende e não compartilha** nenhum dado pessoal com o
desenvolvedor ou com terceiros. Ela se comunica **exclusivamente** com o servidor
Ponto que **você** configura.

## Dados armazenados

A extensão guarda, **apenas localmente no seu navegador** (`chrome.storage.local`):

- A **URL do servidor** Ponto que você informa.
- O **token de acesso** que você gera no seu servidor.
- **Preferências** de uso: horas para o lembrete de timer, e um cache do estado do
  timer e das suas preferências de tema.

Esses dados nunca saem do seu navegador, exceto pelas requisições feitas ao seu
próprio servidor Ponto (veja abaixo). Não há servidores do desenvolvedor
envolvidos.

## Comunicação de rede

A extensão faz requisições HTTP **somente** para o endereço do servidor Ponto que
você configurou, enviando seu token de acesso para autenticar. Nenhum outro
destino é contatado. Nenhum serviço de analytics, rastreamento ou publicidade é
utilizado.

## Dados que NÃO são coletados

A extensão **não** coleta histórico de navegação, conteúdo de páginas, dados de
formulários de outros sites, localização, nem qualquer informação de
identificação pessoal. A permissão de acesso a sites é **opcional** e usada apenas
para alcançar a URL do seu servidor.

## Exclusão dos dados

Para remover todos os dados armazenados, basta **desinstalar a extensão** ou limpar
os dados dela nas configurações do Chrome. Não há cópia em nenhum outro lugar.

## Código

A extensão é de código aberto. Todo o código executa localmente no seu navegador;
não há execução de código remoto. O código-fonte está disponível em:
https://github.com/Rafatakitani/ponto-extension

## Contato

Dúvidas sobre esta política: abra uma issue no repositório acima.
