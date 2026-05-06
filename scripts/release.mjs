import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');
const readmePath = path.join(rootDir, 'README.md');

const rawMode = process.argv[2] ?? 'patch';
const mode = rawMode.trim();

const packageJson = readJson(packageJsonPath);
const currentVersion = String(packageJson.version ?? '0.0.0');
const nextVersion = resolveNextVersion(currentVersion, mode);

if (nextVersion !== currentVersion) {
    packageJson.version = nextVersion;
    writeJson(packageJsonPath, packageJson);
    syncPackageLockVersion(nextVersion);
    syncReadmeVersion(nextVersion);
    console.log(`Versao atualizada: ${currentVersion} -> ${nextVersion}`);
} else {
    syncReadmeVersion(nextVersion);
    console.log(`Mantendo versao atual: ${nextVersion}`);
}

runCommand(getNpmCommand(), ['run', 'compile'], 'Falha ao compilar o projeto.');

const vsixName = `cody-assistant-${nextVersion}.vsix`;
runCommand(getNpxCommand(), ['vsce', 'package', '--out', `./${vsixName}`], 'Falha ao gerar o VSIX.');

console.log(`VSIX gerado com sucesso: ${vsixName}`);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function syncPackageLockVersion(version) {
    if (!fs.existsSync(packageLockPath)) {
        return;
    }

    const packageLock = readJson(packageLockPath);
    packageLock.version = version;

    if (packageLock.packages && packageLock.packages['']) {
        packageLock.packages[''].version = version;
    }

    writeJson(packageLockPath, packageLock);
}

function syncReadmeVersion(version) {
    if (!fs.existsSync(readmePath)) {
        return;
    }

    let readme = fs.readFileSync(readmePath, 'utf8');

    readme = readme.replace(/Versao atual:\s*`[^`]+`/i, `Versao atual: \`${version}\``);
    readme = readme.replace(/cody-assistant-\d+\.\d+\.\d+\.vsix/g, `cody-assistant-${version}.vsix`);

    fs.writeFileSync(readmePath, readme, 'utf8');
}

function resolveNextVersion(current, requestedMode) {
    if (requestedMode === 'current') {
        return current;
    }

    if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requestedMode)) {
        return requestedMode;
    }

    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
    if (!match) {
        throw new Error(`Versao atual invalida: ${current}`);
    }

    let major = Number(match[1]);
    let minor = Number(match[2]);
    let patch = Number(match[3]);

    switch (requestedMode) {
        case 'patch':
            patch += 1;
            break;
        case 'minor':
            minor += 1;
            patch = 0;
            break;
        case 'major':
            major += 1;
            minor = 0;
            patch = 0;
            break;
        default:
            throw new Error(`Modo de release invalido: ${requestedMode}`);
    }

    return `${major}.${minor}.${patch}`;
}

function getNpxCommand() {
    return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function getNpmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runCommand(command, args, failureMessage) {
    const isWindowsCmd = process.platform === 'win32' && /\.cmd$/i.test(command);
    const result = isWindowsCmd
        ? spawnSync(command, args, {
            cwd: rootDir,
            stdio: 'inherit',
            shell: true
        })
        : spawnSync(command, args, {
            cwd: rootDir,
            stdio: 'inherit',
            shell: false
        });

    if (result.status !== 0) {
        throw new Error(failureMessage);
    }
}
