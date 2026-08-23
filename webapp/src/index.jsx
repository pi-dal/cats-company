import React, { lazy, Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import AuthGateway from './views/auth-gateway';
import { getAuthRevision, getPushPromptOwner, getToken } from './auth-session';
import { syncThemeColor, THEME_STORAGE_KEY } from './utils/theme-access';

const importWorkspace = () => import('./views/tinode-web');
const importWorkspaceStyles = () => import('./views/workspace-styles');
const importWorkspaceProviders = () => import('./components/feedback-system').then(({ FeedbackProvider }) => ({ default: FeedbackProvider }));
let workspacePreloadPromise = null;
const preloadWorkspace = () => {
  if (!workspacePreloadPromise) {
    workspacePreloadPromise = Promise.all([
      importWorkspace(),
      importWorkspaceStyles(),
      importWorkspaceProviders(),
    ]).catch((error) => {
      workspacePreloadPromise = null;
      throw error;
    });
  }
  return workspacePreloadPromise;
};
const TinodeWeb = lazy(importWorkspace);
const WorkspaceProviders = lazy(importWorkspaceProviders);
const PwaController = lazy(() => import('./components/pwa-controller'));
const SharedConversationView = lazy(() => import('./views/shared-conversation-view'));
const DEV_THEME_PREVIEWS = new Set(['light', 'dark', 'liquid', 'liquid-green']);

const requestedThemePreview = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('theme_preview')
  : '';
const developmentWorkspacePreview = import.meta.env.DEV && (
  import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'
  || DEV_THEME_PREVIEWS.has(requestedThemePreview)
);

function isStandaloneWorkspaceRoute() {
  return window.location.pathname.startsWith('/mobile-upload/')
    || new URLSearchParams(window.location.search).get('workflow_demo') === '1';
}

syncThemeColor(localStorage.getItem(THEME_STORAGE_KEY));

function decodeSharedConversationToken(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function WorkspaceLoading() {
  return (
    <main className="cc-workspace-loading" role="status" aria-live="polite">
      <span>正在加载工作区…</span>
    </main>
  );
}

function DeferredPwaController({ loggedIn, pushPromptOwner, sessionRevision }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!loggedIn) {
      setEnabled(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setEnabled(true), 1200);
    return () => window.clearTimeout(timer);
  }, [loggedIn]);

  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <PwaController
        loggedIn={loggedIn}
        pushPromptOwner={pushPromptOwner}
        sessionRevision={sessionRevision}
      />
    </Suspense>
  );
}

function App() {
  const sharedConversationMatch = window.location.pathname.match(/^\/share\/([^/]+)$/);
  if (sharedConversationMatch) {
    return (
      <Suspense fallback={<main className="cc-shared-conversation-state" role="status">正在打开分享片段…</main>}>
        <SharedConversationView token={decodeSharedConversationToken(sharedConversationMatch[1])} />
      </Suspense>
    );
  }

  const [auth, setAuth] = useState(() => ({
    loggedIn: Boolean(getToken()),
    pushPromptOwner: getPushPromptOwner(),
    revision: getAuthRevision(),
  }));

  useEffect(() => {
    const handleAuthChanged = (event) => setAuth({
      loggedIn: Boolean(event.detail?.loggedIn),
      pushPromptOwner: getPushPromptOwner(),
      revision: event.detail?.revision ?? getAuthRevision(),
    });
    window.addEventListener('cc:auth-changed', handleAuthChanged);
    return () => window.removeEventListener('cc:auth-changed', handleAuthChanged);
  }, []);

  const standaloneRoute = isStandaloneWorkspaceRoute();
  const shouldLoadWorkspace = auth.loggedIn || standaloneRoute || developmentWorkspacePreview;

  useEffect(() => {
    if (!shouldLoadWorkspace) return undefined;
    // Let the first workspace render claim the critical connection and paint
    // before warming sibling modules and styles in the background. The login
    // submit path still starts this same shared preload before authentication.
    const schedule = window.requestAnimationFrame
      ? window.requestAnimationFrame(() => { void preloadWorkspace().catch(() => {}); })
      : window.setTimeout(() => { void preloadWorkspace().catch(() => {}); }, 0);
    return () => {
      if (window.cancelAnimationFrame && typeof schedule === 'number') {
        window.cancelAnimationFrame(schedule);
      } else {
        window.clearTimeout(schedule);
      }
    };
  }, [shouldLoadWorkspace]);

  return (
    <>
      {!shouldLoadWorkspace && (
        <AuthGateway onAuthenticationIntent={() => { void preloadWorkspace(); }} />
      )}
      {shouldLoadWorkspace && (
        <Suspense fallback={<WorkspaceLoading />}>
          <WorkspaceProviders>
            <TinodeWeb />
          </WorkspaceProviders>
        </Suspense>
      )}
      {auth.loggedIn && (
        <DeferredPwaController
          loggedIn={auth.loggedIn}
          pushPromptOwner={auth.pushPromptOwner}
          sessionRevision={auth.revision}
        />
      )}
    </>
  );
}

const rootElement = document.getElementById('root');
const app = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (rootElement.hasAttribute('data-initial-auth-shell')) {
  ReactDOM.hydrateRoot(rootElement, app);
} else {
  ReactDOM.createRoot(rootElement).render(app);
}
