export type FrontendPromptGoal = 'generate' | 'edit' | 'project' | 'plan';

export type FrontendPromptContext = {
    request?: string;
    filePath?: string;
    languageId?: string;
};

const FRONTEND_LANGUAGE_IDS = new Set([
    'html',
    'css',
    'scss',
    'less',
    'javascriptreact',
    'typescriptreact',
    'vue',
    'svelte'
]);

const FRONTEND_EXTENSIONS = new Set([
    '.html',
    '.css',
    '.scss',
    '.less',
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.vue',
    '.svelte'
]);

const FRONTEND_KEYWORDS = [
    'frontend',
    'interface',
    'ui',
    'ux',
    'layout',
    'landing page',
    'dashboard',
    'pagina',
    'tela',
    'componente',
    'component',
    'hero',
    'formulario',
    'form',
    'botao',
    'card',
    'navbar',
    'sidebar',
    'css',
    'scss',
    'html',
    'bootstrap',
    'react',
    'next',
    'vite'
];

export function buildFrontendPromptBlock(
    context: FrontendPromptContext,
    goal: FrontendPromptGoal
): string {
    if (!isFrontendContext(context)) {
        return '';
    }

    const request = normalize(context.request);
    const mentionsBootstrap = request.includes('bootstrap');
    const goalSpecificRules = getGoalSpecificRules(goal);
    const bootstrapRule = mentionsBootstrap
        ? '- Se usar Bootstrap, use Bootstrap 5 com composicao inteligente de grid/utilities e complemente com CSS proprio para evitar visual padrao.'
        : '- Se Bootstrap fizer sentido para acelerar a entrega, use Bootstrap 5 apenas com customizacao visual real; caso contrario, prefira CSS proprio mais intencional.';

    return [
        'DIRECAO EXTRA DE FRONTEND E INTERFACE:',
        '- Entregue uma interface moderna, intencional e com cara de produto real, nao um layout generico.',
        '- Trabalhe hierarquia visual forte, espacamento consistente, contraste bom e ritmo tipografico claro.',
        '- Use paleta, sombras, bordas e superficies com identidade visual coerente.',
        '- Garanta responsividade real em desktop e mobile.',
        '- Inclua estados importantes quando fizer sentido: hover, focus, active, empty e loading.',
        '- Prefira composicao de secoes e componentes reutilizaveis em vez de blocos soltos.',
        '- Evite fontes, cores e estruturas que parecam boilerplate de IA.',
        bootstrapRule,
        ...goalSpecificRules
    ].join('\n');
}

export function isFrontendContext(context: FrontendPromptContext): boolean {
    const normalizedRequest = normalize(context.request);
    const normalizedPath = normalize(context.filePath);
    const normalizedLanguageId = normalize(context.languageId);

    if (FRONTEND_LANGUAGE_IDS.has(normalizedLanguageId)) {
        return true;
    }

    for (const extension of FRONTEND_EXTENSIONS) {
        if (normalizedPath.endsWith(extension)) {
            return true;
        }
    }

    return FRONTEND_KEYWORDS.some(keyword => normalizedRequest.includes(keyword));
}

function getGoalSpecificRules(goal: FrontendPromptGoal): string[] {
    switch (goal) {
        case 'edit':
            return [
                '- Preserve a semantica e o comportamento existente, mas refine a experiencia visual quando isso fizer parte do pedido.',
                '- Respeite o design system e os padroes ja presentes no projeto quando eles existirem.'
            ];
        case 'project':
            return [
                '- Inclua arquivos e estrutura suficientes para uma base de frontend profissional, com separacao clara entre layout, componentes e estilos.',
                '- Se o pedido envolver UI, inclua uma base visual ja apresentavel desde a primeira execucao.'
            ];
        case 'plan':
            return [
                '- Se a solicitacao envolver UI, planeje arquivos de layout, componentes, estilos e testes visuais/pragmaticos quando isso reduzir regressao.',
                '- Priorize mudancas que elevem experiencia, consistencia visual e clareza de uso, nao apenas cosmetica superficial.'
            ];
        case 'generate':
        default:
            return [
                '- Entregue markup e estilos com estrutura elegante, nomes de classe claros e acabamento profissional.',
                '- Quando gerar CSS, use tokens e variaveis quando isso melhorar consistencia e manutencao.'
            ];
    }
}

function normalize(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase();
}
