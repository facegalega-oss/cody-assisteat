export type DiffPreview = {
    addedLines: number;
    removedLines: number;
    changed: boolean;
    diffText: string;
    statsText: string;
};

const CONTEXT_LINES = 3;
const MAX_RENDERED_CHANGED_LINES = 120;

export function buildDiffPreview(originalCode: string, modifiedCode: string): DiffPreview {
    const originalLines = splitLines(originalCode);
    const modifiedLines = splitLines(modifiedCode);
    const prefixLength = getCommonPrefixLength(originalLines, modifiedLines);
    const suffixLength = getCommonSuffixLength(originalLines, modifiedLines, prefixLength);
    const removedMiddle = originalLines.slice(prefixLength, originalLines.length - suffixLength);
    const addedMiddle = modifiedLines.slice(prefixLength, modifiedLines.length - suffixLength);
    const changed = removedMiddle.length > 0 || addedMiddle.length > 0;

    if (!changed) {
        return {
            addedLines: 0,
            removedLines: 0,
            changed: false,
            diffText: 'Nenhuma mudanca detectada entre o codigo original e o codigo proposto.',
            statsText: 'Sem alteracoes'
        };
    }

    const previewLines: string[] = [];
    const prefixContext = originalLines.slice(Math.max(0, prefixLength - CONTEXT_LINES), prefixLength);
    const suffixStart = Math.max(prefixLength, originalLines.length - suffixLength);
    const suffixContext = originalLines.slice(suffixStart, Math.min(originalLines.length, suffixStart + CONTEXT_LINES));

    if (prefixLength > CONTEXT_LINES) {
        previewLines.push(`... ${prefixLength - CONTEXT_LINES} linha(s) sem alteracao acima ...`);
    }

    for (const line of prefixContext) {
        previewLines.push(`  ${line}`);
    }

    for (const line of removedMiddle.slice(0, MAX_RENDERED_CHANGED_LINES)) {
        previewLines.push(`- ${line}`);
    }

    if (removedMiddle.length > MAX_RENDERED_CHANGED_LINES) {
        previewLines.push(`... ${removedMiddle.length - MAX_RENDERED_CHANGED_LINES} linha(s) removidas omitidas ...`);
    }

    for (const line of addedMiddle.slice(0, MAX_RENDERED_CHANGED_LINES)) {
        previewLines.push(`+ ${line}`);
    }

    if (addedMiddle.length > MAX_RENDERED_CHANGED_LINES) {
        previewLines.push(`... ${addedMiddle.length - MAX_RENDERED_CHANGED_LINES} linha(s) adicionadas omitidas ...`);
    }

    for (const line of suffixContext) {
        previewLines.push(`  ${line}`);
    }

    const omittedSuffixLines = suffixLength > CONTEXT_LINES ? suffixLength - CONTEXT_LINES : 0;
    if (omittedSuffixLines > 0) {
        previewLines.push(`... ${omittedSuffixLines} linha(s) sem alteracao abaixo ...`);
    }

    const addedLines = addedMiddle.length;
    const removedLines = removedMiddle.length;

    return {
        addedLines,
        removedLines,
        changed: true,
        diffText: previewLines.join('\n'),
        statsText: `+${addedLines} / -${removedLines}`
    };
}

function splitLines(value: string): string[] {
    return value.replace(/\r\n/g, '\n').split('\n');
}

function getCommonPrefixLength(left: string[], right: string[]): number {
    const limit = Math.min(left.length, right.length);
    let index = 0;

    while (index < limit && left[index] === right[index]) {
        index += 1;
    }

    return index;
}

function getCommonSuffixLength(left: string[], right: string[], prefixLength: number): number {
    const maxLeft = left.length - prefixLength;
    const maxRight = right.length - prefixLength;
    const limit = Math.min(maxLeft, maxRight);
    let index = 0;

    while (
        index < limit &&
        left[left.length - 1 - index] === right[right.length - 1 - index]
    ) {
        index += 1;
    }

    return index;
}
