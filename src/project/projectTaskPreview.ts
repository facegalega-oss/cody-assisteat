import * as vscode from 'vscode';

import type { CodyProjectPlan, CodyWorkspaceSnapshot } from '../core/types';

type ProjectTaskPreviewInput = {
    task: string;
    snapshot: CodyWorkspaceSnapshot;
    plan: CodyProjectPlan;
};

export async function previewProjectTaskPlan({
    task,
    snapshot,
    plan
}: ProjectTaskPreviewInput): Promise<boolean> {
    const previewDocument = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: buildPreviewMarkdown(task, snapshot, plan)
    });

    await vscode.window.showTextDocument(previewDocument, {
        preview: true,
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Beside
    });

    const choice = await vscode.window.showInformationMessage(
        'Revise o plano do Cody antes de executar alteracoes no projeto.',
        { modal: true },
        'Executar plano',
        'Cancelar'
    );

    return choice === 'Executar plano';
}

function buildPreviewMarkdown(task: string, snapshot: CodyWorkspaceSnapshot, plan: CodyProjectPlan): string {
    const listedFiles = snapshot.files.length > 0
        ? snapshot.files.map(file => `- \`${file.path}\` (${file.reason})`).join('\n')
        : '- Nenhum arquivo contextual carregado';

    const listedRisks = plan.risks.length > 0
        ? plan.risks.map(item => `- ${item}`).join('\n')
        : '- Nenhum risco relevante informado';

    const listedValidations = plan.validations.length > 0
        ? plan.validations.map(item => `- ${item}`).join('\n')
        : '- Nenhuma validacao adicional informada';

    const listedSteps = plan.steps.map((step, index) => [
        `### ${index + 1}. ${step.title}`,
        `- Arquivo: \`${step.filePath}\``,
        `- Acao: \`${step.action}\``,
        `- Objetivo: ${step.summary}`,
        `- Motivo: ${step.reason}`,
        step.validation.length > 0
            ? `- Validar: ${step.validation.join('; ')}`
            : '- Validar: usar revisao manual antes de aplicar'
    ].join('\n')).join('\n\n');

    return `# Plano de Mudanca do Projeto

## Tarefa pedida

${task}

## Leitura do Cody

- Raiz do projeto: \`${snapshot.rootPath}\`
- Arquivos analisados: ${snapshot.files.length}
- Arquivos planejados para mudanca: ${plan.steps.length}

## Resumo do plano

${plan.summary}

## Arquivos usados como contexto

${listedFiles}

## Riscos observados

${listedRisks}

## Validacoes recomendadas

${listedValidations}

## Execucao arquivo por arquivo

${listedSteps || 'Nenhum passo gerado.'}
`;
}
