export const CHAT_WEBVIEW_STYLES = `
    body {
        padding: 12px;
        font-family: var(--vscode-font-family);
        background: var(--vscode-sideBar-background);
        color: var(--vscode-sideBar-foreground);
        margin: 0;
    }
    .chat-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
    }
    .messages {
        flex: 1;
        overflow-y: auto;
        margin-bottom: 16px;
        padding: 8px;
    }
    .session-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        border-bottom: 1px solid var(--vscode-panel-border);
        max-height: 160px;
        overflow-y: auto;
    }
    .session-item {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 6px;
        padding: 8px;
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
    }
    .session-item.active {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
        border-color: var(--vscode-focusBorder);
    }
    .session-main {
        text-align: left;
        background: transparent;
        border: none;
        padding: 0;
        font-size: 11px;
        color: inherit;
    }
    .session-main:hover {
        background: transparent;
    }
    .session-tools {
        display: flex;
        gap: 4px;
    }
    .session-tool {
        padding: 2px 6px;
        font-size: 10px;
        min-width: 0;
    }
    .message {
        margin-bottom: 12px;
        padding: 8px 12px;
        border-radius: 8px;
        word-wrap: break-word;
        white-space: pre-wrap;
        line-height: 1.4;
    }
    .user-message {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }
    .assistant-message {
        background: var(--vscode-editor-selectionBackground);
    }
    .input-area {
        display: flex;
        gap: 8px;
        flex-direction: column;
        padding: 8px;
        border-top: 1px solid var(--vscode-panel-border);
    }
    textarea {
        padding: 8px;
        border-radius: 6px;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-family: monospace;
        font-size: 12px;
        resize: vertical;
    }
    button {
        padding: 6px 12px;
        cursor: pointer;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
    }
    button:hover {
        background: var(--vscode-button-hoverBackground);
    }
    .status {
        margin-top: 8px;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        text-align: center;
    }
    .context-summary {
        margin: 0 8px 8px;
        padding: 8px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        background: var(--vscode-sideBarSectionHeader-background);
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        line-height: 1.4;
    }
    .review-panel {
        margin: 0 8px 12px;
        padding: 12px;
        border: 1px solid var(--vscode-focusBorder);
        border-radius: 10px;
        background: var(--vscode-editorWidget-background);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
    }
    .review-panel.hidden {
        display: none;
    }
    .review-title {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 8px;
    }
    .review-title strong {
        font-size: 12px;
    }
    .review-meta {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
        line-height: 1.4;
    }
    .review-diff {
        max-height: 260px;
        overflow: auto;
        margin: 0 0 10px;
        padding: 10px;
        border-radius: 8px;
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-panel-border);
        font-family: var(--vscode-editor-font-family, Consolas, monospace);
        font-size: 11px;
        line-height: 1.5;
        white-space: pre-wrap;
    }
    .review-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    .review-apply {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }
    .review-secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }
    .intent-summary {
        margin: 0 8px 8px;
        padding: 8px;
        border: 1px solid var(--vscode-focusBorder);
        border-radius: 6px;
        background: var(--vscode-editor-selectionBackground);
        color: var(--vscode-editor-foreground);
        font-size: 11px;
        line-height: 1.4;
    }
    .task-summary {
        margin: 0 8px 8px;
        padding: 8px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        background: var(--vscode-sideBarSectionHeader-background);
        color: var(--vscode-editor-foreground);
        font-size: 11px;
        line-height: 1.4;
    }
    .header {
        margin-bottom: 12px;
        padding: 8px;
        border-bottom: 1px solid var(--vscode-panel-border);
    }
    .header h3 {
        margin: 0;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .badge {
        display: inline-block;
        padding: 2px 6px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: 4px;
        font-size: 10px;
    }
    .action-buttons {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    .action-button {
        padding: 4px 8px;
        font-size: 11px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }
    .loading {
        opacity: 0.6;
        pointer-events: none;
    }
    .typing {
        font-style: italic;
        opacity: 0.7;
    }
`;
