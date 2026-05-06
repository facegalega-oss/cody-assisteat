import * as vscode from 'vscode';

import { CodyViewProvider } from './chat/chatViewProvider';
import { registerCodyCommands } from './commands/registerCommands';
import { getCodySettings } from './core/config';
import { CODY_CONFIGURATION_SECTION, CODY_VIEW_ID, OUTPUT_CHANNEL_NAME } from './core/constants';
import type { AskOllama } from './core/types';
import { CodyOllamaClient } from './ollama/client';
import { VsixUpdater } from './update/vsixUpdater';

export function activate(context: vscode.ExtensionContext): void {
    const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    outputChannel.appendLine('Cody Assistant ativado');

    const ollamaClient = new CodyOllamaClient(outputChannel, getCodySettings);
    const askOllama: AskOllama = (prompt, options) => ollamaClient.askPrompt(prompt, options);
    const vsixUpdater = new VsixUpdater(context, outputChannel);

    const viewProvider = new CodyViewProvider(
        context.extensionUri,
        outputChannel,
        askOllama,
        context.workspaceState
    );

    context.subscriptions.push(
        outputChannel,
        vscode.window.registerWebviewViewProvider(CODY_VIEW_ID, viewProvider)
    );

    registerCodyCommands({
        context,
        viewProvider,
        askOllama,
        listAvailableModels: () => ollamaClient.listModels(),
        checkLocalVsixUpdate: () => vsixUpdater.checkForUpdates({ manual: true })
    });

    const settings = getCodySettings();
    outputChannel.appendLine(`Configuracao ativa: host=${settings.ollamaHost}, model=${settings.model}`);

    if (settings.checkConnectionOnStartup) {
        void ollamaClient.testConnection(settings.showStartupNotifications);
    }

    context.subscriptions.push(
        vsixUpdater,
        vscode.workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration(CODY_CONFIGURATION_SECTION)) {
                return;
            }

            void vsixUpdater.reconfigure();
        })
    );

    void vsixUpdater.start();
}

export function deactivate(): void {
    // VS Code disposes subscriptions registered during activation.
}
