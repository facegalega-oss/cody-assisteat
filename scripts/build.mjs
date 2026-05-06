import fs from 'fs';
import path from 'path';
import { build, context } from 'esbuild';

const rootDir = process.cwd();
const outDir = path.join(rootDir, 'out');
const watchMode = process.argv.includes('--watch');

const buildOptions = {
    absWorkingDir: rootDir,
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    sourcesContent: false,
    external: ['vscode'],
    logLevel: 'info'
};

await prepareOutDir();

if (watchMode) {
    const buildContext = await context(buildOptions);
    await buildContext.watch();
    console.log('Build em modo watch iniciado.');
} else {
    await build(buildOptions);
}

async function prepareOutDir() {
    await fs.promises.rm(outDir, { recursive: true, force: true });
    await fs.promises.mkdir(outDir, { recursive: true });
}
