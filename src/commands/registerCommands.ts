import * as vscode from 'vscode';

import { CodyViewProvider } from '../chat/chatViewProvider';
import { CODY_CONTAINER_COMMAND } from '../core/constants';
import { buildFrontendPromptBlock } from '../core/frontendPrompt';
import { assertSafeGeneratedFileContent, extractFileContentFromResponse } from '../core/response';
import type { AskOllama } from '../core/types';
import { planProjectTask } from '../project/projectTaskFlow';
import { analyzeCurrentProject, createFileWithAI, createProjectStructure } from '../project/projectTools';

type RegisterCommandDependencies = {
    context: vscode.ExtensionContext;
    viewProvider: CodyViewProvider;
    askOllama: AskOllama;
    listAvailableModels: () => Promise<Array<{ name: string; size: number; modifiedAt: string }>>;
    checkLocalVsixUpdate: () => Promise<void>;
};

type CreateFileCommandPayload = {
    description?: string;
    suggestedFileName?: string;
};

type CreateProjectCommandPayload = {
    description?: string;
    forceCustom?: boolean;
};

export function registerCodyCommands({
    context,
    viewProvider,
    askOllama,
    listAvailableModels,
    checkLocalVsixUpdate
}: RegisterCommandDependencies): void {
    const chatCommand = vscode.commands.registerCommand('cody-assistant.chat', async () => {
        await vscode.commands.executeCommand(CODY_CONTAINER_COMMAND);
        viewProvider.reveal();
    });

    const explainCommand = vscode.commands.registerCommand('cody-assistant.explainCode', async (customRequest?: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Abra um arquivo primeiro');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (!selectedText) {
            vscode.window.showErrorMessage('Selecione o codigo que deseja explicar');
            return;
        }

        const documentPath = vscode.workspace.asRelativePath(editor.document.uri, false);
        const explanationPrompt = [
            'Explique o codigo selecionado abaixo de forma profissional e objetiva.',
            `Arquivo: ${documentPath}`,
            `Linguagem: ${editor.document.languageId}`,
            '',
            customRequest?.trim()
                ? `FOCO ADICIONAL DO USUARIO:\n${customRequest.trim()}\n`
                : '',
            'Responda com:',
            '1. Objetivo do trecho',
            '2. Como ele funciona',
            '3. Riscos, bugs ou pontos de atencao',
            '4. Melhorias recomendadas',
            '',
            'CODIGO:',
            '```',
            selectedText,
            '```'
        ].join('\n');

        await viewProvider.sendPrompt({
            userMessage: customRequest?.trim() || `Explique a selecao atual em ${editor.document.languageId}`,
            prompt: explanationPrompt,
            includeProjectContext: false,
            routeIntent: false
        });
    });

    const editCommand = vscode.commands.registerCommand('cody-assistant.editFile', async (prefilledPrompt?: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Abra um arquivo primeiro');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (!selectedText) {
            vscode.window.showErrorMessage('Selecione o codigo que deseja modificar');
            return;
        }

        const prompt = prefilledPrompt?.trim() || await vscode.window.showInputBox({
            prompt: 'O que voce quer mudar neste codigo?',
            placeHolder: 'Ex: Adicione validacao de erro, refatore para async/await...'
        });

        if (!prompt) {
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Cody esta pensando...',
            cancellable: false
        }, async progress => {
            progress.report({ increment: 0, message: 'Gerando modificacao...' });

            try {
                const documentPath = vscode.workspace.asRelativePath(editor.document.uri, false);
                const frontendPromptBlock = buildFrontendPromptBlock({
                    request: prompt,
                    filePath: documentPath,
                    languageId: editor.document.languageId
                }, 'edit');
                const modifiedCodeResponse = await askOllama(`
Voce e um assistente profissional de refatoracao e manutencao de codigo.

ARQUIVO:
${documentPath}

LINGUAGEM:
${editor.document.languageId}

CODIGO ORIGINAL:
\`\`\`
${selectedText}
\`\`\`

SOLICITACAO DO USUARIO:
${prompt}

${frontendPromptBlock}

Responda APENAS com o codigo modificado, sem explicacoes.
Mantenha a mesma indentacao, estilo e comportamento esperado do codigo original.
Nao use blocos de markdown, nao escreva \`\`\`, nao inclua observacoes finais e nao devolva diff.
Entregue apenas o codigo cru que deve substituir a selecao.
                `);

                const modifiedCode = extractFileContentFromResponse(modifiedCodeResponse);
                assertSafeGeneratedFileContent(modifiedCode, documentPath);

                if (!modifiedCode) {
                    throw new Error('A resposta do modelo nao trouxe codigo valido para aplicar.');
                }

                progress.report({ increment: 70, message: 'Enviando diff para revisao no chat...' });

                await viewProvider.presentSelectionEditReview({
                    requestSummary: prompt,
                    documentUri: editor.document.uri,
                    documentLabel: documentPath,
                    languageId: editor.document.languageId,
                    originalVersion: editor.document.version,
                    selectionRange: new vscode.Range(selection.start, selection.end),
                    originalCode: selectedText,
                    modifiedCode
                });
                vscode.window.showInformationMessage('Diff enviado para revisao no chat do Cody.');
            } catch (error) {
                vscode.window.showErrorMessage(`Erro: ${error}`);
            }
        });
    });

    const generateCommand = vscode.commands.registerCommand('cody-assistant.generateCode', async () => {
        const prompt = await vscode.window.showInputBox({
            prompt: 'Descreva o codigo que voce quer gerar',
            placeHolder: 'Ex: Uma funcao que valida email em JavaScript'
        });

        if (!prompt) {
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Gerando codigo...',
            cancellable: false
        }, async progress => {
            progress.report({ increment: 0, message: 'Gerando...' });

            try {
                const languageId = vscode.window.activeTextEditor?.document.languageId ?? 'plaintext';
                const documentPath = vscode.window.activeTextEditor
                    ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri, false)
                    : undefined;
                const frontendPromptBlock = buildFrontendPromptBlock({
                    request: prompt,
                    filePath: documentPath,
                    languageId
                }, 'generate');
                const generatedCodeResponse = await askOllama(`
Gere APENAS o codigo solicitado, sem explicacoes:

${prompt}

${frontendPromptBlock}

Responda apenas com o codigo, bem formatado.
Nao use blocos de markdown e nao adicione texto antes ou depois do codigo.
                `);
                const generatedCode = extractFileContentFromResponse(generatedCodeResponse);
                assertSafeGeneratedFileContent(generatedCode, 'codigo gerado');

                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    await editor.edit(editBuilder => {
                        const position = editor.selection.active;
                        editBuilder.insert(position, generatedCode);
                    });
                } else {
                    const doc = await vscode.workspace.openTextDocument({
                        content: generatedCode,
                        language: languageId
                    });
                    await vscode.window.showTextDocument(doc);
                }

                vscode.window.showInformationMessage('Codigo gerado com sucesso.');
            } catch (error) {
                vscode.window.showErrorMessage(`Erro: ${error}`);
            }
        });
    });

    const createProjectCommand = vscode.commands.registerCommand('cody-assistant.createProject', async (payload?: CreateProjectCommandPayload) => {
        await createProjectStructure(askOllama, {
            initialDescription: payload?.description,
            forceCustom: payload?.forceCustom
        });
    });

    const createFileCommand = vscode.commands.registerCommand('cody-assistant.createFile', async (payload?: string | CreateFileCommandPayload) => {
        const normalizedPayload = typeof payload === 'string'
            ? { description: payload }
            : payload;

        await createFileWithAI(askOllama, {
            description: normalizedPayload?.description,
            suggestedFileName: normalizedPayload?.suggestedFileName
        });
    });

    const analyzeProjectCommand = vscode.commands.registerCommand('cody-assistant.analyzeProject', async (focusRequest?: string) => {
        await analyzeCurrentProject(askOllama, typeof focusRequest === 'string' ? focusRequest : undefined);
    });

    const planProjectTaskCommand = vscode.commands.registerCommand('cody-assistant.planProjectTask', async (initialTask?: string) => {
        await planProjectTask(askOllama, {
            initialTask: typeof initialTask === 'string' ? initialTask : undefined,
            existingTaskSession: viewProvider.getActiveTaskSession(),
            onTaskSessionChange: taskSession => viewProvider.setActiveTaskSession(taskSession)
        });
    });

    const continueProjectTaskCommand = vscode.commands.registerCommand('cody-assistant.continueProjectTask', async () => {
        const activeTaskSession = viewProvider.getActiveTaskSession();
        if (!activeTaskSession) {
            vscode.window.showWarningMessage('Nao ha tarefa ativa nesta conversa para continuar.');
            return;
        }

        await planProjectTask(askOllama, {
            initialTask: activeTaskSession.goal,
            existingTaskSession: activeTaskSession,
            onTaskSessionChange: taskSession => viewProvider.setActiveTaskSession(taskSession)
        });
    });

    const switchModelCommand = vscode.commands.registerCommand('cody-assistant.switchModel', async () => {
        try {
            const config = vscode.workspace.getConfiguration('cody-assistant');
            const currentModel = config.get<string>('model', '');
            const models = await listAvailableModels();

            if (models.length === 0) {
                vscode.window.showWarningMessage('Nenhum modelo foi encontrado no Ollama.');
                return;
            }

            const selection = await vscode.window.showQuickPick(
                models.map(model => ({
                    label: model.name,
                    description: model.name === currentModel ? 'modelo atual' : formatModelSize(model.size),
                    detail: model.modifiedAt ? `Atualizado em ${new Date(model.modifiedAt).toLocaleString()}` : undefined
                })),
                {
                    placeHolder: 'Escolha o modelo que o Cody deve usar'
                }
            );

            if (!selection || selection.label === currentModel) {
                return;
            }

            await config.update('model', selection.label, vscode.ConfigurationTarget.Workspace);
            viewProvider.refresh();
            vscode.window.showInformationMessage(`Modelo do Cody alterado para ${selection.label}.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Nao foi possivel trocar o modelo: ${error}`);
        }
    });

    const clearHistoryCommand = vscode.commands.registerCommand('cody-assistant.clearChatHistory', async () => {
        await viewProvider.clearHistory();
        await vscode.commands.executeCommand(CODY_CONTAINER_COMMAND);
        viewProvider.reveal();
        vscode.window.showInformationMessage('Historico do chat limpo.');
    });

    const checkLocalVsixUpdateCommand = vscode.commands.registerCommand('cody-assistant.checkLocalVsixUpdate', async () => {
        await checkLocalVsixUpdate();
    });

    context.subscriptions.push(
        chatCommand,
        explainCommand,
        editCommand,
        generateCommand,
        createProjectCommand,
        createFileCommand,
        analyzeProjectCommand,
        planProjectTaskCommand,
        continueProjectTaskCommand,
        switchModelCommand,
        checkLocalVsixUpdateCommand,
        clearHistoryCommand
    );
}

function formatModelSize(sizeInBytes: number): string {
    if (!Number.isFinite(sizeInBytes) || sizeInBytes <= 0) {
        return 'tamanho desconhecido';
    }

    const sizeInGb = sizeInBytes / (1024 ** 3);
    return `${sizeInGb.toFixed(1)} GB`;
}
