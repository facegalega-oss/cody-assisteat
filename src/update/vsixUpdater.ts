import { promises as fsPromises, type FSWatcher, watch as watchFs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { fetch } from 'undici';

import { getCodySettings } from '../core/config';
import {
    LOCAL_VSIX_OBSERVED_SIGNATURE_STORAGE_KEY,
    REMOTE_VSIX_OBSERVED_SIGNATURE_STORAGE_KEY
} from '../core/constants';

type CheckVsixUpdateOptions = {
    manual?: boolean;
};

type CandidateState = 'newer' | 'sameVersionChanged' | 'sameVersionUnchanged' | 'older';

type VsixUpdateCandidate = {
    source: 'local' | 'githubRelease' | 'githubContents';
    version: string;
    fileName: string;
    signature: string;
    sortTimestamp: number;
    installUri: vscode.Uri;
    rememberSignatureKey: string;
    sourceLabel: string;
};

type GithubLatestReleaseResponse = {
    tag_name?: string;
    published_at?: string;
    assets?: Array<{
        name?: string;
        browser_download_url?: string;
        updated_at?: string;
        size?: number;
    }>;
};

type GithubContentsEntry = {
    name?: string;
    path?: string;
    sha?: string;
    size?: number;
    type?: 'file' | 'dir' | 'symlink' | 'submodule';
    download_url?: string | null;
    html_url?: string;
};

type GithubRemoteSource =
    | {
        kind: 'release';
        apiUrl: string;
        htmlUrl?: string;
        sourceLabel: string;
    }
    | {
        kind: 'contents';
        apiUrl: string;
        sourceLabel: string;
    };

export class VsixUpdater implements vscode.Disposable {
    private directoryWatcher: FSWatcher | undefined;
    private pendingCheckTimer: NodeJS.Timeout | undefined;
    private installInFlight = false;

    public constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    public async start(): Promise<void> {
        await this.reconfigure();
    }

    public async reconfigure(): Promise<void> {
        this.disposeWatcher();

        await this.checkForUpdates();

        if (getCodySettings().vsixUpdateCheckMode === 'startupAndWatch') {
            await this.startWatcher();
        }
    }

    public async checkForUpdates(options: CheckVsixUpdateOptions = {}): Promise<void> {
        if (this.installInFlight) {
            return;
        }

        const currentVersion = this.getCurrentExtensionVersion();
        const candidates = await this.collectCandidates(
            currentVersion,
            options.manual === true,
            options.manual === true
        );

        if (candidates.length === 0) {
            if (options.manual) {
                vscode.window.showInformationMessage(
                    `Nenhuma atualizacao VSIX foi encontrada. O Cody continua na versao ${currentVersion}.`
                );
            }

            return;
        }

        candidates.sort((left, right) => {
            const versionDiff = compareVersions(right.version, left.version);
            if (versionDiff !== 0) {
                return versionDiff;
            }

            return right.sortTimestamp - left.sortTimestamp;
        });

        const selectedCandidate = candidates[0];
        const sameVersionReinstall = compareVersions(selectedCandidate.version, currentVersion) === 0;
        const autoInstall = getCodySettings().autoInstallLocalVsixUpdates && !options.manual;

        this.outputChannel.appendLine(
            `Atualizacao VSIX escolhida: ${selectedCandidate.fileName} (${selectedCandidate.version}) via ${selectedCandidate.sourceLabel}`
        );

        if (!autoInstall) {
            const action = await vscode.window.showInformationMessage(
                sameVersionReinstall
                    ? `Foi encontrado um novo pacote ${selectedCandidate.fileName} da mesma versao. Deseja reinstalar o Cody agora?`
                    : `Foi encontrada uma versao mais nova do Cody (${selectedCandidate.version}) via ${selectedCandidate.sourceLabel}. Deseja atualizar agora?`,
                'Atualizar agora',
                'Agora nao'
            );

            if (action !== 'Atualizar agora') {
                return;
            }
        }

        await this.installVsix(selectedCandidate, sameVersionReinstall);
    }

    public dispose(): void {
        this.disposeWatcher();
    }

    private async collectCandidates(
        currentVersion: string,
        showMessages: boolean,
        allowSameVersionReinstall: boolean
    ): Promise<VsixUpdateCandidate[]> {
        const candidates: VsixUpdateCandidate[] = [];

        const localCandidate = await this.findLocalVsixCandidate(currentVersion, showMessages, allowSameVersionReinstall);
        if (localCandidate) {
            candidates.push(localCandidate);
        }

        const remoteCandidate = await this.findGithubRemoteCandidate(
            currentVersion,
            showMessages,
            allowSameVersionReinstall
        );
        if (remoteCandidate) {
            candidates.push(remoteCandidate);
        }

        return candidates;
    }

    private async findLocalVsixCandidate(
        currentVersion: string,
        showMessages: boolean,
        allowSameVersionReinstall: boolean
    ): Promise<VsixUpdateCandidate | undefined> {
        const settings = getCodySettings();
        if (!settings.autoUpdateFromLocalVsix) {
            return undefined;
        }

        const directory = await this.resolveLocalVsixDirectory();
        if (!directory) {
            if (showMessages) {
                vscode.window.showWarningMessage(
                    'Defina cody-assistant.localVsixUpdateDirectory ou abra a pasta onde o VSIX do Cody e gerado.'
                );
            }

            return undefined;
        }

        try {
            const entries = await fsPromises.readdir(directory, { withFileTypes: true });
            const fileCandidates: Array<{
                fileName: string;
                fullPath: string;
                version: string;
                modifiedTimeMs: number;
                signature: string;
            }> = [];

            for (const entry of entries) {
                if (!entry.isFile() || !isVsixFileName(entry.name)) {
                    continue;
                }

                const parsedVersion = parseVersionFromVsixFileName(entry.name);
                if (!parsedVersion) {
                    continue;
                }

                const fullPath = path.join(directory, entry.name);
                const stats = await fsPromises.stat(fullPath);

                fileCandidates.push({
                    fileName: entry.name,
                    fullPath,
                    version: parsedVersion,
                    modifiedTimeMs: stats.mtimeMs,
                    signature: `${parsedVersion}|${fullPath}|${stats.size}|${stats.mtimeMs}`
                });
            }

            if (fileCandidates.length === 0) {
                if (showMessages) {
                    vscode.window.showWarningMessage(`Nenhum arquivo cody-assistant-*.vsix foi encontrado em ${directory}.`);
                }

                return undefined;
            }

            fileCandidates.sort((left, right) => {
                const versionDiff = compareVersions(right.version, left.version);
                if (versionDiff !== 0) {
                    return versionDiff;
                }

                return right.modifiedTimeMs - left.modifiedTimeMs;
            });

            const candidate = fileCandidates[0];
            const signatureKey = LOCAL_VSIX_OBSERVED_SIGNATURE_STORAGE_KEY;
            const storedSignature = this.context.globalState.get<string>(signatureKey);
            const candidateState = getCandidateState(candidate.version, currentVersion, storedSignature, candidate.signature);

            this.outputChannel.appendLine(
                `VSIX local encontrado em ${directory}: ${candidate.fileName} (versao ${candidate.version})`
            );

            if (!isCandidateActionable(candidateState, allowSameVersionReinstall)) {
                if (candidateState !== 'sameVersionChanged') {
                    await this.rememberObservedSignature(signatureKey, candidate.signature);
                }

                return undefined;
            }

            return {
                source: 'local',
                version: candidate.version,
                fileName: candidate.fileName,
                signature: candidate.signature,
                sortTimestamp: candidate.modifiedTimeMs,
                installUri: vscode.Uri.file(candidate.fullPath),
                rememberSignatureKey: signatureKey,
                sourceLabel: `VSIX local em ${directory}`
            };
        } catch (error) {
            const message = `Falha ao procurar VSIX locais: ${formatError(error)}`;
            this.outputChannel.appendLine(message);

            if (showMessages) {
                vscode.window.showErrorMessage(message);
            }

            return undefined;
        }
    }

    private async findGithubRemoteCandidate(
        currentVersion: string,
        showMessages: boolean,
        allowSameVersionReinstall: boolean
    ): Promise<VsixUpdateCandidate | undefined> {
        const settings = getCodySettings();
        const remoteSource = resolveGithubRemoteSource(settings.githubReleaseApiUrl.trim());
        if (!remoteSource) {
            return undefined;
        }

        if (remoteSource.kind === 'contents') {
            return await this.findGithubContentsCandidate(
                remoteSource,
                currentVersion,
                showMessages,
                allowSameVersionReinstall
            );
        }

        return await this.findGithubReleaseCandidate(
            remoteSource,
            currentVersion,
            showMessages,
            allowSameVersionReinstall
        );
    }

    private async findGithubReleaseCandidate(
        remoteSource: GithubRemoteSource & { kind: 'release' },
        currentVersion: string,
        showMessages: boolean,
        allowSameVersionReinstall: boolean
    ): Promise<VsixUpdateCandidate | undefined> {
        const settings = getCodySettings();
        const releaseApiUrl = remoteSource.apiUrl;

        try {
            const response = await fetch(releaseApiUrl, {
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'Cody-Assistant-Updater'
                }
            });

            if (!response.ok) {
                throw new Error(`GitHub respondeu com HTTP ${response.status}`);
            }

            const release = await response.json() as GithubLatestReleaseResponse;
            const assetPattern = compileGlobPattern(settings.githubReleaseVsixAssetPattern);
            const matchingAssets = (release.assets ?? [])
                .filter(asset => asset.name && asset.browser_download_url && assetPattern.test(asset.name));

            if (matchingAssets.length === 0) {
                if (showMessages) {
                    vscode.window.showWarningMessage(
                        'Nenhum asset VSIX compativel foi encontrado na release do GitHub configurada.'
                    );
                }

                return undefined;
            }

            matchingAssets.sort((left, right) => {
                const rightTimestamp = Date.parse(right.updated_at ?? release.published_at ?? '') || 0;
                const leftTimestamp = Date.parse(left.updated_at ?? release.published_at ?? '') || 0;
                return rightTimestamp - leftTimestamp;
            });

            const selectedAsset = matchingAssets[0];
            const version = parseVersionFromVsixFileName(selectedAsset.name ?? '')
                ?? normalizeVersionTag(release.tag_name)
                ?? '0.0.0';

            const signature = [
                version,
                selectedAsset.name,
                selectedAsset.browser_download_url,
                selectedAsset.updated_at ?? release.published_at ?? ''
            ].join('|');

            const signatureKey = REMOTE_VSIX_OBSERVED_SIGNATURE_STORAGE_KEY;
            const storedSignature = this.context.globalState.get<string>(signatureKey);
            const candidateState = getCandidateState(version, currentVersion, storedSignature, signature);

            this.outputChannel.appendLine(
                `Release do GitHub encontrada: ${selectedAsset.name} (versao ${version}) em ${releaseApiUrl}`
            );

            if (!isCandidateActionable(candidateState, allowSameVersionReinstall)) {
                if (candidateState !== 'sameVersionChanged') {
                    await this.rememberObservedSignature(signatureKey, signature);
                }

                return undefined;
            }

            const tempUri = await this.downloadReleaseAsset(
                selectedAsset.browser_download_url ?? '',
                selectedAsset.name ?? `cody-assistant-${version}.vsix`
            );

            return {
                source: 'githubRelease',
                version,
                fileName: selectedAsset.name ?? `cody-assistant-${version}.vsix`,
                signature,
                sortTimestamp: Date.parse(selectedAsset.updated_at ?? release.published_at ?? '') || Date.now(),
                installUri: tempUri,
                rememberSignatureKey: signatureKey,
                sourceLabel: remoteSource.sourceLabel
            };
        } catch (error) {
            if (isGithubForbiddenError(error) && remoteSource.htmlUrl) {
                this.outputChannel.appendLine(
                    `GitHub API retornou 403 para ${releaseApiUrl}. Tentando fallback pela pagina publica ${remoteSource.htmlUrl}...`
                );

                const htmlFallbackCandidate = await this.findGithubReleaseCandidateFromHtml(
                    remoteSource,
                    currentVersion,
                    showMessages,
                    allowSameVersionReinstall
                );

                if (htmlFallbackCandidate) {
                    return htmlFallbackCandidate;
                }
            }

            const message = `Falha ao consultar release do GitHub: ${formatError(error)}`;
            this.outputChannel.appendLine(message);

            if (showMessages) {
                vscode.window.showErrorMessage(message);
            }

            return undefined;
        }
    }

    private async findGithubReleaseCandidateFromHtml(
        remoteSource: GithubRemoteSource & { kind: 'release' },
        currentVersion: string,
        showMessages: boolean,
        allowSameVersionReinstall: boolean
    ): Promise<VsixUpdateCandidate | undefined> {
        if (!remoteSource.htmlUrl) {
            return undefined;
        }

        const settings = getCodySettings();

        try {
            const response = await fetch(remoteSource.htmlUrl, {
                headers: {
                    Accept: 'text/html,application/xhtml+xml',
                    'User-Agent': 'Cody-Assistant-Updater'
                }
            });

            if (!response.ok) {
                throw new Error(`GitHub respondeu com HTTP ${response.status}`);
            }

            const html = await response.text();
            const assetPattern = compileGlobPattern(settings.githubReleaseVsixAssetPattern);
            const assetLinks = extractReleaseAssetLinksFromHtml(html, remoteSource.htmlUrl)
                .filter(asset => assetPattern.test(asset.fileName));

            if (assetLinks.length === 0) {
                if (showMessages) {
                    vscode.window.showWarningMessage(
                        'Nenhum asset VSIX compativel foi encontrado na pagina publica da release do GitHub.'
                    );
                }

                return undefined;
            }

            assetLinks.sort((left, right) => {
                const versionDiff = compareVersions(right.version, left.version);
                if (versionDiff !== 0) {
                    return versionDiff;
                }

                return right.fileName.localeCompare(left.fileName);
            });

            const selectedAsset = assetLinks[0];
            const signatureKey = REMOTE_VSIX_OBSERVED_SIGNATURE_STORAGE_KEY;
            const storedSignature = this.context.globalState.get<string>(signatureKey);
            const candidateState = getCandidateState(
                selectedAsset.version,
                currentVersion,
                storedSignature,
                selectedAsset.signature
            );

            this.outputChannel.appendLine(
                `Release publica do GitHub encontrada: ${selectedAsset.fileName} (versao ${selectedAsset.version}) em ${remoteSource.htmlUrl}`
            );

            if (!isCandidateActionable(candidateState, allowSameVersionReinstall)) {
                if (candidateState !== 'sameVersionChanged') {
                    await this.rememberObservedSignature(signatureKey, selectedAsset.signature);
                }

                return undefined;
            }

            const tempUri = await this.downloadReleaseAsset(selectedAsset.downloadUrl, selectedAsset.fileName);

            return {
                source: 'githubRelease',
                version: selectedAsset.version,
                fileName: selectedAsset.fileName,
                signature: selectedAsset.signature,
                sortTimestamp: Date.now(),
                installUri: tempUri,
                rememberSignatureKey: signatureKey,
                sourceLabel: `${remoteSource.sourceLabel} (fallback HTML)`
            };
        } catch (error) {
            const message = `Falha ao consultar pagina publica da release do GitHub: ${formatError(error)}`;
            this.outputChannel.appendLine(message);

            if (showMessages) {
                vscode.window.showErrorMessage(message);
            }

            return undefined;
        }
    }

    private async findGithubContentsCandidate(
        remoteSource: GithubRemoteSource & { kind: 'contents' },
        currentVersion: string,
        showMessages: boolean,
        allowSameVersionReinstall: boolean
    ): Promise<VsixUpdateCandidate | undefined> {
        const settings = getCodySettings();

        try {
            const response = await fetch(remoteSource.apiUrl, {
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'Cody-Assistant-Updater'
                }
            });

            if (!response.ok) {
                throw new Error(`GitHub respondeu com HTTP ${response.status}`);
            }

            const payload = await response.json() as GithubContentsEntry | GithubContentsEntry[];
            const entries = Array.isArray(payload) ? payload : [payload];
            const assetPattern = compileGlobPattern(settings.githubReleaseVsixAssetPattern);

            const fileCandidates = entries
                .filter(entry =>
                    entry.type === 'file'
                    && Boolean(entry.name)
                    && Boolean(entry.download_url)
                    && assetPattern.test(entry.name ?? '')
                )
                .map(entry => ({
                    fileName: entry.name ?? '',
                    downloadUrl: entry.download_url ?? '',
                    version: parseVersionFromVsixFileName(entry.name ?? '') ?? '0.0.0',
                    signature: [
                        parseVersionFromVsixFileName(entry.name ?? '') ?? '0.0.0',
                        entry.path ?? entry.name ?? '',
                        entry.sha ?? '',
                        entry.size ?? 0,
                        entry.download_url ?? ''
                    ].join('|'),
                    sortTimestamp: 0
                }));

            if (fileCandidates.length === 0) {
                if (showMessages) {
                    vscode.window.showWarningMessage(
                        'Nenhum arquivo VSIX compativel foi encontrado na pasta do GitHub configurada.'
                    );
                }

                return undefined;
            }

            fileCandidates.sort((left, right) => {
                const versionDiff = compareVersions(right.version, left.version);
                if (versionDiff !== 0) {
                    return versionDiff;
                }

                return right.fileName.localeCompare(left.fileName);
            });

            const selectedFile = fileCandidates[0];
            const signatureKey = REMOTE_VSIX_OBSERVED_SIGNATURE_STORAGE_KEY;
            const storedSignature = this.context.globalState.get<string>(signatureKey);
            const candidateState = getCandidateState(
                selectedFile.version,
                currentVersion,
                storedSignature,
                selectedFile.signature
            );

            this.outputChannel.appendLine(
                `VSIX encontrado na pasta do GitHub: ${selectedFile.fileName} (versao ${selectedFile.version}) em ${remoteSource.apiUrl}`
            );

            if (!isCandidateActionable(candidateState, allowSameVersionReinstall)) {
                if (candidateState !== 'sameVersionChanged') {
                    await this.rememberObservedSignature(signatureKey, selectedFile.signature);
                }

                return undefined;
            }

            const tempUri = await this.downloadReleaseAsset(
                selectedFile.downloadUrl,
                selectedFile.fileName
            );

            return {
                source: 'githubContents',
                version: selectedFile.version,
                fileName: selectedFile.fileName,
                signature: selectedFile.signature,
                sortTimestamp: Date.now(),
                installUri: tempUri,
                rememberSignatureKey: signatureKey,
                sourceLabel: remoteSource.sourceLabel
            };
        } catch (error) {
            const message = `Falha ao consultar pasta do GitHub: ${formatError(error)}`;
            this.outputChannel.appendLine(message);

            if (showMessages) {
                vscode.window.showErrorMessage(message);
            }

            return undefined;
        }
    }

    private async downloadReleaseAsset(downloadUrl: string, fileName: string): Promise<vscode.Uri> {
        const response = await fetch(downloadUrl, {
            headers: {
                'User-Agent': 'Cody-Assistant-Updater'
            }
        });

        if (!response.ok || !response.body) {
            throw new Error(`Nao foi possivel baixar o asset VSIX remoto. HTTP ${response.status}`);
        }

        const targetDirectory = path.join(os.tmpdir(), 'cody-assistant-updates');
        await fsPromises.mkdir(targetDirectory, { recursive: true });

        const safeFileName = sanitizeFileName(fileName);
        const targetPath = path.join(targetDirectory, safeFileName);
        const fileBuffer = Buffer.from(await response.arrayBuffer());
        await fsPromises.writeFile(targetPath, fileBuffer);

        return vscode.Uri.file(targetPath);
    }

    private async startWatcher(): Promise<void> {
        const settings = getCodySettings();
        if (!settings.autoUpdateFromLocalVsix) {
            return;
        }

        const directory = await this.resolveLocalVsixDirectory();
        if (!directory) {
            return;
        }

        try {
            this.directoryWatcher = watchFs(directory, (_eventType, fileName) => {
                const normalizedFileName = typeof fileName === 'string' ? fileName : '';
                if (!isVsixFileName(normalizedFileName)) {
                    return;
                }

                if (this.pendingCheckTimer) {
                    clearTimeout(this.pendingCheckTimer);
                }

                this.pendingCheckTimer = setTimeout(() => {
                    void this.checkForUpdates();
                }, 1200);
            });

            this.outputChannel.appendLine(`Observando VSIX locais para autoatualizacao em ${directory}`);
        } catch (error) {
            this.outputChannel.appendLine(`Nao foi possivel observar a pasta de VSIX locais: ${formatError(error)}`);
        }
    }

    private async installVsix(candidate: VsixUpdateCandidate, isSameVersionReinstall: boolean): Promise<void> {
        this.installInFlight = true;

        try {
            this.outputChannel.appendLine(`Instalando atualizacao VSIX a partir de ${candidate.installUri.fsPath}`);
            await vscode.commands.executeCommand('workbench.extensions.installExtension', candidate.installUri);
            await this.rememberObservedSignature(candidate.rememberSignatureKey, candidate.signature);

            const reloadAction = await vscode.window.showInformationMessage(
                isSameVersionReinstall
                    ? `O Cody foi reinstalado a partir de ${candidate.fileName}. Recarregar a janela agora?`
                    : `O Cody foi atualizado para ${candidate.version}. Recarregar a janela agora?`,
                'Recarregar agora',
                'Depois'
            );

            if (reloadAction === 'Recarregar agora') {
                await vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        } catch (error) {
            const message = `Nao foi possivel instalar o VSIX ${candidate.fileName}: ${formatError(error)}`;
            this.outputChannel.appendLine(message);
            vscode.window.showErrorMessage(message);
        } finally {
            this.installInFlight = false;
        }
    }

    private async resolveLocalVsixDirectory(): Promise<string | undefined> {
        const configuredDirectory = getCodySettings().localVsixUpdateDirectory;
        if (configuredDirectory) {
            if (!path.isAbsolute(configuredDirectory)) {
                const workspaceRoot = this.getWorkspaceRoot();
                if (!workspaceRoot) {
                    return undefined;
                }

                return this.ensureDirectoryExists(path.resolve(workspaceRoot, configuredDirectory));
            }

            return this.ensureDirectoryExists(path.resolve(configuredDirectory));
        }

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            return undefined;
        }

        return this.ensureDirectoryExists(workspaceRoot);
    }

    private getWorkspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private async ensureDirectoryExists(targetPath: string): Promise<string | undefined> {
        try {
            const stats = await fsPromises.stat(targetPath);
            return stats.isDirectory() ? targetPath : undefined;
        } catch {
            return undefined;
        }
    }

    private getCurrentExtensionVersion(): string {
        const currentExtension = vscode.extensions.getExtension(this.context.extension.id);
        const version = currentExtension?.packageJSON?.version;
        return typeof version === 'string' && version.trim() ? version.trim() : '0.0.0';
    }

    private async rememberObservedSignature(key: string, signature: string): Promise<void> {
        await this.context.globalState.update(key, signature);
    }

    private disposeWatcher(): void {
        if (this.pendingCheckTimer) {
            clearTimeout(this.pendingCheckTimer);
            this.pendingCheckTimer = undefined;
        }

        this.directoryWatcher?.close();
        this.directoryWatcher = undefined;
    }
}

function getCandidateState(
    candidateVersion: string,
    currentVersion: string,
    storedSignature: string | undefined,
    currentSignature: string
): CandidateState {
    const versionComparison = compareVersions(candidateVersion, currentVersion);
    if (versionComparison > 0) {
        return 'newer';
    }

    if (versionComparison < 0) {
        return 'older';
    }

    if (storedSignature !== undefined && storedSignature !== currentSignature) {
        return 'sameVersionChanged';
    }

    return 'sameVersionUnchanged';
}

function isCandidateActionable(candidateState: CandidateState, allowSameVersionReinstall: boolean): boolean {
    if (candidateState === 'newer') {
        return true;
    }

    return candidateState === 'sameVersionChanged' && allowSameVersionReinstall;
}

function parseVersionFromVsixFileName(fileName: string): string | undefined {
    const match = /^cody-assistant-([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\.vsix$/i.exec(fileName);
    return match?.[1];
}

function normalizeVersionTag(tagName: string | undefined): string | undefined {
    if (!tagName) {
        return undefined;
    }

    const normalized = tagName.trim().replace(/^v/i, '');
    return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(normalized) ? normalized : undefined;
}

function isVsixFileName(fileName: string): boolean {
    return /^cody-assistant-.*\.vsix$/i.test(fileName);
}

function compileGlobPattern(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

    return new RegExp(`^${escaped}$`, 'i');
}

function resolveGithubRemoteSource(rawUrl: string): GithubRemoteSource | undefined {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return undefined;
    }

    try {
        const parsed = new URL(trimmed);

        if (parsed.hostname === 'api.github.com') {
            const pathParts = parsed.pathname.split('/').filter(Boolean);
            if (pathParts.length >= 4 && pathParts[0] === 'repos') {
                const owner = pathParts[1];
                const repo = pathParts[2];
                const resource = pathParts[3];

                if (resource === 'releases') {
                    return {
                        kind: 'release',
                        apiUrl: parsed.toString(),
                        htmlUrl: buildGithubReleaseHtmlUrl(owner, repo, pathParts.slice(4)),
                        sourceLabel: 'GitHub Releases'
                    };
                }

                if (resource === 'contents') {
                    const contentPath = pathParts.slice(4).join('/');

                    if (contentPath === 'releases/latest') {
                        return {
                            kind: 'release',
                            apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
                            sourceLabel: 'GitHub Releases'
                        };
                    }

                    if (contentPath.startsWith('releases/tag/')) {
                        const tag = contentPath.slice('releases/tag/'.length);
                        return {
                            kind: 'release',
                            apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
                            sourceLabel: `GitHub Release tag ${tag}`
                        };
                    }

                    if (contentPath.startsWith('releases/tags/')) {
                        const tag = contentPath.slice('releases/tags/'.length);
                        return {
                            kind: 'release',
                            apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
                            sourceLabel: `GitHub Release tag ${tag}`
                        };
                    }

                    return {
                        kind: 'contents',
                        apiUrl: parsed.toString(),
                        sourceLabel: `GitHub folder ${owner}/${repo}`
                    };
                }
            }

            return {
                kind: 'release',
                apiUrl: parsed.toString(),
                htmlUrl: undefined,
                sourceLabel: 'GitHub'
            };
        }

        if (parsed.hostname !== 'github.com') {
            return {
                kind: 'release',
                apiUrl: parsed.toString(),
                htmlUrl: undefined,
                sourceLabel: 'GitHub'
            };
        }

        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length < 2) {
            return {
                kind: 'release',
                apiUrl: parsed.toString(),
                htmlUrl: parsed.toString(),
                sourceLabel: 'GitHub'
            };
        }

        const owner = parts[0];
        const repo = parts[1];
        const suffix = parts.slice(2);

        if (suffix.length === 0) {
            return {
                kind: 'release',
                apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
                htmlUrl: `https://github.com/${owner}/${repo}/releases/latest`,
                sourceLabel: 'GitHub Releases'
            };
        }

        if (suffix[0] === 'tree' && suffix[1] && suffix.length >= 3) {
            const ref = suffix[1];
            const folderPath = suffix.slice(2).join('/');

            if (folderPath === 'releases/latest') {
                return {
                    kind: 'release',
                    apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
                    htmlUrl: `https://github.com/${owner}/${repo}/releases/latest`,
                    sourceLabel: 'GitHub Releases'
                };
            }

            if (folderPath.startsWith('releases/tag/')) {
                const tag = folderPath.slice('releases/tag/'.length);
                return {
                    kind: 'release',
                    apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
                    htmlUrl: `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(tag)}`,
                    sourceLabel: `GitHub Release tag ${tag}`
                };
            }

            if (folderPath.startsWith('releases/tags/')) {
                const tag = folderPath.slice('releases/tags/'.length);
                return {
                    kind: 'release',
                    apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
                    htmlUrl: `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(tag)}`,
                    sourceLabel: `GitHub Release tag ${tag}`
                };
            }

            return {
                kind: 'contents',
                apiUrl: `https://api.github.com/repos/${owner}/${repo}/contents/${folderPath}?ref=${encodeURIComponent(ref)}`,
                sourceLabel: `GitHub folder ${owner}/${repo}/${folderPath}@${ref}`
            };
        }

        if (suffix[0] === 'contents' && suffix.length >= 2) {
            return {
                kind: 'contents',
                apiUrl: `https://api.github.com/repos/${owner}/${repo}/contents/${suffix.slice(1).join('/')}`,
                sourceLabel: `GitHub folder ${owner}/${repo}/${suffix.slice(1).join('/')}`
            };
        }

        if (suffix[0] !== 'releases') {
            return {
                kind: 'release',
                apiUrl: parsed.toString(),
                htmlUrl: parsed.toString(),
                sourceLabel: 'GitHub'
            };
        }

        if (suffix.length === 1 || suffix[1] === 'latest') {
            return {
                kind: 'release',
                apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
                htmlUrl: `https://github.com/${owner}/${repo}/releases/latest`,
                sourceLabel: 'GitHub Releases'
            };
        }

        if (suffix[1] === 'tag' && suffix[2]) {
            return {
                kind: 'release',
                apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(suffix[2])}`,
                htmlUrl: `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(suffix[2])}`,
                sourceLabel: `GitHub Release tag ${suffix[2]}`
            };
        }

        return {
            kind: 'release',
            apiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
            htmlUrl: `https://github.com/${owner}/${repo}/releases/latest`,
            sourceLabel: 'GitHub Releases'
        };
    } catch {
        return {
            kind: 'release',
            apiUrl: trimmed,
            htmlUrl: undefined,
            sourceLabel: 'GitHub'
        };
    }
}

function extractReleaseAssetLinksFromHtml(
    html: string,
    baseUrl: string
): Array<{ fileName: string; downloadUrl: string; version: string; signature: string }> {
    const assetMatches = [
        ...html.matchAll(/href="([^"]*\/releases\/download\/[^"]+\/([^"/?#]+\.vsix))"/gi)
    ];

    const assets = assetMatches
        .map(match => {
            const href = match[1];
            const fileName = decodeURIComponent(match[2]);
            const downloadUrl = new URL(href, baseUrl).toString();
            const version = parseVersionFromVsixFileName(fileName) ?? '0.0.0';

            return {
                fileName,
                downloadUrl,
                version,
                signature: `${version}|${downloadUrl}|${fileName}`
            };
        });

    const seen = new Set<string>();
    return assets.filter(asset => {
        if (seen.has(asset.downloadUrl)) {
            return false;
        }

        seen.add(asset.downloadUrl);
        return true;
    });
}

function buildGithubReleaseHtmlUrl(owner: string, repo: string, suffix: string[]): string | undefined {
    if (suffix.length === 0 || suffix[0] === 'latest') {
        return `https://github.com/${owner}/${repo}/releases/latest`;
    }

    if (suffix[0] === 'tags' && suffix[1]) {
        return `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(suffix[1])}`;
    }

    return `https://github.com/${owner}/${repo}/releases/latest`;
}

function isGithubForbiddenError(error: unknown): boolean {
    return error instanceof Error && /HTTP 403/i.test(error.message);
}

function sanitizeFileName(fileName: string): string {
    return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function compareVersions(left: string, right: string): number {
    const leftVersion = parseSemanticVersion(left);
    const rightVersion = parseSemanticVersion(right);

    for (let index = 0; index < 3; index += 1) {
        const diff = leftVersion.core[index] - rightVersion.core[index];
        if (diff !== 0) {
            return diff;
        }
    }

    if (!leftVersion.prerelease && !rightVersion.prerelease) {
        return 0;
    }

    if (!leftVersion.prerelease) {
        return 1;
    }

    if (!rightVersion.prerelease) {
        return -1;
    }

    const maxLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
    for (let index = 0; index < maxLength; index += 1) {
        const leftPart = leftVersion.prerelease[index];
        const rightPart = rightVersion.prerelease[index];

        if (leftPart === undefined) {
            return -1;
        }

        if (rightPart === undefined) {
            return 1;
        }

        const leftNumeric = /^\d+$/.test(leftPart);
        const rightNumeric = /^\d+$/.test(rightPart);

        if (leftNumeric && rightNumeric) {
            const diff = Number(leftPart) - Number(rightPart);
            if (diff !== 0) {
                return diff;
            }

            continue;
        }

        if (leftNumeric) {
            return -1;
        }

        if (rightNumeric) {
            return 1;
        }

        const lexicalDiff = leftPart.localeCompare(rightPart);
        if (lexicalDiff !== 0) {
            return lexicalDiff;
        }
    }

    return 0;
}

function parseSemanticVersion(version: string): { core: [number, number, number]; prerelease?: string[] } {
    const [corePart, prereleasePart] = version.trim().split('-', 2);
    const coreTokens = corePart.split('.').map(token => Number.parseInt(token, 10));

    return {
        core: [
            Number.isFinite(coreTokens[0]) ? coreTokens[0] : 0,
            Number.isFinite(coreTokens[1]) ? coreTokens[1] : 0,
            Number.isFinite(coreTokens[2]) ? coreTokens[2] : 0
        ],
        prerelease: prereleasePart ? prereleasePart.split('.') : undefined
    };
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}
