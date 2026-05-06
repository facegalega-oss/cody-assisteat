import * as vscode from 'vscode';

import {
    detectChatIntent,
    getIntentLabel,
    getIntentSummary,
    isStructuredIntent,
    type CodyChatIntent
} from './chatIntent';
import {
    buildSessionTitleFromMessage,
    createChatSession,
    loadChatState,
    saveChatState
} from './chatHistory';
import { getChatWebviewContent } from './webview/chatHtml';
import { getCodySettings } from '../core/config';
import { buildDiffPreview } from '../core/diffPreview';
import { collectProjectContext } from '../core/projectContext';
import { applySelectionEditSafely, openSelectionDiffPreview } from '../commands/editPreview';
import type {
    AskOllama,
    CodyChatHistoryEntry,
    CodyChatSession,
    CodyChatState,
    CodyTaskSession,
    CodyPromptRequest
} from '../core/types';

type WebviewChatMessage = {
    command: 'addMessage';
    role: 'user' | 'assistant';
    text: string;
};

type WebviewBeginAssistantMessage = {
    command: 'beginAssistantMessage';
    messageId: string;
};

type WebviewUpdateAssistantMessage = {
    command: 'updateAssistantMessage';
    messageId: string;
    text: string;
};

type WebviewLoadingMessage = {
    command: 'setLoading';
    value: boolean;
};

type WebviewHydrateMessage = {
    command: 'hydrateState';
    sessions: Array<{ id: string; title: string; updatedAt: number; pinned: boolean }>;
    activeSessionId?: string;
    messages: Array<{ role: 'user' | 'assistant'; text: string }>;
    contextSummary: string;
    intentSummary: string;
    taskSummary: string;
    model: string;
};

type WebviewContextSummaryMessage = {
    command: 'setContextSummary';
    text: string;
};

type WebviewIntentSummaryMessage = {
    command: 'setIntentSummary';
    text: string;
};

type WebviewTaskSummaryMessage = {
    command: 'setTaskSummary';
    text: string;
};

type WebviewSelectionReviewPayload = {
    reviewId: string;
    filePath: string;
    requestSummary: string;
    statsText: string;
    diffText: string;
};

type WebviewSelectionReviewMessage = {
    command: 'setPendingSelectionReview';
    review: WebviewSelectionReviewPayload | null;
};

type WebviewMessage =
    | WebviewChatMessage
    | WebviewBeginAssistantMessage
    | WebviewUpdateAssistantMessage
    | WebviewLoadingMessage
    | WebviewHydrateMessage
    | WebviewContextSummaryMessage
    | WebviewIntentSummaryMessage
    | WebviewTaskSummaryMessage
    | WebviewSelectionReviewMessage;

type PendingSelectionReview = WebviewSelectionReviewPayload & {
    sessionId: string;
    documentUri: vscode.Uri;
    languageId: string;
    originalVersion: number;
    originalCode: string;
    modifiedCode: string;
    selectionRange: vscode.Range;
};

export class CodyViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private isReady = false;
    private readonly pendingMessages: WebviewMessage[] = [];
    private readonly chatState: CodyChatState;
    private persistQueue: Promise<void> = Promise.resolve();
    private deferredPersistHandle?: ReturnType<typeof setTimeout>;
    private readonly pendingSelectionReviews = new Map<string, PendingSelectionReview>();

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly outputChannel: vscode.OutputChannel,
        private readonly askOllama: AskOllama,
        private readonly storage: vscode.Memento
    ) {
        this.chatState = loadChatState(storage);
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        this.isReady = false;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = getChatWebviewContent(webviewView.webview, getCodySettings().model);

        webviewView.webview.onDidReceiveMessage(async message => {
            if (message.command === 'ready') {
                this.isReady = true;
                this.postHydratedState();
                this.flushPendingMessages();
                return;
            }

            if (message.command === 'ask') {
                await this.handlePrompt({ prompt: message.text });
                return;
            }

            if (message.command === 'createSession') {
                await this.createSession();
                return;
            }

            if (message.command === 'selectSession') {
                await this.selectSession(message.sessionId);
                return;
            }

            if (message.command === 'renameSession') {
                await this.renameSession(message.sessionId);
                return;
            }

            if (message.command === 'deleteSession') {
                await this.deleteSession(message.sessionId);
                return;
            }

            if (message.command === 'togglePinSession') {
                await this.togglePinSession(message.sessionId);
                return;
            }

            if (message.command === 'clearHistory') {
                await this.clearHistory();
                return;
            }

            if (message.command === 'executeCommand') {
                await this.executeCommand(message.commandName);
                return;
            }

            if (message.command === 'resolveSelectionReview') {
                await this.resolveSelectionReview(message.reviewId, message.action);
            }
        });

        webviewView.title = 'Cody Assistant';
        webviewView.description = 'Assistente de codigo local';
    }

    reveal(): void {
        this.view?.show?.(true);
    }

    refresh(): void {
        this.postHydratedState();
    }

    getActiveTaskSession(): CodyTaskSession | undefined {
        return this.ensureActiveSession().taskSession;
    }

    async setActiveTaskSession(taskSession: CodyTaskSession | undefined): Promise<void> {
        const activeSession = this.ensureActiveSession();
        activeSession.taskSession = taskSession;
        activeSession.updatedAt = Date.now();
        this.postMessage({ command: 'setTaskSummary', text: this.getTaskSummaryText(activeSession) });
        await this.persistChatState();
        this.postHydratedState();
    }

    async sendPrompt({ prompt, userMessage, includeProjectContext = true, routeIntent = true }: CodyPromptRequest): Promise<void> {
        await vscode.commands.executeCommand('cody-assistant.chat');
        await this.handlePrompt({ prompt, userMessage, includeProjectContext, routeIntent });
    }

    async presentSelectionEditReview({
        requestSummary,
        documentUri,
        documentLabel,
        languageId,
        originalVersion,
        selectionRange,
        originalCode,
        modifiedCode
    }: {
        requestSummary: string;
        documentUri: vscode.Uri;
        documentLabel: string;
        languageId: string;
        originalVersion: number;
        selectionRange: vscode.Range;
        originalCode: string;
        modifiedCode: string;
    }): Promise<void> {
        const session = this.ensureActiveSession();
        const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const diffPreview = buildDiffPreview(originalCode, modifiedCode);

        this.pendingSelectionReviews.set(session.id, {
            reviewId,
            sessionId: session.id,
            filePath: documentLabel,
            requestSummary,
            statsText: diffPreview.statsText,
            diffText: diffPreview.diffText,
            documentUri,
            languageId,
            originalVersion,
            originalCode,
            modifiedCode,
            selectionRange
        });

        await vscode.commands.executeCommand('cody-assistant.chat');
        this.appendAssistantNotice(
            session.id,
            `Preparei uma proposta de alteracao para ${documentLabel}. Revise o diff no chat e escolha aplicar, cancelar ou abrir o diff nativo.`
        );
        this.postSelectionReview(session.id);
    }

    private async executeCommand(commandName: string): Promise<void> {
        try {
            switch (commandName) {
                case 'explainCode':
                    await vscode.commands.executeCommand('cody-assistant.explainCode');
                    break;
                case 'editFile':
                    await vscode.commands.executeCommand('cody-assistant.editFile');
                    break;
                case 'generateCode':
                    await vscode.commands.executeCommand('cody-assistant.generateCode');
                    break;
                case 'continueTask':
                    await vscode.commands.executeCommand('cody-assistant.continueProjectTask');
                    break;
                case 'switchModel':
                    await vscode.commands.executeCommand('cody-assistant.switchModel');
                    break;
            }
        } catch (error) {
            this.outputChannel.appendLine(`Erro ao executar comando ${commandName}: ${error}`);
        }
    }

    private async handlePrompt({ prompt, userMessage, includeProjectContext = true, routeIntent = true }: CodyPromptRequest): Promise<void> {
        const activeSession = this.ensureActiveSession();
        const activeSessionId = activeSession.id;
        const visibleMessage = userMessage ?? prompt;
        const editor = vscode.window.activeTextEditor;
        const hasSelection = Boolean(editor && !editor.selection.isEmpty && editor.document.getText(editor.selection));
        const intent = detectChatIntent(visibleMessage, hasSelection);
        const historySnapshot = [...activeSession.history];
        const userEntry: CodyChatHistoryEntry = {
            role: 'user',
            text: visibleMessage,
            prompt
        };

        if (activeSession.history.length === 0 && activeSession.title === 'Nova conversa') {
            activeSession.title = buildSessionTitleFromMessage(visibleMessage);
        }

        activeSession.intentSummary = getIntentSummary(intent);
        this.postMessage({ command: 'setIntentSummary', text: activeSession.intentSummary });
        this.postMessage({ command: 'setTaskSummary', text: this.getTaskSummaryText(activeSession) });
        this.appendHistoryEntry(activeSession, userEntry);
        this.postMessage({ command: 'addMessage', role: 'user', text: visibleMessage });
        this.outputChannel.appendLine(`Chat: ${visibleMessage.substring(0, 100)}...`);

        if (routeIntent && await this.tryRouteIntent(intent, activeSessionId, visibleMessage)) {
            this.postMessage({ command: 'setLoading', value: false });
            return;
        }

        this.postMessage({ command: 'setLoading', value: true });
        const assistantMessageId = createStreamMessageId();
        let assistantStreamStarted = false;

        try {
            const projectContext = includeProjectContext ? await collectProjectContext() : undefined;
            const contextSummary = projectContext?.summary ?? 'Sem contexto automatico adicional';
            let streamedResponse = '';
            const currentSession = this.getSessionById(activeSessionId) ?? this.ensureActiveSession();

            currentSession.contextSummary = contextSummary;
            this.postMessage({ command: 'setContextSummary', text: contextSummary });
            this.outputChannel.appendLine(`Contexto do chat: ${contextSummary}`);
            await this.persistChatState();
            this.postHydratedState();
            this.postMessage({ command: 'beginAssistantMessage', messageId: assistantMessageId });
            assistantStreamStarted = true;

            const response = await this.askOllama(prompt, {
                history: historySnapshot,
                projectContext,
                onStreamChunk: async chunk => {
                    streamedResponse += chunk;
                    this.upsertStreamingAssistantEntry(activeSessionId, streamedResponse);
                    this.postMessage({
                        command: 'updateAssistantMessage',
                        messageId: assistantMessageId,
                        text: streamedResponse
                    });
                }
            });
            this.upsertStreamingAssistantEntry(activeSessionId, response);
            await this.persistChatState();
            this.postHydratedState();
            if (!streamedResponse) {
                this.postMessage({
                    command: 'updateAssistantMessage',
                    messageId: assistantMessageId,
                    text: response
                });
            }
        } catch (error) {
            const errorMessage = `Erro: ${error instanceof Error ? error.message : String(error)}`;
            this.upsertStreamingAssistantEntry(activeSessionId, errorMessage);
            await this.persistChatState();
            this.postHydratedState();
            if (assistantStreamStarted) {
                this.postMessage({
                    command: 'updateAssistantMessage',
                    messageId: assistantMessageId,
                    text: errorMessage
                });
            } else {
                this.postMessage({
                    command: 'addMessage',
                    role: 'assistant',
                    text: errorMessage
                });
            }
        } finally {
            this.postMessage({ command: 'setLoading', value: false });
        }
    }

    private async tryRouteIntent(
        intent: CodyChatIntent,
        activeSessionId: string,
        visibleMessage: string
    ): Promise<boolean> {
        const resolvedIntent = await this.confirmIntent(intent, visibleMessage);
        const activeSession = this.getSessionById(activeSessionId) ?? this.ensureActiveSession();

        if (!resolvedIntent) {
            activeSession.intentSummary = 'Modo atual: execucao automatica cancelada';
            this.postMessage({ command: 'setIntentSummary', text: activeSession.intentSummary });
            this.appendAssistantNotice(
                activeSession.id,
                'Nenhum fluxo estruturado foi executado. Se quiser, reformule o pedido ou continue a conversa normalmente.'
            );
            await this.persistChatState();
            this.postHydratedState();
            return true;
        }

        activeSession.intentSummary = getIntentSummary(resolvedIntent);
        this.postMessage({ command: 'setIntentSummary', text: activeSession.intentSummary });

        switch (resolvedIntent.type) {
            case 'analyzeProject':
                activeSession.contextSummary = 'Fluxo acionado: analise profunda do projeto a partir do chat';
                this.postMessage({ command: 'setContextSummary', text: activeSession.contextSummary });
                this.appendAssistantNotice(
                    activeSession.id,
                    'Entendi isso como um pedido de analise profunda. Vou abrir o fluxo de analise do projeto com esse foco.'
                );
                await this.persistChatState();
                this.postHydratedState();
                await vscode.commands.executeCommand('cody-assistant.analyzeProject', resolvedIntent.request);
                return true;
            case 'planProjectTask':
                activeSession.contextSummary = 'Fluxo acionado: planejamento seguro e execucao por arquivo';
                this.postMessage({ command: 'setContextSummary', text: activeSession.contextSummary });
                this.appendAssistantNotice(
                    activeSession.id,
                    'Entendi isso como uma mudanca real no projeto. Vou acionar o planejador seguro para montar um plano por arquivo e executar com diff.'
                );
                await this.persistChatState();
                this.postHydratedState();
                await vscode.commands.executeCommand('cody-assistant.planProjectTask', resolvedIntent.request);
                return true;
            case 'continueTask':
                activeSession.contextSummary = 'Fluxo acionado: continuacao da tarefa ativa';
                this.postMessage({ command: 'setContextSummary', text: activeSession.contextSummary });
                this.appendAssistantNotice(
                    activeSession.id,
                    'Vou retomar a tarefa ativa com base no objetivo e no progresso ja salvos nesta conversa.'
                );
                await this.persistChatState();
                this.postHydratedState();
                await vscode.commands.executeCommand('cody-assistant.continueProjectTask');
                return true;
            case 'explainSelection':
                activeSession.contextSummary = 'Fluxo acionado: explicacao da selecao atual';
                this.postMessage({ command: 'setContextSummary', text: activeSession.contextSummary });
                await this.persistChatState();
                this.postHydratedState();
                await vscode.commands.executeCommand('cody-assistant.explainCode', resolvedIntent.request);
                return true;
            case 'editSelection':
                activeSession.contextSummary = 'Fluxo acionado: edicao segura da selecao atual';
                this.postMessage({ command: 'setContextSummary', text: activeSession.contextSummary });
                this.appendAssistantNotice(
                    activeSession.id,
                    'Vou tratar isso como uma edicao segura da selecao atual, com geracao de diff antes de aplicar.'
                );
                await this.persistChatState();
                this.postHydratedState();
                await vscode.commands.executeCommand('cody-assistant.editFile', visibleMessage);
                return true;
            case 'createFile':
                activeSession.contextSummary = 'Fluxo acionado: criacao guiada de arquivo a partir do chat';
                this.postMessage({ command: 'setContextSummary', text: activeSession.contextSummary });
                this.appendAssistantNotice(
                    activeSession.id,
                    'Vou abrir a criacao guiada de arquivo usando a sua descricao como ponto de partida.'
                );
                await this.persistChatState();
                this.postHydratedState();
                await vscode.commands.executeCommand('cody-assistant.createFile', {
                    description: resolvedIntent.request,
                    suggestedFileName: resolvedIntent.suggestedFileName
                });
                return true;
            case 'createProject':
                activeSession.contextSummary = 'Fluxo acionado: criacao guiada de projeto a partir do chat';
                this.postMessage({ command: 'setContextSummary', text: activeSession.contextSummary });
                this.appendAssistantNotice(
                    activeSession.id,
                    'Vou abrir a criacao de projeto usando sua descricao como base inicial.'
                );
                await this.persistChatState();
                this.postHydratedState();
                await vscode.commands.executeCommand('cody-assistant.createProject', {
                    description: resolvedIntent.request,
                    forceCustom: true
                });
                return true;
            default:
                return false;
        }
    }

    private async confirmIntent(intent: CodyChatIntent, visibleMessage: string): Promise<CodyChatIntent | undefined> {
        if (!isStructuredIntent(intent)) {
            return intent;
        }

        const selection = await vscode.window.showQuickPick(this.buildIntentOptions(intent, visibleMessage), {
            placeHolder: `Modo detectado: ${getIntentLabel(intent)}. Como voce quer tratar esta mensagem?`
        });

        return selection?.intent;
    }

    private buildIntentOptions(
        intent: CodyChatIntent,
        visibleMessage: string
    ): Array<{ label: string; description: string; detail?: string; intent: CodyChatIntent }> {
        const options: Array<{ label: string; description: string; detail?: string; intent: CodyChatIntent }> = [
            {
                label: `$(sparkle) ${getIntentLabel(intent)} (Recomendado)`,
                description: 'Executa o modo detectado automaticamente.',
                detail: visibleMessage,
                intent
            },
            {
                label: '$(comment-discussion) Conversa normal',
                description: 'Responde no chat sem disparar fluxo estruturado.',
                intent: { type: 'general' }
            }
        ];

        if (intent.type !== 'analyzeProject') {
            options.push({
                label: '$(search) Analise profunda',
                description: 'Abre a analise detalhada do projeto.',
                intent: { type: 'analyzeProject', request: visibleMessage }
            });
        }

        if (intent.type !== 'planProjectTask') {
            options.push({
                label: '$(tools) Planejar e aplicar',
                description: 'Monta um plano seguro por arquivo e executa com diff.',
                intent: { type: 'planProjectTask', request: visibleMessage }
            });
        }

        if (this.ensureActiveSession().taskSession && intent.type !== 'continueTask') {
            options.push({
                label: '$(history) Continuar tarefa',
                description: 'Retoma o objetivo ativo sem precisar repetir o contexto.',
                intent: { type: 'continueTask' }
            });
        }

        if (intent.type !== 'createFile') {
            options.push({
                label: '$(new-file) Criar arquivo',
                description: 'Abre a criacao guiada de um novo arquivo.',
                intent: { type: 'createFile', request: visibleMessage }
            });
        }

        if (intent.type !== 'createProject') {
            options.push({
                label: '$(folder-library) Criar projeto',
                description: 'Abre a criacao guiada de um novo projeto.',
                intent: { type: 'createProject', request: visibleMessage }
            });
        }

        return options;
    }

    async clearHistory(): Promise<void> {
        const activeSession = this.ensureActiveSession();
        activeSession.history = [];
        activeSession.contextSummary = 'Sem contexto automatico adicional';
        activeSession.intentSummary = 'Modo atual: conversa normal';
        activeSession.taskSession = undefined;
        activeSession.updatedAt = Date.now();
        await this.persistChatState();
        this.postHydratedState();
        this.outputChannel.appendLine(`Historico do chat limpo para a conversa ${activeSession.id}`);
    }

    private async createSession(): Promise<void> {
        const newSession = createChatSession();
        this.chatState.sessions.unshift(newSession);
        this.chatState.activeSessionId = newSession.id;
        await this.persistChatState();
        this.postHydratedState();
    }

    private async selectSession(sessionId: string): Promise<void> {
        const session = this.chatState.sessions.find(item => item.id === sessionId);
        if (!session) {
            return;
        }

        this.chatState.activeSessionId = session.id;
        await this.persistChatState();
        this.postHydratedState();
    }

    private async renameSession(sessionId: string): Promise<void> {
        const session = this.chatState.sessions.find(item => item.id === sessionId);
        if (!session) {
            return;
        }

        const renamed = await vscode.window.showInputBox({
            prompt: 'Novo nome para a conversa',
            value: session.title,
            placeHolder: 'Ex: API do cliente X'
        });

        if (!renamed?.trim()) {
            return;
        }

        session.title = renamed.trim();
        session.updatedAt = Date.now();
        await this.persistChatState();
        this.postHydratedState();
    }

    private async deleteSession(sessionId: string): Promise<void> {
        const session = this.chatState.sessions.find(item => item.id === sessionId);
        if (!session) {
            return;
        }

        const confirmation = await vscode.window.showWarningMessage(
            `Excluir a conversa "${session.title}"?`,
            { modal: true },
            'Excluir'
        );

        if (confirmation !== 'Excluir') {
            return;
        }

        this.chatState.sessions = this.chatState.sessions.filter(item => item.id !== sessionId);

        if (this.chatState.sessions.length === 0) {
            const replacement = createChatSession();
            this.chatState.sessions = [replacement];
            this.chatState.activeSessionId = replacement.id;
        } else if (this.chatState.activeSessionId === sessionId) {
            this.chatState.activeSessionId = this.chatState.sessions[0].id;
        }

        await this.persistChatState();
        this.postHydratedState();
    }

    private async togglePinSession(sessionId: string): Promise<void> {
        const session = this.chatState.sessions.find(item => item.id === sessionId);
        if (!session) {
            return;
        }

        session.pinned = !session.pinned;
        session.updatedAt = Date.now();
        await this.persistChatState();
        this.postHydratedState();
    }

    private appendHistoryEntry(session: CodyChatSession, entry: CodyChatHistoryEntry): void {
        session.history.push(entry);
        session.updatedAt = Date.now();
        void this.persistChatState();
        this.postHydratedState();
    }

    private upsertStreamingAssistantEntry(sessionId: string, text: string): void {
        const session = this.getSessionById(sessionId);
        if (!session) {
            return;
        }

        const lastEntry = session.history.at(-1);

        if (lastEntry?.role === 'assistant') {
            lastEntry.text = text;
        } else {
            session.history.push({
                role: 'assistant',
                text
            });
        }

        session.updatedAt = Date.now();
        this.schedulePersistChatState();
    }

    private appendAssistantNotice(sessionId: string, text: string): void {
        const session = this.getSessionById(sessionId);
        if (!session) {
            return;
        }

        this.appendHistoryEntry(session, {
            role: 'assistant',
            text
        });
        this.postMessage({
            command: 'addMessage',
            role: 'assistant',
            text
        });
    }

    private async resolveSelectionReview(reviewId: string, action: 'apply' | 'cancel' | 'openNative'): Promise<void> {
        const review = [...this.pendingSelectionReviews.values()].find(candidate => candidate.reviewId === reviewId);
        if (!review) {
            return;
        }

        switch (action) {
            case 'openNative':
                await openSelectionDiffPreview({
                    documentUri: review.documentUri,
                    documentLabel: review.filePath,
                    languageId: review.languageId,
                    originalCode: review.originalCode,
                    modifiedCode: review.modifiedCode,
                    selectionRange: review.selectionRange
                });
                this.appendAssistantNotice(review.sessionId, `Abri o diff nativo do VS Code para ${review.filePath}.`);
                this.postSelectionReview(review.sessionId);
                return;
            case 'cancel':
                this.pendingSelectionReviews.delete(review.sessionId);
                this.appendAssistantNotice(review.sessionId, `Revisao cancelada para ${review.filePath}. Nenhuma alteracao foi aplicada.`);
                this.postSelectionReview(review.sessionId);
                return;
            case 'apply': {
                const outcome = await applySelectionEditSafely({
                    documentUri: review.documentUri,
                    originalVersion: review.originalVersion,
                    originalCode: review.originalCode,
                    modifiedCode: review.modifiedCode,
                    selectionRange: review.selectionRange
                });

                if (outcome.applied) {
                    this.pendingSelectionReviews.delete(review.sessionId);
                    this.appendAssistantNotice(review.sessionId, `Alteracao aplicada com sucesso em ${review.filePath}.`);
                    vscode.window.showInformationMessage('Alteracao aplicada com sucesso.');
                } else {
                    this.pendingSelectionReviews.delete(review.sessionId);
                    this.appendAssistantNotice(
                        review.sessionId,
                        `Nao foi possivel aplicar a alteracao em ${review.filePath}: ${outcome.reason ?? 'falha desconhecida'}.`
                    );
                }

                this.postSelectionReview(review.sessionId);
                return;
            }
        }
    }

    private ensureActiveSession(): CodyChatSession {
        let session = this.chatState.sessions.find(item => item.id === this.chatState.activeSessionId);

        if (!session) {
            session = this.chatState.sessions[0];
        }

        if (!session) {
            session = createChatSession();
            this.chatState.sessions = [session];
        }

        this.chatState.activeSessionId = session.id;
        return session;
    }

    private getSessionById(sessionId: string): CodyChatSession | undefined {
        return this.chatState.sessions.find(session => session.id === sessionId);
    }

    private postSelectionReview(sessionId: string): void {
        const activeSession = this.ensureActiveSession();
        const review = activeSession.id === sessionId
            ? this.pendingSelectionReviews.get(sessionId)
            : this.pendingSelectionReviews.get(activeSession.id);

        this.postMessage({
            command: 'setPendingSelectionReview',
            review: review
                ? {
                    reviewId: review.reviewId,
                    filePath: review.filePath,
                    requestSummary: review.requestSummary,
                    statsText: review.statsText,
                    diffText: review.diffText
                }
                : null
        });
    }

    private async persistChatState(): Promise<void> {
        if (this.deferredPersistHandle) {
            clearTimeout(this.deferredPersistHandle);
            this.deferredPersistHandle = undefined;
        }

        const snapshot = cloneChatState(this.chatState);

        this.persistQueue = this.persistQueue.then(async () => {
            await saveChatState(this.storage, snapshot);
        });

        await this.persistQueue;
    }

    private schedulePersistChatState(delayMs: number = 700): void {
        if (this.deferredPersistHandle) {
            clearTimeout(this.deferredPersistHandle);
        }

        this.deferredPersistHandle = setTimeout(() => {
            this.deferredPersistHandle = undefined;
            void this.persistChatState();
        }, delayMs);
    }

    private postHydratedState(): void {
        const activeSession = this.ensureActiveSession();

        this.postMessage({
            command: 'hydrateState',
            sessions: [...this.chatState.sessions]
                .sort((left, right) => {
                    if (left.pinned !== right.pinned) {
                        return left.pinned ? -1 : 1;
                    }

                    return right.updatedAt - left.updatedAt;
                })
                .map(session => ({
                    id: session.id,
                    title: session.title,
                    updatedAt: session.updatedAt,
                    pinned: session.pinned
                })),
            activeSessionId: activeSession.id,
            messages: activeSession.history.map(entry => ({ role: entry.role, text: entry.text })),
            contextSummary: activeSession.contextSummary ?? 'Sem contexto automatico adicional',
            intentSummary: activeSession.intentSummary ?? 'Modo atual: conversa normal',
            taskSummary: this.getTaskSummaryText(activeSession),
            model: getCodySettings().model
        });
        this.postSelectionReview(activeSession.id);
    }

    private getTaskSummaryText(session: CodyChatSession): string {
        const taskSession = session.taskSession;
        if (!taskSession) {
            return 'Tarefa ativa: nenhuma';
        }

        const doneSteps = taskSession.stepStates.filter(step => step.status === 'applied').length;
        const totalSteps = taskSession.stepStates.length;
        const suffix = totalSteps > 0 ? ` | Progresso: ${doneSteps}/${totalSteps}` : '';
        return `Tarefa ativa: ${taskSession.goal} | Status: ${taskSession.status}${suffix}`;
    }

    private postMessage(message: WebviewMessage): void {
        if (!this.view || !this.isReady) {
            this.pendingMessages.push(message);
            return;
        }

        void this.view.webview.postMessage(message);
    }

    private flushPendingMessages(): void {
        if (!this.view || !this.isReady) {
            return;
        }

        for (const message of this.pendingMessages.splice(0)) {
            void this.view.webview.postMessage(message);
        }
    }

}

function cloneChatState(state: CodyChatState): CodyChatState {
    return {
        activeSessionId: state.activeSessionId,
        sessions: state.sessions.map(session => ({
            ...session,
            history: session.history.map(entry => ({ ...entry }))
        }))
    };
}

function createStreamMessageId(): string {
    return `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
