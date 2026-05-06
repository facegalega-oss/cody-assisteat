import * as path from 'path';

import { extractCodeFromResponse } from '../core/response';
import type {
    CodyAnalysisRecommendation,
    CodyProjectAnalysis,
    CodyWorkspaceInsights,
    CodyWorkspaceSnapshot
} from '../core/types';

type PackageJsonShape = {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    packageManager?: string;
};

export function deriveWorkspaceInsights(snapshot: CodyWorkspaceSnapshot): CodyWorkspaceInsights {
    const relativePaths = snapshot.tree
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const lowerPaths = relativePaths.map(item => item.toLowerCase());
    const packageJsonFile = snapshot.files.find(file => path.posix.basename(file.path) === 'package.json');
    const packageJson = parsePackageJson(packageJsonFile?.content);
    const dependencies = {
        ...(packageJson?.dependencies ?? {}),
        ...(packageJson?.devDependencies ?? {})
    };
    const dependencyNames = Object.keys(dependencies);
    const scripts = Object.keys(packageJson?.scripts ?? {});
    const frameworks = detectFrameworks(dependencyNames, lowerPaths);
    const hasTests = lowerPaths.some(isTestFilePath) || scripts.some(script => /test|vitest|jest|playwright|cypress/i.test(script));
    const hasLinting = scripts.some(script => /lint|eslint/i.test(script))
        || dependencyNames.some(name => /eslint|biome|ts-standard|xo/.test(name));
    const hasFormatting = scripts.some(script => /format|prettier|biome/i.test(script))
        || dependencyNames.some(name => /prettier|biome/.test(name));
    const hasTypeScript = lowerPaths.some(file => file.endsWith('.ts') || file.endsWith('.tsx'))
        || Boolean(packageJson?.devDependencies?.typescript)
        || Boolean(packageJson?.dependencies?.typescript);
    const hasCi = lowerPaths.some(file => file.startsWith('.github/workflows/') || file.startsWith('.gitlab-ci'));
    const hasDocker = lowerPaths.some(file => file.includes('dockerfile') || file === 'docker-compose.yml' || file === 'docker-compose.yaml');
    const hasEnvExample = lowerPaths.some(file => file.includes('.env.example') || file.includes('.env.sample'));
    const hasReadme = lowerPaths.some(file => file === 'readme.md');
    const sourceFileCount = lowerPaths.filter(file => /\.[cm]?[jt]sx?$/.test(file) && !isTestFilePath(file)).length;
    const testFileCount = lowerPaths.filter(isTestFilePath).length;

    const strengths: string[] = [];
    const keyRisks: string[] = [];

    if (frameworks.length > 0) {
        strengths.push(`Stack identificado: ${frameworks.join(', ')}`);
    }

    if (hasTypeScript) {
        strengths.push('Uso de TypeScript no projeto');
    }

    if (hasTests) {
        strengths.push(`Presenca de testes no workspace (${testFileCount})`);
    } else {
        keyRisks.push('Projeto sem sinais claros de testes automatizados');
    }

    if (!hasLinting) {
        keyRisks.push('Nao ha sinais claros de linting padronizado');
    }

    if (!hasFormatting) {
        keyRisks.push('Nao ha sinais claros de formatacao automatica');
    }

    if (!hasCi) {
        keyRisks.push('Nao ha pipeline de CI visivel no repositorio');
    }

    if (!hasEnvExample) {
        keyRisks.push('Nao ha arquivo de exemplo para variaveis de ambiente');
    }

    if (!hasReadme) {
        keyRisks.push('Documentacao principal ausente ou muito limitada');
    }

    return {
        packageManager: packageJson?.packageManager ?? detectPackageManager(lowerPaths),
        frameworks,
        sourceFileCount,
        testFileCount,
        hasTests,
        hasLinting,
        hasFormatting,
        hasTypeScript,
        hasCi,
        hasDocker,
        hasEnvExample,
        hasReadme,
        keyRisks,
        strengths,
        notableScripts: scripts.slice(0, 12),
        notableDependencies: dependencyNames.slice(0, 18)
    };
}

export function buildProjectAnalysisPrompt(
    snapshot: CodyWorkspaceSnapshot,
    insights: CodyWorkspaceInsights,
    focusRequest?: string
): string {
    const fileSections = snapshot.files.map(file => [
        `ARQUIVO: ${file.path}`,
        `LINGUAGEM: ${file.languageId}`,
        `MOTIVO: ${file.reason}`,
        'CONTEUDO:',
        '```',
        file.content,
        '```'
    ].join('\n')).join('\n\n');

    return `
Voce e um principal engineer fazendo uma analise de alto nivel de um projeto para sugerir melhorias que realmente elevem o produto.

FOCO DO USUARIO:
${focusRequest?.trim() || 'Analise geral do projeto e proxima melhoria prioritaria.'}

ARVORE DO PROJETO:
${snapshot.tree || '(sem arquivos encontrados)'}

INSIGHTS LOCAIS DO WORKSPACE:
- Package manager: ${insights.packageManager ?? 'nao identificado'}
- Frameworks detectados: ${insights.frameworks.join(', ') || 'nao identificados'}
- Arquivos de codigo: ${insights.sourceFileCount}
- Arquivos de teste: ${insights.testFileCount}
- Tem testes: ${insights.hasTests ? 'sim' : 'nao'}
- Tem lint: ${insights.hasLinting ? 'sim' : 'nao'}
- Tem formatacao automatica: ${insights.hasFormatting ? 'sim' : 'nao'}
- Tem TypeScript: ${insights.hasTypeScript ? 'sim' : 'nao'}
- Tem CI: ${insights.hasCi ? 'sim' : 'nao'}
- Tem Docker: ${insights.hasDocker ? 'sim' : 'nao'}
- Tem env example: ${insights.hasEnvExample ? 'sim' : 'nao'}
- Tem README: ${insights.hasReadme ? 'sim' : 'nao'}
- Scripts relevantes: ${insights.notableScripts.join(', ') || 'nenhum'}
- Dependencias relevantes: ${insights.notableDependencies.join(', ') || 'nenhuma'}
- Pontos fortes detectados localmente: ${insights.strengths.join(' | ') || 'nenhum'}
- Riscos detectados localmente: ${insights.keyRisks.join(' | ') || 'nenhum'}

ARQUIVOS CHAVE LIDOS:
${fileSections || '(nenhum arquivo textual foi carregado)'}

Responda APENAS com JSON valido no formato:
{
  "executiveSummary": "Resumo direto",
  "strengths": ["forca 1"],
  "risks": ["risco 1"],
  "recommendations": [
    {
      "title": "Melhoria de alto impacto",
      "impact": "high",
      "why": "Por que isso muda o nivel do projeto",
      "files": ["src/app.ts"],
      "actions": ["acao concreta 1", "acao concreta 2"]
    }
  ],
  "roadmap": {
    "quickWins": ["ganho rapido 1"],
    "nextLevel": ["melhoria de alto impacto 1"],
    "strategic": ["movimento estrategico 1"]
  },
  "nextBestMove": {
    "title": "Melhor proximo passo",
    "why": "Justificativa",
    "files": ["src/app.ts"],
    "acceptanceCriteria": ["criterio 1", "criterio 2"]
  }
}

Regras obrigatorias:
- Evite conselhos genericos.
- Recomende o que realmente eleva arquitetura, confiabilidade, DX, qualidade ou capacidade de evolucao.
- Priorize mudancas com impacto cumulativo no projeto, nao apenas limpeza cosmetica.
- Sempre proponha acoes concretas e arquivos provaveis.
- Traga entre 3 e 5 recomendacoes, ordenadas da mais valiosa para a menos valiosa.
- Use "high", "medium" ou "low" em "impact".
- Nao devolva recomendacoes vagas como "melhorar o visual", "deixar mais bonito", "ter boa responsividade" ou similares sem dizer exatamente onde, por que isso importa no produto e quais arquivos devem mudar.
- Se sugerir melhoria de UI/UX, ela deve citar telas, componentes, gargalos visiveis no contexto lido e a estrutura tecnica provavel para implementacao.
- Cada recomendacao precisa parecer algo que um tech lead colocaria no backlog, nao um comentario superficial de revisao visual.
- Diga o suficiente para que a recomendacao possa virar tarefa executavel sem nova analise do zero.
`;
}

export function parseProjectAnalysis(response: string): CodyProjectAnalysis {
    const trimmed = extractCodeFromResponse(response);
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
        throw new Error('A resposta da analise nao trouxe JSON valido.');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<CodyProjectAnalysis>;
    const recommendations = Array.isArray(parsed.recommendations)
        ? parsed.recommendations
            .map(normalizeRecommendation)
            .filter((item): item is CodyAnalysisRecommendation => Boolean(item))
            .slice(0, 5)
        : [];

    if (recommendations.length === 0) {
        throw new Error('A analise retornou JSON, mas sem recomendacoes acionaveis.');
    }

    return {
        executiveSummary: asString(parsed.executiveSummary) ?? 'Analise concluida sem resumo estruturado.',
        strengths: asStringArray(parsed.strengths),
        risks: asStringArray(parsed.risks),
        recommendations,
        roadmap: {
            quickWins: asStringArray(parsed.roadmap?.quickWins),
            nextLevel: asStringArray(parsed.roadmap?.nextLevel),
            strategic: asStringArray(parsed.roadmap?.strategic)
        },
        nextBestMove: {
            title: asString(parsed.nextBestMove?.title) ?? recommendations[0].title,
            why: asString(parsed.nextBestMove?.why) ?? recommendations[0].why,
            files: asStringArray(parsed.nextBestMove?.files),
            acceptanceCriteria: asStringArray(parsed.nextBestMove?.acceptanceCriteria)
        }
    };
}

export function buildProjectAnalysisMarkdown(
    analysis: CodyProjectAnalysis,
    insights: CodyWorkspaceInsights,
    focusRequest?: string
): string {
    const strengths = analysis.strengths.length > 0
        ? analysis.strengths.map(item => `- ${item}`).join('\n')
        : '- Nenhum ponto forte destacado';
    const risks = analysis.risks.length > 0
        ? analysis.risks.map(item => `- ${item}`).join('\n')
        : '- Nenhum risco destacado';
    const recommendations = analysis.recommendations.map((item, index) => [
        `### ${index + 1}. ${item.title} [${item.impact}]`,
        item.why,
        item.files.length > 0 ? `Arquivos provaveis: ${item.files.map(file => `\`${file}\``).join(', ')}` : 'Arquivos provaveis: revisar o modulo relacionado',
        item.actions.length > 0 ? item.actions.map(action => `- ${action}`).join('\n') : '- Definir acoes concretas na proxima iteracao'
    ].join('\n\n')).join('\n\n');

    return `# Analise do Projeto

## Foco

${focusRequest?.trim() || 'Analise geral do projeto'}

## Resumo Executivo

${analysis.executiveSummary}

## Leitura Local do Cody

- Stack: ${insights.frameworks.join(', ') || 'nao identificada'}
- Arquivos de codigo: ${insights.sourceFileCount}
- Arquivos de teste: ${insights.testFileCount}
- Testes: ${insights.hasTests ? 'sim' : 'nao'}
- Lint: ${insights.hasLinting ? 'sim' : 'nao'}
- Formatacao: ${insights.hasFormatting ? 'sim' : 'nao'}
- CI: ${insights.hasCi ? 'sim' : 'nao'}
- Docker: ${insights.hasDocker ? 'sim' : 'nao'}

## Pontos Fortes

${strengths}

## Riscos e Gaps

${risks}

## Recomendacoes de Maior Impacto

${recommendations}

## Roadmap

### Quick Wins

${renderList(analysis.roadmap.quickWins)}

### Next Level

${renderList(analysis.roadmap.nextLevel)}

### Strategic

${renderList(analysis.roadmap.strategic)}

## Melhor Proximo Passo

**${analysis.nextBestMove.title}**

${analysis.nextBestMove.why}

Arquivos provaveis: ${analysis.nextBestMove.files.length > 0 ? analysis.nextBestMove.files.map(file => `\`${file}\``).join(', ') : 'a confirmar na proxima iteracao'}

### Criterios de aceite

${renderList(analysis.nextBestMove.acceptanceCriteria)}
`;
}

function detectFrameworks(dependencyNames: string[], lowerPaths: string[]): string[] {
    const frameworks = new Set<string>();

    if (dependencyNames.includes('react') || lowerPaths.some(file => file.endsWith('.tsx') || file.endsWith('.jsx'))) {
        frameworks.add('React');
    }

    if (dependencyNames.includes('next')) {
        frameworks.add('Next.js');
    }

    if (dependencyNames.includes('vue')) {
        frameworks.add('Vue');
    }

    if (dependencyNames.includes('svelte')) {
        frameworks.add('Svelte');
    }

    if (dependencyNames.includes('express')) {
        frameworks.add('Express');
    }

    if (dependencyNames.includes('fastify')) {
        frameworks.add('Fastify');
    }

    if (dependencyNames.includes('nestjs') || dependencyNames.includes('@nestjs/core')) {
        frameworks.add('NestJS');
    }

    if (dependencyNames.includes('vite')) {
        frameworks.add('Vite');
    }

    if (dependencyNames.includes('tailwindcss')) {
        frameworks.add('Tailwind CSS');
    }

    return [...frameworks];
}

function parsePackageJson(content: string | undefined): PackageJsonShape | undefined {
    if (!content) {
        return undefined;
    }

    try {
        return JSON.parse(content) as PackageJsonShape;
    } catch {
        return undefined;
    }
}

function detectPackageManager(lowerPaths: string[]): string | undefined {
    if (lowerPaths.includes('pnpm-lock.yaml')) {
        return 'pnpm';
    }

    if (lowerPaths.includes('yarn.lock')) {
        return 'yarn';
    }

    if (lowerPaths.includes('package-lock.json')) {
        return 'npm';
    }

    return undefined;
}

function isTestFilePath(filePath: string): boolean {
    return /(^tests?\/|\/tests?\/|\.test\.|\.spec\.)/.test(filePath);
}

function normalizeRecommendation(value: unknown): CodyAnalysisRecommendation | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const candidate = value as Partial<CodyAnalysisRecommendation>;
    const impact = candidate.impact === 'high' || candidate.impact === 'medium' || candidate.impact === 'low'
        ? candidate.impact
        : 'medium';
    const title = asString(candidate.title);
    const why = asString(candidate.why);

    if (!title || !why) {
        return undefined;
    }

    const files = asStringArray(candidate.files);
    const actions = asStringArray(candidate.actions);

    if (isGenericRecommendation(title, why, actions)) {
        return undefined;
    }

    return {
        title,
        impact,
        why,
        files,
        actions
    };
}

function asString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
}

function renderList(items: string[]): string {
    return items.length > 0
        ? items.map(item => `- ${item}`).join('\n')
        : '- Nenhum item sugerido';
}

function isGenericRecommendation(title: string, why: string, actions: string[]): boolean {
    const combined = `${title} ${why} ${actions.join(' ')}`.toLowerCase();
    const genericUiPatterns = [
        'aparencia agradavel',
        'aparência agradável',
        'mais bonito',
        'melhorar o visual',
        'visual melhor',
        'visual moderno',
        'ser responsiva',
        'ser responsivo',
        'boa responsividade',
        'melhor experiencia do usuario',
        'melhor experiência do usuário'
    ];

    const hasConcreteAnchors = /\b(src\/|app\/|pages\/|components\/|layout|dashboard|home|login|package\.json|readme|api|tests?)\b/.test(combined);
    const hasConcreteAction = actions.length > 0;

    return genericUiPatterns.some(pattern => combined.includes(pattern))
        && (!hasConcreteAnchors || !hasConcreteAction);
}
