import * as path from 'path';
import * as vscode from 'vscode';

import {
    MAX_PROJECT_ANALYSIS_FILE_CHARS,
    MAX_PROJECT_ANALYSIS_FILES,
    MAX_PROJECT_EXECUTION_SUPPORTING_FILES,
    MAX_PROJECT_TREE_FILES
} from '../core/constants';
import type { CodyProjectPlanStep, CodyWorkspaceSnapshot, CodyWorkspaceSnapshotFile } from '../core/types';

const IGNORED_SEGMENTS = new Set([
    'node_modules',
    '.git',
    'out',
    'dist',
    'build',
    'coverage',
    '.next',
    '.turbo'
]);

const PRIORITY_FILE_SCORES: Array<{ pattern: RegExp; score: number; reason: string }> = [
    { pattern: /^package\.json$/i, score: 90, reason: 'manifesto principal do projeto' },
    { pattern: /^README\.md$/i, score: 80, reason: 'documentacao principal' },
    { pattern: /^tsconfig(\..+)?\.json$/i, score: 75, reason: 'configuracao TypeScript' },
    { pattern: /^jsconfig(\..+)?\.json$/i, score: 70, reason: 'configuracao JavaScript' },
    { pattern: /^vite\.config\./i, score: 70, reason: 'configuracao de build' },
    { pattern: /^next\.config\./i, score: 70, reason: 'configuracao do framework' },
    { pattern: /^webpack\.config\./i, score: 70, reason: 'configuracao de bundler' },
    { pattern: /^src\/index\./i, score: 68, reason: 'ponto de entrada do codigo' },
    { pattern: /^src\/main\./i, score: 68, reason: 'ponto de entrada do app' },
    { pattern: /^src\/app\./i, score: 66, reason: 'arquivo central da aplicacao' }
];

export async function collectWorkspaceSnapshot(taskDescription?: string): Promise<CodyWorkspaceSnapshot> {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
        throw new Error('Abra um projeto primeiro.');
    }

    const allFiles = await vscode.workspace.findFiles('**/*', buildExcludeGlob(), MAX_PROJECT_TREE_FILES);
    const relativePaths = allFiles
        .map(file => vscode.workspace.asRelativePath(file, false))
        .filter(relativePath => isAllowedProjectPath(relativePath))
        .sort((left, right) => left.localeCompare(right));

    const rankedFiles = rankFiles(relativePaths, taskDescription);
    const selectedFiles = await loadSnapshotFiles(rankedFiles.slice(0, MAX_PROJECT_ANALYSIS_FILES));

    return {
        rootPath: workspaceFolder.uri.fsPath,
        tree: relativePaths.join('\n'),
        files: selectedFiles
    };
}

export async function readWorkspaceTextFile(relativePath: string): Promise<{ content: string; languageId: string } | undefined> {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
        return undefined;
    }

    const normalized = normalizeRelativePath(relativePath);
    if (!normalized || !isAllowedProjectPath(normalized)) {
        return undefined;
    }

    const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, ...normalized.split('/'));

    try {
        const document = await vscode.workspace.openTextDocument(targetUri);
        return {
            content: document.getText(),
            languageId: document.languageId
        };
    } catch {
        return undefined;
    }
}

export async function collectSupportingFilesForStep(
    step: CodyProjectPlanStep,
    snapshot: CodyWorkspaceSnapshot
): Promise<CodyWorkspaceSnapshotFile[]> {
    const targetPath = normalizeRelativePath(step.filePath);
    const directSnapshotMatches = snapshot.files.filter(file => normalizeRelativePath(file.path) !== targetPath);
    const supporting: CodyWorkspaceSnapshotFile[] = [];
    const usedPaths = new Set<string>();

    for (const file of directSnapshotMatches) {
        if (supporting.length >= MAX_PROJECT_EXECUTION_SUPPORTING_FILES) {
            break;
        }

        if (shouldUseAsSupportingFile(file.path, targetPath)) {
            supporting.push(file);
            usedPaths.add(normalizeRelativePath(file.path));
        }
    }

    if (supporting.length < MAX_PROJECT_EXECUTION_SUPPORTING_FILES) {
        for (const file of directSnapshotMatches) {
            if (supporting.length >= MAX_PROJECT_EXECUTION_SUPPORTING_FILES) {
                break;
            }

            const normalized = normalizeRelativePath(file.path);
            if (!usedPaths.has(normalized)) {
                supporting.push(file);
                usedPaths.add(normalized);
            }
        }
    }

    return supporting;
}

function getPrimaryWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
}

function buildExcludeGlob(): string {
    return '**/{node_modules,.git,out,dist,build,coverage,.next,.turbo}/**';
}

function isAllowedProjectPath(relativePath: string): boolean {
    const normalized = normalizeRelativePath(relativePath);

    if (!normalized) {
        return false;
    }

    return normalized.split('/').every(segment => !IGNORED_SEGMENTS.has(segment));
}

function normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, '/').trim();
}

function rankFiles(relativePaths: string[], taskDescription?: string): Array<{ path: string; score: number; reason: string }> {
    const activeEditorPath = vscode.window.activeTextEditor
        ? normalizeRelativePath(vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri, false))
        : undefined;
    const normalizedTask = taskDescription?.toLowerCase() ?? '';
    const keywords = normalizedTask
        .split(/[^a-zA-Z0-9_-]+/)
        .map(keyword => keyword.trim())
        .filter(keyword => keyword.length >= 3);

    return relativePaths
        .map(relativePath => {
            const normalized = normalizeRelativePath(relativePath);
            let score = 0;
            const reasons: string[] = [];
            const fileName = path.posix.basename(normalized);

            if (activeEditorPath && normalized === activeEditorPath) {
                score += 120;
                reasons.push('arquivo ativo no editor');
            }

            for (const priorityRule of PRIORITY_FILE_SCORES) {
                if (priorityRule.pattern.test(normalized) || priorityRule.pattern.test(fileName)) {
                    score += priorityRule.score;
                    reasons.push(priorityRule.reason);
                    break;
                }
            }

            if (normalized.startsWith('src/')) {
                score += 24;
                reasons.push('arquivo de codigo da pasta src');
            }

            if (/\.(ts|tsx|js|jsx|json|md|yml|yaml|css|scss|html)$/.test(normalized)) {
                score += 18;
                reasons.push('arquivo textual relevante');
            }

            for (const keyword of keywords) {
                if (normalized.toLowerCase().includes(keyword)) {
                    score += 16;
                    reasons.push(`relacao com a tarefa: ${keyword}`);
                }
            }

            if (score === 0) {
                score = 1;
                reasons.push('arquivo adicional do workspace');
            }

            return {
                path: normalized,
                score,
                reason: reasons[0] ?? 'arquivo do workspace'
            };
        })
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

async function loadSnapshotFiles(
    rankedFiles: Array<{ path: string; score: number; reason: string }>
): Promise<CodyWorkspaceSnapshotFile[]> {
    const loadedFiles = await Promise.all(rankedFiles.map(async candidate => {
        const file = await readWorkspaceTextFile(candidate.path);
        if (!file) {
            return undefined;
        }

        return {
            path: candidate.path,
            languageId: file.languageId,
            content: truncate(file.content, MAX_PROJECT_ANALYSIS_FILE_CHARS),
            reason: candidate.reason
        };
    }));

    return loadedFiles.filter((value): value is CodyWorkspaceSnapshotFile => Boolean(value));
}

function truncate(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }

    const headChars = Math.ceil(maxChars * 0.75);
    const tailChars = Math.max(0, maxChars - headChars);
    return `${value.slice(0, headChars)}\n... [trecho truncado pelo Cody] ...\n${value.slice(value.length - tailChars)}`;
}

function shouldUseAsSupportingFile(candidatePath: string, targetPath: string): boolean {
    if (!targetPath) {
        return false;
    }

    const candidateDir = path.posix.dirname(normalizeRelativePath(candidatePath));
    const targetDir = path.posix.dirname(targetPath);

    if (candidateDir === targetDir) {
        return true;
    }

    return path.posix.basename(candidatePath).toLowerCase() === 'package.json';
}
