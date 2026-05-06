import * as vscode from 'vscode';

type ProjectPreviewInput = {
    projectName: string;
    projectPath: string;
    sourceLabel: string;
    folders: string[];
    files: Array<{ path: string; content: string }>;
    instructions?: string;
};

export async function previewProjectStructure({
    projectName,
    projectPath,
    sourceLabel,
    folders,
    files,
    instructions
}: ProjectPreviewInput): Promise<boolean> {
    const previewDocument = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: buildPreviewMarkdown(projectName, projectPath, sourceLabel, folders, files, instructions)
    });

    await vscode.window.showTextDocument(previewDocument, {
        preview: true,
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Beside
    });

    const choice = await vscode.window.showInformationMessage(
        `Revise o preview do projeto "${projectName}" antes de criar os arquivos.`,
        { modal: true },
        'Criar projeto',
        'Cancelar'
    );

    return choice === 'Criar projeto';
}

function buildPreviewMarkdown(
    projectName: string,
    projectPath: string,
    sourceLabel: string,
    folders: string[],
    files: Array<{ path: string; content: string }>,
    instructions?: string
): string {
    const listedFolders = folders.length > 0
        ? folders.map(folder => `- \`${folder}\``).join('\n')
        : '- Nenhuma pasta adicional';

    const listedFiles = files
        .map(file => `- \`${file.path}\` (${file.content.length} chars)`)
        .join('\n');

    const sampleFiles = files
        .slice(0, 3)
        .map(file => `## ${file.path}\n\n\`\`\`\n${truncate(file.content, 800)}\n\`\`\``)
        .join('\n\n');

    return `# Preview do Projeto

## Resumo

- Nome: \`${projectName}\`
- Destino: \`${projectPath}\`
- Origem da estrutura: ${sourceLabel}
- Pastas: ${folders.length}
- Arquivos: ${files.length}

## Pastas

${listedFolders}

## Arquivos

${listedFiles}

## Amostra

${sampleFiles || 'Sem arquivos para mostrar.'}

## Instrucoes

${instructions ?? 'Nenhuma instrucao adicional.'}
`;
}

function truncate(value: string, maxChars: number): string {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n... [truncado]`;
}
