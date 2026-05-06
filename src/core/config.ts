import * as vscode from 'vscode';

import {
    CODY_CONFIGURATION_SECTION,
    DEFAULT_CODY_MODEL,
    DEFAULT_AUTO_INSTALL_LOCAL_VSIX_UPDATES,
    DEFAULT_AUTO_UPDATE_FROM_LOCAL_VSIX,
    DEFAULT_GITHUB_RELEASE_VSIX_ASSET_PATTERN,
    DEFAULT_OLLAMA_KEEP_ALIVE_MINUTES,
    DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS,
    DEFAULT_MAX_TOKENS,
    DEFAULT_OLLAMA_HOST,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_TEMPERATURE,
    DEFAULT_VSIX_UPDATE_CHECK_MODE
} from './constants';

export type CodySettings = {
    ollamaHost: string;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    keepAliveMinutes: number;
    requestTimeoutMs: number;
    autoUpdateFromLocalVsix: boolean;
    localVsixUpdateDirectory: string;
    autoInstallLocalVsixUpdates: boolean;
    vsixUpdateCheckMode: 'startup' | 'startupAndWatch';
    githubReleaseApiUrl: string;
    githubReleaseVsixAssetPattern: string;
    checkConnectionOnStartup: boolean;
    showStartupNotifications: boolean;
};

export function getCodySettings(): CodySettings {
    const config = vscode.workspace.getConfiguration(CODY_CONFIGURATION_SECTION);

    return {
        ollamaHost: getNonEmptyString(config.get<string>('ollamaHost'), DEFAULT_OLLAMA_HOST),
        model: getNonEmptyString(config.get<string>('model'), DEFAULT_CODY_MODEL),
        systemPrompt: getNonEmptyString(config.get<string>('systemPrompt'), DEFAULT_SYSTEM_PROMPT),
        temperature: clampNumber(config.get<number>('temperature'), DEFAULT_TEMPERATURE, 0, 2),
        maxTokens: clampInteger(config.get<number>('maxTokens'), DEFAULT_MAX_TOKENS, 1),
        keepAliveMinutes: clampInteger(config.get<number>('keepAliveMinutes'), DEFAULT_OLLAMA_KEEP_ALIVE_MINUTES, 0),
        requestTimeoutMs: clampInteger(config.get<number>('requestTimeoutMs'), DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS, 0),
        autoUpdateFromLocalVsix: config.get<boolean>('autoUpdateFromLocalVsix', DEFAULT_AUTO_UPDATE_FROM_LOCAL_VSIX),
        localVsixUpdateDirectory: (config.get<string>('localVsixUpdateDirectory') ?? '').trim(),
        autoInstallLocalVsixUpdates: config.get<boolean>('autoInstallLocalVsixUpdates', DEFAULT_AUTO_INSTALL_LOCAL_VSIX_UPDATES),
        vsixUpdateCheckMode: getVsixUpdateCheckMode(config.get<string>('vsixUpdateCheckMode')),
        githubReleaseApiUrl: (config.get<string>('githubReleaseApiUrl') ?? '').trim(),
        githubReleaseVsixAssetPattern: getNonEmptyString(
            config.get<string>('githubReleaseVsixAssetPattern'),
            DEFAULT_GITHUB_RELEASE_VSIX_ASSET_PATTERN
        ),
        checkConnectionOnStartup: config.get<boolean>('checkConnectionOnStartup', true),
        showStartupNotifications: config.get<boolean>('showStartupNotifications', false)
    };
}

function getNonEmptyString(value: string | undefined, fallback: string): string {
    const normalized = value?.trim();
    return normalized ? normalized : fallback;
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return fallback;
    }

    return Math.min(Math.max(value, min), max);
}

function clampInteger(value: number | undefined, fallback: number, min: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return fallback;
    }

    return Math.max(Math.floor(value), min);
}

function getVsixUpdateCheckMode(value: string | undefined): 'startup' | 'startupAndWatch' {
    return value === 'startupAndWatch' ? 'startupAndWatch' : DEFAULT_VSIX_UPDATE_CHECK_MODE as 'startup';
}
