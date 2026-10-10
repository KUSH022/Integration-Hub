import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { get } from '../api/client';
import type { Template } from '../api/types';
import { useAuth } from '../auth';
import { ErrorAlert, JsonViewer, Loading, PageHeader, useAsync } from '../components/common';

export default function TemplatesPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => get<{ items: Template[] }>('/api/templates'), []);
  return (
    <>
      <PageHeader title="Integration Templates" subtitle="Reusable starting configurations with mapping examples and validation rules" />
      <Alert severity="info" sx={{ mb: 2 }}>Templates are starting points, not evidence that a destination supports an operation. You must select a connection and enter the endpoint, method and success codes from the actual API contract before the integration can be saved and executed.</Alert>
      <ErrorAlert error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <Grid container spacing={2}>
          {data?.items.map((t) => (
            <Grid key={t.key} size={{ xs: 12, lg: 4 }}>
              <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Typography variant="subtitle1" fontWeight={600}>{t.name}</Typography>
                <Typography variant="caption" color="text.secondary">Entity: {t.entityType}</Typography>
                <Typography variant="body2" sx={{ my: 1 }}>{t.summary}</Typography>
                <Typography variant="subtitle2">Configuration guidance</Typography>
                <Box component="ul" sx={{ mt: 0.5, pl: 2.5, typography: 'body2' }}>{t.guidance.map((g) => <li key={g}>{g}</li>)}</Box>
                <Typography variant="subtitle2">Mapping example</Typography>
                <Box sx={{ overflowX: 'auto', mb: 1 }}>
                  <Table size="small">
                    <TableHead><TableRow><TableCell>Source</TableCell><TableCell>Destination</TableCell><TableCell>Transformations</TableCell></TableRow></TableHead>
                    <TableBody>{t.config.mappings.map((m, i) => <TableRow key={i}><TableCell><code>{m.sourcePath}</code></TableCell><TableCell><code>{m.targetPath}</code></TableCell><TableCell>{(m.transforms ?? []).map((s) => s.type).join(' → ') || 'Direct'}</TableCell></TableRow>)}</TableBody>
                  </Table>
                </Box>
                <Typography variant="subtitle2">Validation rules</Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>{t.config.validationRules.map((r) => `${r.field}${r.required ? ' (required)' : ''}`).join(', ') || '—'}</Typography>
                <Typography variant="subtitle2">Sample source record</Typography>
                <JsonViewer value={t.sampleSource} maxHeight={160} />
                <Stack direction="row" sx={{ mt: 'auto', pt: 2 }}>
                  {can('OPERATOR') && <Button variant="contained" component={RouterLink} to={`/integrations/new?template=${t.key}`}>Use template</Button>}
                </Stack>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}
    </>
  );
}
