import * as path from 'path';
import * as vscode from 'vscode';

import {
    MAX_ACTIVE_SNIPPET_CHARS,
    MAX_SUPPORTING_FILE_CHARS,
    MAX_SUPPORTING_FILES
} from './constants';
import type { CodyProjectContext } from './types';

const SUPPORTING_FILE_CANDIDATES = [
    'package.json',
    'README.md',
    'tsconfig.json',
    'pyproject.toml',
    'requirements.txt',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'vite.config.ts',
    'next.config.js'
];

const IGNORED_SEGMENTS = new Set([
    'node_modules',
    '.git',
    'out',
    'dist',
    'build',
    '.next',
    'coverage'
]);

const PROJECT_CONTEXT_CACHE_TTL_MS = 10_000;
const SUPPORTING_FILES_CACHE_TTL_MS = 30_000;

type SupportingFileSnippet = {
    label: string;
    content: string;
};

type CachedProjectContext = {
    key: string;
    value: CodyProjectContext | undefined;
    cachedAt: number;
};

type CachedSupportingFiles = {
    key: string;
    files: SupportingFileSnippet[];
    cachedAt: number;
};

let projectContextCache: CachedProjectContext | undefined;
const supportingFilesCache = new Map<string, CachedSupportingFiles>();

export async function collectProjectContext(): Promise<CodyProjectContext | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    const workspaceFolder = activeEditor
        ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
        : vscode.workspace.workspaceFolders?.[0];
    const cacheKey = buildProjectContextCacheKey(workspaceFolder, activeEditor);
    const now = Date.now();

    if (projectContextCache
        && projectContextCache.key === cacheKey
        && now - projectContextCache.cachedAt <= PROJECT_CONTEXT_CACHE_TTL_MS) {
        return projectContextCache.value;
    }

    const summaryParts: string[] = [];
    const promptParts: string[] = [];

    if (workspaceFolder) {
        summaryParts.push(`workspace ${workspaceFolder.name}`);
        promptParts.push(`WORKSPACE ATIVO: ${workspaceFolder.name}`);
    }

    if (activeEditor) {
        const editorContext = collectEditorContext(activeEditor);
        summaryParts.push(...editorContext.summaryParts);
        promptParts.push(editorContext.promptSection);
    }

    const supportingFiles = workspaceFolder
        ? await collectSupportingFiles(workspaceFolder, activeEditor?.document.uri)
        : [];

    if (supportingFiles.length > 0) {
        summaryParts.push(`apoio: ${supportingFiles.map(file => file.label).join(', ')}`);
        promptParts.push('ARQUIVOS RELEVANTES DO PROJETO:');

        for (const file of supportingFiles) {
            promptParts.push(`Arquivo: ${file.label}`);
            promptParts.push('```');
            promptParts.push(file.content);
            promptParts.push('```');
        }
    }

    if (summaryParts.length === 0 || promptParts.length === 0) {
        projectContextCache = {
            key: cacheKey,
            value: undefined,
            cachedAt: now
        };
        return undefined;
    }

    const context = {
        summary: summaryParts.join(' | '),
        promptSection: promptParts.join('\n\n')
    };

    projectContextCache = {
        key: cacheKey,
        value: context,
        cachedAt: now
    };

    return context;
}

function collectEditorContext(editor: vscode.TextEditor): { summaryParts: string[]; promptSection: string } {
    const document = editor.document;
    const relativePath = vscode.workspace.asRelativePath(document.uri, false);
    const summaryParts = [`arquivo ${relativePath}`, `linguagem ${document.languageId}`];

    const selection = editor.selection;
    const hasSelection = !selection.isEmpty;
    const snippet = hasSelection
        ? document.getText(selection)
        : extractCursorContext(document, selection.active.line);

    if (hasSelection) {
        summaryParts.push(`selecao ${selection.start.line + 1}-${selection.end.line + 1}`);
    } else {
        summaryParts.push(`cursor linha ${selection.active.line + 1}`);
    }

    const promptSection = [
        'CONTEXTO DO EDITOR:',
        `Arquivo ativo: ${relativePath}`,
        `Linguagem: ${document.languageId}`,
        hasSelection
            ? `Selecao atual: linhas ${selection.start.line + 1} ate ${selection.end.line + 1}`
            : `Linha atual do cursor: ${selection.active.line + 1}`,
        '',
        hasSelection ? 'TRECHO SELECIONADO:' : 'TRECHO PROXIMO AO CURSOR:',
        '```',
        trimToLength(snippet, MAX_ACTIVE_SNIPPET_CHARS),
        '```'
    ].join('\n');

    return { summaryParts, promptSection };
}

async function collectSupportingFiles(
    workspaceFolder: vscode.WorkspaceFolder,
    activeDocumentUri?: vscode.Uri
): Promise<SupportingFileSnippet[]> {
    const cacheKey = `${workspaceFolder.uri.toString()}::${activeDocumentUri?.toString() ?? 'no-active-document'}`;
    const cached = supportingFilesCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.cachedAt <= SUPPORTING_FILES_CACHE_TTL_MS) {
        return cached.files;
    }

    const collected = new Map<string, { label: string; content: string }>();

    for (const candidate of SUPPORTING_FILE_CANDIDATES) {
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, `**/${candidate}`),
            '**/node_modules/**',
            2
        );

        for (const uri of matches) {
            if (activeDocumentUri && uri.toString() === activeDocumentUri.toString()) {
                continue;
            }

            if (shouldIgnorePath(uri.fsPath)) {
                continue;
            }

            const label = vscode.workspace.asRelativePath(uri, false);
            if (collected.has(label)) {
                continue;
            }

            const content = await readSnippet(uri);
            if (!content) {
                continue;
            }

            collected.set(label, { label, content });
            if (collected.size >= MAX_SUPPORTING_FILES) {
                const files = [...collected.values()];
                supportingFilesCache.set(cacheKey, {
                    key: cacheKey,
                    files,
                    cachedAt: now
                });
                return files;
            }
        }
    }

    const files = [...collected.values()];
    supportingFilesCache.set(cacheKey, {
        key: cacheKey,
        files,
        cachedAt: now
    });
    return files;
}

async function readSnippet(uri: vscode.Uri): Promise<string | undefined> {
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        return trimToLength(document.getText(), MAX_SUPPORTING_FILE_CHARS);
    } catch {
        return undefined;
    }
}

function extractCursorContext(document: vscode.TextDocument, centerLine: number): string {
    const startLine = Math.max(0, centerLine - 20);
    const endLine = Math.min(document.lineCount - 1, centerLine + 20);
    return document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));
}

function trimToLength(value: string, maxChars: number): string {
    const normalized = value.trim();
    if (normalized.length <= maxChars) {
        return normalized;
    }

    return `${normalized.slice(0, maxChars)}\n... [truncado]`;
}

function shouldIgnorePath(filePath: string): boolean {
    const segments = filePath.split(path.sep);
    return segments.some(segment => IGNORED_SEGMENTS.has(segment));
}

function buildProjectContextCacheKey(
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    activeEditor: vscode.TextEditor | undefined
): string {
    if (!activeEditor) {
        return `workspace:${workspaceFolder?.uri.toString() ?? 'none'}::no-editor`;
    }

    const selection = activeEditor.selection;
    return [
        `workspace:${workspaceFolder?.uri.toString() ?? 'none'}`,
        `document:${activeEditor.document.uri.toString()}`,
        `version:${activeEditor.document.version}`,
        `selection:${selection.start.line}:${selection.start.character}-${selection.end.line}:${selection.end.character}`
    ].join('::');
}
