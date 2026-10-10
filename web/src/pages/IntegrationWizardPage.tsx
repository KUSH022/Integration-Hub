import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Checkbox, FormControlLabel, Grid, MenuItem, Paper, Stack, Step, StepButton, Stepper, Switch, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { ApiError, get, post, put } from '../api/client';
import type { ConfigIssue, Connection, Integration, IntegrationConfig, Meta, PreviewResult, Template } from '../api/types';
import { useAuth } from '../auth';
import { ErrorAlert, FieldErrorsTable, JsonViewer, KeyValueEditor, Loading, PageHeader, parseNumberList } from '../components/common';
import { MappingEditor, ValidationRulesEditor } from './wizard/MappingEditor';

const STEPS = ['Basic details', 'Source', 'Destination', 'Field mapping', 'Validation rules', 'Execution settings', 'Review and save'];

const EMPTY: IntegrationConfig = {
  name: '', description: '', businessPurpose: '', entityType: 'LOCATION', direction: 'INBOUND_TO_DESTINATION', active: false,
  source: { type: 'MANUAL_JSON', recordIdField: '', sample: null },
  destination: { connectionId: '', endpointPath: '', method: 'POST', headers: {}, timeoutMs: 15000, successStatuses: [200, 201], idempotency: { supported: false }, destinationIdFrom: null, readback: { enabled: false } },
  mappings: [{ sourcePath: '', targetPath: '', transforms: [], required: false, nullHandling: 'KEEP' }],
  validationRules: [],
  duplicateCheck: null,
  execution: { retry: { retryCount: 2, retryDelayMs: 2000, backoff: 'EXPONENTIAL', retryOnStatus: [408, 429, 502, 503, 504] }, batchSize: 100 },
  qa: { enabled: false, comparisonRules: { fields: [], mode: 'EXACT' } },
};

function leafPaths(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? leafPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

/** Strips server-managed fields so an existing integration can be edited as a config. */
function toConfig(i: Integration): IntegrationConfig {
  const { _id, version, createdAt, updatedAt, createdBy, updatedBy, ...cfg } = i as Integration & Record<string, unknown>;
  void _id; void version; void createdAt; void updatedAt; void createdBy; void updatedBy;
  return cfg as IntegrationConfig;
}

export default function IntegrationWizardPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState<IntegrationConfig>(EMPTY);
  const [version, setVersion] = useState<number | undefined>();
  const [sampleText, setSampleText] = useState('');
  const [sampleError, setSampleError] = useState('');
  const [meta, setMeta] = useState<Meta>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadError, setLoadError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewResult>();
  const [previewError, setPreviewError] = useState<unknown>();
  const [issues, setIssues] = useState<ConfigIssue[]>();
  const [saveError, setSaveError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const [guidance, setGuidance] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [m, c] = await Promise.all([get<Meta>('/api/meta'), get<{ items: Connection[] }>('/api/connections')]);
        setMeta(m);
        setConnections(c.items);
        let initial = EMPTY;
        if (id) {
          const r = await get<{ integration: Integration }>(`/api/integrations/${id}`);
          initial = toConfig(r.integration);
          setVersion(r.integration.version);
        } else if (params.get('template')) {
          const t = (await get<{ items: Template[] }>('/api/templates')).items.find((x) => x.key === params.get('template'));
          if (t) {
            initial = { ...t.config, templateKey: t.key };
            setGuidance(t.guidance);
          }
        }
        setCfg(initial);
        setSampleText(initial.source.sample ? JSON.stringify(initial.source.sample, null, 2) : '');
      } catch (e) {
        setLoadError(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, params]);

  const set = <K extends keyof IntegrationConfig>(k: K, v: IntegrationConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const setDest = (patch: Partial<IntegrationConfig['destination']>) => setCfg((c) => ({ ...c, destination: { ...c.destination, ...patch } }));
  const sourceFields = useMemo(() => leafPaths(cfg.source.sample), [cfg.source.sample]);
  const targetFields = useMemo(() => cfg.mappings.map((m) => m.targetPath).filter(Boolean), [cfg.mappings]);
  const destConn = connections.find((c) => c._id === cfg.destination.connectionId);

  const onSampleChange = (text: string) => {
    setSampleText(text);
    if (!text.trim()) {
      setSampleError('');
      setCfg((c) => ({ ...c, source: { ...c.source, sample: null } }));
      return;
    }
    try {
      const v = JSON.parse(text);
      const rec = Array.isArray(v) ? v[0] : v;
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('Sample must be a JSON object (or an array whose first item is an object)');
      setSampleError('');
      setCfg((c) => ({ ...c, source: { ...c.source, sample: rec } }));
    } catch (e) {
      setSampleError((e as Error).message);
    }
  };

  const onSampleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 2_000_000) return setSampleError('Sample file is larger than 2 MB');
    const text = await f.text();
    if (f.name.toLowerCase().endsWith('.csv')) {
      try {
        const r = await post<{ records: Record<string, unknown>[]; parseErrors: Array<{ message: string }> }>('/api/sources/parse', { sourceType: 'CSV_FILE', content: text });
        if (!r.records.length) return setSampleError(r.parseErrors[0]?.message ?? 'No CSV records');
        onSampleChange(JSON.stringify(r.records[0], null, 2));
      } catch (err) {
        setSampleError((err as Error).message);
      }
    } else onSampleChange(text);
  };

  // Live mapping preview (debounced) — uses the backend transformation engine, nothing is sent anywhere.
  useEffect(() => {
    if (!cfg.source.sample || cfg.mappings.every((m) => !m.targetPath)) {
      setPreview(undefined);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const mappings = cfg.mappings.filter((m) => m.targetPath);
        const rules = cfg.validationRules.filter((r) => r.field);
        setPreview(await post<PreviewResult>('/api/integrations/preview', { mappings, validationRules: rules, records: [cfg.source.sample] }));
        setPreviewError(undefined);
      } catch (e) {
        setPreviewError(e);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [cfg.source.sample, cfg.mappings, cfg.validationRules]);

  const validate = async () => {
    setIssues(undefined);
    setSaveError(undefined);
    try {
      const r = await post<{ valid: boolean; issues: ConfigIssue[] }>('/api/integrations/validate', cfg);
      setIssues(r.issues);
      return r.valid;
    } catch (e) {
      setSaveError(e);
      return false;
    }
  };

  useEffect(() => {
    if (step === STEPS.length - 1) void validate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const save = async () => {
    setSaving(true);
    setSaveError(undefined);
    try {
      if (id) {
        await put(`/api/integrations/${id}`, { ...cfg, expectedVersion: version });
        nav(`/integrations/${id}`);
      } else {
        const r = await post<{ integration: Integration }>('/api/integrations', { ...cfg, active: can('ADMIN') ? cfg.active : false });
        nav(`/integrations/${r.integration._id}`);
      }
    } catch (e) {
      setSaveError(e);
      if (e instanceof ApiError && Array.isArray(e.details)) setIssues(e.details as ConfigIssue[]);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (loadError) return <ErrorAlert error={loadError} />;
  if (!can('OPERATOR')) return <Alert severity="warning">You need the OPERATOR role to create or edit integrations.</Alert>;

  const previewPanel = (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>Live payload preview</Typography>
      {!cfg.source.sample ? <Typography variant="body2" color="text.secondary">Add a sample source record in step 2 to preview the transformed payload.</Typography> : (
        <>
          <ErrorAlert error={previewError} />
          {preview?.results[0] && (
            <>
              <Typography variant="caption" color="text.secondary">Source sample</Typography>
              <JsonViewer value={cfg.source.sample} maxHeight={180} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Transformed request body</Typography>
              <JsonViewer value={preview.results[0].output} maxHeight={220} />
              <Box sx={{ mt: 1 }}>
                {preview.results[0].valid ? <Alert severity="success" sx={{ py: 0 }}>Sample passes mapping and validation</Alert> : (
                  <>
                    <FieldErrorsTable errors={preview.results[0].transformationErrors} title="Transformation errors" />
                    <FieldErrorsTable errors={preview.results[0].validationErrors} title="Validation errors" />
                  </>
                )}
              </Box>
            </>
          )}
        </>
      )}
    </Paper>
  );

  return (
    <>
      <PageHeader title={id ? `Edit integration (v${version})` : 'New integration'} subtitle="Configure, preview and validate before saving. Saved changes create a new configuration version." />
      {guidance.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>Template guidance.</strong> Templates are starting points only — they do not prove the destination supports these operations.
          <Box component="ul" sx={{ m: 0, pl: 2 }}>{guidance.map((g) => <li key={g}>{g}</li>)}</Box>
        </Alert>
      )}
      <Paper sx={{ p: 2, mb: 2, overflowX: 'auto' }}>
        <Stepper nonLinear activeStep={step} orientation={wide ? 'horizontal' : 'vertical'} alternativeLabel={wide}>
          {STEPS.map((s, i) => <Step key={s}><StepButton onClick={() => setStep(i)}>{s}</StepButton></Step>)}
        </Stepper>
      </Paper>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: step === 3 || step === 4 ? 7 : 12 }}>
          <Paper sx={{ p: { xs: 2, sm: 3 } }}>
            {step === 0 && (
              <Stack spacing={2} sx={{ maxWidth: 720 }}>
                <TextField label="Integration name" value={cfg.name} onChange={(e) => set('name', e.target.value)} required inputProps={{ maxLength: 100 }} />
                <TextField label="Description" value={cfg.description} onChange={(e) => set('description', e.target.value)} multiline minRows={2} />
                <TextField select label="Entity type" value={cfg.entityType} onChange={(e) => setCfg((c) => ({ ...c, entityType: e.target.value, source: { ...c.source, recordIdField: meta?.entities.find((x) => x.key === e.target.value)?.recordIdField ?? c.source.recordIdField } }))} helperText="Only entities with implemented mapping, validation and test support can be selected.">
                  {meta?.entities.map((e) => <MenuItem key={e.key} value={e.key} disabled={!e.operational}>{e.label}{!e.operational ? ' — planned' : ''}</MenuItem>)}
                </TextField>
                <TextField select label="Direction" value={cfg.direction} disabled helperText="Currently implemented: Hub-managed source records → REST destination (e.g. KP WFM).">
                  <MenuItem value="INBOUND_TO_DESTINATION">Inbound to destination</MenuItem>
                </TextField>
                <TextField label="Business purpose" value={cfg.businessPurpose} onChange={(e) => set('businessPurpose', e.target.value)} multiline minRows={2} />
                <FormControlLabel control={<Switch checked={cfg.active} disabled={!can('ADMIN') || Boolean(id)} onChange={(e) => set('active', e.target.checked)} />} label={id ? 'Use Activate/Deactivate on the integration page' : can('ADMIN') ? 'Activate after saving (requires an active destination connection)' : 'Activation requires the ADMIN role'} />
              </Stack>
            )}

            {step === 1 && (
              <Stack spacing={2} sx={{ maxWidth: 820 }}>
                <TextField select label="Source type" value={cfg.source.type} onChange={(e) => set('source', { ...cfg.source, type: e.target.value as IntegrationConfig['source']['type'] })} helperText="Records are entered, pasted or uploaded on the Source Data page. Scheduled/SFTP/event ingestion is not implemented.">
                  <MenuItem value="MANUAL_JSON">Manually entered JSON records</MenuItem>
                  <MenuItem value="JSON_PAYLOAD">JSON payload input</MenuItem>
                  <MenuItem value="JSON_FILE">JSON file upload</MenuItem>
                  <MenuItem value="CSV_FILE">CSV file upload (values arrive as text)</MenuItem>
                </TextField>
                <TextField label="Source record identifier field" value={cfg.source.recordIdField ?? ''} onChange={(e) => set('source', { ...cfg.source, recordIdField: e.target.value })} helperText="Used to label executions (e.g. locationCode)." />
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="subtitle2">Sample source record</Typography>
                  <Button component="label" size="small">Load from file (.json / .csv)<input hidden type="file" accept=".json,.csv,application/json,text/csv" onChange={onSampleFile} /></Button>
                </Stack>
                <TextField multiline minRows={10} value={sampleText} onChange={(e) => onSampleChange(e.target.value)} error={Boolean(sampleError)} helperText={sampleError || 'Paste one JSON object. It is used for mapping preview only.'} InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }} placeholder='{"locationCode": "KP101", "name": "KP Downtown Store", "region": "North", "active": true}' />
              </Stack>
            )}

            {step === 2 && (
              <Stack spacing={2} sx={{ maxWidth: 880 }}>
                {connections.filter((c) => c.application !== 'KP_QA_AGENT').length === 0 && <Alert severity="warning">No destination connections exist. Create a KP WFM or REST API connection on the Connections page first.</Alert>}
                <TextField select label="Destination connection" value={cfg.destination.connectionId} onChange={(e) => setDest({ connectionId: e.target.value })} required>
                  {connections.filter((c) => c.application !== 'KP_QA_AGENT').map((c) => <MenuItem key={c._id} value={c._id}>{c.name} ({c.application}){c.active ? '' : ' — inactive'}</MenuItem>)}
                </TextField>
                {destConn && (
                  <Alert severity={destConn.active ? 'info' : 'warning'}>
                    <strong>{destConn.application}</strong> · {destConn.baseUrl} · auth: {destConn.authType}{destConn.authType !== 'NONE' ? (destConn.hasSecret ? ' (credential stored server-side)' : ' (credential missing)') : ''} · timeout {destConn.timeoutMs} ms
                    {destConn.healthCheck ? ` · health check ${destConn.healthCheck.path}` : ' · no health check'}
                    {destConn.apiDocsUrl && <> · <a href={destConn.apiDocsUrl} target="_blank" rel="noreferrer noopener">API documentation</a></>}
                  </Alert>
                )}
                {destConn && destConn.operations.length > 0 && (
                  <TextField select label="Documented operation (from the connection's API contract)" value="" onChange={(e) => { const op = destConn.operations.find((o) => o.key === e.target.value); if (op && op.method !== 'GET') setDest({ method: op.method as 'POST', endpointPath: op.path }); }} helperText="Selecting one fills method and path.">
                    {destConn.operations.filter((o) => o.method !== 'GET').map((o) => <MenuItem key={o.key} value={o.key}>{o.label} — {o.method} {o.path}</MenuItem>)}
                  </TextField>
                )}
                {destConn && destConn.operations.length === 0 && <Alert severity="warning">This connection has no documented operations. Enter the endpoint exactly as documented in the destination's API contract — the Hub does not assume any endpoint exists.</Alert>}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField select label="HTTP method" value={cfg.destination.method} onChange={(e) => setDest({ method: e.target.value as 'POST' })} sx={{ width: { sm: 150 } }} helperText="DELETE sends no body">
                    {['POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                  </TextField>
                  <TextField label="Endpoint path" value={cfg.destination.endpointPath} onChange={(e) => setDest({ endpointPath: e.target.value })} fullWidth required helperText="Relative to the base URL. Use {{payload.field}} for path values, e.g. /locations/{{payload.locationId}}" />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField label="Expected success status codes" defaultValue={cfg.destination.successStatuses.join(', ')} onBlur={(e) => setDest({ successStatuses: parseNumberList(e.target.value) })} helperText="Comma-separated, e.g. 200, 201" />
                  <TextField type="number" label="Timeout (ms)" value={cfg.destination.timeoutMs} onChange={(e) => setDest({ timeoutMs: Number(e.target.value) })} inputProps={{ min: 1000, max: 120000 }} />
                </Stack>
                <Typography variant="subtitle2">Additional request headers (non-secret)</Typography>
                <KeyValueEditor value={cfg.destination.headers} onChange={(h) => setDest({ headers: h })} helper="Credentials are never entered here; they are stored encrypted on the connection." />
                <Typography variant="subtitle2" sx={{ pt: 1 }}>Destination record identifier</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField select label="Identifier source" value={cfg.destination.destinationIdFrom?.source ?? ''} onChange={(e) => setDest({ destinationIdFrom: e.target.value ? { source: e.target.value as 'RESPONSE', path: cfg.destination.destinationIdFrom?.path ?? '' } : null })} sx={{ minWidth: 220 }}>
                    <MenuItem value="">Not captured</MenuItem><MenuItem value="RESPONSE">Destination response body</MenuItem><MenuItem value="PAYLOAD">Transformed request field</MenuItem>
                  </TextField>
                  {cfg.destination.destinationIdFrom && <TextField label="Field path" value={cfg.destination.destinationIdFrom.path} onChange={(e) => setDest({ destinationIdFrom: { ...cfg.destination.destinationIdFrom!, path: e.target.value } })} helperText="e.g. id or data.id" />}
                </Stack>
                <Typography variant="subtitle2" sx={{ pt: 1 }}>Read-back verification (separate GET)</Typography>
                <FormControlLabel control={<Switch checked={Boolean(cfg.destination.readback?.enabled)} onChange={(e) => setDest({ readback: { ...(cfg.destination.readback ?? {}), enabled: e.target.checked } })} />} label="Verify persistence by reading the record back" />
                {cfg.destination.readback?.enabled ? (
                  <Stack spacing={2}>
                    <TextField label="Read-back GET path" value={cfg.destination.readback.pathTemplate ?? ''} onChange={(e) => setDest({ readback: { ...cfg.destination.readback!, pathTemplate: e.target.value } })} helperText="As documented by the destination, e.g. /locations/{{destinationId}} or /locations/{{payload.locationId}}" />
                    <TextField label="Record location in response (optional)" value={cfg.destination.readback.responseRecordPath ?? ''} onChange={(e) => setDest({ readback: { ...cfg.destination.readback!, responseRecordPath: e.target.value || undefined } })} helperText="e.g. data — leave empty if the response body is the record" />
                    <TextField label="Fields to compare (comma-separated, empty = all sent fields)" defaultValue={(cfg.destination.readback.compareFields ?? []).join(', ')} onBlur={(e) => setDest({ readback: { ...cfg.destination.readback!, compareFields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} />
                  </Stack>
                ) : <Alert severity="warning">Without a read-back endpoint, executions will state that destination persistence could not be independently verified.</Alert>}
              </Stack>
            )}

            {step === 3 && <MappingEditor mappings={cfg.mappings} onChange={(m) => set('mappings', m)} sourceFields={sourceFields} />}

            {step === 4 && (
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">Rules run against the transformed payload before anything is sent.</Typography>
                <ValidationRulesEditor rules={cfg.validationRules} onChange={(r) => set('validationRules', r)} fields={targetFields} />
                <Typography variant="subtitle2" sx={{ pt: 1 }}>Duplicate check</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField select label="Identifier field" value={cfg.duplicateCheck?.keyField ?? ''} onChange={(e) => set('duplicateCheck', e.target.value ? { keyField: e.target.value, scope: cfg.duplicateCheck?.scope ?? 'BATCH' } : null)} sx={{ minWidth: 220 }} helperText="Only use a field that reliably identifies a record">
                    <MenuItem value="">No duplicate check</MenuItem>{targetFields.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
                  </TextField>
                  {cfg.duplicateCheck && (
                    <TextField select label="Scope" value={cfg.duplicateCheck.scope} onChange={(e) => set('duplicateCheck', { ...cfg.duplicateCheck!, scope: e.target.value as 'BATCH' })} sx={{ minWidth: 260 }}>
                      <MenuItem value="BATCH">Within the same submission</MenuItem><MenuItem value="BATCH_AND_HISTORY">Submission + previous successful transfers</MenuItem>
                    </TextField>
                  )}
                </Stack>
              </Stack>
            )}

            {step === 5 && (
              <Stack spacing={2} sx={{ maxWidth: 820 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField type="number" label="Request timeout (ms)" value={cfg.destination.timeoutMs} onChange={(e) => setDest({ timeoutMs: Number(e.target.value) })} />
                  <TextField type="number" label="Retry count (0–5)" value={cfg.execution.retry.retryCount} onChange={(e) => set('execution', { ...cfg.execution, retry: { ...cfg.execution.retry, retryCount: Math.max(0, Math.min(5, Number(e.target.value))) } })} />
                  <TextField type="number" label="Retry delay (ms)" value={cfg.execution.retry.retryDelayMs} onChange={(e) => set('execution', { ...cfg.execution, retry: { ...cfg.execution.retry, retryDelayMs: Number(e.target.value) } })} />
                  <TextField select label="Backoff" value={cfg.execution.retry.backoff} onChange={(e) => set('execution', { ...cfg.execution, retry: { ...cfg.execution.retry, backoff: e.target.value as 'FIXED' } })}><MenuItem value="FIXED">Fixed</MenuItem><MenuItem value="EXPONENTIAL">Exponential</MenuItem></TextField>
                </Stack>
                <TextField label="Retry on HTTP status" defaultValue={cfg.execution.retry.retryOnStatus.join(', ')} onBlur={(e) => set('execution', { ...cfg.execution, retry: { ...cfg.execution.retry, retryOnStatus: parseNumberList(e.target.value) } })} helperText="POST/PATCH are only retried if not delivered, on 429, or when an idempotency key is supported. Timeouts after delivery are never blindly retried." />
                <TextField type="number" label="Batch size (max records per execution)" value={cfg.execution.batchSize} onChange={(e) => set('execution', { ...cfg.execution, batchSize: Number(e.target.value) })} inputProps={{ min: 1, max: 500 }} />
                <Typography variant="subtitle2">Idempotency key</Typography>
                <FormControlLabel control={<Checkbox checked={cfg.destination.idempotency.supported} onChange={(e) => setDest({ idempotency: { ...cfg.destination.idempotency, supported: e.target.checked } })} />} label="The destination API documents idempotency-key support" />
                {cfg.destination.idempotency.supported && (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField label="Header name" value={cfg.destination.idempotency.headerName ?? ''} onChange={(e) => setDest({ idempotency: { ...cfg.destination.idempotency, headerName: e.target.value } })} helperText="Exactly as documented" />
                    <TextField select label="Key field" value={cfg.destination.idempotency.keyField ?? ''} onChange={(e) => setDest({ idempotency: { ...cfg.destination.idempotency, keyField: e.target.value } })} sx={{ minWidth: 200 }}>{targetFields.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}</TextField>
                  </Stack>
                )}
                <Typography variant="subtitle2" sx={{ pt: 1 }}>Manual QA Agent check after transfer</Typography>
                <FormControlLabel control={<Switch checked={cfg.qa.enabled} onChange={(e) => set('qa', { ...cfg.qa, enabled: e.target.checked })} />} label="Allow manual QA Agent verification after a successful transfer" />
                {cfg.qa.enabled && (
                  <Stack spacing={2}>
                    <Typography variant="body2">The QA Agent runs locally. It fetches a completed run from the Hub only when you click its manual check button. Configure a matching WFM profile in the QA Agent.</Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField label="Fields to compare (comma-separated)" defaultValue={cfg.qa.comparisonRules.fields.join(', ')} onBlur={(e) => set('qa', { ...cfg.qa, comparisonRules: { ...cfg.qa.comparisonRules, fields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} fullWidth />
                      <TextField select label="Comparison" value={cfg.qa.comparisonRules.mode} onChange={(e) => set('qa', { ...cfg.qa, comparisonRules: { ...cfg.qa.comparisonRules, mode: e.target.value as 'EXACT' } })} sx={{ minWidth: 180 }}><MenuItem value="EXACT">Exact</MenuItem><MenuItem value="CASE_INSENSITIVE">Case-insensitive</MenuItem></TextField>
                    </Stack>
                  </Stack>
                )}
              </Stack>
            )}

            {step === 6 && (
              <Stack spacing={2}>
                <ErrorAlert error={saveError} />
                {issues === undefined ? <Loading label="Validating configuration…" /> : issues.length === 0 ? <Alert severity="success">Configuration is valid.</Alert> : (
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead><TableRow><TableCell>Severity</TableCell><TableCell>Field</TableCell><TableCell>Message</TableCell></TableRow></TableHead>
                      <TableBody>{issues.map((i, k) => <TableRow key={k}><TableCell>{i.severity === 'error' ? <Typography color="error" variant="body2">Error</Typography> : <Typography color="warning.main" variant="body2">Warning</Typography>}</TableCell><TableCell><code>{i.field}</code></TableCell><TableCell>{i.message}</TableCell></TableRow>)}</TableBody>
                    </Table>
                  </Box>
                )}
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" gutterBottom>Destination</Typography>
                    <Typography variant="body2">{destConn ? `${destConn.name} — ${destConn.baseUrl}` : 'Not selected'}</Typography>
                    <Typography variant="body2"><code>{cfg.destination.method} {cfg.destination.endpointPath || '(no path)'}</code> · success: {cfg.destination.successStatuses.join(', ')} · timeout {cfg.destination.timeoutMs} ms</Typography>
                    <Typography variant="body2">Read-back: {cfg.destination.readback?.enabled ? cfg.destination.readback.pathTemplate : 'not configured'}</Typography>
                    <Typography variant="body2">Retries: {cfg.execution.retry.retryCount} × {cfg.execution.retry.retryDelayMs} ms ({cfg.execution.retry.backoff}) · batch size {cfg.execution.batchSize}</Typography>
                    <Typography variant="body2">QA validation: {cfg.qa.enabled ? 'enabled' : 'off'}</Typography>
                    <Typography variant="subtitle2" sx={{ mt: 2 }} gutterBottom>Mapping and validation preview</Typography>
                    {previewPanel}
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" gutterBottom>Complete configuration</Typography>
                    <JsonViewer value={cfg} maxHeight={560} />
                  </Grid>
                </Grid>
              </Stack>
            )}
          </Paper>
        </Grid>
        {(step === 3 || step === 4) && <Grid size={{ xs: 12, lg: 5 }}>{previewPanel}</Grid>}
      </Grid>

      <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 2 }}>
        <Button onClick={() => (step === 0 ? nav(-1) : setStep(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</Button>
        {step < STEPS.length - 1 ? <Button variant="contained" onClick={() => setStep(step + 1)}>Next</Button> : (
          <Stack direction="row" spacing={1}>
            <Button onClick={() => void validate()}>Re-validate</Button>
            <Button variant="contained" onClick={() => void save()} disabled={saving || Boolean(issues?.some((i) => i.severity === 'error'))}>{saving ? 'Saving…' : id ? 'Save new version' : 'Save integration'}</Button>
          </Stack>
        )}
      </Stack>
    </>
  );
}
