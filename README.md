# Cody Assistant

Extensao VS Code para assistencia local de codigo usando Ollama.

## Requisitos

- VS Code
- Node.js
- Ollama rodando em `http://127.0.0.1:11434`
- Modelo atual esperado: `deepseek-coder-v2:16b`

## Instalar dependencias

```powershell
npm install
```

Se o PowerShell bloquear `npm`, use:

```powershell
.\node_modules\.bin\tsc.cmd -v
```

## Compilar a extensao

```powershell
cd d:\cody-assistant
.\node_modules\.bin\tsc.cmd -p ./
```

O TypeScript compilado vai para a pasta `out/`.

## Testar no VS Code

O jeito mais rapido de testar e abrir o projeto no VS Code e pressionar `F5`.

Isso abre uma nova janela `Extension Development Host` com a extensao carregada.

Agora o `F5` executa o build antes de iniciar o host de desenvolvimento.

## Gerar o VSIX

```powershell
npx vsce package
```

Se `npx` estiver bloqueado:

```powershell
.\node_modules\.bin\vsce.cmd package
```

Isso gera um arquivo como:

```text
cody-assistant-0.0.20.vsix
```

O script `vscode:prepublish` executa o build antes do empacotamento, entao a pasta `out/` vai junto no VSIX.

Para testar a autoatualizacao local do Cody, voce tambem pode gerar o pacote mais novo exatamente na pasta observada pela extensao:

```powershell
npx.cmd vsce package --out .\cody-assistant-0.0.20.vsix
```

Ou, se preferir, usar o script do projeto:

```powershell
npm.cmd run package:local-update
```

## Instalar no VS Code

1. Abra o VS Code.
2. Execute `Extensions: Install from VSIX...`
3. Selecione o arquivo `.vsix`
4. Recarregue a janela quando o VS Code pedir

Depois disso, a extensao instalada pode ativar automaticamente no startup do VS Code.

## Como abrir o Cody

- Comando: `Cody: Open Assistant`
- Atalho atual: `Ctrl+Shift+C`

Se a extensao estiver instalada corretamente, `Ctrl+Shift+C` tambem pode ativar a extensao e abrir a sidebar do Cody.

O comando `Cody: Explain Selected Code` agora envia a selecao atual para o chat com contexto do arquivo e da linguagem.

O comando `Cody: Edit Selected Code` agora abre um diff de revisao antes de aplicar a alteracao no arquivo.

O chat agora persiste historico por workspace, restaura a conversa quando voce reabre o VS Code e usa mensagens recentes como contexto real para respostas seguintes.

Agora esse historico foi evoluido para multiplas conversas: voce pode abrir um `Novo chat`, alternar entre conversas pela lista lateral e cada conversa assume seu proprio contexto e memoria.

Voce tambem pode limpar a conversa ativa pelo botao `Limpar chat` na sidebar ou pelo comando `Cody: Clear Chat History`.

No chat geral da sidebar, o Cody agora tambem injeta contexto automatico do editor e do workspace, incluindo arquivo ativo, linguagem, selecao ou trecho proximo ao cursor, e arquivos relevantes como `package.json`, `README.md` e configs do projeto.

O chat agora tambem entende intencao. Em vez de depender sempre dos comandos manuais, voce ja pode escrever pedidos como "analise este projeto", "quero adicionar autenticacao", "crie um arquivo" ou "explique este codigo", e o Cody tenta encaminhar automaticamente para o fluxo certo: conversa normal, analise profunda, explicacao da selecao atual, edicao segura da selecao, criacao guiada de arquivo, criacao guiada de projeto ou planejamento de mudanca no projeto.

Esse roteamento ficou mais confiavel: a sidebar mostra o modo detectado para a conversa ativa e, antes de executar um fluxo estruturado, o Cody abre uma confirmacao curta para voce manter o modo sugerido ou corrigir para outro.

Na criacao de projetos, stacks conhecidas agora usam templates base mais confiaveis, projetos `Custom` passam por validacao forte de estrutura, e existe preview antes de criar pastas e arquivos no disco.

O comando `Cody: Analyze Current Project` agora faz uma leitura bem mais forte: ele considera a arvore do workspace, arquivos reais importantes, sinais locais de maturidade do projeto, stack detectada, presenca de testes/lint/CI e devolve uma analise estruturada com recomendacoes de alto impacto, roadmap e melhor proximo passo.

O novo comando `Cody: Plan And Apply Project Change` leva o Cody para um fluxo mais profissional de evolucao do projeto: voce descreve a melhoria desejada, ele monta um plano estruturado por arquivo, mostra um preview do plano e executa passo a passo com diff antes de aplicar cada mudanca.

Voce tambem pode trocar rapidamente o modelo usado pelo Cody com `Cody: Switch Model` ou pelo botao `Trocar modelo` na sidebar. O comando lista os modelos instalados no Ollama e salva a escolha no workspace atual.

O Cody agora tambem consegue procurar automaticamente um `cody-assistant-*.vsix` local mais novo, instalar essa atualizacao e pedir apenas o reload da janela. Isso vale tanto para versoes realmente novas quanto para reinstalar a mesma versao quando um novo VSIX for gerado na pasta observada.

Se quiser disparar essa verificacao manualmente, use `Cody: Check Local VSIX Update`.

## Configuracoes

Nas configuracoes do VS Code, voce pode ajustar:

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
- `cody-assistant.checkConnectionOnStartup`
- `cody-assistant.showStartupNotifications`

Se o Ollama estiver online mas o Cody mostrar `fetch failed`, prefira configurar `cody-assistant.ollamaHost` como `http://127.0.0.1:11434`. Nesta versao o cliente tambem tenta esse fallback automaticamente quando `localhost` falha.

Para respostas mais rapidas, o Cody agora usa um limite de tokens mais enxuto por padrao e mantem o modelo aquecido no Ollama por alguns minutos. Se quiser priorizar ainda mais velocidade, reduza `cody-assistant.maxTokens` e mantenha `cody-assistant.keepAliveMinutes` acima de `0`.

Se aparecer `Headers Timeout Error`, aumente `cody-assistant.requestTimeoutMs`. O Cody agora usa um `fetch` proprio com timeouts mais adequados para modelos locais pesados, mas maquinas mais lentas ou modelos grandes ainda podem precisar de um limite maior. Se preferir, voce tambem pode definir `cody-assistant.requestTimeoutMs = 0` para desativar o timeout.

Analise de projeto e planejamento de mudancas agora usam automaticamente um timeout maior do que o chat comum, porque esses fluxos enviam mais contexto e naturalmente demoram mais para modelos grandes.

Para autoatualizacao local, deixe `cody-assistant.autoUpdateFromLocalVsix = true`. Se `cody-assistant.localVsixUpdateDirectory` estiver vazio, o Cody usa a primeira pasta aberta no workspace e observa novos arquivos `cody-assistant-*.vsix`. Se preferir, voce pode apontar para uma pasta absoluta fixa onde seus pacotes sao gerados.

No seu caso atual, se o workspace aberto for `D:\cody-assistant` e `cody-assistant.localVsixUpdateDirectory` estiver vazio, o arquivo novo precisa ficar em `D:\cody-assistant`. Entao o teste ideal e simples:

1. deixar a versao `0.0.19` instalada no VS Code
2. abrir o workspace `D:\cody-assistant`
3. gerar `D:\cody-assistant\cody-assistant-0.0.20.vsix`
4. esperar a deteccao automatica ou rodar `Cody: Check Local VSIX Update`

Se quiser observar outra pasta, configure `cody-assistant.localVsixUpdateDirectory` com esse caminho.

Se quiser apenas ser avisado antes de instalar, defina `cody-assistant.autoInstallLocalVsixUpdates = false`.

## Sobre a inicializacao automatica

O comportamento esperado agora e:

- a extensao ativa ao finalizar o startup do VS Code
- a extensao tambem ativa ao abrir a view do Cody
- a extensao tambem ativa ao executar `Cody: Open Assistant`

Para isso funcionar fora do `F5`, a extensao precisa estar compilada e instalada no VS Code.

## Estrutura atual

```text
src/
  chat/
  commands/
  core/
  ollama/
  project/
  extension.ts
```

## Arquivos principais

- `src/extension.ts`: ponto de entrada
- `src/chat/chatViewProvider.ts`: webview do chat
- `src/commands/registerCommands.ts`: registro dos comandos
- `src/ollama/client.ts`: cliente Ollama
- `src/project/projectTools.ts`: criacao e analise de projeto
