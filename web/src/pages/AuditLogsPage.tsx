import { useState } from 'react';
import { Box, Button, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import { get, fmtDate } from '../api/client';
import type { Paged } from '../api/types';
import { EmptyState, ErrorAlert, Loading, PageHeader, StatusChip, useAsync } from '../components/common';

interface Audit { _id: string; timestamp: string; action: string; resourceType: string; resourceId: string; result: 'SUCCESS' | 'FAILURE'; actor: { email: string; role?: string }; details: Record<string, unknown> }

const ACTIONS = ['AUTH_LOGIN', 'AUTH_LOGIN_FAILED', 'AUTH_LOGOUT', 'AUTH_PASSWORD_CHANGED', 'USER_CREATED', 'USER_UPDATED', 'INTEGRATION_CREATED', 'INTEGRATION_UPDATED', 'INTEGRATION_ACTIVATED', 'INTEGRATION_DEACTIVATED', 'INTEGRATION_CLONED', 'CONNECTION_CREATED', 'CONNECTION_UPDATED', 'CONNECTION_ACTIVATED', 'CONNECTION_DEACTIVATED', 'CONNECTION_TESTED', 'CREDENTIAL_UPDATED', 'CREDENTIAL_REMOVED', 'SOURCE_SUBMITTED', 'EXECUTION_REQUESTED', 'EXECUTION_STARTED', 'EXECUTION_COMPLETED', 'EXECUTION_FAILED', 'EXECUTION_CANCELLED', 'EXECUTION_RECOVERED', 'QA_TRIGGERED', 'QA_COMPLETED'];

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [applied, setApplied] = useState({ action: '', result: '', resourceId: '' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const { data, error, loading, reload } = useAsync(() => get<Paged<Audit>>('/api/audit-logs', { ...applied, page: page + 1, pageSize }), [applied, page, pageSize]);

  return (
    <>
      <PageHeader title="Audit Logs" subtitle="Security-relevant actions. Credentials and tokens are never logged." />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <TextField size="small" select label="Action" value={action} onChange={(e) => setAction(e.target.value)} sx={{ minWidth: 240 }}><MenuItem value="">All</MenuItem>{ACTIONS.map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}</TextField>
          <TextField size="small" select label="Result" value={result} onChange={(e) => setResult(e.target.value)} sx={{ minWidth: 140 }}><MenuItem value="">All</MenuItem><MenuItem value="SUCCESS">Success</MenuItem><MenuItem value="FAILURE">Failure</MenuItem></TextField>
          <TextField size="small" label="Resource ID" value={resourceId} onChange={(e) => setResourceId(e.target.value.trim())} sx={{ minWidth: 240 }} />
          <Button variant="contained" onClick={() => { setPage(0); setApplied({ action, result, resourceId }); }}>Apply</Button>
        </Stack>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <ErrorAlert error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data && data.total === 0 ? <EmptyState title="No audit entries" /> : data && (
          <>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>Time</TableCell><TableCell>Action</TableCell><TableCell>Result</TableCell><TableCell>Actor</TableCell><TableCell>Resource</TableCell><TableCell>Details</TableCell></TableRow></TableHead>
                <TableBody>
                  {data.items.map((a) => (
                    <TableRow key={a._id} sx={{ verticalAlign: 'top' }}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(a.timestamp)}</TableCell>
                      <TableCell>{a.action}</TableCell>
                      <TableCell><StatusChip status={a.result === 'SUCCESS' ? 'SUCCESS' : 'FAILED'} /></TableCell>
                      <TableCell>{a.actor?.email}{a.actor?.role ? ` (${a.actor.role})` : ''}</TableCell>
                      <TableCell>{a.resourceType} <code>{a.resourceId}</code></TableCell>
                      <TableCell><Typography variant="caption" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{Object.keys(a.details ?? {}).length ? JSON.stringify(a.details) : ''}</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[25, 50, 100]} onPageChange={(_e, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
          </>
        )}
      </Paper>
    </>
  );
}
