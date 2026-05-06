export type CodyChatHistoryEntry = {
    role: 'user' | 'assistant';
    text: string;
    prompt?: string;
};

export type CodyChatSession = {
    id: string;
    title: string;
    pinned: boolean;
    history: CodyChatHistoryEntry[];
    contextSummary?: string;
    intentSummary?: string;
    taskSession?: CodyTaskSession;
    createdAt: number;
    updatedAt: number;
};

export type CodyChatState = {
    sessions: CodyChatSession[];
    activeSessionId?: string;
};

export type CodyProjectContext = {
    summary: string;
    promptSection: string;
};

export type CodyWorkspaceSnapshotFile = {
    path: string;
    languageId: string;
    content: string;
    reason: string;
};

export type CodyWorkspaceSnapshot = {
    rootPath: string;
    tree: string;
    files: CodyWorkspaceSnapshotFile[];
};

export type CodyWorkspaceInsights = {
    packageManager?: string;
    frameworks: string[];
    sourceFileCount: number;
    testFileCount: number;
    hasTests: boolean;
    hasLinting: boolean;
    hasFormatting: boolean;
    hasTypeScript: boolean;
    hasCi: boolean;
    hasDocker: boolean;
    hasEnvExample: boolean;
    hasReadme: boolean;
    keyRisks: string[];
    strengths: string[];
    notableScripts: string[];
    notableDependencies: string[];
};

export type CodyAnalysisRecommendation = {
    title: string;
    impact: 'high' | 'medium' | 'low';
    why: string;
    files: string[];
    actions: string[];
};

export type CodyProjectAnalysis = {
    executiveSummary: string;
    strengths: string[];
    risks: string[];
    recommendations: CodyAnalysisRecommendation[];
    roadmap: {
        quickWins: string[];
        nextLevel: string[];
        strategic: string[];
    };
    nextBestMove: {
        title: string;
        why: string;
        files: string[];
        acceptanceCriteria: string[];
    };
};

export type CodyProjectPlanStep = {
    id: string;
    title: string;
    filePath: string;
    action: 'create' | 'update';
    summary: string;
    reason: string;
    validation: string[];
};

export type CodyProjectPlan = {
    goal: string;
    summary: string;
    risks: string[];
    validations: string[];
    steps: CodyProjectPlanStep[];
};

export type CodyTaskStepState = {
    stepId: string;
    filePath: string;
    title: string;
    status: 'pending' | 'applied' | 'skipped' | 'failed';
    note?: string;
};

export type CodyTaskSession = {
    goal: string;
    status: 'planning' | 'ready' | 'in_progress' | 'completed' | 'completed_with_issues' | 'cancelled';
    summary: string;
    plan?: CodyProjectPlan;
    stepStates: CodyTaskStepState[];
    lastSummary?: string;
    updatedAt: number;
};

export type AskOllamaOptions = {
    history?: CodyChatHistoryEntry[];
    projectContext?: CodyProjectContext;
    timeoutMs?: number;
    maxTokens?: number;
    onStreamChunk?: (chunk: string) => void | Promise<void>;
};

export type AskOllama = (prompt: string, options?: AskOllamaOptions) => Promise<string>;

export type CodyPromptRequest = {
    prompt: string;
    userMessage?: string;
    includeProjectContext?: boolean;
    routeIntent?: boolean;
};
