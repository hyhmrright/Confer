import './i18n/index.js';
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { LoadingDots } from './components/LoadingDots.js';
import { LoginPage } from './components/LoginPage.js';
import { RouteErrorBoundary } from './components/RouteErrorBoundary.js';
import { useAuthStore } from './stores/auth.js';
import './index.css';

// Only LoginPage is eager. The three authenticated routes account for roughly
// half the bundle — ChatLayout alone drags in react-markdown and its CommonMark
// parser (~150 KB) — and none of it is reachable until someone signs in, so a
// logged-out visitor was downloading the entire app to see a login form.
// Named exports, hence the unwrap to `default`.
const ChatLayout = lazy(() =>
  import('./components/ChatLayout.js').then((m) => ({ default: m.ChatLayout })),
);
const SettingsPage = lazy(() =>
  import('./components/SettingsPage.js').then((m) => ({ default: m.SettingsPage })),
);
const AdminPage = lazy(() =>
  import('./components/AdminPage.js').then((m) => ({ default: m.AdminPage })),
);

function RouteFallback() {
  return (
    <div className="h-screen flex items-center justify-center bg-dark-base">
      <LoadingDots size="md" />
    </div>
  );
}

useAuthStore.getState().restoreSession();
// Refresh the cached profile so the current role is known after a cold start
// (a session stored before the role field existed would otherwise lack it).
if (useAuthStore.getState().accessToken) {
  void useAuthStore.getState().refreshUser();
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Role gate layered on top of auth: a non-admin (or a user whose role is not yet
// loaded) is redirected home. The server-side adminMiddleware is the real
// enforcement; this only hides the UI.
function AdminRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const role = useAuthStore((s) => s.user?.role);
  if (!token) return <Navigate to="/login" replace />;
  if (role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminPage />
                </AdminRoute>
              }
            />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <ChatLayout />
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
