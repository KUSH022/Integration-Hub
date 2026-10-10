import { useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { get, post, fmtDate, duration } from '../api/client';
import type { Run } from '../api/types';
import { useAuth } from '../auth';
import { ConfirmDialog, ErrorAlert, FieldErrorsTable, JsonViewer, Loading, PageHeader, StatusChip, useAsync } from '../components/common';

const ACTIVE = ['PENDING', 'RUNNING', 'RETRYING'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>{title}</Typography>
      {children}
    </Paper>
  );
}

/** Renders QA-provided difference rows generically (the QA Agent's schema is configured, not assumed). */
function DiffTable({ rows }: { rows: unknown[] }) {
  const objects = rows.filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
  if (objects.length === 0) return <JsonViewer value={rows} />;
  const cols = Array.from(new Set(objects.flatMap((o) => Object.keys(o)))).slice(0, 8);
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead><TableRow>{cols.map((c) => <TableCell key={c}>{c}</TableCell>)}</TableRow></TableHead>
        <TableBody>{objects.map((o, i) => <TableRow key={i}>{cols.map((c) => <TableCell key={c}>{typeof o[c] === 'object' ? JSON.stringify(o[c]) : String(o[c] ?? '')}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </Box>
  );
}

export default function ExecutionDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => get<{ run: Run }>(`/api/runs/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const run = data?.run;
  const live = run && (ACTIVE.includes(run.transferStatus) || ['PENDING', 'RUNNING'].includes(run.qa.status));

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [live, reload]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(undefined);
    try {
      await fn();
      await reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  if (loading && !run) return <Loading />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!run) return null;

  return (
    <>
      <PageHeader
        title={`Execution ${run._id}`}
        subtitle={`${run.integrationName} (v${run.integrationVersion}) · ${run.entityType} · ${run.destinationApplication}`}
        actions={
          <>
            {live && <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>Auto-refreshing…</Typography>}
            <Button onClick={() => void reload()}>Refresh</Button>
            {can('OPERATOR') && ACTIVE.includes(run.transferStatus) && <Button color="warning" onClick={() => setConfirmCancel(true)}>Cancel</Button>}
          </>
        }
      />
      <ErrorAlert error={actionError} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 2 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><Typography variant="caption" color="text.secondary">Transfer status</Typography><Box><StatusChip status={run.transferStatus} /> {run.httpStatus ? <Typography component="span" variant="body2">HTTP {run.httpStatus}</Typography> : null}</Box></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><Typography variant="caption" color="text.secondary">Destination read-back</Typography><Box><StatusChip status={run.verification?.status} /></Box></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><Typography variant="caption" color="text.secondary">QA validation</Typography><Box><StatusChip status={run.qa.status} /> {run.qa.qaExecutionId && <Typography component="span" variant="body2">QA ID <code>{run.qa.qaExecutionId}</code></Typography>}</Box></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><Typography variant="caption" color="text.secondary">Retries</Typography><Typography variant="body2">{run.retryCount}</Typography></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><Typography variant="caption" color="text.secondary">Correlation ID</Typography><Typography variant="body2"><code>{run.correlationId}</code></Typography></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><Typography variant="caption" color="text.secondary">Source record</Typography><Typography variant="body2">{run.sourceRecordKey ?? '—'} (<code>{run.sourceRecordId}</code>)</Typography></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><Typography variant="caption" color="text.secondary">Destination record ID</Typography><Typography variant="body2">{run.destinationRecordId ?? '—'}</Typography></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><Typography variant="caption" color="text.secondary">Timing</Typography><Typography variant="body2">{fmtDate(run.startedAt ?? run.createdAt)} → {fmtDate(run.endedAt)} ({duration(run.startedAt, run.endedAt)})</Typography></Grid>
            </Grid>
            {run.errorSummary && <Alert severity={run.transferStatus === 'SUCCESS' ? 'warning' : 'error'} sx={{ mt: 2 }}>{run.errorSummary}</Alert>}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Transfer status reflects the destination's response to the request. Read-back and QA statuses are separate, independent checks.
              <RouterLink to={`/integrations/${run.integrationId}`} style={{ marginLeft: 8 }}>Open integration</RouterLink>
            </Typography>
          </Paper>
        </Grid>

        {(run.transformationErrors?.length > 0 || run.validationErrors?.length > 0) && (
          <Grid size={{ xs: 12 }}>
            <Section title="Transformation and validation errors">
              <FieldErrorsTable errors={run.transformationErrors} title="Transformation errors" />
              <FieldErrorsTable errors={run.validationErrors} title="Validation errors" />
            </Section>
          </Grid>
        )}

        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="Original source snapshot (immutable)">
            <Typography variant="caption" color="text.secondary">SHA-256 {run.sourceSnapshotHash}</Typography>
            <JsonViewer value={run.sourceSnapshot} />
          </Section>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="Transformed request snapshot (exactly as sent)">
            {run.requestSnapshot ? (
              <>
                <Typography variant="body2"><code>{run.requestSnapshot.method} {run.requestSnapshot.url}</code></Typography>
                <Typography variant="caption" color="text.secondary">SHA-256 {run.requestSnapshot.hash} · credentials redacted</Typography>
                <JsonViewer value={{ headers: run.requestSnapshot.headers, body: run.requestSnapshot.body }} />
              </>
            ) : <Typography variant="body2" color="text.secondary">No request was built (execution stopped before sending).</Typography>}
          </Section>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="Actual destination response">
            {run.response ? (
              <>
                <Typography variant="body2">HTTP {run.response.httpStatus} · {run.response.durationMs} ms{run.response.truncated ? ' · truncated' : ''}</Typography>
                <JsonViewer value={{ headers: run.response.headers, body: run.response.body }} />
              </>
            ) : <Typography variant="body2" color="text.secondary">No HTTP response was received.</Typography>}
          </Section>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="Attempts and retry history">
            {run.attempts?.length ? (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead><TableRow><TableCell>#</TableCell><TableCell>Started</TableCell><TableCell>Result</TableCell><TableCell>Duration</TableCell><TableCell>Retry decision</TableCell></TableRow></TableHead>
                  <TableBody>{run.attempts.map((a) => (
                    <TableRow key={a.attempt}><TableCell>{a.attempt}</TableCell><TableCell>{fmtDate(a.startedAt)}</TableCell><TableCell>{a.httpStatus ? `HTTP ${a.httpStatus}` : `${a.errorKind}: ${a.message}`}</TableCell><TableCell>{a.durationMs} ms</TableCell><TableCell>{a.retryDecision}</TableCell></TableRow>
                  ))}</TableBody>
                </Table>
              </Box>
            ) : <Typography variant="body2" color="text.secondary">No attempts were made.</Typography>}
          </Section>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="Destination read-back verification">
            <Stack spacing={1}>
              <Box><StatusChip status={run.verification?.status} /></Box>
              <Typography variant="body2">{run.verification?.message}</Typography>
              {run.verification?.url && <Typography variant="body2"><code>GET {run.verification.url}</code> {run.verification.httpStatus ? `→ HTTP ${run.verification.httpStatus}` : ''} · {fmtDate(run.verification.checkedAt)}</Typography>}
              {run.verification?.differences && run.verification.differences.length > 0 && <DiffTable rows={run.verification.differences} />}
            </Stack>
          </Section>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="KP QA Agent validation">
            <Stack spacing={1}>
              <Box><StatusChip status={run.qa.status} /> {run.qa.rawStatus && <Typography component="span" variant="body2">QA Agent status: {run.qa.rawStatus}</Typography>}</Box>
              {run.qa.message && <Typography variant="body2">{run.qa.message}</Typography>}
              <Typography variant="body2">QA execution ID: {run.qa.qaExecutionId ? <code>{run.qa.qaExecutionId}</code> : '—'} · triggered {fmtDate(run.qa.triggeredAt)} · polls {run.qa.pollCount ?? 0} · completed {fmtDate(run.qa.completedAt)}</Typography>
              {Array.isArray(run.qa.differences) && run.qa.differences.length > 0 && (<><Typography variant="subtitle2">Field-level differences reported by KP QA Agent</Typography><DiffTable rows={run.qa.differences} /></>)}
              {run.qa.errorDetails !== undefined && <><Typography variant="subtitle2">Error details</Typography><JsonViewer value={run.qa.errorDetails} maxHeight={200} /></>}
              {run.qa.lastResponse !== undefined && <><Typography variant="subtitle2">Last QA Agent response (redacted)</Typography><JsonViewer value={run.qa.lastResponse} maxHeight={200} /></>}
            </Stack>
          </Section>
        </Grid>
      </Grid>
      <ConfirmDialog open={confirmCancel} busy={busy} danger title="Cancel execution?" confirmLabel="Cancel execution"
        message="Pending executions are cancelled immediately. In-flight executions stop before their next retry; a request already sent cannot be recalled."
        onClose={() => setConfirmCancel(false)} onConfirm={() => void act(() => post(`/api/runs/${run._id}/cancel`))} />
    </>
  );
}
