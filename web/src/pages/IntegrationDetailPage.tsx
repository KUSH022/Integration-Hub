import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import { get, post, fmtDate } from '../api/client';
import type { Integration, Paged, RunSummary } from '../api/types';
import { useAuth } from '../auth';
import { ConfirmDialog, EmptyState, ErrorAlert, JsonViewer, Loading, PageHeader, StatusChip, useAsync } from '../components/common';

interface VersionRow { _id: string; version: number; changeType: string; changedFields?: string[]; createdAt: string; createdBy?: string }

function Versions({ id }: { id: string }) {
  const { data, error, loading } = useAsync(() => get<{ items: VersionRow[] }>(`/api/integrations/${id}/versions`), [id]);
  const [view, setView] = useState<{ version: number; config: unknown }>();
  if (loading) return <Loading />;
  return (
    <>
      <ErrorAlert error={error} />
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Version</TableCell><TableCell>Change</TableCell><TableCell>Changed sections</TableCell><TableCell>By</TableCell><TableCell>When</TableCell><TableCell /></TableRow></TableHead>
          <TableBody>
            {data?.items.map((v) => (
              <TableRow key={v._id}>
                <TableCell>v{v.version}</TableCell><TableCell>{v.changeType}</TableCell><TableCell>{(v.changedFields ?? []).join(', ')}</TableCell><TableCell>{v.createdBy ?? '—'}</TableCell><TableCell>{fmtDate(v.createdAt)}</TableCell>
                <TableCell><Button size="small" onClick={async () => setView((await get<{ version: { version: number; config: unknown } }>(`/api/integrations/${id}/versions/${v.version}`)).version)}>View</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Dialog open={Boolean(view)} onClose={() => setView(undefined)} maxWidth="md" fullWidth>
        <DialogTitle>Configuration v{view?.version}</DialogTitle>
        <DialogContent><JsonViewer value={view?.config} maxHeight={600} /></DialogContent>
        <DialogActions><Button onClick={() => setView(undefined)}>Close</Button></DialogActions>
      </Dialog>
    </>
  );
}

export function RunsTable({ query }: { query: Record<string, unknown> }) {
  const nav = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const key = JSON.stringify(query);
  const { data, error, loading, reload } = useAsync(() => get<Paged<RunSummary>>('/api/runs', { ...query, page: page + 1, pageSize }), [key, page, pageSize]);
  if (loading && !data) return <Loading />;
  return (
    <>
      <ErrorAlert error={error} onRetry={reload} />
      {data && data.total === 0 ? <EmptyState title="No executions match" description="Executions appear here after records are submitted for execution." /> : data && (
        <>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow><TableCell>Execution ID</TableCell><TableCell>Correlation ID</TableCell><TableCell>Integration</TableCell><TableCell>Entity</TableCell><TableCell>Source record</TableCell><TableCell>Destination</TableCell><TableCell>Started</TableCell><TableCell>Ended</TableCell><TableCell>Transfer</TableCell><TableCell>HTTP</TableCell><TableCell>Read-back</TableCell><TableCell>QA</TableCell><TableCell>Retries</TableCell><TableCell>Error summary</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r._id} hover sx={{ cursor: 'pointer' }} onClick={() => nav(`/executions/${r._id}`)}>
                    <TableCell><code>{r._id}</code></TableCell>
                    <TableCell><code>{r.correlationId}</code></TableCell>
                    <TableCell>{r.integrationName}</TableCell>
                    <TableCell>{r.entityType}</TableCell>
                    <TableCell>{r.sourceRecordKey ?? '—'}</TableCell>
                    <TableCell>{r.destinationApplication}</TableCell>
                    <TableCell>{fmtDate(r.startedAt ?? r.createdAt)}</TableCell>
                    <TableCell>{fmtDate(r.endedAt)}</TableCell>
                    <TableCell><StatusChip status={r.transferStatus} /></TableCell>
                    <TableCell>{r.httpStatus ?? '—'}</TableCell>
                    <TableCell><StatusChip status={r.verification?.status} /></TableCell>
                    <TableCell><StatusChip status={r.qa?.status} /></TableCell>
                    <TableCell>{r.retryCount}</TableCell>
                    <TableCell sx={{ maxWidth: 320 }}><Typography variant="body2" noWrap title={r.errorSummary ?? ''}>{r.errorSummary ?? '—'}</Typography></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[10, 25, 50, 100]} onPageChange={(_e, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
        </>
      )}
    </>
  );
}

export default function IntegrationDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [tab, setTab] = useState(0);
  const [confirm, setConfirm] = useState<'activate' | 'deactivate' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>();
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const { data, error, loading, reload } = useAsync(() => get<{ integration: Integration }>(`/api/integrations/${id}`), [id]);
  const i = data?.integration;

  const toggle = async () => {
    setBusy(true);
    setActionError(undefined);
    try {
      await post(`/api/integrations/${id}/${confirm}`);
      setConfirm(null);
      await reload();
    } catch (e) {
      setActionError(e);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };
  const clone = async () => {
    setBusy(true);
    try {
      const r = await post<{ integration: Integration }>(`/api/integrations/${id}/clone`, { name: cloneName });
      setCloneOpen(false);
      nav(`/integrations/${r.integration._id}`);
    } catch (e) {
      setActionError(e);
      setCloneOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !i) return <Loading />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!i) return null;

  return (
    <>
      <PageHeader
        title={i.name}
        subtitle={`${i.entityType} · v${i.version} · updated ${fmtDate(i.updatedAt)}${i.updatedBy ? ` by ${i.updatedBy}` : ''}`}
        actions={
          <>
            <StatusChip status={i.active ? 'ACTIVE' : 'INACTIVE'} />
            {can('OPERATOR') && <Button variant="contained" component={RouterLink} to={`/source-data?integration=${i._id}`} disabled={!i.active}>Execute</Button>}
            {can('OPERATOR') && <Button component={RouterLink} to={`/integrations/${i._id}/edit`}>Edit</Button>}
            {can('OPERATOR') && <Button onClick={() => { setCloneName(`${i.name} (copy)`); setCloneOpen(true); }}>Clone</Button>}
            {can('ADMIN') && <Button color={i.active ? 'warning' : 'success'} onClick={() => setConfirm(i.active ? 'deactivate' : 'activate')}>{i.active ? 'Deactivate' : 'Activate'}</Button>}
          </>
        }
      />
      <ErrorAlert error={actionError} />
      {!i.active && <Alert severity="info" sx={{ mb: 2 }}>This integration is inactive and cannot be executed. Activation requires a tested, active destination connection.</Alert>}
      <Paper>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}>
          <Tab label="Configuration" /><Tab label="Execution history" /><Tab label="Configuration history" />
        </Tabs>
        <Box sx={{ p: 2 }}>
          {tab === 0 && (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Stack spacing={1}>
                  <Typography variant="body2"><strong>Integration ID:</strong> <code>{i._id}</code></Typography>
                  <Typography variant="body2"><strong>Description:</strong> {i.description || '—'}</Typography>
                  <Typography variant="body2"><strong>Business purpose:</strong> {i.businessPurpose || '—'}</Typography>
                  <Typography variant="body2"><strong>Source:</strong> {i.source.type} (identifier: {i.source.recordIdField || '—'})</Typography>
                  <Typography variant="body2"><strong>Destination:</strong> <code>{i.destination.method} {i.destination.endpointPath}</code> (connection {i.destination.connectionId})</Typography>
                  <Typography variant="body2"><strong>Success statuses:</strong> {i.destination.successStatuses.join(', ')} · <strong>Timeout:</strong> {i.destination.timeoutMs} ms</Typography>
                  <Typography variant="body2"><strong>Read-back:</strong> {i.destination.readback?.enabled ? i.destination.readback.pathTemplate : 'Not configured — persistence is not independently verified'}</Typography>
                  <Typography variant="body2"><strong>Retry policy:</strong> {i.execution.retry.retryCount} retries, {i.execution.retry.retryDelayMs} ms {i.execution.retry.backoff.toLowerCase()} on {i.execution.retry.retryOnStatus.join(', ') || '—'}</Typography>
                  <Typography variant="body2"><strong>Idempotency key:</strong> {i.destination.idempotency.supported ? `${i.destination.idempotency.headerName} ← ${i.destination.idempotency.keyField}` : 'Not supported by destination'}</Typography>
                  <Typography variant="body2"><strong>QA validation:</strong> {i.qa.enabled ? 'Available for manual check in the local QA Agent' : 'Off'}</Typography>
                  <Typography variant="subtitle2" sx={{ pt: 1 }}>Mappings</Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead><TableRow><TableCell>Source</TableCell><TableCell>Destination</TableCell><TableCell>Transformations</TableCell><TableCell>Required</TableCell></TableRow></TableHead>
                      <TableBody>{i.mappings.map((m, k) => <TableRow key={k}><TableCell><code>{m.sourcePath || '(default)'}</code></TableCell><TableCell><code>{m.targetPath}</code></TableCell><TableCell>{m.transforms.map((t) => t.type).join(' → ') || 'Direct'}</TableCell><TableCell>{m.required ? 'Yes' : ''}</TableCell></TableRow>)}</TableBody>
                    </Table>
                  </Box>
                </Stack>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}><Typography variant="subtitle2" gutterBottom>Full configuration</Typography><JsonViewer value={i} maxHeight={600} /></Grid>
            </Grid>
          )}
          {tab === 1 && <RunsTable query={{ integrationId: i._id }} />}
          {tab === 2 && <Versions id={i._id} />}
        </Box>
      </Paper>

      <ConfirmDialog open={confirm !== null} busy={busy} title={confirm === 'activate' ? 'Activate integration?' : 'Deactivate integration?'} danger={confirm === 'deactivate'}
        message={confirm === 'activate' ? 'Active integrations can send real requests to the destination API.' : 'Queued executions will be cancelled when processed; no new executions can be started.'}
        confirmLabel={confirm === 'activate' ? 'Activate' : 'Deactivate'} onClose={() => setConfirm(null)} onConfirm={() => void toggle()} />
      <Dialog open={cloneOpen} onClose={() => setCloneOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Clone integration</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth label="New name" value={cloneName} onChange={(e) => setCloneName(e.target.value)} sx={{ mt: 1 }} helperText="The clone is created inactive." /></DialogContent>
        <DialogActions><Button onClick={() => setCloneOpen(false)}>Cancel</Button><Button variant="contained" disabled={busy || cloneName.trim().length < 3} onClick={() => void clone()}>Clone</Button></DialogActions>
      </Dialog>
    </>
  );
}
