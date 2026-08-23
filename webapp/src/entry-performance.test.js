import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('entry performance split', () => {
  it('ships a paintable anonymous shell before React boots', () => {
    const indexHtml = readSource('index.html');
    const viteConfig = readSource('vite.config.js');

    expect(indexHtml).toContain('/* __CATSCO_AUTH_STYLES__ */');
    expect(indexHtml).toContain('<div id="root" data-initial-auth-shell>');
    expect(indexHtml).toContain("window.localStorage?.getItem('oc_token')");
    expect(indexHtml).toContain("path.startsWith('/share/')");
    expect(indexHtml).toContain("const workspaceStylesPreloadURL = '__CATSCO_WORKSPACE_STYLES_PRELOAD__'");
    expect(indexHtml).toContain("if (!href.startsWith('/')) return;");
    expect(indexHtml).toContain("const addHighPriorityStylesheet = (href) => {");
    expect(indexHtml).toContain("stylesheetLink.rel = 'stylesheet'");
    expect(indexHtml).toContain("stylesheetLink.setAttribute('fetchpriority', 'high')");
    expect(indexHtml).toContain("brandPreload.href = '/catsco-brand-mark.webp'");
    expect(indexHtml).toContain("brandPreload.setAttribute('fetchpriority', 'high')");
    expect(indexHtml).toContain('root.replaceChildren();');
    expect(indexHtml).toContain('document.createTreeWalker(root, NodeFilter.SHOW_TEXT)');
    expect(indexHtml).toContain('<script type="module" async src="/src/index.jsx"></script>');
    expect(viteConfig).toContain("name: 'inline-auth-entry-styles'");
    expect(viteConfig).toContain("readFileSync(new URL('./src/css/auth.css', import.meta.url), 'utf8')");
    expect(viteConfig).toContain("name: 'preload-workspace-styles'");
    expect(viteConfig).toContain("context.bundle");
    expect(viteConfig).toContain("/^assets\\/workspace-styles-[^/]+\\.css$/");
    expect(readSource('src/index.jsx')).toContain("ReactDOM.hydrateRoot(rootElement, app);");
  });

  it('keeps anonymous entry free of workspace and feedback dependencies', () => {
    const entry = readSource('src/index.jsx');
    const authGateway = readSource('src/views/auth-gateway.jsx');

    expect(entry).toContain("const TinodeWeb = lazy(importWorkspace);");
    expect(entry).toContain("const PwaController = lazy(() => import('./components/pwa-controller'));");
    expect(entry).toContain("const importWorkspaceStyles = () => import('./views/workspace-styles');");
    expect(entry).toContain('const preloadWorkspace = () => {');
    expect(entry).toContain('workspacePreloadPromise = Promise.all([');
    expect(entry).toContain('if (!shouldLoadWorkspace) return undefined;');
    expect(entry).toContain('requestAnimationFrame');
    expect(entry).toContain('void preloadWorkspace().catch(() => {});');
    expect(entry).not.toContain("import TinodeWeb from './views/tinode-web';");
    expect(entry).not.toContain("import PwaController from './components/pwa-controller';");
    expect(entry).not.toContain("from './api'");
    expect(entry).toContain("<AuthGateway onAuthenticationIntent={() => { void preloadWorkspace(); }} />");
    expect(entry).toContain('function DeferredPwaController');
    expect(entry).toContain('setTimeout(() => setEnabled(true), 1200)');
    expect(authGateway).toContain("from '../auth-session'");
    expect(authGateway).not.toContain("from '../api'");
    expect(authGateway).not.toContain("from '../i18n'");
    expect(authGateway).toContain('const AUTH_COPY = Object.freeze');
    expect(authGateway).not.toContain('InlineFeedback');
  });

  it('does not precache lazy workspace and PDF assets', () => {
    const viteConfig = readSource('vite.config.js');
    expect(viteConfig).toContain("'assets/index-*.{js,css}'");
    expect(viteConfig).toContain("'assets/workbox-window.*.js'");
    expect(viteConfig).not.toContain("'assets/**/*.{js,css}'");
    expect(viteConfig).not.toContain("'pwa-*.png'");
  });

  it('keeps the animated auth background deferred', () => {
    const authGateway = readSource('src/views/auth-gateway.jsx');
    const background = readSource('src/components/auth-flow-background.jsx');
    const authCss = readSource('src/css/auth.css');
    expect(authGateway).toContain('setTimeout(() => setEnabled(true), 600)');
    expect(authGateway).toContain("window.matchMedia?.('(max-width: 699px)')");
    expect(authGateway).toContain('globalThis.navigator?.connection?.saveData');
    expect(background).toContain('navigator.connection?.saveData');
    expect(background).toContain('authFlowFrameInterval');
    expect(authCss).toContain('--cc-font-sans: -apple-system');
    expect(authCss).not.toContain('Inter Variable');
  });

  it('keeps the anonymous primary color readable on its light surface', () => {
    const authCss = readSource('src/css/auth.css');

    expect(authCss).toContain('--cc-accent: oklch(52.9% 0.11 165);');
    expect(authCss).toContain('--cc-accent-hover: oklch(46% 0.1 163);');
    expect(authCss).toContain('--cc-accent-foreground: oklch(99% 0.003 165);');
    expect(authCss).toContain('color: var(--cc-accent-foreground);');
  });

  it('loads the workspace sidebar only after it is needed on mobile', () => {
    const workspace = readSource('src/views/tinode-web.jsx');

    expect(workspace).toContain('const shouldRenderSidebarContent = sidebarViewportWidth > 768 || mobileSidebarOpen;');
    expect(workspace).toContain('{shouldRenderSidebarContent && (');
    expect(workspace).toContain('<SidebarContent');
  });

  it('uses device-native fonts for the compact workspace', () => {
    const workspaceStyles = readSource('src/views/workspace-styles.js');
    const mobilePerformance = readSource('src/css/mobile-performance.css');

    expect(workspaceStyles).toContain("import '../css/mobile-performance.css';");
    expect(mobilePerformance).toContain('@media (max-width: 768px)');
    expect(mobilePerformance).toContain('--cc-font-sans: -apple-system');
  });
});
