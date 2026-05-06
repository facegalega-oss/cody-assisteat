export type CodyChatIntent =
    | { type: 'general' }
    | { type: 'analyzeProject'; request: string }
    | { type: 'planProjectTask'; request: string }
    | { type: 'continueTask' }
    | { type: 'explainSelection'; request: string }
    | { type: 'editSelection'; request: string }
    | { type: 'createFile'; request: string; suggestedFileName?: string }
    | { type: 'createProject'; request: string };

const ANALYZE_PATTERNS = [
    /\banalis[ea]\b/i,
    /\bavalie\b/i,
    /\brevise\b/i,
    /\bentenda\b/i,
    /\bdiagnostique\b/i
];

const PROJECT_PATTERNS = [
    /\bprojeto\b/i,
    /\bcodebase\b/i,
    /\brepositorio\b/i,
    /\bworkspace\b/i,
    /\barquitetura\b/i,
    /\baplicac[aã]o\b/i,
    /\bsistema\b/i
];

const PLAN_PATTERNS = [
    /\badicion(e|ar)\b/i,
    /\bimplemente?\b/i,
    /\bcrie\b/i,
    /\bmelhore\b/i,
    /\brefatore\b/i,
    /\bcorrij[ae]\b/i,
    /\bajuste\b/i,
    /\bevolu(a|ir)\b/i,
    /\bcontinue\b/i,
    /\bcontinuar\b/i,
    /\bquero\b/i,
    /\bpreciso\b/i
];

const CONTINUE_TASK_PATTERNS = [
    /\bcontinue\b/i,
    /\bcontinuar\b/i,
    /\bprosseguir\b/i,
    /\bseguir\b/i,
    /\bretomar\b/i
];

const TASK_PATTERNS = [
    /\btarefa\b/i,
    /\bplano\b/i,
    /\bmelhoria\b/i,
    /\bfeature\b/i,
    /\bimplementac/i
];

const EXPLAIN_PATTERNS = [
    /\bexplique\b/i,
    /\bo que faz\b/i,
    /\bme explique\b/i,
    /\bentenda este codigo\b/i
];

const EDIT_PATTERNS = [
    /\bedite\b/i,
    /\brefatore\b/i,
    /\bmelhore\b/i,
    /\bcorrij[ae]\b/i,
    /\bajuste\b/i,
    /\botimize\b/i
];

const CODE_PATTERNS = [
    /\bcodigo\b/i,
    /\btrecho\b/i,
    /\bselec[aã]o\b/i,
    /\bfunc[aã]o\b/i,
    /\bclasse\b/i,
    /\bm[eé]todo\b/i
];

const CREATE_FILE_PATTERNS = [
    /\bcrie um arquivo\b/i,
    /\bcriar um arquivo\b/i,
    /\bnovo arquivo\b/i,
    /\bgere um arquivo\b/i,
    /\bcrie um componente\b/i,
    /\bcrie um script\b/i
];

const CREATE_PROJECT_PATTERNS = [
    /\bcrie um projeto\b/i,
    /\bcriar um projeto\b/i,
    /\bnovo projeto\b/i,
    /\bcrie uma aplicac[aã]o\b/i,
    /\bcrie uma api\b/i,
    /\bcrie uma extens[aã]o\b/i,
    /\bmonte a estrutura de um projeto\b/i
];

export function detectChatIntent(message: string, hasSelection: boolean): CodyChatIntent {
    const normalizedMessage = message.trim();

    if (!normalizedMessage) {
        return { type: 'general' };
    }

    if (matchesAny(normalizedMessage, CREATE_PROJECT_PATTERNS)) {
        return {
            type: 'createProject',
            request: normalizedMessage
        };
    }

    if (matchesAny(normalizedMessage, CREATE_FILE_PATTERNS)) {
        return {
            type: 'createFile',
            request: normalizedMessage,
            suggestedFileName: extractSuggestedFileName(normalizedMessage)
        };
    }

    if (matchesAny(normalizedMessage, CONTINUE_TASK_PATTERNS) && (
        matchesAny(normalizedMessage, TASK_PATTERNS) || /\bde onde parou\b/i.test(normalizedMessage)
    )) {
        return { type: 'continueTask' };
    }

    if (hasSelection && matchesAny(normalizedMessage, EXPLAIN_PATTERNS)) {
        return {
            type: 'explainSelection',
            request: normalizedMessage
        };
    }

    if (hasSelection && matchesAny(normalizedMessage, EDIT_PATTERNS) && matchesAny(normalizedMessage, CODE_PATTERNS)) {
        return {
            type: 'editSelection',
            request: normalizedMessage
        };
    }

    if (matchesAny(normalizedMessage, ANALYZE_PATTERNS) && matchesAny(normalizedMessage, PROJECT_PATTERNS)) {
        return {
            type: 'analyzeProject',
            request: normalizedMessage
        };
    }

    if (matchesAny(normalizedMessage, PLAN_PATTERNS) && (
        matchesAny(normalizedMessage, PROJECT_PATTERNS)
        || /\bfuncionalidade\b/i.test(normalizedMessage)
        || /\bfeature\b/i.test(normalizedMessage)
        || /\bendpoint\b/i.test(normalizedMessage)
        || /\bautentic/i.test(normalizedMessage)
        || /\bapi\b/i.test(normalizedMessage)
        || /\bmodulo\b/i.test(normalizedMessage)
    )) {
        return {
            type: 'planProjectTask',
            request: normalizedMessage
        };
    }

    return { type: 'general' };
}

export function getIntentSummary(intent: CodyChatIntent): string {
    switch (intent.type) {
        case 'analyzeProject':
            return 'Modo detectado: analise profunda do projeto';
        case 'planProjectTask':
            return 'Modo detectado: planejamento seguro e execucao por arquivo';
        case 'continueTask':
            return 'Modo detectado: continuar tarefa ativa';
        case 'explainSelection':
            return 'Modo detectado: explicacao da selecao atual';
        case 'editSelection':
            return 'Modo detectado: edicao segura da selecao atual';
        case 'createFile':
            return 'Modo detectado: criacao guiada de arquivo';
        case 'createProject':
            return 'Modo detectado: criacao guiada de projeto';
        default:
            return 'Modo atual: conversa normal';
    }
}

export function getIntentLabel(intent: CodyChatIntent): string {
    switch (intent.type) {
        case 'analyzeProject':
            return 'Analise profunda';
        case 'planProjectTask':
            return 'Planejar e aplicar';
        case 'continueTask':
            return 'Continuar tarefa';
        case 'explainSelection':
            return 'Explicar selecao';
        case 'editSelection':
            return 'Editar selecao';
        case 'createFile':
            return 'Criar arquivo';
        case 'createProject':
            return 'Criar projeto';
        default:
            return 'Conversa normal';
    }
}

export function isStructuredIntent(intent: CodyChatIntent): boolean {
    return intent.type !== 'general';
}

function extractSuggestedFileName(message: string): string | undefined {
    const explicitFileNameMatch = message.match(/\b([A-Za-z0-9._-]+\.[A-Za-z0-9]+)\b/);
    return explicitFileNameMatch?.[1];
}

function matchesAny(message: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(message));
}
