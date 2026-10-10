import { useMemo, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Grid, Paper, Stack, TextField, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { get } from '../api/client';
import { ErrorAlert, JsonViewer, Loading, PageHeader, useAsync } from '../components/common';

interface Op {
  tags: string[]; summary: string; description?: string; 'x-required-role': string; parameters?: Array<{ name: string; in: string; required: boolean; schema: unknown }>;
  requestBody?: { content: { 'application/json': { schema: unknown; example?: unknown } } };
  responses: Record<string, { description: string; content?: { 'application/json': { schema: unknown; example?: unknown } } }>;
}
interface OpenApi { info: { title: string; version: string; description: string }; paths: Record<string, Record<string, Op>> }

const METHOD_COLOR: Record<string, 'success' | 'primary' | 'warning' | 'error' | 'secondary'> = { get: 'primary', post: 'success', put: 'warning', patch: 'secondary', delete: 'error' };

/** Builds a minimal example object from a JSON schema when no explicit example exists. */
function exampleFrom(schema: unknown, depth = 0): unknown {
  const s = schema as { type?: string | string[]; properties?: Record<string, unknown>; items?: unknown; enum?: unknown[]; default?: unknown; anyOf?: unknown[]; oneOf?: unknown[]; required?: string[] };
  if (!s || depth > 4) return null;
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  if (s.anyOf || s.oneOf) return exampleFrom((s.anyOf ?? s.oneOf)![0], depth + 1);
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === 'object' || s.properties) return Object.fromEntries(Object.entries(s.properties ?? {}).filter(([k]) => !s.required || s.required.includes(k) || depth === 0).map(([k, v]) => [k, exampleFrom(v, depth + 1)]));
  if (t === 'array') return [exampleFrom(s.items, depth + 1)];
  if (t === 'string') return 'string';
  if (t === 'number' || t === 'integer') return 0;
  if (t === 'boolean') return false;
  return null;
}

export default function ApiDocsPage() {
  const { data, error, loading, reload } = useAsync(() => get<OpenApi>('/api/openapi.json'), []);
  const [filter, setFilter] = useState('');
  const ops = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, op })))
      .filter((o) => !filter || `${o.method} ${o.path} ${o.op.summary} ${o.op.tags.join(' ')}`.toLowerCase().includes(filter.toLowerCase()));
  }, [data, filter]);
  const tags = Array.from(new Set(ops.map((o) => o.op.tags[0])));

  const download = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kp-integration-hub-openapi.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader title="API Documentation" subtitle="Generated live from the backend's implemented route registry (OpenAPI 3.1)" actions={<Button onClick={download} disabled={!data}>Download OpenAPI JSON</Button>} />
      <ErrorAlert error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="body2">{data.info.description}</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>Authentication: browser sessions use an HttpOnly cookie; scripts call <code>POST /api/auth/login</code> with <code>issueToken: true</code> and send <code>Authorization: Bearer &lt;token&gt;</code>. Errors use <code>{'{ "error": { "code", "message", "details", "requestId" } }'}</code>.</Typography>
            <TextField size="small" label="Filter endpoints" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ mt: 2, minWidth: 280 }} />
          </Paper>
          {tags.map((tag) => (
            <Box key={tag} sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>{tag}</Typography>
              {ops.filter((o) => o.op.tags[0] === tag).map(({ path, method, op }) => {
                const req = op.requestBody?.content['application/json'];
                const okCode = Object.keys(op.responses).find((c) => c.startsWith('2')) ?? '200';
                const ok = op.responses[okCode]?.content?.['application/json'];
                return (
                  <Accordion key={`${method} ${path}`} disableGutters>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ minWidth: 0 }}>
                        <Chip size="small" label={method.toUpperCase()} color={METHOD_COLOR[method]} sx={{ width: 72 }} />
                        <Typography component="code" sx={{ fontFamily: 'monospace', fontSize: 14, wordBreak: 'break-all' }}>{path}</Typography>
                        <Typography variant="body2" color="text.secondary">{op.summary}</Typography>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-line', mb: 1 }}>{op.description}</Typography>
                      {op.parameters && op.parameters.length > 0 && (
                        <Typography variant="body2" sx={{ mb: 1 }}><strong>Parameters:</strong> {op.parameters.map((p) => `${p.name} (${p.in}${p.required ? ', required' : ''})`).join(', ')}</Typography>
                      )}
                      <Typography variant="body2" sx={{ mb: 1 }}><strong>Responses:</strong> {Object.entries(op.responses).map(([c, r]) => `${c} ${r.description}`).join(' · ')}</Typography>
                      <Grid container spacing={2}>
                        {req && <Grid size={{ xs: 12, md: 6 }}><Typography variant="subtitle2">Request schema</Typography><JsonViewer value={req.schema} maxHeight={260} /><Typography variant="subtitle2" sx={{ mt: 1 }}>Example request</Typography><JsonViewer value={req.example ?? exampleFrom(req.schema)} maxHeight={200} /></Grid>}
                        <Grid size={{ xs: 12, md: req ? 6 : 12 }}><Typography variant="subtitle2">Response schema ({okCode})</Typography><JsonViewer value={ok?.schema ?? {}} maxHeight={260} /><Typography variant="subtitle2" sx={{ mt: 1 }}>Example response</Typography><JsonViewer value={ok?.example ?? exampleFrom(ok?.schema)} maxHeight={200} /></Grid>
                      </Grid>
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          ))}
        </>
      )}
    </>
  );
}
