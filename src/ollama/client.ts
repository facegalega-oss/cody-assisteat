import * as vscode from 'vscode';
import { Ollama } from 'ollama';
import { Agent, fetch as undiciFetch } from 'undici';

import { getCodySettings, type CodySettings } from '../core/config';
import { MAX_CONTEXT_MESSAGES } from '../core/constants';
import type { AskOllamaOptions, CodyChatHistoryEntry, CodyProjectContext } from '../core/types';

type CodyOllamaRequest = {
    model: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    options: {
        temperature: number;
        num_predict: number;
    };
    keep_alive: string | number;
};

export class CodyOllamaClient {
    private readonly dispatcher = new Agent({
        headersTimeout: 300_000,
        bodyTimeout: 0,
        connectTimeout: 30_000
    });

    constructor(
        private readonly outputChannel: vscode.OutputChannel,
        private readonly settingsProvider: () => CodySettings = getCodySettings
    ) {}

    async askPrompt(prompt: string, options?: AskOllamaOptions): Promise<string> {
        const settings = this.settingsProvider();
        const requestTimeoutMs = options?.timeoutMs ?? settings.requestTimeoutMs;

        try {
            const response = await this.withHostFallback(settings, async currentHost => {
                const client = this.createClient(currentHost, requestTimeoutMs);
                const request: CodyOllamaRequest = {
                    model: settings.model,
                    messages: [
                        { role: 'system', content: settings.systemPrompt },
                        ...this.mapProjectContextToMessages(options?.projectContext),
                        ...this.mapHistoryToMessages(options?.history),
                        { role: 'user', content: prompt }
                    ],
                    options: {
                        temperature: settings.temperature,
                        num_predict: options?.maxTokens ?? settings.maxTokens
                    },
                    keep_alive: this.toKeepAliveValue(settings.keepAliveMinutes)
                };

                if (options?.onStreamChunk) {
                    return await this.chatWithStreamFallback(client, request, options.onStreamChunk);
                }

                const nonStreamResponse = await client.chat(request);
                return nonStreamResponse.message.content;
            });

            return response.trim();
        } catch (error) {
            this.outputChannel.appendLine(`Erro no Ollama: ${this.describeError(error)}`);
            throw new Error(
                `Nao foi possivel consultar o Ollama em ${settings.ollamaHost} usando o modelo ${settings.model}. ${this.describeError(error)}`
            );
        }
    }

    async testConnection(showNotifications: boolean = false): Promise<boolean> {
        const settings = this.settingsProvider();

        try {
            const response = await this.withHostFallback(settings, async currentHost => {
                const client = this.createClient(currentHost, settings.requestTimeoutMs);
                return client.list();
            });
            const models = response.models.map(model => model.name).join(', ');
            const hasConfiguredModel = response.models.some(model => model.name === settings.model);

            this.outputChannel.appendLine(`Ollama conectado em ${settings.ollamaHost}. Modelos: ${models || 'nenhum modelo encontrado'}`);

            if (showNotifications) {
                if (hasConfiguredModel) {
                    vscode.window.showInformationMessage(`Cody: Ollama conectado. Modelo ${settings.model} disponivel.`);
                } else {
                    vscode.window.showWarningMessage(`Cody: Ollama conectado, mas o modelo ${settings.model} nao foi encontrado.`);
                }
            }

            return hasConfiguredModel;
        } catch (error) {
            this.outputChannel.appendLine(`Erro ao conectar com Ollama: ${this.describeError(error)}`);

            if (showNotifications) {
                vscode.window.showErrorMessage(`Cody: Nao foi possivel conectar ao Ollama em ${settings.ollamaHost}. ${this.describeError(error)}`);
            }

            return false;
        }
    }

    async listModels(): Promise<Array<{ name: string; size: number; modifiedAt: string }>> {
        const settings = this.settingsProvider();

        const response = await this.withHostFallback(settings, async currentHost => {
            const client = this.createClient(currentHost, settings.requestTimeoutMs);
            return client.list();
        });

        return response.models
            .map(model => ({
                name: model.name,
                size: model.size,
                modifiedAt: model.modified_at instanceof Date
                    ? model.modified_at.toISOString()
                    : String(model.modified_at)
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    private createClient(host: string, requestTimeoutMs: number): Ollama {
        return new Ollama({
            host,
            fetch: (input, init) => this.fetchWithTimeout(input, init, requestTimeoutMs)
        });
    }

    private async chatWithStreamFallback(
        client: Ollama,
        request: CodyOllamaRequest,
        onStreamChunk: (chunk: string) => void | Promise<void>
    ): Promise<string> {
        let fullResponse = '';
        let streamedAnyContent = false;

        try {
            const stream = await client.chat({
                ...request,
                stream: true
            });

            for await (const chunk of stream) {
                const content = chunk.message.content ?? '';
                if (!content) {
                    continue;
                }

                streamedAnyContent = true;
                fullResponse += content;
                await onStreamChunk(content);
            }

            return fullResponse;
        } catch (error) {
            if (streamedAnyContent) {
                throw error;
            }

            this.outputChannel.appendLine(`Stream do Ollama falhou antes do primeiro chunk. Tentando fallback sem stream... ${this.describeError(error)}`);

            const fallbackResponse = await client.chat(request);
            const fallbackContent = fallbackResponse.message.content ?? '';

            if (fallbackContent) {
                await onStreamChunk(fallbackContent);
            }

            return fallbackContent;
        }
    }

    private mapHistoryToMessages(history: CodyChatHistoryEntry[] | undefined): Array<{ role: 'user' | 'assistant'; content: string }> {
        if (!history || history.length === 0) {
            return [];
        }

        return history.slice(-MAX_CONTEXT_MESSAGES).map(entry => ({
            role: entry.role,
            content: entry.role === 'user' ? entry.prompt ?? entry.text : entry.text
        }));
    }

    private mapProjectContextToMessages(projectContext: CodyProjectContext | undefined): Array<{ role: 'system'; content: string }> {
        if (!projectContext) {
            return [];
        }

        return [{
            role: 'system',
            content: `Use este contexto automatico do projeto apenas quando ele for relevante para responder.\n\n${projectContext.promptSection}`
        }];
    }

    private async withHostFallback<T>(settings: CodySettings, operation: (host: string) => Promise<T>): Promise<T> {
        const candidateHosts = this.buildCandidateHosts(settings.ollamaHost);
        let lastError: unknown;

        for (const host of candidateHosts) {
            try {
                if (host !== settings.ollamaHost) {
                    this.outputChannel.appendLine(`Tentando fallback do Ollama em ${host}...`);
                }

                const result = await operation(host);

                if (host !== settings.ollamaHost) {
                    this.outputChannel.appendLine(`Fallback do Ollama funcionou em ${host}.`);
                }

                return result;
            } catch (error) {
                lastError = error;
                this.outputChannel.appendLine(`Falha ao consultar Ollama em ${host}: ${this.describeError(error)}`);
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error(typeof lastError === 'string' ? lastError : 'Falha desconhecida ao consultar o Ollama.');
    }

    private buildCandidateHosts(configuredHost: string): string[] {
        const normalized = configuredHost.trim();
        const candidates = [normalized];

        if (normalized.includes('localhost')) {
            candidates.push(normalized.replace('localhost', '127.0.0.1'));
        } else if (normalized.includes('127.0.0.1')) {
            candidates.push(normalized.replace('127.0.0.1', 'localhost'));
        }

        return [...new Set(candidates)];
    }

    private toKeepAliveValue(keepAliveMinutes: number): string | number {
        if (keepAliveMinutes <= 0) {
            return 0;
        }

        return `${keepAliveMinutes}m`;
    }

    private describeError(error: unknown): string {
        if (error instanceof Error) {
            const details = [error.message];
            const cause = (error as Error & { cause?: unknown }).cause;

            if (cause instanceof Error && cause.message && cause.message !== error.message) {
                details.push(`causa: ${cause.message}`);
            } else if (typeof cause === 'string' && cause !== error.message) {
                details.push(`causa: ${cause}`);
            }

            if (error.message === 'fetch failed') {
                details.push('sugestao: confirme o host do Ollama e tente usar http://127.0.0.1:11434 nas configuracoes do Cody');
            }

            if (/headers timeout/i.test(error.message)) {
                details.push('dica: o modelo pode estar demorando para carregar; aumente o timeout do Cody ou use um modelo menor');
            }

            return details.join(' | ');
        }

        return String(error);
    }

    private async fetchWithTimeout(
        input: unknown,
        init: unknown,
        requestTimeoutMs: number
    ): Promise<Response> {
        const signals: AbortSignal[] = [];
        const normalizedInit = (init ?? {}) as RequestInit;

        if (normalizedInit.signal) {
            signals.push(normalizedInit.signal);
        }

        if (requestTimeoutMs > 0) {
            signals.push(AbortSignal.timeout(requestTimeoutMs));
        }

        const signal = signals.length === 0
            ? undefined
            : signals.length === 1
                ? signals[0]
                : AbortSignal.any(signals);

        return await undiciFetch(input as never, {
            ...(normalizedInit as Record<string, unknown>),
            signal,
            dispatcher: this.dispatcher
        } as never) as unknown as Response;
    }
}
