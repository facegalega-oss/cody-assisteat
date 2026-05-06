import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { LONG_OLLAMA_REQUEST_TIMEOUT_MS } from '../core/constants';
import { buildFrontendPromptBlock } from '../core/frontendPrompt';
import {
    assertSafeGeneratedFileContent,
    extractCodeFromResponse,
    extractFileContentFromResponse
} from '../core/response';
import type { AskOllama } from '../core/types';
import {
    buildProjectAnalysisMarkdown,
    buildProjectAnalysisPrompt,
    deriveWorkspaceInsights,
    parseProjectAnalysis
} from './projectAnalysis';
import { previewProjectStructure } from './projectPreview';
import { buildProjectTemplate, type ProjectTemplateId } from './projectTemplates';
import { collectWorkspaceSnapshot } from './projectWorkspace';

type ProjectTypeOption = {
    label: string;
    value: ProjectTemplateId | 'custom';
    source: 'template' | 'ai';
};

type GeneratedProjectStructure = {
    folders: string[];
    files: Array<{ path: string; content: string }>;
    instructions?: string;
};

type CreateProjectOptions = {
    initialDescription?: string;
    forceCustom?: boolean;
};

type CreateFileOptions = {
    description?: string;
    suggestedFileName?: string;
};

const PROJECT_TYPE_OPTIONS: ProjectTypeOption[] = [
    { label: 'Node.js API', value: 'node-api', source: 'template' },
    { label: 'React App', value: 'react-app', source: 'template' },
    { label: 'Express Server', value: 'express-server', source: 'template' },
    { label: 'TypeScript Library', value: 'ts-library', source: 'template' },
    { label: 'VS Code Extension', value: 'vscode-extension', source: 'template' },
    { label: 'Custom', value: 'custom', source: 'ai' }
];

export async function createProjectStructure(
    askOllama: AskOllama,
    options?: CreateProjectOptions
): Promise<void> {
    const projectType = options?.forceCustom
        ? PROJECT_TYPE_OPTIONS.find(option => option.value === 'custom')
        : await vscode.window.showQuickPick(
            PROJECT_TYPE_OPTIONS,
            { placeHolder: 'Qual tipo de projeto voce quer criar?' }
        );
    if (!projectType) {
        return;
    }

    const projectName = await vscode.window.showInputBox({
        prompt: 'Nome do projeto',
        placeHolder: 'meu-projeto'
    });
    if (!projectName) {
        return;
    }

    if (!isValidProjectName(projectName)) {
        vscode.window.showErrorMessage('Use um nome de projeto sem barras, ".." ou caracteres invalidos para pasta.');
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    let targetPath: string;

    if (workspaceFolders && workspaceFolders.length > 0) {
        const selected = await vscode.window.showQuickPick(
            workspaceFolders.map(folder => folder.uri.fsPath),
            { placeHolder: 'Onde criar o projeto?' }
        );
        targetPath = selected || workspaceFolders[0].uri.fsPath;
    } else {
        const selected = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            openLabel: 'Selecionar pasta'
        });
        if (!selected) {
            return;
        }
        targetPath = selected[0].fsPath;
    }

    const projectPath = path.join(targetPath, projectName);
    const projectPathExists = fs.existsSync(projectPath);

    if (projectPathExists && fs.readdirSync(projectPath).length > 0) {
        vscode.window.showErrorMessage('A pasta de destino ja existe e nao esta vazia. Escolha outro nome ou outro destino.');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Criando estrutura do projeto...',
        cancellable: false
    }, async progress => {
        try {
            const structure = await generateProjectStructure(projectType, projectName, askOllama, progress, options?.initialDescription);
            if (!structure) {
                return;
            }
            validateProjectStructure(structure);

            const approved = await previewProjectStructure({
                projectName,
                projectPath,
                sourceLabel: projectType.source === 'template' ? 'Template confiavel do Cody' : 'Estrutura custom gerada com IA',
                folders: structure.folders,
                files: structure.files,
                instructions: structure.instructions
            });

            if (!approved) {
                return;
            }

            progress.report({ increment: 65, message: 'Criando pastas...' });
            createProjectFolders(projectPath, structure.folders);

            progress.report({ increment: 85, message: 'Criando arquivos...' });
            createProjectFiles(projectPath, structure.files);

            progress.report({ increment: 100, message: 'Projeto criado.' });

            const openProject = await vscode.window.showInformationMessage(
                `Projeto "${projectName}" criado com sucesso. Abrir?`,
                'Sim',
                'Nao'
            );

            if (openProject === 'Sim') {
                const newWindow = vscode.Uri.file(projectPath);
                await vscode.commands.executeCommand('vscode.openFolder', newWindow, true);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Erro ao criar projeto: ${error}`);
        }
    });
}

export async function createFileWithAI(
    askOllama: AskOllama,
    options?: CreateFileOptions
): Promise<void> {
    const description = options?.description?.trim() || await vscode.window.showInputBox({
        prompt: 'Descreva o arquivo que voce quer criar',
        placeHolder: 'Ex: Um componente React que mostra uma lista de tarefas'
    });
    if (!description) {
        return;
    }

    let fileName = options?.suggestedFileName?.trim() || await vscode.window.showInputBox({
        prompt: 'Nome do arquivo',
        placeHolder: 'Ex: TaskList.jsx'
    });
    if (!fileName) {
        return;
    }

    const editor = vscode.window.activeTextEditor;
    let savePath: string;

    if (editor) {
        const currentFileDir = path.dirname(editor.document.uri.fsPath);
        savePath = path.join(currentFileDir, fileName);
    } else if (vscode.workspace.workspaceFolders) {
        const selected = await vscode.window.showQuickPick(
            vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath),
            { placeHolder: 'Onde salvar o arquivo?' }
        );
        savePath = selected
            ? path.join(selected, fileName)
            : path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, fileName);
    } else {
        const selected = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(fileName),
            filters: { 'All Files': ['*'] }
        });
        if (!selected) {
            return;
        }

        savePath = selected.fsPath;
        fileName = path.basename(savePath);
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Gerando arquivo...',
        cancellable: false
    }, async progress => {
        progress.report({ increment: 0, message: 'IA criando conteudo...' });

        const extension = path.extname(fileName).slice(1);
        const frontendPromptBlock = buildFrontendPromptBlock({
            request: description,
            filePath: fileName
        }, 'generate');
        const prompt = `
Crie um arquivo chamado "${fileName}" (extensao: ${extension}) que atenda a seguinte descricao:

${description}

${frontendPromptBlock}

Responda APENAS com o conteudo do arquivo, sem explicacoes.
Nao use blocos de markdown, nao escreva \`\`\` e nao inclua observacoes depois do codigo.
Gere codigo funcional, bem estruturado e seguindo boas praticas.
        `;

        try {
            const rawContent = await askOllama(prompt);
            const content = extractFileContentFromResponse(rawContent);
            assertSafeGeneratedFileContent(content, fileName);

            progress.report({ increment: 80, message: 'Salvando arquivo...' });

            const dir = path.dirname(savePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(savePath, content);

            const document = await vscode.workspace.openTextDocument(savePath);
            await vscode.window.showTextDocument(document);

            vscode.window.showInformationMessage(`Arquivo "${fileName}" criado com sucesso.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Erro ao criar arquivo: ${error}`);
        }
    });
}

export async function analyzeCurrentProject(askOllama: AskOllama, focusRequest?: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Abra um projeto primeiro');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Analisando projeto...',
        cancellable: false
    }, async progress => {
        progress.report({ increment: 15, message: 'Lendo estrutura e arquivos-chave...' });

        const snapshot = await collectWorkspaceSnapshot(focusRequest?.trim() || 'analise geral do projeto');
        const insights = deriveWorkspaceInsights(snapshot);

        progress.report({ increment: 55, message: 'Consolidando sinais de maturidade do projeto...' });
        const prompt = buildProjectAnalysisPrompt(snapshot, insights, focusRequest);

        try {
            progress.report({ increment: 80, message: 'IA montando recomendacoes de alto impacto...' });
            const analysisResponse = await askOllama(prompt, {
                timeoutMs: LONG_OLLAMA_REQUEST_TIMEOUT_MS
            });
            const analysis = parseProjectAnalysis(analysisResponse);
            const markdown = buildProjectAnalysisMarkdown(analysis, insights, focusRequest);
            const analysisDocument = await vscode.workspace.openTextDocument({
                language: 'markdown',
                content: markdown
            });

            await vscode.window.showTextDocument(analysisDocument, {
                preview: true,
                preserveFocus: false,
                viewColumn: vscode.ViewColumn.Beside
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Erro na analise: ${error}`);
        }
    });
}

async function generateProjectStructure(
    projectType: ProjectTypeOption,
    projectName: string,
    askOllama: AskOllama,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    initialCustomDescription?: string
): Promise<GeneratedProjectStructure | undefined> {
    if (projectType.source === 'template' && projectType.value !== 'custom') {
        progress.report({ increment: 15, message: 'Montando template confiavel...' });
        return buildProjectTemplate(projectType.value, projectName);
    }

    const customDescription = initialCustomDescription?.trim() || await vscode.window.showInputBox({
        prompt: 'Descreva o projeto customizado que voce quer criar',
        placeHolder: 'Ex: SaaS de tarefas com frontend React, API Node e pasta docs'
    });

    if (!customDescription) {
        return undefined;
    }

    progress.report({ increment: 15, message: 'Gerando estrutura custom com IA...' });
    const response = await askOllama(buildCustomProjectPrompt(projectName, customDescription));
    const structure = parseGeneratedProjectStructure(response);

    if (!structure.instructions) {
        structure.instructions = 'Revise dependencias, scripts e configuracoes antes de executar o projeto.';
    }

    return structure;
}

function buildCustomProjectPrompt(projectName: string, customDescription: string): string {
    const frontendPromptBlock = buildFrontendPromptBlock({
        request: customDescription,
        filePath: projectName
    }, 'project');

    return `
Crie uma estrutura de projeto completa para um projeto chamado "${projectName}".

DESCRICAO DO PROJETO:
${customDescription}

${frontendPromptBlock}

Responda APENAS com JSON valido no formato:
{
  "folders": ["src", "tests"],
  "files": [
    {
      "path": "package.json",
      "content": "{...}"
    }
  ],
  "instructions": "Orientacoes finais"
}

Regras:
- Use apenas caminhos relativos
- Nao use ".."
- Nao use caminhos absolutos
- Gere conteudo real e coerente
- Inclua arquivos essenciais para o stack pedido
- Se houver frontend, inclua uma base visual inicial moderna e arquivos de estilo coerentes com a proposta
`;
}

function parseGeneratedProjectStructure(response: string): GeneratedProjectStructure {
    const trimmed = extractCodeFromResponse(response);
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
        throw new Error('Resposta invalida da IA: JSON nao encontrado.');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<GeneratedProjectStructure>;

    return {
        folders: Array.isArray(parsed.folders) ? parsed.folders.filter((value): value is string => typeof value === 'string') : [],
        files: Array.isArray(parsed.files)
            ? parsed.files.filter(isValidGeneratedFile)
            : [],
        instructions: typeof parsed.instructions === 'string' ? parsed.instructions : undefined
    };
}

function isValidGeneratedFile(
    value: unknown
): value is { path: string; content: string } {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<{ path: string; content: string }>;
    return typeof candidate.path === 'string' && typeof candidate.content === 'string';
}

function validateProjectStructure(structure: GeneratedProjectStructure): void {
    const filePaths = new Set<string>();

    for (const folder of structure.folders) {
        validateRelativeProjectPath(folder);
    }

    for (const file of structure.files) {
        validateRelativeProjectPath(file.path);

        if (filePaths.has(file.path)) {
            throw new Error(`Estrutura invalida: arquivo duplicado "${file.path}".`);
        }

        filePaths.add(file.path);
    }

    if (structure.files.length === 0) {
        throw new Error('Estrutura invalida: nenhum arquivo foi gerado.');
    }
}

function validateRelativeProjectPath(relativePath: string): void {
    const normalized = relativePath.replace(/\\/g, '/').trim();

    if (!normalized) {
        throw new Error('Estrutura invalida: caminho vazio encontrado.');
    }

    if (path.isAbsolute(normalized) || normalized.includes('..')) {
        throw new Error(`Estrutura invalida: caminho inseguro "${relativePath}".`);
    }
}

function createProjectFolders(projectPath: string, folders: string[]): void {
    for (const folder of folders) {
        const folderPath = path.join(projectPath, folder);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
    }
}

function createProjectFiles(projectPath: string, files: Array<{ path: string; content: string }>): void {
    for (const file of files) {
        const filePath = path.join(projectPath, file.path);
        const fileDir = path.dirname(filePath);

        if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true });
        }

        fs.writeFileSync(filePath, file.content, 'utf8');
    }
}

function isValidProjectName(projectName: string): boolean {
    const trimmed = projectName.trim();

    if (!trimmed || trimmed === '.' || trimmed === '..') {
        return false;
    }

    return !/[\\/:*?"<>|]/.test(trimmed);
}
