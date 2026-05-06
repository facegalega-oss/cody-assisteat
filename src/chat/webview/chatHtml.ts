import * as vscode from 'vscode';

import { CHAT_WEBVIEW_SCRIPT } from './chatScript';
import { CHAT_WEBVIEW_STYLES } from './chatStyles';

export function getChatWebviewContent(webview: vscode.Webview, model: string): string {
    const nonce = createNonce();

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"
    />
    <style nonce="${nonce}">
${CHAT_WEBVIEW_STYLES}
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="header">
            <h3>
                Cody Assistant
                <span class="badge" id="modelBadge">${escapeHtml(model)}</span>
            </h3>
            <div class="action-buttons">
                <button class="action-button" id="newSessionButton">Novo chat</button>
                <button class="action-button" id="switchModelButton">Trocar modelo</button>
                <button class="action-button" id="clearHistoryButton">Limpar chat</button>
            </div>
        </div>
        <div class="session-list" id="sessionList"></div>
        <div class="messages" id="messages"></div>
        <div class="intent-summary" id="intentSummary">Modo atual: conversa normal</div>
        <div class="task-summary" id="taskSummary">Tarefa ativa: nenhuma</div>
        <div class="context-summary" id="contextSummary">Contexto automatico: aguardando pergunta.</div>
        <div class="review-panel hidden" id="reviewPanel"></div>
        <div class="input-area">
            <textarea id="input" rows="3" placeholder="Digite sua pergunta... (Ctrl+Enter para enviar)"></textarea>
            <div class="action-buttons">
                <button class="action-button" data-quick-action="explique este codigo">Explicar</button>
                <button class="action-button" data-quick-action="refatore este codigo para melhor performance">Refatorar</button>
                <button class="action-button" data-quick-action="adicione comentarios ao codigo">Comentar</button>
                <button class="action-button" data-quick-action="crie testes unitarios para esta funcao">Testes</button>
            </div>
            <button id="sendButton">Enviar mensagem</button>
        </div>
        <div class="status">
            Modelo rodando localmente via Ollama
        </div>
    </div>
    <script nonce="${nonce}">
${CHAT_WEBVIEW_SCRIPT}
    </script>
</body>
</html>`;
}

function createNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';

    for (let index = 0; index < 32; index += 1) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return value;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
