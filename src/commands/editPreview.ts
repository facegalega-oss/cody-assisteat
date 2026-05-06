import * as vscode from 'vscode';
import * as path from 'path';

type PreviewSelectionEditParams = {
    documentUri: vscode.Uri;
    documentLabel: string;
    languageId: string;
    originalCode: string;
    modifiedCode: string;
    selectionRange: vscode.Range;
};

type ApplySelectionEditParams = {
    documentUri: vscode.Uri;
    originalVersion: number;
    originalCode: string;
    modifiedCode: string;
    selectionRange: vscode.Range;
};

export async function openSelectionDiffPreview({
    documentUri,
    documentLabel,
    languageId,
    originalCode,
    modifiedCode,
    selectionRange
}: PreviewSelectionEditParams): Promise<boolean> {
    const originalDocument = await vscode.workspace.openTextDocument(documentUri);
    const originalContent = originalDocument.getText();
    const previewContent = buildPreviewContent(originalContent, selectionRange, modifiedCode);

    const previewDocument = await vscode.workspace.openTextDocument({
        content: previewContent,
        language: languageId
    });

    await vscode.commands.executeCommand(
        'vscode.diff',
        originalDocument.uri,
        previewDocument.uri,
        `Cody Preview: ${documentLabel}`
    );

    return true;
}

export async function applySelectionEditSafely({
    documentUri,
    originalVersion,
    originalCode,
    modifiedCode,
    selectionRange
}: ApplySelectionEditParams): Promise<{ applied: boolean; reason?: string }> {
    const originalDocument = await vscode.workspace.openTextDocument(documentUri);

    if (originalDocument.version !== originalVersion) {
        const reason = 'O arquivo mudou enquanto a revisao estava aberta. Gere a alteracao novamente.';
        vscode.window.showWarningMessage(reason);
        return { applied: false, reason };
    }

    const currentSelectedText = originalDocument.getText(selectionRange);
    if (currentSelectedText !== originalCode) {
        const reason = 'A selecao mudou enquanto a revisao estava aberta. Gere a alteracao novamente.';
        vscode.window.showWarningMessage(reason);
        return { applied: false, reason };
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(documentUri, selectionRange, modifiedCode);
    const applied = await vscode.workspace.applyEdit(workspaceEdit);

    if (!applied) {
        const reason = 'Nao foi possivel aplicar a alteracao sugerida.';
        vscode.window.showErrorMessage(reason);
        return { applied: false, reason };
    }

    const updatedDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === documentUri.toString());
    if (updatedDocument) {
        await updatedDocument.save();
    }

    return { applied: true };
}

type PreviewWorkspaceFileChangeParams = {
    relativePath: string;
    originalContent?: string;
    modifiedContent: string;
    languageId: string;
};

export async function previewWorkspaceFileChange({
    relativePath,
    originalContent,
    modifiedContent,
    languageId
}: PreviewWorkspaceFileChangeParams): Promise<'applied' | 'skipped' | 'cancelled'> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('Abra um projeto primeiro.');
    }

    const normalizedPath = relativePath.replace(/\\/g, '/').trim();
    const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, ...normalizedPath.split('/'));
    const fileExists = typeof originalContent === 'string';

    const leftDocument = fileExists
        ? await vscode.workspace.openTextDocument(targetUri)
        : await vscode.workspace.openTextDocument({ content: '', language: languageId });
    const rightDocument = await vscode.workspace.openTextDocument({
        content: modifiedContent,
        language: languageId
    });

    const previewLabel = fileExists
        ? `Cody Preview: ${normalizedPath}`
        : `Cody Preview: criar ${normalizedPath}`;

    await vscode.commands.executeCommand(
        'vscode.diff',
        leftDocument.uri,
        rightDocument.uri,
        previewLabel
    );

    const choice = await vscode.window.showInformationMessage(
        `Revise o diff do arquivo "${normalizedPath}" antes de aplicar.`,
        { modal: true },
        'Aplicar',
        'Pular',
        'Cancelar tarefa'
    );

    if (choice === 'Cancelar tarefa') {
        return 'cancelled';
    }

    if (choice !== 'Aplicar') {
        return 'skipped';
    }

    if (fileExists) {
        const latest = await vscode.workspace.openTextDocument(targetUri);
        if (latest.getText() !== originalContent) {
            vscode.window.showWarningMessage(`O arquivo "${normalizedPath}" mudou durante a revisao. Gere o plano novamente.`);
            return 'skipped';
        }
    } else {
        try {
            await vscode.workspace.fs.stat(targetUri);
            vscode.window.showWarningMessage(`O arquivo "${normalizedPath}" foi criado enquanto o diff estava aberto.`);
            return 'skipped';
        } catch {
            // Arquivo ainda nao existe, pode seguir.
        }
    }

    await writeWorkspaceFile(targetUri, modifiedContent, fileExists);
    return 'applied';
}

function buildPreviewContent(documentText: string, selection: vscode.Range, modifiedCode: string): string {
    const startOffset = computeOffset(documentText, selection.start);
    const endOffset = computeOffset(documentText, selection.end);

    return `${documentText.slice(0, startOffset)}${modifiedCode}${documentText.slice(endOffset)}`;
}

function computeOffset(text: string, position: vscode.Position): number {
    let offset = 0;
    let line = 0;

    while (line < position.line) {
        const nextBreak = text.indexOf('\n', offset);
        if (nextBreak === -1) {
            return text.length;
        }

        offset = nextBreak + 1;
        line += 1;
    }

    return Math.min(offset + position.character, text.length);
}

async function writeWorkspaceFile(targetUri: vscode.Uri, content: string, fileExists: boolean): Promise<void> {
    const openDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === targetUri.toString());

    if (openDocument) {
        if (openDocument.isDirty) {
            throw new Error(`O arquivo ${path.basename(targetUri.fsPath)} possui alteracoes nao salvas no editor.`);
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(targetUri, fullDocumentRange(openDocument), content);
        const applied = await vscode.workspace.applyEdit(edit);

        if (!applied) {
            throw new Error(`Nao foi possivel aplicar a alteracao em ${targetUri.fsPath}.`);
        }

        await openDocument.save();
        return;
    }

    const targetDirectory = vscode.Uri.file(path.dirname(targetUri.fsPath));
    await vscode.workspace.fs.createDirectory(targetDirectory);
    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));

    if (!fileExists) {
        const createdDocument = await vscode.workspace.openTextDocument(targetUri);
        await createdDocument.save();
    }
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
    const lastLine = document.lineAt(document.lineCount - 1);
    return new vscode.Range(new vscode.Position(0, 0), lastLine.rangeIncludingLineBreak.end);
}
