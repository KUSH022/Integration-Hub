import { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { del, get, post, put, fmtDate } from '../api/client';
import type { Connection, Meta, QaContract } from '../api/types';
import { useAuth } from '../auth';
import { ConfirmDialog, EmptyState, ErrorAlert, KeyValueEditor, Loading, PageHeader, StatusChip, parseNumberList, useAsync } from '../components/common';

type Form = {
  name: string; application: Connection['application']; description: string; baseUrl: string; authType: Connection['authType']; apiKeyHeader: string;
  defaultHeaders: Record<string, string>; timeoutMs: number; healthPath: string; healthStatuses: string; apiDocsUrl: string; operationsJson: string; qaContractJson: string;
};

const QA_CONTRACT_SKELETON: QaContract = {
  triggerPath: '', triggerMethod: 'POST', triggerSuccessStatuses: [200, 201, 202],
  requestTemplate: { '<qa-field-for-execution-id>': '{{executionId}}', '<qa-field-for-correlation-id>': '{{correlationId}}', '<qa-field-for-expected-payload>': '{{expectedPayload}}' },
  executionIdPath: '', statusPathTemplate: '/<documented-status-path>/{{qaExecutionId}}', statusFieldPath: '',
  statusValues: { passed: [], failed: [], running: [], error: [] }, differencesPath: '', errorMessagePath: '', pollIntervalSeconds: 10, maxPollMinutes: 30, contractReference: '',
};

function toForm(c?: Connection): Form {
  return {
    name: c?.name ?? '', application: c?.application ?? 'KP_WFM', description: c?.description ?? '', baseUrl: c?.baseUrl ?? '', authType: c?.authType ?? 'BEARER',
    apiKeyHeader: c?.apiKeyHeader ?? '', defaultHeaders: c?.defaultHeaders ?? {}, timeoutMs: c?.timeoutMs ?? 15000, healthPath: c?.healthCheck?.path ?? '',
    healthStatuses: (c?.healthCheck?.expectedStatuses ?? [200]).join(', '), apiDocsUrl: c?.apiDocsUrl ?? '',
    operationsJson: JSON.stringify(c?.operations ?? [], null, 2), qaContractJson: c?.qaContract ? JSON.stringify(c.qaContract, null, 2) : '',
  };
}

function ConnectionDialog({ open, existing, onClose, onSaved, meta }: { open: boolean; existing?: Connection; onClose: () => void; onSaved: () => void; meta?: Meta }) {
  const [f, setF] = useState<Form>(toForm(existing));
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      let operations: unknown = [];
      let qaContract: unknown = null;
      try { operations = f.operationsJson.trim() ? JSON.parse(f.operationsJson) : []; } catch { throw new Error('Documented operations must be valid JSON'); }
      if (f.application === 'KP_QA_AGENT' && f.qaContractJson.trim()) {
        try { qaContract = JSON.parse(f.qaContractJson); } catch { throw new Error('QA contract must be valid JSON'); }
        const qc = qaContract as Record<string, unknown>;
        for (const k of ['differencesPath', 'errorMessagePath', 'initialStatusPath']) if (qc[k] === '') delete qc[k];
      }
      const body = {
        name: f.name, application: f.application, description: f.description || undefined, baseUrl: f.baseUrl.trim(), authType: f.authType,
        apiKeyHeader: f.authType === 'API_KEY' ? f.apiKeyHeader : undefined, defaultHeaders: f.defaultHeaders, timeoutMs: Number(f.timeoutMs),
        healthCheck: f.healthPath ? { path: f.healthPath, expectedStatuses: parseNumberList(f.healthStatuses) } : null,
        apiDocsUrl: f.apiDocsUrl || undefined, operations, qaContract: f.application === 'KP_QA_AGENT' ? qaContract : null,
      };
      if (existing) await put(`/api/connections/${existing._id}`, body);
      else await post('/api/connections', body);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{existing ? `Edit connection — ${existing.name}` : 'New connection'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <ErrorAlert error={error} />
          <Alert severity="info">Enter endpoints, authentication and payload contracts exactly as documented by the target application. The Hub does not assume any KP WFM or KP QA Agent endpoint exists. Credentials are set separately and stored encrypted on the server.</Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Name" value={f.name} onChange={(e) => set('name', e.target.value)} fullWidth required />
            <TextField select label="Application" value={f.application} onChange={(e) => set('application', e.target.value as Form['application'])} sx={{ minWidth: 200 }}>
              <MenuItem value="KP_WFM">KP WFM</MenuItem><MenuItem value="KP_QA_AGENT">KP QA Agent</MenuItem><MenuItem value="REST_API">Other REST API</MenuItem>
            </TextField>
          </Stack>
          <TextField label="Description" value={f.description} onChange={(e) => set('description', e.target.value)} />
          <TextField label="Base URL" value={f.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} required helperText={meta?.security.requireHttpsDestinations ? 'HTTPS required. Private, loopback and metadata addresses are blocked.' : 'Private/loopback addresses are blocked unless explicitly allowed by the server configuration.'} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Authentication" value={f.authType} onChange={(e) => set('authType', e.target.value as Form['authType'])} sx={{ minWidth: 200 }}>
              <MenuItem value="BEARER">Bearer token</MenuItem><MenuItem value="API_KEY">API key header</MenuItem><MenuItem value="NONE">None</MenuItem>
            </TextField>
            {f.authType === 'API_KEY' && <TextField label="API key header name" value={f.apiKeyHeader} onChange={(e) => set('apiKeyHeader', e.target.value)} helperText="As documented, e.g. X-API-Key" />}
            <TextField type="number" label="Timeout (ms)" value={f.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Health-check path (GET)" value={f.healthPath} onChange={(e) => set('healthPath', e.target.value)} fullWidth helperText="A verified endpoint used by 'Test connection'" />
            <TextField label="Expected statuses" value={f.healthStatuses} onChange={(e) => set('healthStatuses', e.target.value)} sx={{ minWidth: 160 }} />
          </Stack>
          <TextField label="API documentation URL" value={f.apiDocsUrl} onChange={(e) => set('apiDocsUrl', e.target.value)} />
          <Typography variant="subtitle2">Default headers (non-secret)</Typography>
          <KeyValueEditor value={f.defaultHeaders} onChange={(v) => set('defaultHeaders', v)} />
          <TextField label="Documented API operations (JSON array)" value={f.operationsJson} onChange={(e) => set('operationsJson', e.target.value)} multiline minRows={4} InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12.5 } }}
            helperText='Each item: {"key","label","method","path","purpose":"CREATE|UPDATE|UPSERT|DELETE|READ|HEALTH|QA_TRIGGER|QA_STATUS","entityType","contractReference"} — contractReference must cite the source (docs URL, file, version).' />
          {f.application === 'KP_QA_AGENT' && (
            <>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle2">KP QA Agent API contract</Typography>
                {!f.qaContractJson && <Button size="small" onClick={() => set('qaContractJson', JSON.stringify(QA_CONTRACT_SKELETON, null, 2))}>Insert blank contract</Button>}
              </Stack>
              <TextField value={f.qaContractJson} onChange={(e) => set('qaContractJson', e.target.value)} multiline minRows={10} InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12.5 } }}
                helperText={`Fill every field from the real QA Agent API documentation. Template variables available: ${meta?.qaTemplateVariables.map((v) => `{{${v}}}`).join(', ') ?? ''}. Until complete, QA is recorded as NOT_STARTED.`} />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="contained" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></DialogActions>
    </Dialog>
  );
}

function SecretDialog({ conn, onClose, onSaved }: { conn: Connection; onClose: () => void; onSaved: () => void }) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await put(`/api/connections/${conn._id}/secret`, { secret });
      setSecret('');
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Set credential — {conn.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <ErrorAlert error={error} />
          <Alert severity="info">{conn.authType === 'BEARER' ? 'Bearer token' : `API key sent in header "${conn.apiKeyHeader}"`}. The value is sent once over HTTPS, encrypted with AES-256-GCM on the server and never displayed again. Use a least-privilege credential. The connection is deactivated until re-tested.</Alert>
          <TextField type="password" label="Credential" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" fullWidth inputProps={{ autoComplete: 'new-password' }} />
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button><Button variant="contained" disabled={busy || secret.length < 8} onClick={() => void save()}>Save credential</Button></DialogActions>
    </Dialog>
  );
}

export default function ConnectionsPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => get<{ items: Connection[] }>('/api/connections'), []);
  const meta = useAsync(() => get<Meta>('/api/meta'), []);
  const [edit, setEdit] = useState<{ conn?: Connection } | null>(null);
  const [secretFor, setSecretFor] = useState<Connection>();
  const [confirm, setConfirm] = useState<{ conn: Connection; action: 'activate' | 'deactivate' | 'remove-secret' } | null>(null);
  const [busyId, setBusyId] = useState<string>();
  const [actionError, setActionError] = useState<unknown>();

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setActionError(undefined);
    try {
      await fn();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusyId(undefined);
      setConfirm(null);
      await reload();
    }
  };

  return (
    <>
      <PageHeader title="Connections" subtitle="Authenticated API connections to KP WFM, KP QA Agent and other REST systems" actions={can('ADMIN') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEdit({})}>New connection</Button>} />
      <ErrorAlert error={error ?? actionError} onRetry={reload} />
      {loading && !data ? <Loading /> : data && data.items.length === 0 ? (
        <Paper><EmptyState title="No connections configured" description="Create a connection for KP WFM (destination) and KP QA Agent (verification) using their documented base URLs, health-check endpoints and authentication." /></Paper>
      ) : data && (
        <Stack spacing={2}>
          {data.items.map((c) => (
            <Paper key={c._id} sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="subtitle1" fontWeight={600}>{c.name}</Typography>
                    <StatusChip status={c.active ? 'ACTIVE' : 'INACTIVE'} />
                    <Typography variant="caption" color="text.secondary">{c.application} · v{c.version}</Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}><code>{c.baseUrl}</code></Typography>
                  <Typography variant="body2" color="text.secondary">
                    Auth: {c.authType}{c.authType === 'API_KEY' ? ` (${c.apiKeyHeader})` : ''} · credential: {c.authType === 'NONE' ? 'n/a' : c.hasSecret ? `stored (updated ${fmtDate(c.secretUpdatedAt)})` : 'not set'} · timeout {c.timeoutMs} ms · health check: {c.healthCheck ? <code>GET {c.healthCheck.path}</code> : 'not configured'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">Documented operations: {c.operations.length}{c.apiDocsUrl && <> · <a href={c.apiDocsUrl} target="_blank" rel="noreferrer noopener">API docs</a></>}</Typography>
                  {c.application === 'KP_QA_AGENT' && (c.qaContractMissing?.length ? <Alert severity="warning" sx={{ mt: 1, py: 0 }}>QA contract incomplete — missing: {c.qaContractMissing.join(', ')}</Alert> : <Alert severity="success" sx={{ mt: 1, py: 0 }}>QA contract configured ({c.qaContract?.contractReference})</Alert>)}
                  {c.lastTest && (
                    <Alert severity={c.lastTest.ok ? 'success' : 'error'} sx={{ mt: 1, py: 0 }}>
                      Last test {fmtDate(c.lastTest.at)}: {c.lastTest.message}{c.lastTest.durationMs !== undefined ? ` (${c.lastTest.durationMs} ms)` : ''}
                    </Alert>
                  )}
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-start" sx={{ flexShrink: 0 }}>
                  {can('OPERATOR') && <Button size="small" variant="outlined" disabled={busyId === c._id || !c.healthCheck} onClick={() => void run(c._id, () => post(`/api/connections/${c._id}/test`))}>{busyId === c._id ? 'Testing…' : 'Test connection'}</Button>}
                  {can('ADMIN') && <Button size="small" onClick={() => setEdit({ conn: c })}>Edit</Button>}
                  {can('ADMIN') && c.authType !== 'NONE' && <Button size="small" onClick={() => setSecretFor(c)}>{c.hasSecret ? 'Rotate credential' : 'Set credential'}</Button>}
                  {can('ADMIN') && c.hasSecret && <Button size="small" color="warning" onClick={() => setConfirm({ conn: c, action: 'remove-secret' })}>Remove credential</Button>}
                  {can('ADMIN') && <Button size="small" color={c.active ? 'warning' : 'success'} onClick={() => setConfirm({ conn: c, action: c.active ? 'deactivate' : 'activate' })}>{c.active ? 'Deactivate' : 'Activate'}</Button>}
                </Stack>
              </Stack>
              {c.operations.length > 0 && (
                <Box sx={{ overflowX: 'auto', mt: 1 }}>
                  <Table size="small">
                    <TableHead><TableRow><TableCell>Operation</TableCell><TableCell>Method</TableCell><TableCell>Path</TableCell><TableCell>Purpose</TableCell><TableCell>Contract reference</TableCell></TableRow></TableHead>
                    <TableBody>{c.operations.map((o) => <TableRow key={o.key}><TableCell>{o.label}</TableCell><TableCell>{o.method}</TableCell><TableCell><code>{o.path}</code></TableCell><TableCell>{o.purpose}</TableCell><TableCell>{o.contractReference}</TableCell></TableRow>)}</TableBody>
                  </Table>
                </Box>
              )}
            </Paper>
          ))}
        </Stack>
      )}
      {edit && <ConnectionDialog open existing={edit.conn} meta={meta.data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
      {secretFor && <SecretDialog conn={secretFor} onClose={() => setSecretFor(undefined)} onSaved={() => { setSecretFor(undefined); void reload(); }} />}
      <ConfirmDialog open={confirm !== null} busy={Boolean(busyId)} danger={confirm?.action !== 'activate'}
        title={confirm?.action === 'activate' ? 'Activate connection?' : confirm?.action === 'deactivate' ? 'Deactivate connection?' : 'Remove stored credential?'}
        message={confirm?.action === 'activate' ? 'Requires a successful connection test. Active connections can receive real requests from integrations.' : confirm?.action === 'deactivate' ? 'Executions using this connection will fail until it is re-activated.' : 'The connection will be deactivated and requests will fail until a new credential is set.'}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void run(confirm.conn._id, () => (confirm.action === 'remove-secret' ? del(`/api/connections/${confirm.conn._id}/secret`) : post(`/api/connections/${confirm.conn._id}/${confirm.action}`)))} />
    </>
  );
}
