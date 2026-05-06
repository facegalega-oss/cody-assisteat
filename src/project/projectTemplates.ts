type ProjectTemplate = {
    folders: string[];
    files: Array<{ path: string; content: string }>;
    instructions?: string;
};

export type ProjectTemplateId =
    | 'node-api'
    | 'react-app'
    | 'express-server'
    | 'ts-library'
    | 'vscode-extension';

export function buildProjectTemplate(templateId: ProjectTemplateId, projectName: string): ProjectTemplate {
    switch (templateId) {
        case 'node-api':
            return buildNodeApiTemplate(projectName);
        case 'react-app':
            return buildReactAppTemplate(projectName);
        case 'express-server':
            return buildExpressServerTemplate(projectName);
        case 'ts-library':
            return buildTypeScriptLibraryTemplate(projectName);
        case 'vscode-extension':
            return buildVsCodeExtensionTemplate(projectName);
    }
}

function buildNodeApiTemplate(projectName: string): ProjectTemplate {
    return {
        folders: ['src', 'src/routes', 'src/controllers', 'src/services', 'tests'],
        files: [
            {
                path: 'package.json',
                content: `{
  "name": "${projectName}",
  "version": "0.1.0",
  "private": true,
  "main": "src/server.js",
  "scripts": {
    "dev": "node src/server.js",
    "test": "node --test"
  }
}
`
            },
            {
                path: 'README.md',
                content: `# ${projectName}

API Node.js inicial criada pelo Cody.

## Scripts

- \`npm run dev\`
- \`npm test\`
`
            },
            {
                path: '.gitignore',
                content: `node_modules
.env
coverage
`
            },
            {
                path: 'src/server.js',
                content: `const http = require('node:http');

const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', service: '${projectName}' }));
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(\`Server running on http://localhost:\${PORT}\`);
});
`
            },
            {
                path: 'tests/health.test.js',
                content: `const test = require('node:test');
const assert = require('node:assert/strict');

test('health check placeholder', () => {
    assert.equal(1, 1);
});
`
            }
        ],
        instructions: 'Depois de criar, instale as dependencias necessarias para sua stack e evolua as rotas em src/routes.'
    };
}

function buildReactAppTemplate(projectName: string): ProjectTemplate {
    return {
        folders: ['src', 'src/components', 'public'],
        files: [
            {
                path: 'package.json',
                content: `{
  "name": "${projectName}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
`
            },
            {
                path: 'index.html',
                content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <script type="module" src="/src/main.jsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`
            },
            {
                path: 'src/main.jsx',
                content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
`
            },
            {
                path: 'src/App.jsx',
                content: `const highlights = [
    {
        title: 'Entrega mais rapida',
        description: 'Fluxos claros, CTA evidente e componentes prontos para crescer.'
    },
    {
        title: 'Visual mais premium',
        description: 'Superficies em camadas, contraste elegante e ritmo visual consistente.'
    },
    {
        title: 'Base pronta para produto',
        description: 'Estrutura simples de evoluir com dados reais, auth e dashboard.'
    }
];

export default function App() {
    return (
        <main className="app-shell">
            <div className="orb orb-left" aria-hidden="true" />
            <div className="orb orb-right" aria-hidden="true" />

            <section className="hero-panel">
                <div className="hero-copy">
                    <p className="eyebrow">Cody React Starter</p>
                    <h1>${projectName}</h1>
                    <p className="lead">
                        Interface inicial com atmosfera moderna, responsiva e pronta para virar
                        landing page, painel SaaS ou produto interno elegante.
                    </p>

                    <div className="hero-actions">
                        <button className="primary-action" type="button">Explorar produto</button>
                        <button className="secondary-action" type="button">Ver componentes</button>
                    </div>
                </div>

                <aside className="showcase-card">
                    <span className="showcase-label">Visao Geral</span>
                    <strong className="showcase-value">94%</strong>
                    <p className="showcase-text">
                        Estrutura visual pronta para receber metricas, conteudo real e integracoes.
                    </p>

                    <div className="showcase-metrics">
                        <div>
                            <span>Conversao</span>
                            <strong>+28%</strong>
                        </div>
                        <div>
                            <span>Retencao</span>
                            <strong>12 sem</strong>
                        </div>
                    </div>
                </aside>
            </section>

            <section className="highlights-grid" aria-label="Highlights do projeto">
                {highlights.map(item => (
                    <article key={item.title} className="highlight-card">
                        <h2>{item.title}</h2>
                        <p>{item.description}</p>
                    </article>
                ))}
            </section>
        </main>
    );
}
`
            },
            {
                path: 'src/styles.css',
                content: `:root {
    font-family: "Space Grotesk", "Segoe UI", sans-serif;
    color: #f5f7fb;
    background:
        radial-gradient(circle at top left, rgba(255, 122, 89, 0.22), transparent 32%),
        radial-gradient(circle at top right, rgba(86, 204, 242, 0.18), transparent 28%),
        linear-gradient(180deg, #081120 0%, #0f1c33 52%, #08101d 100%);
    --surface: rgba(9, 18, 34, 0.72);
    --surface-strong: rgba(16, 29, 51, 0.92);
    --border: rgba(255, 255, 255, 0.1);
    --text-muted: rgba(245, 247, 251, 0.74);
    --accent: #ff7a59;
    --accent-cool: #56ccf2;
    --shadow: 0 24px 80px rgba(2, 10, 23, 0.45);
}

* {
    box-sizing: border-box;
}

html {
    scroll-behavior: smooth;
}

body {
    margin: 0;
    min-height: 100vh;
}

.app-shell {
    min-height: 100vh;
    position: relative;
    overflow: hidden;
    padding: 48px 24px 72px;
}

.orb {
    position: absolute;
    width: 320px;
    height: 320px;
    border-radius: 999px;
    filter: blur(18px);
    opacity: 0.5;
    pointer-events: none;
}

.orb-left {
    top: -80px;
    left: -60px;
    background: rgba(255, 122, 89, 0.24);
}

.orb-right {
    right: -80px;
    bottom: 140px;
    background: rgba(86, 204, 242, 0.2);
}

.hero-panel {
    position: relative;
    z-index: 1;
    max-width: 1180px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(280px, 380px);
    gap: 28px;
    align-items: stretch;
}

.hero-copy,
.showcase-card,
.highlight-card {
    backdrop-filter: blur(18px);
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
}

.hero-copy {
    padding: 40px;
    border-radius: 32px;
}

.showcase-card {
    padding: 28px;
    border-radius: 28px;
    background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02)),
        var(--surface-strong);
    align-self: center;
}

.eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.28em;
    font-size: 12px;
    color: var(--accent-cool);
    margin: 0 0 20px;
}

h1 {
    font-size: clamp(44px, 8vw, 92px);
    line-height: 0.95;
    margin: 0 0 18px;
    max-width: 10ch;
}

.lead {
    max-width: 58ch;
    margin: 0;
    font-size: 18px;
    line-height: 1.7;
    color: var(--text-muted);
}

.hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 30px;
}

button {
    border: 0;
    cursor: pointer;
    font: inherit;
    transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

button:hover {
    transform: translateY(-1px);
}

.primary-action,
.secondary-action {
    padding: 14px 20px;
    border-radius: 999px;
}

.primary-action {
    background: linear-gradient(135deg, var(--accent), #ff9966);
    color: #081120;
    box-shadow: 0 14px 28px rgba(255, 122, 89, 0.26);
}

.secondary-action {
    background: rgba(255, 255, 255, 0.06);
    color: #f5f7fb;
    border: 1px solid rgba(255, 255, 255, 0.14);
}

.showcase-label,
.showcase-metrics span {
    color: var(--text-muted);
    font-size: 14px;
}

.showcase-label {
    display: inline-flex;
    margin-bottom: 18px;
}

.showcase-value {
    display: block;
    font-size: clamp(44px, 7vw, 68px);
    line-height: 1;
}

.showcase-text {
    margin: 14px 0 24px;
    line-height: 1.6;
    color: var(--text-muted);
}

.showcase-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
}

.showcase-metrics div,
.highlight-card {
    padding: 18px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
}

.showcase-metrics strong {
    display: block;
    margin-top: 8px;
    font-size: 24px;
}

.highlights-grid {
    position: relative;
    z-index: 1;
    max-width: 1180px;
    margin: 28px auto 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
}

.highlight-card h2 {
    margin: 0 0 10px;
    font-size: 22px;
}

.highlight-card p {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.65;
}

@media (max-width: 920px) {
    .hero-panel {
        grid-template-columns: 1fr;
    }

    .showcase-card {
        max-width: 520px;
    }

    .highlights-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 640px) {
    .app-shell {
        padding: 28px 16px 48px;
    }

    .hero-copy,
    .showcase-card {
        padding: 24px;
        border-radius: 24px;
    }

    h1 {
        max-width: none;
    }

    .hero-actions {
        flex-direction: column;
    }

    .primary-action,
    .secondary-action {
        width: 100%;
    }
}
`
            },
            {
                path: 'README.md',
                content: `# ${projectName}

Base React com Vite gerada pelo Cody.

## Proximos passos

1. Instale \`react\`, \`react-dom\` e \`vite\`
2. Rode \`npm run dev\`
3. Comece seus componentes em \`src/components\`
`
            }
        ],
        instructions: 'Instale react, react-dom e vite antes de iniciar o projeto.'
    };
}

function buildExpressServerTemplate(projectName: string): ProjectTemplate {
    return {
        folders: ['src', 'src/routes', 'src/middleware'],
        files: [
            {
                path: 'package.json',
                content: `{
  "name": "${projectName}",
  "version": "0.1.0",
  "private": true,
  "main": "src/app.js",
  "scripts": {
    "dev": "node src/app.js"
  }
}
`
            },
            {
                path: 'src/app.js',
                content: `const express = require('express');

const app = express();
app.use(express.json());

app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: '${projectName}' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(\`Express listening on http://localhost:\${port}\`);
});
`
            },
            {
                path: '.gitignore',
                content: `node_modules
.env
`
            },
            {
                path: 'README.md',
                content: `# ${projectName}

Servidor Express inicial criado pelo Cody.

Instale \`express\` antes de rodar \`npm run dev\`.
`
            }
        ],
        instructions: 'Instale express e adicione middlewares, rotas e camada de servico conforme o dominio.'
    };
}

function buildTypeScriptLibraryTemplate(projectName: string): ProjectTemplate {
    return {
        folders: ['src', 'tests'],
        files: [
            {
                path: 'package.json',
                content: `{
  "name": "${projectName}",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p .",
    "test": "node --test"
  }
}
`
            },
            {
                path: 'tsconfig.json',
                content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
`
            },
            {
                path: 'src/index.ts',
                content: `export function greet(name: string): string {
    return \`Hello, \${name}!\`;
}
`
            },
            {
                path: 'README.md',
                content: `# ${projectName}

Biblioteca TypeScript inicial criada pelo Cody.
`
            }
        ],
        instructions: 'Instale typescript e configure seu pipeline de build/publicacao antes de distribuir a biblioteca.'
    };
}

function buildVsCodeExtensionTemplate(projectName: string): ProjectTemplate {
    return {
        folders: ['src', '.vscode'],
        files: [
            {
                path: 'package.json',
                content: `{
  "name": "${projectName}",
  "displayName": "${projectName}",
  "description": "VS Code extension scaffolded by Cody",
  "version": "0.0.1",
  "publisher": "your-name",
  "engines": {
    "vscode": "^1.85.0"
  },
  "activationEvents": [
    "onCommand:${projectName}.hello"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "${projectName}.hello",
        "title": "${projectName}: Hello"
      }
    ]
  },
  "scripts": {
    "compile": "tsc -p ./"
  }
}
`
            },
            {
                path: 'tsconfig.json',
                content: `{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "outDir": "out",
    "rootDir": "src",
    "strict": true
  },
  "include": ["src/**/*"]
}
`
            },
            {
                path: 'src/extension.ts',
                content: `import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('${projectName}.hello', () => {
        vscode.window.showInformationMessage('Hello from ${projectName}!');
    });

    context.subscriptions.push(command);
}

export function deactivate(): void {}
`
            },
            {
                path: 'README.md',
                content: `# ${projectName}

Base de extensao VS Code criada pelo Cody.
`
            }
        ],
        instructions: 'Instale typescript e @types/vscode para compilar a extensao.'
    };
}
