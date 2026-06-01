import './i18n/index.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminPage } from './components/AdminPage.js';
import { ChatLayout } from './components/ChatLayout.js';
import { LoginPage } from './components/LoginPage.js';
import { SettingsPage } from './components/SettingsPage.js';
import { useAuthStore } from './stores/auth.js';
import './index.css';

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
    </BrowserRouter>
  </React.StrictMode>,
);
