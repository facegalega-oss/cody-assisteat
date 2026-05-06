export const CHAT_WEBVIEW_SCRIPT = `
    const vscode = acquireVsCodeApi();
    let isLoading = false;
    let activeAssistantMessageId = null;
    let activeReviewId = null;

    window.addEventListener('message', event => {
        if (event.data.command === 'hydrateState') {
            renderSessions(event.data.sessions, event.data.activeSessionId);
            renderHistory(event.data.messages);
            activeAssistantMessageId = null;
            document.getElementById('modelBadge').textContent = event.data.model;
            document.getElementById('intentSummary').textContent = event.data.intentSummary;
            document.getElementById('taskSummary').textContent = event.data.taskSummary;
            document.getElementById('contextSummary').textContent = 'Contexto automatico: ' + event.data.contextSummary;
            return;
        }

        if (event.data.command === 'setIntentSummary') {
            document.getElementById('intentSummary').textContent = event.data.text;
            return;
        }

        if (event.data.command === 'setTaskSummary') {
            document.getElementById('taskSummary').textContent = event.data.text;
            return;
        }

        if (event.data.command === 'setContextSummary') {
            document.getElementById('contextSummary').textContent = 'Contexto automatico: ' + event.data.text;
            return;
        }

        if (event.data.command === 'addMessage') {
            if (event.data.role === 'assistant') {
                removeTypingIndicator();
                activeAssistantMessageId = null;
            }

            addMessage(event.data.text, event.data.role);
            return;
        }

        if (event.data.command === 'beginAssistantMessage') {
            removeTypingIndicator();
            activeAssistantMessageId = event.data.messageId;
            addMessage('', 'assistant', event.data.messageId);
            return;
        }

        if (event.data.command === 'updateAssistantMessage') {
            removeTypingIndicator();
            activeAssistantMessageId = event.data.messageId;
            updateMessage(event.data.messageId, event.data.text);
            return;
        }

        if (event.data.command === 'setLoading') {
            isLoading = event.data.value;

            if (isLoading) {
                disableInput();
                addTypingIndicator();
            } else {
                activeAssistantMessageId = null;
                removeTypingIndicator();
                enableInput();
            }
            return;
        }

        if (event.data.command === 'setPendingSelectionReview') {
            renderSelectionReview(event.data.review);
        }
    });

    vscode.postMessage({ command: 'ready' });
    document.getElementById('newSessionButton').addEventListener('click', createSession);
    document.getElementById('switchModelButton').addEventListener('click', () => runCommand('switchModel'));
    document.getElementById('clearHistoryButton').addEventListener('click', clearHistory);
    document.getElementById('sendButton').addEventListener('click', sendMessage);

    for (const button of document.querySelectorAll('[data-quick-action]')) {
        button.addEventListener('click', () => sendQuickAction(button.getAttribute('data-quick-action') || ''));
    }

    function sendQuickAction(action) {
        const input = document.getElementById('input');
        input.value = action;
        sendMessage();
    }

    function createSession() {
        if (isLoading) return;
        vscode.postMessage({ command: 'createSession' });
    }

    function selectSession(sessionId) {
        if (isLoading) return;
        vscode.postMessage({ command: 'selectSession', sessionId });
    }

    function clearHistory() {
        if (isLoading) return;
        vscode.postMessage({ command: 'clearHistory' });
    }

    function runCommand(commandName) {
        if (isLoading) return;
        vscode.postMessage({ command: 'executeCommand', commandName });
    }

    function sendMessage() {
        if (isLoading) return;

        const input = document.getElementById('input');
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        disableInput();
        addTypingIndicator();

        isLoading = true;
        vscode.postMessage({ command: 'ask', text });
    }

    function renderHistory(messages) {
        const messagesDiv = document.getElementById('messages');
        messagesDiv.innerHTML = '';
        activeAssistantMessageId = null;

        if (!messages.length) {
            addWelcomeMessage();
            return;
        }

        for (const message of messages) {
            addMessage(message.text, message.role);
        }
    }

    function renderSelectionReview(review) {
        const reviewPanel = document.getElementById('reviewPanel');
        reviewPanel.innerHTML = '';

        if (!review) {
            activeReviewId = null;
            reviewPanel.classList.add('hidden');
            return;
        }

        activeReviewId = review.reviewId;
        reviewPanel.classList.remove('hidden');

        const title = document.createElement('div');
        title.className = 'review-title';
        title.innerHTML = '<strong>Diff pronto para revisao</strong><span class="badge">' + escapeHtml(review.statsText) + '</span>';

        const meta = document.createElement('div');
        meta.className = 'review-meta';
        meta.textContent = 'Arquivo: ' + review.filePath + ' | Pedido: ' + review.requestSummary;

        const diff = document.createElement('pre');
        diff.className = 'review-diff';
        diff.textContent = review.diffText;

        const actions = document.createElement('div');
        actions.className = 'review-actions';

        const applyButton = document.createElement('button');
        applyButton.className = 'review-apply';
        applyButton.textContent = 'Aplicar';
        applyButton.onclick = () => resolveSelectionReview('apply');

        const nativeButton = document.createElement('button');
        nativeButton.className = 'review-secondary';
        nativeButton.textContent = 'Abrir diff nativo';
        nativeButton.onclick = () => resolveSelectionReview('openNative');

        const cancelButton = document.createElement('button');
        cancelButton.className = 'review-secondary';
        cancelButton.textContent = 'Cancelar';
        cancelButton.onclick = () => resolveSelectionReview('cancel');

        actions.appendChild(applyButton);
        actions.appendChild(nativeButton);
        actions.appendChild(cancelButton);

        reviewPanel.appendChild(title);
        reviewPanel.appendChild(meta);
        reviewPanel.appendChild(diff);
        reviewPanel.appendChild(actions);
    }

    function renderSessions(sessions, activeSessionId) {
        const sessionList = document.getElementById('sessionList');
        sessionList.innerHTML = '';

        for (const session of sessions) {
            const item = document.createElement('div');
            item.className = 'session-item' + (session.id === activeSessionId ? ' active' : '');

            const mainButton = document.createElement('button');
            mainButton.className = 'session-main';
            mainButton.textContent = (session.pinned ? '[fixo] ' : '') + session.title;
            mainButton.title = session.title;
            mainButton.onclick = () => selectSession(session.id);

            const tools = document.createElement('div');
            tools.className = 'session-tools';

            const pinButton = document.createElement('button');
            pinButton.className = 'session-tool';
            pinButton.textContent = session.pinned ? 'Desafixar' : 'Fixar';
            pinButton.onclick = event => {
                event.stopPropagation();
                togglePinSession(session.id);
            };

            const renameButton = document.createElement('button');
            renameButton.className = 'session-tool';
            renameButton.textContent = 'Renomear';
            renameButton.onclick = event => {
                event.stopPropagation();
                renameSession(session.id);
            };

            const deleteButton = document.createElement('button');
            deleteButton.className = 'session-tool';
            deleteButton.textContent = 'Excluir';
            deleteButton.onclick = event => {
                event.stopPropagation();
                deleteSession(session.id);
            };

            tools.appendChild(pinButton);
            tools.appendChild(renameButton);
            tools.appendChild(deleteButton);

            item.appendChild(mainButton);
            item.appendChild(tools);
            sessionList.appendChild(item);
        }
    }

    function renameSession(sessionId) {
        if (isLoading) return;
        vscode.postMessage({ command: 'renameSession', sessionId });
    }

    function deleteSession(sessionId) {
        if (isLoading) return;
        vscode.postMessage({ command: 'deleteSession', sessionId });
    }

    function togglePinSession(sessionId) {
        if (isLoading) return;
        vscode.postMessage({ command: 'togglePinSession', sessionId });
    }

    function addMessage(text, role, messageId) {
        const messagesDiv = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message ' + (role === 'user' ? 'user-message' : 'assistant-message');
        if (messageId) {
            messageDiv.dataset.messageId = messageId;
        }
        messageDiv.textContent = text;
        messagesDiv.appendChild(messageDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function updateMessage(messageId, text) {
        const messagesDiv = document.getElementById('messages');
        let messageDiv = messageId
            ? messagesDiv.querySelector('[data-message-id="' + cssEscape(messageId) + '"]')
            : null;

        if (!messageDiv) {
            addMessage(text, 'assistant', messageId);
            return;
        }

        messageDiv.textContent = text;
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function addWelcomeMessage() {
        addMessage('Ola! Sou o Cody.\\nSeu assistente de codigo local.\\nComo posso ajudar voce hoje?', 'assistant');
    }

    function resolveSelectionReview(action) {
        if (!activeReviewId) return;
        vscode.postMessage({ command: 'resolveSelectionReview', reviewId: activeReviewId, action });
    }

    function addTypingIndicator() {
        if (activeAssistantMessageId) {
            return;
        }

        if (document.getElementById('typingIndicator')) {
            return;
        }

        const messagesDiv = document.getElementById('messages');
        const indicator = document.createElement('div');
        indicator.id = 'typingIndicator';
        indicator.className = 'message assistant-message typing';
        indicator.textContent = 'Pensando...';
        messagesDiv.appendChild(indicator);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    }

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }

        return String(value).replace(/["\\\\]/g, '\\\\$&');
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function disableInput() {
        const input = document.getElementById('input');
        const button = document.getElementById('sendButton');
        input.disabled = true;
        button.disabled = true;
        input.classList.add('loading');
    }

    function enableInput() {
        const input = document.getElementById('input');
        const button = document.getElementById('sendButton');
        input.disabled = false;
        button.disabled = false;
        input.classList.remove('loading');
        input.focus();
    }

    document.getElementById('input').addEventListener('keydown', event => {
        if (event.ctrlKey && event.key === 'Enter') {
            event.preventDefault();
            sendMessage();
        }
    });

    document.getElementById('input').focus();
`;
