import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { get, fmtDate } from '../api/client';
import { EmptyState, ErrorAlert, Loading, PageHeader, StatusChip, TrendChart, useAsync } from '../components/common';

interface Dashboard {
  generatedAt: string;
  integrations: { total: number; active: number; inactive: number };
  executions: { total: number; successfulTransfers: number; failedTransfers: number; pending: number; cancelled: number };
  qa: { passed: number; failed: number; errors: number; running: number; notStarted: number };
  recentRuns: Array<{ _id: string; integrationName: string; entityType: string; transferStatus: string; qa: { status: string }; verification?: { status: string }; httpStatus?: number; createdAt: string; sourceRecordKey?: string }>;
  recentErrors: Array<{ _id: string; integrationName: string; transferStatus: string; qa: { status: string; message?: string }; verification?: { status: string }; errorSummary?: string; updatedAt: string }>;
  trend: Array<{ day: string } & Record<string, number | string>>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'success.main' | 'error.main' | 'info.main' | 'text.primary' }) {
  return (
    <Paper sx={{ p: 2, height: '100%' }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h4" fontWeight={600} color={tone ?? 'text.primary'}>{value.toLocaleString()}</Typography>
    </Paper>
  );
}

export default function DashboardPage() {
  const { data, error, loading, reload } = useAsync(() => get<Dashboard>('/api/dashboard', { days: 14 }), []);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={data ? `Live data from the Hub database · updated ${fmtDate(data.generatedAt)}` : 'Live data from the Hub database'} actions={<Button startIcon={<RefreshIcon />} onClick={() => void reload()}>Refresh</Button>} />
      <ErrorAlert error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 6, md: 3 }}><Metric label="Configured integrations" value={data.integrations.total} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Metric label="Active / inactive" value={data.integrations.active} /><Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>{data.integrations.inactive} inactive</Typography></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Metric label="Total executions" value={data.executions.total} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Metric label="Pending / running" value={data.executions.pending} tone="info.main" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Metric label="Successful transfers" value={data.executions.successfulTransfers} tone="success.main" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Metric label="Failed transfers (incl. timeout)" value={data.executions.failedTransfers} tone="error.main" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Metric label="QA validations passed" value={data.qa.passed} tone="success.main" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Metric label="QA validations failed / error" value={data.qa.failed + data.qa.errors} tone="error.main" /></Grid>
          </Grid>

          {data.executions.total === 0 ? (
            <Paper><EmptyState title="No executions yet" description="Configure a connection, create an integration and run it from Source Data. Metrics appear here once real executions are stored." action={<Button component={RouterLink} to="/integrations/new" variant="contained">Create integration</Button>} /></Paper>
          ) : (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>Execution trend (last 14 days)</Typography>
                  <TrendChart data={data.trend} />
                </Paper>
              </Grid>
              <Grid size={{ xs: 12, lg: 7 }}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>Recent integration runs</Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead><TableRow><TableCell>Integration</TableCell><TableCell>Record</TableCell><TableCell>Transfer</TableCell><TableCell>Read-back</TableCell><TableCell>QA</TableCell><TableCell>Started</TableCell></TableRow></TableHead>
                      <TableBody>
                        {data.recentRuns.map((r) => (
                          <TableRow key={r._id} hover component={RouterLink} to={`/executions/${r._id}`} sx={{ textDecoration: 'none' }}>
                            <TableCell>{r.integrationName}</TableCell>
                            <TableCell>{r.sourceRecordKey ?? '—'}</TableCell>
                            <TableCell><StatusChip status={r.transferStatus} /></TableCell>
                            <TableCell><StatusChip status={r.verification?.status} /></TableCell>
                            <TableCell><StatusChip status={r.qa?.status} /></TableCell>
                            <TableCell>{fmtDate(r.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                </Paper>
              </Grid>
              <Grid size={{ xs: 12, lg: 5 }}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>Recent errors</Typography>
                  {data.recentErrors.length === 0 ? <Typography variant="body2" color="text.secondary">No transfer, verification or QA errors recorded.</Typography> : (
                    <Stack spacing={1}>
                      {data.recentErrors.map((r) => (
                        <Paper key={r._id} variant="outlined" sx={{ p: 1.5, textDecoration: 'none' }} component={RouterLink} to={`/executions/${r._id}`}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="body2" fontWeight={600} color="text.primary">{r.integrationName}</Typography>
                            <StatusChip status={r.transferStatus} />
                            {r.verification?.status && ['MISMATCH', 'ERROR'].includes(r.verification.status) && <StatusChip status={r.verification.status} title="Read-back verification" />}
                            {['FAILED', 'ERROR'].includes(r.qa?.status) && <StatusChip status={r.qa.status} title="QA validation" />}
                          </Stack>
                          <Typography variant="caption" color="text.secondary" display="block">{r.errorSummary ?? r.qa?.message ?? ''}</Typography>
                          <Typography variant="caption" color="text.secondary">{fmtDate(r.updatedAt)}</Typography>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Paper>
              </Grid>
            </Grid>
          )}
        </>
      )}
    </>
  );
}
