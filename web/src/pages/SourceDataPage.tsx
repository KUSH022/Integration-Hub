import { useEffect, useState, type ChangeEvent } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell,
  TableHead, TablePagination, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import { get, post, fmtDate } from '../api/client';
import type { Integration, Paged, PreviewResult, RunSummary } from '../api/types';
import { useAuth } from '../auth';
import { EmptyState, ErrorAlert, FieldErrorsTable, JsonViewer, Loading, PageHeader, StatusChip, useAsync } from '../components/common';

type Mode = 'MANUAL_JSON' | 'JSON_PAYLOAD' | 'FILE';
interface ParseResult { count: number; parseErrors: Array<{ line?: number; index?: number; message: string }>; records: Record<string, unknown>[]; preview?: PreviewResult }
interface SourceRow { _id: string; submissionId: string; sourceType: string; fileName?: string; recordIndex: number; recordKey?: string; payload: unknown; payloadHash: string; createdAt: string; createdBy?: string }
const TERMINAL = ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'];

function BatchMonitor({ batchId }: { batchId: string }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await get<Paged<RunSummary>>('/api/runs', { batchId, pageSize: 100 });
        if (stop) return;
        setRuns(r.items);
        setError(undefined);
        const done = r.items.length > 0 && r.items.every((x) => TERMINAL.includes(x.transferStatus) && !['PENDING', 'RUNNING'].includes(x.qa?.status));
        if (!done) timer = setTimeout(poll, 3000);
      } catch (e) {
        if (!stop) {
          setError(e);
          timer = setTimeout(poll, 6000);
        }
      }
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [batchId]);
  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      <Typography variant="subtitle1" fontWeight={600}>Execution status (auto-refreshing)</Typography>
      <Typography variant="caption" color="text.secondary">Batch <code>{batchId}</code> — statuses are read from the Hub database.</Typography>
      <ErrorAlert error={error} />
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Execution</TableCell><TableCell>Record</TableCell><TableCell>Transfer</TableCell><TableCell>HTTP</TableCell><TableCell>Read-back</TableCell><TableCell>QA</TableCell><TableCell>Error</TableCell></TableRow></TableHead>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r._id}>
                <TableCell><RouterLink to={`/executions/${r._id}`}><code>{r._id}</code></RouterLink></TableCell>
                <TableCell>{r.sourceRecordKey ?? '—'}</TableCell>
                <TableCell><StatusChip status={r.transferStatus} /></TableCell>
                <TableCell>{r.httpStatus ?? '—'}</TableCell>
                <TableCell><StatusChip status={r.verification?.status} /></TableCell>
                <TableCell><StatusChip status={r.qa?.status} /></TableCell>
                <TableCell>{r.errorSummary ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  );
}

export default function SourceDataPage() {
  const [params] = useSearchParams();
  const { can } = useAuth();
  const [integrationId, setIntegrationId] = useState(params.get('integration') ?? '');
  const [mode, setMode] = useState<Mode>('MANUAL_JSON');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [fileType, setFileType] = useState<'JSON_FILE' | 'CSV_FILE'>('JSON_FILE');
  const [parsed, setParsed] = useState<ParseResult>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [batchId, setBatchId] = useState<string>();
  const [savedMsg, setSavedMsg] = useState('');
  const [page, setPage] = useState(0);
  const [view, setView] = useState<SourceRow>();

  const ints = useAsync(() => get<Paged<Integration>>('/api/integrations', { pageSize: 100 }), []);
  const history = useAsync(() => get<Paged<SourceRow>>('/api/sources', { page: page + 1, pageSize: 10 }), [page, batchId, savedMsg]);
  const integration = ints.data?.items.find((i) => i._id === integrationId);

  const sourceType = mode === 'FILE' ? fileType : mode;
  const reset = () => { setParsed(undefined); setError(undefined); setAck(false); setSavedMsg(''); };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    reset();
    if (f.size > 4_500_000) return setError(new Error('File is larger than 4.5 MB'));
    setFileName(f.name);
    setFileType(f.name.toLowerCase().endsWith('.csv') ? 'CSV_FILE' : 'JSON_FILE');
    setText(await f.text());
  };

  const validate = async () => {
    reset();
    setBusy(true);
    try {
      setParsed(await post<ParseResult>('/api/sources/parse', { sourceType, content: text, integrationId: integrationId || undefined, fileName }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await post<{ submissionId: string; count: number }>('/api/sources', { sourceType, content: text, integrationId: integrationId || undefined, fileName, recordIdField: integration?.source.recordIdField });
      setSavedMsg(`Stored ${r.count} record(s) as immutable snapshots in submission ${r.submissionId}.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const execute = async (body: Record<string, unknown>) => {
    if (!integrationId) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await post<{ batchId: string; queued: number }>(`/api/integrations/${integrationId}/execute`, body);
      setBatchId(r.batchId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const preview = parsed?.preview;
  const invalid = preview?.invalidCount ?? 0;

  return (
    <>
      <PageHeader title="Source Data" subtitle="Enter, upload and validate source records, then execute an integration" />
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 2 }}>
        <Stack spacing={2}>
          <TextField select label="Integration" value={integrationId} onChange={(e) => { setIntegrationId(e.target.value); reset(); }} helperText="Validation and preview use the integration's mappings and rules.">
            <MenuItem value="">(none — parse only)</MenuItem>
            {ints.data?.items.map((i) => <MenuItem key={i._id} value={i._id}>{i.name} · {i.entityType}{i.active ? '' : ' — inactive'}</MenuItem>)}
          </TextField>
          <Tabs value={mode} onChange={(_e, v) => { setMode(v); reset(); }} variant="scrollable">
            <Tab value="MANUAL_JSON" label="Enter JSON record" /><Tab value="JSON_PAYLOAD" label="JSON payload (array)" /><Tab value="FILE" label="Upload file" />
          </Tabs>
          {mode === 'FILE' ? (
            <Stack spacing={1}>
              <Button component="label" variant="outlined" sx={{ alignSelf: 'flex-start' }}>Choose .json or .csv file<input hidden type="file" accept=".json,.csv,application/json,text/csv" onChange={onFile} /></Button>
              {fileName && <Typography variant="body2">{fileName} ({fileType === 'CSV_FILE' ? 'CSV — header row required; values are text' : 'JSON'})</Typography>}
            </Stack>
          ) : (
            <TextField multiline minRows={8} value={text} onChange={(e) => { setText(e.target.value); reset(); }} InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
              placeholder={mode === 'MANUAL_JSON' ? '{"locationCode": "KP101", "name": "KP Downtown Store", "region": "North", "active": true}' : '[{"locationCode": "KP101", ...}, {"locationCode": "KP102", ...}]'} />
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" onClick={() => void validate()} disabled={busy || !text.trim()}>Validate &amp; preview</Button>
            {can('OPERATOR') && <Button onClick={() => void save()} disabled={busy || !parsed || parsed.count === 0}>Store records only</Button>}
          </Stack>
          <ErrorAlert error={error} />
          {savedMsg && <Alert severity="success">{savedMsg}</Alert>}
        </Stack>
      </Paper>

      {parsed && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>Parsed records: {parsed.count}{preview ? ` · valid ${preview.validCount} · invalid ${preview.invalidCount}` : ''}</Typography>
          {parsed.parseErrors.length > 0 && (
            <Alert severity="warning" sx={{ my: 1 }}>{parsed.parseErrors.map((p, i) => <div key={i}>{p.line ? `Line ${p.line}: ` : p.index !== undefined ? `Record #${p.index + 1}: ` : ''}{p.message}</div>)}</Alert>
          )}
          {!preview && <Typography variant="body2" color="text.secondary">Select an integration to validate records against its mappings and rules.</Typography>}
          {preview && (
            <Box sx={{ overflowX: 'auto', my: 1 }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>#</TableCell><TableCell>Valid</TableCell><TableCell>Errors (field — reason)</TableCell><TableCell>Transformed payload</TableCell></TableRow></TableHead>
                <TableBody>
                  {preview.results.slice(0, 200).map((r) => (
                    <TableRow key={r.index} sx={{ verticalAlign: 'top' }}>
                      <TableCell>{r.index + 1}</TableCell>
                      <TableCell><StatusChip status={r.valid ? 'PASSED' : 'FAILED'} /></TableCell>
                      <TableCell sx={{ minWidth: 280 }}><FieldErrorsTable errors={[...r.transformationErrors, ...r.validationErrors]} />{r.valid && '—'}</TableCell>
                      <TableCell sx={{ minWidth: 260 }}><JsonViewer value={r.output} maxHeight={160} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
          {integration && can('OPERATOR') && preview && (
            <Stack spacing={1} sx={{ mt: 1 }}>
              {!integration.active && <Alert severity="warning">The integration is inactive. Ask an administrator to activate it before executing.</Alert>}
              {parsed.count > integration.execution.batchSize && <Alert severity="warning">{parsed.count} records exceed the integration batch size ({integration.execution.batchSize}).</Alert>}
              {invalid > 0 && <FormControlLabel control={<Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} />} label={`I reviewed the errors — execute only the ${preview.validCount} valid record(s)`} />}
              <Box>
                <Button variant="contained" disabled={busy || !integration.active || preview.validCount === 0 || (invalid > 0 && !ack)} onClick={() => void execute({ records: parsed.records, acknowledgeInvalid: ack })}>
                  Execute {preview.validCount} record(s) → {integration.name}
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary">Records are stored as immutable snapshots, then queued. The request returns immediately; statuses update below.</Typography>
            </Stack>
          )}
        </Paper>
      )}

      {batchId && <BatchMonitor batchId={batchId} />}

      <Paper sx={{ p: 2, mt: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>Previously submitted records</Typography>
        <ErrorAlert error={history.error} onRetry={history.reload} />
        {history.loading && !history.data ? <Loading /> : history.data && history.data.total === 0 ? <EmptyState title="No source records stored yet" /> : history.data && (
          <>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>Record ID</TableCell><TableCell>Submission</TableCell><TableCell>Type</TableCell><TableCell>Identifier</TableCell><TableCell>Submitted</TableCell><TableCell /></TableRow></TableHead>
                <TableBody>
                  {history.data.items.map((s) => (
                    <TableRow key={s._id}>
                      <TableCell><code>{s._id}</code></TableCell>
                      <TableCell><code>{s.submissionId}</code></TableCell>
                      <TableCell>{s.sourceType}{s.fileName ? ` (${s.fileName})` : ''}</TableCell>
                      <TableCell>{s.recordKey ?? '—'}</TableCell>
                      <TableCell>{fmtDate(s.createdAt)} {s.createdBy ? `· ${s.createdBy}` : ''}</TableCell>
                      <TableCell>
                        <Button size="small" onClick={() => setView(s)}>View</Button>
                        {integration?.active && can('OPERATOR') && <Button size="small" onClick={() => void execute({ submissionId: s.submissionId, acknowledgeInvalid: false })}>Execute submission</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <TablePagination component="div" count={history.data.total} page={page} rowsPerPage={10} rowsPerPageOptions={[10]} onPageChange={(_e, p) => setPage(p)} />
          </>
        )}
      </Paper>

      <Dialog open={Boolean(view)} onClose={() => setView(undefined)} maxWidth="md" fullWidth>
        <DialogTitle>Source record {view?._id}</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary">SHA-256: {view?.payloadHash}</Typography>
          <JsonViewer value={view?.payload} maxHeight={500} />
        </DialogContent>
        <DialogActions><Button onClick={() => setView(undefined)}>Close</Button></DialogActions>
      </Dialog>
    </>
  );
}
