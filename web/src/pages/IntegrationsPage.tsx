import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Button, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { get, fmtDate } from '../api/client';
import type { Integration, Paged } from '../api/types';
import { useAuth } from '../auth';
import { EmptyState, ErrorAlert, Loading, PageHeader, StatusChip, useAsync } from '../components/common';

export default function IntegrationsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const { data, error, loading, reload } = useAsync(
    () => get<Paged<Integration>>('/api/integrations', { search, entityType, active, page: page + 1, pageSize }),
    [search, entityType, active, page, pageSize],
  );

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Configured data transfers from Hub-managed source records to REST destinations"
        actions={can('OPERATOR') && <Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/integrations/new">New integration</Button>}
      />
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <TextField size="small" label="Search by name" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} sx={{ minWidth: 240 }} />
          <TextField size="small" select label="Entity" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(0); }} sx={{ minWidth: 160 }}>
            <MenuItem value="">All</MenuItem><MenuItem value="LOCATION">Locations</MenuItem><MenuItem value="EMPLOYEE">Employees</MenuItem><MenuItem value="GENERIC">Generic</MenuItem>
          </TextField>
          <TextField size="small" select label="Status" value={active} onChange={(e) => { setActive(e.target.value); setPage(0); }} sx={{ minWidth: 140 }}>
            <MenuItem value="">All</MenuItem><MenuItem value="true">Active</MenuItem><MenuItem value="false">Inactive</MenuItem>
          </TextField>
        </Stack>
        <ErrorAlert error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data && data.total === 0 ? (
          <EmptyState title="No integrations found" description={search || entityType || active ? 'Try clearing the filters.' : 'Create your first integration from scratch or from a template.'} action={can('OPERATOR') ? <Button component={RouterLink} to="/templates">Browse templates</Button> : undefined} />
        ) : data && (
          <>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Entity</TableCell><TableCell>Destination</TableCell><TableCell>QA</TableCell><TableCell>Status</TableCell><TableCell>Version</TableCell><TableCell>Updated</TableCell></TableRow></TableHead>
                <TableBody>
                  {data.items.map((i) => (
                    <TableRow key={i._id} hover sx={{ cursor: 'pointer' }} onClick={() => nav(`/integrations/${i._id}`)}>
                      <TableCell>{i.name}</TableCell>
                      <TableCell>{i.entityType}</TableCell>
                      <TableCell><code>{i.destination?.method} {i.destination?.endpointPath}</code></TableCell>
                      <TableCell>{i.qa?.enabled ? 'Enabled' : 'Off'}</TableCell>
                      <TableCell><StatusChip status={i.active ? 'ACTIVE' : 'INACTIVE'} /></TableCell>
                      <TableCell>v{i.version}</TableCell>
                      <TableCell>{fmtDate(i.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[10, 25, 50, 100]} onPageChange={(_e, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
          </>
        )}
      </Paper>
    </>
  );
}
