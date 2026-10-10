import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert, AlertTitle, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { ApiError } from '../api/client';
import type { FieldError } from '../api/types';

/* ---------- data loading ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await fn();
      if (my === seq.current) {
        setData(d);
        setError(undefined);
      }
    } catch (e) {
      if (my === seq.current) setError(e);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/* ---------- status ---------- */
const COLORS: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  SUCCESS: 'success', PASSED: 'success', VERIFIED: 'success', ACTIVE: 'success',
  FAILED: 'error', ERROR: 'error', TIMEOUT: 'error', MISMATCH: 'error',
  RUNNING: 'info', RETRYING: 'warning', PENDING: 'info',
  CANCELLED: 'default', NOT_REQUESTED: 'default', NOT_STARTED: 'default', NOT_CONFIGURED: 'warning', NOT_APPLICABLE: 'default', INACTIVE: 'default',
};
const LABELS: Record<string, string> = { NOT_CONFIGURED: 'Not verified', NOT_APPLICABLE: 'N/A', NOT_REQUESTED: 'Not requested', NOT_STARTED: 'Not started' };

export function StatusChip({ status, title }: { status?: string | null; title?: string }) {
  if (!status) return <Chip size="small" label="—" variant="outlined" />;
  const chip = <Chip size="small" label={LABELS[status] ?? status} color={COLORS[status] ?? 'default'} variant={COLORS[status] === 'default' ? 'outlined' : 'filled'} />;
  return title ? <Tooltip title={title}>{chip}</Tooltip> : chip;
}

/* ---------- layout pieces ---------- */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2} sx={{ mb: 3 }}>
      <Box>
        <Typography variant="h5" component="h1" fontWeight={600}>{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{actions}</Stack>}
    </Stack>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 6 }} role="status" aria-live="polite">
      <CircularProgress size={28} />
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 6, px: 2, textAlign: 'center' }}>
      <InboxOutlinedIcon color="disabled" sx={{ fontSize: 48 }} />
      <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>
      {description && <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>{description}</Typography>}
      {action}
    </Stack>
  );
}

export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const e = error as ApiError;
  const details = e instanceof ApiError ? e.details : undefined;
  const list = Array.isArray(details) ? (details as Array<{ field?: string; message?: string; severity?: string }>) : [];
  return (
    <Alert severity="error" sx={{ mb: 2 }} action={onRetry ? <Button color="inherit" size="small" onClick={onRetry}>Retry</Button> : undefined}>
      <AlertTitle>{e instanceof ApiError && e.status ? `Error ${e.status}` : 'Error'}</AlertTitle>
      {e?.message ?? String(error)}
      {list.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 1, pl: 2 }}>
          {list.slice(0, 20).map((d, i) => (
            <li key={i}>{d.field ? <strong>{d.field}: </strong> : null}{d.message}{d.severity === 'warning' ? ' (warning)' : ''}</li>
          ))}
        </Box>
      )}
      {e instanceof ApiError && e.requestId && <Typography variant="caption" display="block" sx={{ mt: 1 }}>Request ID: {e.requestId}</Typography>}
    </Alert>
  );
}

export function FieldErrorsTable({ errors, title }: { errors: FieldError[]; title?: string }) {
  if (!errors?.length) return null;
  return (
    <Box sx={{ mb: 2 }}>
      {title && <Typography variant="subtitle2" color="error" gutterBottom>{title}</Typography>}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Field</TableCell><TableCell>Source field</TableCell><TableCell>Code</TableCell><TableCell>Reason</TableCell></TableRow></TableHead>
          <TableBody>
            {errors.map((e, i) => (
              <TableRow key={i}>
                <TableCell><code>{e.field}</code></TableCell>
                <TableCell>{e.sourceField ? <code>{e.sourceField}</code> : '—'}</TableCell>
                <TableCell>{e.code}</TableCell>
                <TableCell>{e.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}

export function JsonViewer({ value, maxHeight = 360, label }: { value: unknown; maxHeight?: number; label?: string }) {
  const text = value === undefined ? '(none)' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <Paper variant="outlined" sx={{ position: 'relative', bgcolor: 'grey.50' }}>
      <Tooltip title="Copy">
        <IconButton size="small" aria-label={`Copy ${label ?? 'JSON'}`} sx={{ position: 'absolute', top: 4, right: 4 }} onClick={() => void navigator.clipboard?.writeText(text)}>
          <ContentCopyIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>
      <Box component="pre" sx={{ m: 0, p: 1.5, pr: 5, fontSize: 12.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto', maxHeight, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text}
      </Box>
    </Paper>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><DialogContentText component="div">{message}</DialogContentText></DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={onConfirm} variant="contained" color={danger ? 'error' : 'primary'} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function KeyValueEditor({ value, onChange, keyLabel = 'Header', valueLabel = 'Value', helper }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; keyLabel?: string; valueLabel?: string; helper?: string }) {
  const entries = Object.entries(value ?? {});
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  return (
    <Box>
      {entries.map(([key, val]) => (
        <Stack key={key} direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <TextField size="small" label={keyLabel} value={key} disabled sx={{ flex: 1 }} />
          <TextField size="small" label={valueLabel} value={val} onChange={(e) => onChange({ ...value, [key]: e.target.value })} sx={{ flex: 2 }} />
          <IconButton aria-label={`Remove ${key}`} onClick={() => { const n = { ...value }; delete n[key]; onChange(n); }}><DeleteOutlineIcon /></IconButton>
        </Stack>
      ))}
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField size="small" label={keyLabel} value={k} onChange={(e) => setK(e.target.value)} sx={{ flex: 1 }} />
        <TextField size="small" label={valueLabel} value={v} onChange={(e) => setV(e.target.value)} sx={{ flex: 2 }} />
        <Button size="small" disabled={!k.trim()} onClick={() => { onChange({ ...value, [k.trim()]: v }); setK(''); setV(''); }}>Add</Button>
      </Stack>
      {helper && <Typography variant="caption" color="text.secondary">{helper}</Typography>}
    </Box>
  );
}

/** Simple stacked bar chart drawn with SVG (no chart library). */
export function TrendChart({ data }: { data: Array<{ day: string } & Record<string, number | string>> }) {
  const series: Array<{ key: string; color: string; label: string }> = [
    { key: 'SUCCESS', color: '#2e7d32', label: 'Success' },
    { key: 'FAILED', color: '#d32f2f', label: 'Failed' },
    { key: 'TIMEOUT', color: '#ef6c00', label: 'Timeout' },
    { key: 'PENDING', color: '#0288d1', label: 'Pending/Running' },
    { key: 'CANCELLED', color: '#9e9e9e', label: 'Cancelled' },
  ];
  const val = (d: Record<string, unknown>, k: string) => (k === 'PENDING' ? Number(d.PENDING ?? 0) + Number(d.RUNNING ?? 0) + Number(d.RETRYING ?? 0) : Number(d[k] ?? 0));
  const totals = data.map((d) => series.reduce((a, s) => a + val(d, s.key), 0));
  const max = Math.max(1, ...totals);
  const W = 640, H = 180, pad = 24, bw = (W - pad * 2) / Math.max(1, data.length);
  return (
    <Box>
      <Box component="svg" viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label="Executions per day by transfer status" sx={{ width: '100%', height: 'auto' }}>
        <line x1={pad} y1={H} x2={W - pad} y2={H} stroke="#ccc" />
        <text x={2} y={12} fontSize="10" fill="#666">{max}</text>
        {data.map((d, i) => {
          let y = H;
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${totals[i]} executions`}</title>
              {series.map((s) => {
                const h = (val(d, s.key) / max) * (H - 16);
                y -= h;
                return h > 0 ? <rect key={s.key} x={pad + i * bw + 2} y={y} width={Math.max(2, bw - 4)} height={h} fill={s.color} /> : null;
              })}
              {(i % Math.ceil(data.length / 7) === 0) && <text x={pad + i * bw + bw / 2} y={H + 16} fontSize="10" textAnchor="middle" fill="#666">{d.day.slice(5)}</text>}
            </g>
          );
        })}
      </Box>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {series.map((s) => (
          <Stack key={s.key} direction="row" spacing={0.5} alignItems="center"><Box sx={{ width: 10, height: 10, bgcolor: s.color, borderRadius: 0.5 }} /><Typography variant="caption">{s.label}</Typography></Stack>
        ))}
      </Stack>
    </Box>
  );
}

/** Parses comma-separated numbers (e.g. "200, 201"). */
export function parseNumberList(s: string): number[] {
  return s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n));
}
