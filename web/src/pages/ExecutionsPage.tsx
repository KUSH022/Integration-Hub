import { useState } from 'react';
import { Button, MenuItem, Paper, Stack, TextField } from '@mui/material';
import { get } from '../api/client';
import type { Integration, Meta, Paged } from '../api/types';
import { PageHeader, useAsync } from '../components/common';
import { RunsTable } from './IntegrationDetailPage';

const EMPTY = { integrationId: '', entityType: '', transferStatus: '', qaStatus: '', correlationId: '', from: '', to: '' };

export default function ExecutionsPage() {
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const meta = useAsync(() => get<Meta>('/api/meta'), []);
  const ints = useAsync(() => get<Paged<Integration>>('/api/integrations', { pageSize: 100 }), []);
  const set = (k: keyof typeof EMPTY, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <>
      <PageHeader title="Execution History" subtitle="Every execution is persisted in the Hub database with its snapshots, responses and statuses" />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={draft.from} onChange={(e) => set('from', e.target.value)} />
          <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={draft.to} onChange={(e) => set('to', e.target.value)} />
          <TextField size="small" select label="Integration" value={draft.integrationId} onChange={(e) => set('integrationId', e.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">All</MenuItem>{ints.data?.items.map((i) => <MenuItem key={i._id} value={i._id}>{i.name}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Entity" value={draft.entityType} onChange={(e) => set('entityType', e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="">All</MenuItem>{meta.data?.entities.filter((e) => e.operational).map((e) => <MenuItem key={e.key} value={e.key}>{e.label}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Transfer status" value={draft.transferStatus} onChange={(e) => set('transferStatus', e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">All</MenuItem>{meta.data?.transferStatuses.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="QA status" value={draft.qaStatus} onChange={(e) => set('qaStatus', e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">All</MenuItem>{meta.data?.qaStatuses.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Correlation ID" value={draft.correlationId} onChange={(e) => set('correlationId', e.target.value.trim())} sx={{ minWidth: 240 }} />
          <Button variant="contained" onClick={() => setApplied(draft)}>Apply</Button>
          <Button onClick={() => { setDraft(EMPTY); setApplied(EMPTY); }}>Clear</Button>
        </Stack>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <RunsTable query={applied} />
      </Paper>
    </>
  );
}
