# Cody Assistant

Extensao do VS Code para assistencia de programacao com Ollama, chat persistente, contexto automatico do projeto e fluxo seguro de alteracoes com preview.

Versao atual: `1.0.13`

## Requisitos

- VS Code
- Node.js
- Ollama ativo em `http://127.0.0.1:11434`
- Modelo padrao atual: `deepseek-coder:6.7b-instruct-q4_K_M`

## Instalar dependencias

```powershell
npm install
```

Se o PowerShell bloquear `npm`, use os executaveis `.cmd` diretamente.

## Build

Build atual:

- `npm run typecheck`
- `npm run bundle`
- `npm run compile`

O `compile` executa `typecheck + bundle` e gera `out/extension.js`.

## Testar no VS Code

Abra o projeto no VS Code e pressione `F5`.

O host de desenvolvimento abre com a extensao carregada e o build e executado antes do startup.

## Gerar VSIX

```powershell
npx vsce package
```

Se preferir:

```powershell
npm run package
```

Isso gera um arquivo como:

```text
cody-assistant-1.0.13.vsix
```

## Scripts de release

- `npm run package`: empacota o VSIX
- `npm run package:local-update`: gera o VSIX da versao atual para teste de update
- `npm run release:patch`
- `npm run release:minor`
- `npm run release:major`

Os scripts de release automatizam:

- bump de versao
- build
- empacotamento do VSIX
- sincronizacao das referencias de versao no projeto

## Instalar no VS Code

1. Abra o VS Code.
2. Execute `Extensions: Install from VSIX...`
3. Selecione o arquivo `.vsix`.
4. Recarregue a janela.

## Comandos principais

- `Cody: Open Assistant`
- `Cody: Explain Selected Code`
- `Cody: Edit Selected Code`
- `Cody: Generate Code`
- `Cody: Create Project Structure`
- `Cody: Create New File`
- `Cody: Analyze Current Project`
- `Cody: Plan And Apply Project Change`
- `Cody: Continue Active Task`
- `Cody: Switch Model`
- `Cody: Check VSIX Update`
- `Cody: Clear Chat History`

Atalhos atuais:

- `Ctrl+Shift+C`: abrir o Cody
- `Ctrl+Shift+N`: criar projeto
- `Ctrl+Shift+F`: criar arquivo

## O que o Cody ja faz

- chat na sidebar com multiplas conversas por workspace
- historico persistente por conversa
- roteamento de intencao no chat
- contexto automatico do editor e do workspace
- explicacao de codigo selecionado
- edicao com diff antes de aplicar
- geracao de codigo
- criacao de arquivos
- criacao de estrutura de projeto com preview
- analise de projeto com leitura de contexto real
- planejamento e aplicacao de mudancas por arquivo
- tarefa ativa persistente por conversa, com objetivo, plano e progresso
- continuacao de tarefa sem precisar repetir todo o contexto
- analise de projeto mais exigente contra recomendacoes vagas ou superficiais
- troca rapida de modelo do Ollama
- atualizacao da extensao por VSIX local ou remoto
- streaming de respostas no chat para reduzir a sensacao de espera
- sanitizacao forte das respostas antes de aplicar conteudo em arquivos
- prompts reforcados para frontend, CSS, JS e interfaces mais modernas
- template React inicial com direcao visual mais forte e responsividade melhor
- fallback para resposta normal quando o stream do Ollama falhar antes do primeiro chunk
- persistencia do historico corrigida para manter mensagens do usuario e do assistente entre saves e reaberturas
- rascunho parcial da resposta do assistente salvo durante streaming para reduzir perda de historico em respostas longas
- revisao de alteracao da selecao com diff resumido e confirmacao diretamente no chat
- compatibilidade melhor com URLs antigas e novas de update remoto no GitHub
- fallback pela pagina publica da release quando a API do GitHub responder 403

## Continuidade de Tarefa

O Cody agora pode manter uma tarefa ativa por conversa.

Isso significa que ele guarda:

- objetivo principal da melhoria
- ultimo plano gerado
- status atual da tarefa
- progresso por etapa/arquivo

Fluxo recomendado:

1. use `Cody: Plan And Apply Project Change` ou peça uma mudanca no chat
2. deixe o Cody montar e executar o plano
3. depois, use `Cody: Continue Active Task` ou diga no chat algo como `continue a tarefa`

Com isso, o Cody tenta retomar a execucao com base no objetivo e no progresso salvos, sem depender de voce reexplicar tudo.

## Atualizacao da extensao

O sistema de update fica em [src/update/vsixUpdater.ts](D:/cody-assistant/src/update/vsixUpdater.ts:1).

Fontes suportadas:

- VSIX local
- GitHub Releases
- pasta do repositorio via GitHub Contents API

Comportamento atual:

- `startup`: verifica atualizacao ao iniciar o VS Code
- `startupAndWatch`: verifica no startup e observa a pasta local durante a sessao
- `Cody: Check VSIX Update`: permite forcar uma checagem manual

Importante:

- checagem automatica no startup so sugere update quando encontra versao maior
- reinstalacao da mesma versao fica reservada para a checagem manual

## Configuracoes

Configuracoes principais do Cody:

- `cody-assistant.ollamaHost`
- `cody-assistant.model`
- `cody-assistant.systemPrompt`
- `cody-assistant.temperature`
- `cody-assistant.maxTokens`
- `cody-assistant.keepAliveMinutes`
- `cody-assistant.requestTimeoutMs`
- `cody-assistant.autoUpdateFromLocalVsix`
- `cody-assistant.localVsixUpdateDirectory`
- `cody-assistant.autoInstallLocalVsixUpdates`
- `cody-assistant.vsixUpdateCheckMode`
- `cody-assistant.githubReleaseApiUrl`
- `cody-assistant.githubReleaseVsixAssetPattern`
- `cody-assistant.checkConnectionOnStartup`
- `cody-assistant.showStartupNotifications`

Defaults atuais relevantes:

- `cody-assistant.autoUpdateFromLocalVsix = true`
- `cody-assistant.localVsixUpdateDirectory = "d:/cody-assistant/update"`
- `cody-assistant.autoInstallLocalVsixUpdates = false`
- `cody-assistant.vsixUpdateCheckMode = "startup"`
- `cody-assistant.githubReleaseApiUrl = "https://github.com/facegalega-oss/cody-assisteat/releases/latest"`

Exemplos validos para `githubReleaseApiUrl`:

```text
https://github.com/OWNER/REPO/releases/latest
https://api.github.com/repos/OWNER/REPO/releases/latest
https://github.com/OWNER/REPO/tree/main/releases/latest
https://api.github.com/repos/OWNER/REPO/contents/releases/latest?ref=main
```

O updater agora tambem reconhece formatos antigos que acabavam apontando `releases/latest` como pasta do repositorio e converte isso para a release correta quando necessario.

## Observacoes sobre desempenho

- o Cody usa `keepAliveMinutes` para manter o modelo aquecido
- `Analyze Current Project` e `Plan And Apply Project Change` usam timeouts maiores do que o chat comum
- `requestTimeoutMs = 0` desativa o timeout do lado da extensao
- o chat agora renderiza a resposta do Ollama em streaming, exibindo o texto aos poucos em vez de esperar a resposta completa

## Estrutura do projeto

```text
src/
  chat/
    webview/
  commands/
  core/
  ollama/
  project/
  update/
  extension.ts
scripts/
  build.mjs
  release.mjs
docs/
  analise_inicial.md
  continuidade.md
```

## Arquivos principais

- [src/extension.ts](D:/cody-assistant/src/extension.ts:1): ativacao da extensao
- [src/chat/chatViewProvider.ts](D:/cody-assistant/src/chat/chatViewProvider.ts:1): fluxo da sidebar e conversas
- [src/chat/webview/chatHtml.ts](D:/cody-assistant/src/chat/webview/chatHtml.ts:1): HTML da webview
- [src/chat/webview/chatStyles.ts](D:/cody-assistant/src/chat/webview/chatStyles.ts:1): estilos da webview
- [src/chat/webview/chatScript.ts](D:/cody-assistant/src/chat/webview/chatScript.ts:1): logica da webview
- [src/commands/registerCommands.ts](D:/cody-assistant/src/commands/registerCommands.ts:1): comandos da extensao
- [src/ollama/client.ts](D:/cody-assistant/src/ollama/client.ts:1): cliente do Ollama
- [src/project/projectTools.ts](D:/cody-assistant/src/project/projectTools.ts:1): criacao e analise de projeto
- [src/project/projectTaskFlow.ts](D:/cody-assistant/src/project/projectTaskFlow.ts:1): plano e execucao de mudancas
- [src/update/vsixUpdater.ts](D:/cody-assistant/src/update/vsixUpdater.ts:1): autoatualizacao
- [docs/continuidade.md](D:/cody-assistant/docs/continuidade.md:1): resumo vivo do estado atual do projeto

## Continuidade

Use [docs/continuidade.md](D:/cody-assistant/docs/continuidade.md:1) como referencia rapida para retomar o projeto em novas conversas.
