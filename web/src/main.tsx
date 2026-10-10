import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading } from './components/common';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import IntegrationsPage from './pages/IntegrationsPage';
import IntegrationDetailPage from './pages/IntegrationDetailPage';
import IntegrationWizardPage from './pages/IntegrationWizardPage';
import SourceDataPage from './pages/SourceDataPage';
import ExecutionsPage from './pages/ExecutionsPage';
import ExecutionDetailPage from './pages/ExecutionDetailPage';
import ConnectionsPage from './pages/ConnectionsPage';
import TemplatesPage from './pages/TemplatesPage';
import ApiDocsPage from './pages/ApiDocsPage';
import AuditLogsPage from './pages/AuditLogsPage';
import UsersPage from './pages/UsersPage';

const theme = createTheme({
  palette: { primary: { main: '#1554c0' }, secondary: { main: '#00796b' }, background: { default: '#f5f7fb' } },
  shape: { borderRadius: 8 },
  typography: { fontFamily: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  components: {
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: '1px solid #e3e8f0' } } },
    MuiAppBar: { styleOverrides: { root: { border: 'none' } } },
    MuiDrawer: { styleOverrides: { paper: { border: 'none', borderRight: '1px solid #e3e8f0' } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none' } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 600, whiteSpace: 'nowrap' } } },
  },
});

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking session…" />;
  if (!user) return <LoginPage />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/integrations/new" element={<IntegrationWizardPage />} />
        <Route path="/integrations/:id" element={<IntegrationDetailPage />} />
        <Route path="/integrations/:id/edit" element={<IntegrationWizardPage />} />
        <Route path="/source-data" element={<SourceDataPage />} />
        <Route path="/executions" element={<ExecutionsPage />} />
        <Route path="/executions/:id" element={<ExecutionDetailPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/api-docs" element={<ApiDocsPage />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <Protected />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
