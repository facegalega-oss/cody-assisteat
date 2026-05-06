export function extractCodeFromResponse(response: string): string {
    const trimmed = normalizeResponse(response);
    const fencedBlocks = [...trimmed.matchAll(/```[a-zA-Z0-9_.+-]*\r?\n([\s\S]*?)\r?\n```/g)];

    if (fencedBlocks.length > 0) {
        const richestBlock = fencedBlocks
            .map(match => match[1]?.trim() ?? '')
            .filter(Boolean)
            .sort((left, right) => right.length - left.length)[0];

        if (richestBlock) {
            return richestBlock;
        }
    }

    return trimmed;
}

export function extractFileContentFromResponse(response: string): string {
    let content = extractCodeFromResponse(response);

    const trailingExplanationPatterns = [
        /\n{2,}(?:este e o conteudo final do arquivo|este é o conteúdo final do arquivo|este e o conteudo final|este é o conteúdo final)[\s\S]*$/i,
        /\n{2,}(?:this is the final file content|this is the final content|the final file content)[\s\S]*$/i,
        /\n{2,}(?:as alteracoes incluem|as alterações incluem|the changes include|changes included)[\s\S]*$/i,
        /\n{2,}(?:explicacao|explicação|explanation|observacao|observação|note):[\s\S]*$/i
    ];

    for (const pattern of trailingExplanationPatterns) {
        content = content.replace(pattern, '').trimEnd();
    }

    content = content
        .replace(/^```[a-zA-Z0-9_.+-]*\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    return content;
}

export function assertSafeGeneratedFileContent(content: string, targetLabel: string): void {
    if (!content.trim()) {
        throw new Error(`A resposta do modelo para ${targetLabel} veio vazia.`);
    }

    if (/```/.test(content)) {
        throw new Error(`A resposta do modelo para ${targetLabel} ainda contem cerca de markdown.`);
    }

    if (/(?:^|\n)(?:este e o conteudo final|este é o conteúdo final|this is the final file content|the changes include)/i.test(content)) {
        throw new Error(`A resposta do modelo para ${targetLabel} ainda contem texto explicativo.`);
    }
}

function normalizeResponse(response: string): string {
    return response.replace(/\r\n/g, '\n').trim();
}
