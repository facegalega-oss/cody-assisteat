import * as vscode from 'vscode';

import {
    CHAT_HISTORY_STORAGE_KEY,
    MAX_CHAT_HISTORY_MESSAGES,
    MAX_CHAT_SESSIONS
} from '../core/constants';
import type {
    CodyChatHistoryEntry,
    CodyChatSession,
    CodyChatState,
    CodyProjectPlan,
    CodyProjectPlanStep,
    CodyTaskSession,
    CodyTaskStepState
} from '../core/types';

const DEFAULT_CHAT_TITLE = 'Nova conversa';

export function loadChatState(storage: vscode.Memento): CodyChatState {
    const value = storage.get<unknown>(CHAT_HISTORY_STORAGE_KEY, undefined);

    if (!value) {
        return createEmptyChatState();
    }

    if (Array.isArray(value)) {
        const legacyHistory = value.filter(isValidHistoryEntry).slice(-MAX_CHAT_HISTORY_MESSAGES);
        if (legacyHistory.length === 0) {
            return createEmptyChatState();
        }

        const migratedSession = createSessionFromHistory(legacyHistory);
        return {
            sessions: [migratedSession],
            activeSessionId: migratedSession.id
        };
    }

    if (isValidChatState(value)) {
        return normalizeChatState(value);
    }

    return createEmptyChatState();
}

export async function saveChatState(
    storage: vscode.Memento,
    state: CodyChatState
): Promise<CodyChatState> {
    const normalized = normalizeChatState(state);
    await storage.update(CHAT_HISTORY_STORAGE_KEY, normalized);
    return normalized;
}

export function createChatSession(title: string = DEFAULT_CHAT_TITLE): CodyChatSession {
    const now = Date.now();

    return {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        pinned: false,
        history: [],
        contextSummary: 'Sem contexto automatico adicional',
        intentSummary: 'Modo atual: conversa normal',
        createdAt: now,
        updatedAt: now
    };
}

export function buildSessionTitleFromMessage(message: string): string {
    const compact = message
        .replace(/\s+/g, ' ')
        .replace(/^(explique|refatore|adicione|crie|gere)\s+/i, '')
        .replace(/[.:!?]+$/g, '')
        .trim();

    if (!compact) {
        return DEFAULT_CHAT_TITLE;
    }

    return compact.length <= 40 ? compact : `${compact.slice(0, 40)}...`;
}

function normalizeChatState(state: CodyChatState): CodyChatState {
    const sessions = state.sessions
        .filter(isValidSession)
        .map(session => ({
            ...session,
            pinned: session.pinned ?? false,
            history: session.history.slice(-MAX_CHAT_HISTORY_MESSAGES),
            contextSummary: session.contextSummary ?? 'Sem contexto automatico adicional',
            intentSummary: session.intentSummary ?? 'Modo atual: conversa normal',
            taskSession: normalizeTaskSession(session.taskSession)
        }))
        .sort(compareSessions)
        .slice(0, MAX_CHAT_SESSIONS);

    const activeSessionId = sessions.some(session => session.id === state.activeSessionId)
        ? state.activeSessionId
        : sessions[0]?.id;

    return {
        sessions,
        activeSessionId
    };
}

function createEmptyChatState(): CodyChatState {
    const session = createChatSession();
    return {
        sessions: [session],
        activeSessionId: session.id
    };
}

function createSessionFromHistory(history: CodyChatHistoryEntry[]): CodyChatSession {
    const session = createChatSession();
    session.history = history;
    session.title = buildSessionTitleFromMessage(history.find(entry => entry.role === 'user')?.text ?? DEFAULT_CHAT_TITLE);
    session.updatedAt = Date.now();
    return session;
}

function isValidChatState(value: unknown): value is CodyChatState {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<CodyChatState>;
    const hasSessions = Array.isArray(candidate.sessions);
    const activeSessionValid = typeof candidate.activeSessionId === 'undefined' || typeof candidate.activeSessionId === 'string';

    return hasSessions && activeSessionValid;
}

function isValidSession(value: unknown): value is CodyChatSession {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<CodyChatSession>;

    return typeof candidate.id === 'string'
        && typeof candidate.title === 'string'
        && (typeof candidate.pinned === 'boolean' || typeof candidate.pinned === 'undefined')
        && Array.isArray(candidate.history)
        && typeof candidate.createdAt === 'number'
        && typeof candidate.updatedAt === 'number'
        && (typeof candidate.contextSummary === 'undefined' || typeof candidate.contextSummary === 'string')
        && (typeof candidate.intentSummary === 'undefined' || typeof candidate.intentSummary === 'string')
        && (typeof candidate.taskSession === 'undefined' || isValidTaskSession(candidate.taskSession))
        && candidate.history.every(isValidHistoryEntry);
}

function isValidHistoryEntry(value: unknown): value is CodyChatHistoryEntry {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<CodyChatHistoryEntry>;
    const isRoleValid = candidate.role === 'user' || candidate.role === 'assistant';
    const isTextValid = typeof candidate.text === 'string';
    const isPromptValid = typeof candidate.prompt === 'undefined' || typeof candidate.prompt === 'string';

    return isRoleValid && isTextValid && isPromptValid;
}

function compareSessions(left: CodyChatSession, right: CodyChatSession): number {
    if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
    }

    return right.updatedAt - left.updatedAt;
}

function normalizeTaskSession(taskSession: CodyTaskSession | undefined): CodyTaskSession | undefined {
    if (!taskSession || !isValidTaskSession(taskSession)) {
        return undefined;
    }

    return {
        goal: taskSession.goal.trim(),
        status: taskSession.status,
        summary: taskSession.summary.trim(),
        plan: normalizeProjectPlan(taskSession.plan),
        stepStates: taskSession.stepStates
            .filter(isValidTaskStepState)
            .map(stepState => ({
                ...stepState,
                note: typeof stepState.note === 'string' ? stepState.note.trim() : undefined
            })),
        lastSummary: typeof taskSession.lastSummary === 'string' ? taskSession.lastSummary.trim() : undefined,
        updatedAt: taskSession.updatedAt
    };
}

function normalizeProjectPlan(plan: CodyProjectPlan | undefined): CodyProjectPlan | undefined {
    if (!plan || !isValidProjectPlan(plan)) {
        return undefined;
    }

    return {
        goal: plan.goal.trim(),
        summary: plan.summary.trim(),
        risks: plan.risks.map(item => item.trim()).filter(Boolean),
        validations: plan.validations.map(item => item.trim()).filter(Boolean),
        steps: plan.steps.filter(isValidProjectPlanStep).map(step => ({
            ...step,
            title: step.title.trim(),
            filePath: step.filePath.trim(),
            summary: step.summary.trim(),
            reason: step.reason.trim(),
            validation: step.validation.map(item => item.trim()).filter(Boolean)
        }))
    };
}

function isValidTaskSession(value: unknown): value is CodyTaskSession {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<CodyTaskSession>;

    return typeof candidate.goal === 'string'
        && typeof candidate.summary === 'string'
        && typeof candidate.updatedAt === 'number'
        && isValidTaskStatus(candidate.status)
        && Array.isArray(candidate.stepStates)
        && candidate.stepStates.every(isValidTaskStepState)
        && (typeof candidate.lastSummary === 'undefined' || typeof candidate.lastSummary === 'string')
        && (typeof candidate.plan === 'undefined' || isValidProjectPlan(candidate.plan));
}

function isValidTaskStatus(value: unknown): value is CodyTaskSession['status'] {
    return value === 'planning'
        || value === 'ready'
        || value === 'in_progress'
        || value === 'completed'
        || value === 'completed_with_issues'
        || value === 'cancelled';
}

function isValidTaskStepState(value: unknown): value is CodyTaskStepState {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<CodyTaskStepState>;
    return typeof candidate.stepId === 'string'
        && typeof candidate.filePath === 'string'
        && typeof candidate.title === 'string'
        && (candidate.status === 'pending' || candidate.status === 'applied' || candidate.status === 'skipped' || candidate.status === 'failed')
        && (typeof candidate.note === 'undefined' || typeof candidate.note === 'string');
}

function isValidProjectPlan(value: unknown): value is CodyProjectPlan {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<CodyProjectPlan>;
    return typeof candidate.goal === 'string'
        && typeof candidate.summary === 'string'
        && Array.isArray(candidate.risks)
        && Array.isArray(candidate.validations)
        && Array.isArray(candidate.steps)
        && candidate.risks.every(item => typeof item === 'string')
        && candidate.validations.every(item => typeof item === 'string')
        && candidate.steps.every(isValidProjectPlanStep);
}

function isValidProjectPlanStep(value: unknown): value is CodyProjectPlanStep {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<CodyProjectPlanStep>;
    return typeof candidate.id === 'string'
        && typeof candidate.title === 'string'
        && typeof candidate.filePath === 'string'
        && (candidate.action === 'create' || candidate.action === 'update')
        && typeof candidate.summary === 'string'
        && typeof candidate.reason === 'string'
        && Array.isArray(candidate.validation)
        && candidate.validation.every(item => typeof item === 'string');
}
