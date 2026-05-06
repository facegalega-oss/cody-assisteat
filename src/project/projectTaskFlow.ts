import * as path from 'path';
import * as vscode from 'vscode';

import { previewWorkspaceFileChange } from '../commands/editPreview';
import {
    LONG_OLLAMA_REQUEST_TIMEOUT_MS,
    MAX_PROJECT_PLAN_STEPS,
    MEDIUM_OLLAMA_REQUEST_TIMEOUT_MS
} from '../core/constants';
import { buildFrontendPromptBlock } from '../core/frontendPrompt';
import {
    assertSafeGeneratedFileContent,
    extractCodeFromResponse,
    extractFileContentFromResponse
} from '../core/response';
import type {
    AskOllama,
    CodyProjectPlan,
    CodyProjectPlanStep,
    CodyTaskSession,
    CodyTaskStepState,
    CodyWorkspaceSnapshot,
    CodyWorkspaceSnapshotFile
} from '../core/types';
import { previewProjectTaskPlan } from './projectTaskPreview';
import {
    collectSupportingFilesForStep,
    collectWorkspaceSnapshot,
    readWorkspaceTextFile
} from './projectWorkspace';

type ProjectPlanExecutionResult = {
    applied: string[];
    skipped: Array<{ filePath: string; reason: string }>;
    failed: Array<{ filePath: string; reason: string }>;
    cancelled: boolean;
};

type PlanProjectTaskOptions = {
    initialTask?: string;
    existingTaskSession?: CodyTaskSession;
    onTaskSessionChange?: (taskSession: CodyTaskSession | undefined) => Promise<void> | void;
};

export async function planProjectTask(
    askOllama: AskOllama,
    options?: string | PlanProjectTaskOptions
): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Abra um projeto primeiro.');
        return;
    }

    const normalizedOptions = typeof options === 'string'
        ? { initialTask: options }
        : options;
    const fallbackTask = normalizedOptions?.existingTaskSession?.goal;
    const task = normalizedOptions?.initialTask?.trim()
        || fallbackTask?.trim()
        || await vscode.window.showInputBox({
        prompt: 'Qual melhoria ou funcionalidade voce quer planejar e aplicar neste projeto?',
        placeHolder: 'Ex: adicionar autenticacao JWT sem quebrar o fluxo atual'
    });

    if (!task?.trim()) {
        return;
    }

    let snapshot: CodyWorkspaceSnapshot | undefined;
    let plan: CodyProjectPlan | undefined;
    let taskSession: CodyTaskSession | undefined = buildPlanningTaskSession(
        task,
        normalizedOptions?.existingTaskSession
    );

    await normalizedOptions?.onTaskSessionChange?.(taskSession);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Cody esta analisando o projeto...',
        cancellable: false
    }, async progress => {
        progress.report({ increment: 15, message: 'Lendo arquivos e contexto do workspace...' });
        snapshot = await collectWorkspaceSnapshot(task);

        progress.report({ increment: 55, message: 'Montando plano estruturado de mudancas...' });
        plan = await createProjectTaskPlan(task, snapshot, askOllama, normalizedOptions?.existingTaskSession);
    });

    if (!snapshot || !plan) {
        return;
    }

    const resolvedSnapshot = snapshot;
    const resolvedPlan = plan;
    taskSession = buildReadyTaskSession(task, resolvedPlan);
    await normalizedOptions?.onTaskSessionChange?.(taskSession);

    const approved = await previewProjectTaskPlan({
        task,
        snapshot: resolvedSnapshot,
        plan: resolvedPlan
    });

    if (!approved) {
        taskSession = {
            ...taskSession,
            status: 'cancelled',
            lastSummary: 'Plano cancelado antes da execucao.',
            updatedAt: Date.now()
        };
        await normalizedOptions?.onTaskSessionChange?.(taskSession);
        return;
    }

    taskSession = {
        ...taskSession,
        status: 'in_progress',
        updatedAt: Date.now()
    };
    await normalizedOptions?.onTaskSessionChange?.(taskSession);

    const execution = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Executando plano do Cody...',
        cancellable: false
    }, async progress => executeProjectTaskPlan({
        task,
        snapshot: resolvedSnapshot,
        plan: resolvedPlan,
        askOllama,
        progress,
        onStepStateChange: async stepState => {
            if (!taskSession) {
                return;
            }

            taskSession = upsertTaskStepState(taskSession, stepState);
            await normalizedOptions?.onTaskSessionChange?.(taskSession);
        }
    }));

    await showExecutionSummary(task, resolvedPlan, execution);

    taskSession = finalizeTaskSession(taskSession, execution);
    await normalizedOptions?.onTaskSessionChange?.(taskSession);

    if (execution.cancelled) {
        vscode.window.showWarningMessage('Execucao do plano interrompida pelo usuario.');
        return;
    }

    if (execution.failed.length > 0) {
        vscode.window.showWarningMessage('Plano executado com ressalvas. Revise o resumo do Cody para ver os arquivos que falharam.');
        return;
    }

    vscode.window.showInformationMessage('Plano executado com sucesso. Revise os diffs aplicados e teste o projeto.');
}

async function createProjectTaskPlan(
    task: string,
    snapshot: CodyWorkspaceSnapshot,
    askOllama: AskOllama,
    existingTaskSession?: CodyTaskSession
): Promise<CodyProjectPlan> {
    const response = await askOllama(buildPlanningPrompt(task, snapshot, existingTaskSession), {
        timeoutMs: LONG_OLLAMA_REQUEST_TIMEOUT_MS
    });
    return parseProjectPlan(response, task);
}

async function executeProjectTaskPlan({
    task,
    snapshot,
    plan,
    askOllama,
    progress,
    onStepStateChange
}: {
    task: string;
    snapshot: CodyWorkspaceSnapshot;
    plan: CodyProjectPlan;
    askOllama: AskOllama;
    progress: vscode.Progress<{ message?: string; increment?: number }>;
    onStepStateChange?: (stepState: CodyTaskStepState) => Promise<void> | void;
}): Promise<ProjectPlanExecutionResult> {
    const result: ProjectPlanExecutionResult = {
        applied: [],
        skipped: [],
        failed: [],
        cancelled: false
    };

    const totalSteps = Math.max(plan.steps.length, 1);

    for (const [index, step] of plan.steps.entries()) {
        const progressBase = Math.round((index / totalSteps) * 100);
        progress.report({
            increment: progressBase,
            message: `Preparando ${step.filePath} (${index + 1}/${plan.steps.length})...`
        });

        try {
            const currentFile = await readWorkspaceTextFile(step.filePath);

            if (step.action === 'update' && !currentFile) {
                await onStepStateChange?.({
                    stepId: step.id,
                    filePath: step.filePath,
                    title: step.title,
                    status: 'skipped',
                    note: 'O plano pediu update, mas o arquivo nao existe no workspace.'
                });
                result.skipped.push({
                    filePath: step.filePath,
                    reason: 'O plano pediu update, mas o arquivo nao existe no workspace.'
                });
                continue;
            }

            if (step.action === 'create' && currentFile) {
                await onStepStateChange?.({
                    stepId: step.id,
                    filePath: step.filePath,
                    title: step.title,
                    status: 'skipped',
                    note: 'O plano pediu create, mas o arquivo ja existe.'
                });
                result.skipped.push({
                    filePath: step.filePath,
                    reason: 'O plano pediu create, mas o arquivo ja existe. Ajuste a tarefa ou use edicao manual.'
                });
                continue;
            }

            const supportingFiles = await collectSupportingFilesForStep(step, snapshot);
            progress.report({
                increment: Math.round(100 / totalSteps),
                message: `Gerando mudanca para ${step.filePath}...`
            });

            const response = await askOllama(buildExecutionPrompt({
                task,
                plan,
                step,
                currentFile,
                supportingFiles
            }), {
                timeoutMs: MEDIUM_OLLAMA_REQUEST_TIMEOUT_MS
            });
            const modifiedContent = extractFileContentFromResponse(response).trim();
            assertSafeGeneratedFileContent(modifiedContent, step.filePath);

            if (!modifiedContent) {
                throw new Error('O modelo nao retornou conteudo de arquivo valido.');
            }

            const previewOutcome = await previewWorkspaceFileChange({
                relativePath: step.filePath,
                originalContent: currentFile?.content,
                modifiedContent,
                languageId: currentFile?.languageId ?? inferLanguageId(step.filePath)
            });

            if (previewOutcome === 'cancelled') {
                await onStepStateChange?.({
                    stepId: step.id,
                    filePath: step.filePath,
                    title: step.title,
                    status: 'skipped',
                    note: 'Execucao interrompida pelo usuario.'
                });
                result.cancelled = true;
                break;
            }

            if (previewOutcome === 'skipped') {
                await onStepStateChange?.({
                    stepId: step.id,
                    filePath: step.filePath,
                    title: step.title,
                    status: 'skipped',
                    note: 'Mudanca revisada, mas nao aplicada.'
                });
                result.skipped.push({
                    filePath: step.filePath,
                    reason: 'Mudanca revisada, mas nao aplicada.'
                });
                continue;
            }

            await onStepStateChange?.({
                stepId: step.id,
                filePath: step.filePath,
                title: step.title,
                status: 'applied',
                note: 'Mudanca aplicada com sucesso.'
            });
            result.applied.push(step.filePath);
        } catch (error) {
            await onStepStateChange?.({
                stepId: step.id,
                filePath: step.filePath,
                title: step.title,
                status: 'failed',
                note: error instanceof Error ? error.message : String(error)
            });
            result.failed.push({
                filePath: step.filePath,
                reason: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return result;
}

function buildPlanningPrompt(task: string, snapshot: CodyWorkspaceSnapshot, existingTaskSession?: CodyTaskSession): string {
    const fileSections = snapshot.files.map(file => [
        `ARQUIVO: ${file.path}`,
        `LINGUAGEM: ${file.languageId}`,
        `MOTIVO: ${file.reason}`,
        'CONTEUDO:',
        '```',
        file.content,
        '```'
    ].join('\n')).join('\n\n');
    const frontendPromptBlock = buildFrontendPromptBlock({ request: task }, 'plan');
    const continuationSection = existingTaskSession
        ? [
            'CONTEXTO DE CONTINUIDADE DA TAREFA:',
            `- Status anterior: ${existingTaskSession.status}`,
            `- Resumo anterior: ${existingTaskSession.summary}`,
            existingTaskSession.lastSummary ? `- Ultimo resultado: ${existingTaskSession.lastSummary}` : '',
            existingTaskSession.stepStates.length > 0
                ? `- Etapas conhecidas:\n${existingTaskSession.stepStates.map(step => `  - ${step.title} [${step.status}] em ${step.filePath}${step.note ? `: ${step.note}` : ''}`).join('\n')}`
                : '- Nenhuma etapa anterior registrada.'
        ].filter(Boolean).join('\n')
        : '';

    return `
Voce e um engenheiro principal responsavel por evoluir um projeto existente sem quebrar o que ja funciona.

OBJETIVO DO USUARIO:
${task}

${frontendPromptBlock}
${continuationSection ? `\n${continuationSection}\n` : ''}

ARVORE DO WORKSPACE:
${snapshot.tree || '(sem arquivos encontrados)'}

ARQUIVOS IMPORTANTES LIDOS:
${fileSections || '(nenhum arquivo textual foi carregado)'}

Responda APENAS com JSON valido no formato:
{
  "goal": "Objetivo resumido",
  "summary": "Resumo curto da estrategia",
  "risks": ["risco 1"],
  "validations": ["teste 1"],
  "steps": [
    {
      "id": "step-1",
      "title": "Nome curto do passo",
      "filePath": "src/exemplo.ts",
      "action": "update",
      "summary": "O que muda neste arquivo",
      "reason": "Por que este arquivo precisa mudar",
      "validation": ["o que revisar neste arquivo"]
    }
  ]
}

Regras obrigatorias:
- Planeje no maximo ${MAX_PROJECT_PLAN_STEPS} arquivos.
- Cada passo altera apenas um arquivo.
- Use apenas "create" ou "update" em "action".
- Nao planeje deletar, renomear ou mover arquivos.
- Priorize manter compatibilidade com o comportamento atual.
- Inclua arquivos de teste/config quando isso reduzir risco de regressao.
- Se o contexto estiver insuficiente, ainda faca o melhor plano pragmatico e aponte o risco.
`;
}

function parseProjectPlan(response: string, task: string): CodyProjectPlan {
    const trimmed = extractCodeFromResponse(response);
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
        throw new Error('A resposta do plano nao trouxe JSON valido.');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<CodyProjectPlan>;
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const usedPaths = new Set<string>();

    const normalizedSteps = steps
        .map((step, index) => normalizePlanStep(step, index))
        .filter((step): step is CodyProjectPlanStep => Boolean(step))
        .filter(step => {
            const normalizedPath = normalizeProjectPath(step.filePath);
            if (!normalizedPath || usedPaths.has(normalizedPath)) {
                return false;
            }

            usedPaths.add(normalizedPath);
            step.filePath = normalizedPath;
            return true;
        })
        .slice(0, MAX_PROJECT_PLAN_STEPS);

    if (normalizedSteps.length === 0) {
        throw new Error('O Cody nao conseguiu gerar um plano acionavel para este projeto.');
    }

    return {
        goal: asNonEmptyString(parsed.goal) ?? task,
        summary: asNonEmptyString(parsed.summary) ?? 'Aplicar mudancas graduais e revisar diff antes de cada arquivo.',
        risks: asStringArray(parsed.risks),
        validations: asStringArray(parsed.validations),
        steps: normalizedSteps
    };
}

function normalizePlanStep(value: unknown, index: number): CodyProjectPlanStep | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const candidate = value as Partial<CodyProjectPlanStep>;
    const filePath = normalizeProjectPath(candidate.filePath);
    const action = candidate.action === 'create' || candidate.action === 'update'
        ? candidate.action
        : undefined;

    if (!filePath || !action) {
        return undefined;
    }

    return {
        id: asNonEmptyString(candidate.id) ?? `step-${index + 1}`,
        title: asNonEmptyString(candidate.title) ?? `Alterar ${filePath}`,
        filePath,
        action,
        summary: asNonEmptyString(candidate.summary) ?? 'Atualizar este arquivo conforme o objetivo principal.',
        reason: asNonEmptyString(candidate.reason) ?? 'Arquivo necessario para atender a solicitacao.',
        validation: asStringArray(candidate.validation)
    };
}

function asNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeProjectPath(relativePath: string | undefined): string {
    if (!relativePath) {
        return '';
    }

    const normalized = relativePath.replace(/\\/g, '/').trim();

    if (!normalized || path.isAbsolute(normalized) || normalized.includes('..')) {
        return '';
    }

    return normalized;
}

function buildExecutionPrompt({
    task,
    plan,
    step,
    currentFile,
    supportingFiles
}: {
    task: string;
    plan: CodyProjectPlan;
    step: CodyProjectPlanStep;
    currentFile?: { content: string; languageId: string };
    supportingFiles: CodyWorkspaceSnapshotFile[];
}): string {
    const supportingSections = supportingFiles.length > 0
        ? supportingFiles.map(file => [
            `ARQUIVO DE APOIO: ${file.path}`,
            `LINGUAGEM: ${file.languageId}`,
            'CONTEUDO:',
            '```',
            file.content,
            '```'
        ].join('\n')).join('\n\n')
        : '(nenhum arquivo de apoio adicional)';

    const currentContentSection = currentFile
        ? [
            `ARQUIVO ATUAL: ${step.filePath}`,
            `LINGUAGEM: ${currentFile.languageId}`,
            'CONTEUDO ATUAL:',
            '```',
            currentFile.content,
            '```'
        ].join('\n')
        : `ARQUIVO NOVO: ${step.filePath}\nAinda nao existe no workspace.`;

    const validationChecklist = step.validation.length > 0
        ? step.validation.join('\n- ')
        : 'manter o comportamento atual e a consistencia do projeto';
    const frontendPromptBlock = buildFrontendPromptBlock({
        request: `${task}\n${step.summary}\n${step.reason}`,
        filePath: step.filePath,
        languageId: currentFile?.languageId
    }, 'edit');

    return `
Voce vai alterar exatamente um arquivo de um projeto existente.

OBJETIVO GERAL:
${task}

RESUMO DO PLANO:
${plan.summary}

PASSO ATUAL:
- Titulo: ${step.title}
- Arquivo: ${step.filePath}
- Acao: ${step.action}
- Objetivo neste arquivo: ${step.summary}
- Motivo: ${step.reason}
- Checklist:
- ${validationChecklist}

${currentContentSection}

ARQUIVOS DE APOIO:
${supportingSections}

${frontendPromptBlock}

Regras obrigatorias:
- Responda APENAS com o conteudo final completo do arquivo ${step.filePath}.
- Nao explique nada fora do arquivo.
- Nao use blocos de markdown.
- Nao escreva \`\`\`.
- Nao devolva diff, comentario final, titulo ou resumo.
- Preserve imports, contratos publicos e comportamento existente quando isso nao conflitar com a tarefa.
- Evite mudancas desnecessarias fora do escopo deste arquivo.
- Se criar arquivo novo, entregue um conteudo pronto para uso imediato.
`;
}

async function showExecutionSummary(
    task: string,
    plan: CodyProjectPlan,
    execution: ProjectPlanExecutionResult
): Promise<void> {
    const summaryDocument = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: buildExecutionSummaryMarkdown(task, plan, execution)
    });

    await vscode.window.showTextDocument(summaryDocument, {
        preview: true,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Beside
    });
}

function buildExecutionSummaryMarkdown(
    task: string,
    plan: CodyProjectPlan,
    execution: ProjectPlanExecutionResult
): string {
    const applied = execution.applied.length > 0
        ? execution.applied.map(file => `- \`${file}\``).join('\n')
        : '- Nenhum arquivo aplicado';
    const skipped = execution.skipped.length > 0
        ? execution.skipped.map(item => `- \`${item.filePath}\`: ${item.reason}`).join('\n')
        : '- Nenhum arquivo pulado';
    const failed = execution.failed.length > 0
        ? execution.failed.map(item => `- \`${item.filePath}\`: ${item.reason}`).join('\n')
        : '- Nenhuma falha';

    return `# Execucao do Plano do Cody

## Tarefa

${task}

## Resumo

${plan.summary}

## Aplicados

${applied}

## Pulados

${skipped}

## Falhas

${failed}

## Proximos passos

- Revise os arquivos aplicados e rode testes do projeto.
- Confira o checklist sugerido pelo plano antes de publicar mudancas maiores.
`;
}

function inferLanguageId(relativePath: string): string {
    const extension = path.extname(relativePath).toLowerCase();

    switch (extension) {
        case '.ts':
            return 'typescript';
        case '.tsx':
            return 'typescriptreact';
        case '.js':
            return 'javascript';
        case '.jsx':
            return 'javascriptreact';
        case '.json':
            return 'json';
        case '.md':
            return 'markdown';
        case '.css':
            return 'css';
        case '.scss':
            return 'scss';
        case '.html':
            return 'html';
        case '.yml':
        case '.yaml':
            return 'yaml';
        default:
            return 'plaintext';
    }
}

function buildPlanningTaskSession(task: string, existingTaskSession?: CodyTaskSession): CodyTaskSession {
    return {
        goal: task,
        status: 'planning',
        summary: existingTaskSession?.summary ?? 'Planejando a execucao da tarefa por arquivo.',
        plan: existingTaskSession?.plan,
        stepStates: existingTaskSession?.stepStates ?? [],
        lastSummary: existingTaskSession?.lastSummary,
        updatedAt: Date.now()
    };
}

function buildReadyTaskSession(task: string, plan: CodyProjectPlan): CodyTaskSession {
    return {
        goal: task,
        status: 'ready',
        summary: plan.summary,
        plan,
        stepStates: plan.steps.map(step => ({
            stepId: step.id,
            filePath: step.filePath,
            title: step.title,
            status: 'pending' as const
        })),
        updatedAt: Date.now()
    };
}

function upsertTaskStepState(taskSession: CodyTaskSession, stepState: CodyTaskStepState): CodyTaskSession {
    const existingIndex = taskSession.stepStates.findIndex(item => item.stepId === stepState.stepId);
    const nextStepStates = [...taskSession.stepStates];

    if (existingIndex >= 0) {
        nextStepStates[existingIndex] = stepState;
    } else {
        nextStepStates.push(stepState);
    }

    return {
        ...taskSession,
        status: 'in_progress',
        stepStates: nextStepStates,
        updatedAt: Date.now()
    };
}

function finalizeTaskSession(
    taskSession: CodyTaskSession | undefined,
    execution: ProjectPlanExecutionResult
): CodyTaskSession | undefined {
    if (!taskSession) {
        return undefined;
    }

    const summary = [
        execution.applied.length > 0 ? `${execution.applied.length} arquivo(s) aplicado(s)` : 'nenhum arquivo aplicado',
        execution.skipped.length > 0 ? `${execution.skipped.length} pulado(s)` : 'nenhum pulado',
        execution.failed.length > 0 ? `${execution.failed.length} falha(s)` : 'nenhuma falha'
    ].join(', ');

    const status = execution.cancelled
        ? 'cancelled'
        : execution.failed.length > 0 || execution.skipped.length > 0
            ? 'completed_with_issues'
            : 'completed';

    return {
        ...taskSession,
        status,
        lastSummary: summary,
        updatedAt: Date.now()
    };
}
