import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { get, patch, post } from '../api/client';
import type { Role, User } from '../api/types';
import { useAuth } from '../auth';
import { ErrorAlert, Loading, PageHeader, StatusChip, useAsync } from '../components/common';

export default function UsersPage() {
  const { user: me, can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => get<{ items: User[] }>('/api/users'), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'VIEWER' as Role });
  const [formError, setFormError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();

  if (!can('ADMIN')) return <Alert severity="warning">Administrator access is required.</Alert>;

  const create = async () => {
    setFormError(undefined);
    try {
      await post('/api/users', form);
      setOpen(false);
      setForm({ email: '', name: '', password: '', role: 'VIEWER' });
      await reload();
    } catch (e) {
      setFormError(e);
    }
  };
  const update = async (id: string, body: Record<string, unknown>) => {
    setActionError(undefined);
    try {
      await patch(`/api/users/${id}`, body);
      await reload();
    } catch (e) {
      setActionError(e);
    }
  };

  return (
    <>
      <PageHeader title="Users" subtitle="Roles: VIEWER (read-only) · OPERATOR (configure and execute integrations) · ADMIN (connections, credentials, activation, users)" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>New user</Button>} />
      <ErrorAlert error={error ?? actionError} onRetry={reload} />
      <Paper sx={{ p: 2 }}>
        {loading && !data ? <Loading /> : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>E-mail</TableCell><TableCell>Name</TableCell><TableCell>Role</TableCell><TableCell>Status</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {data?.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{u.name || '—'}</TableCell>
                    <TableCell>
                      <TextField select size="small" value={u.role} disabled={u.id === me?.id} onChange={(e) => void update(u.id, { role: e.target.value })} sx={{ minWidth: 130 }}>
                        <MenuItem value="VIEWER">VIEWER</MenuItem><MenuItem value="OPERATOR">OPERATOR</MenuItem><MenuItem value="ADMIN">ADMIN</MenuItem>
                      </TextField>
                    </TableCell>
                    <TableCell><StatusChip status={u.active ? 'ACTIVE' : 'INACTIVE'} /></TableCell>
                    <TableCell>{u.id !== me?.id && <Button size="small" onClick={() => void update(u.id, { active: !u.active })}>{u.active ? 'Deactivate' : 'Activate'}</Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New user</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ErrorAlert error={formError} />
            <TextField label="E-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="Initial password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} helperText="At least 12 characters" inputProps={{ autoComplete: 'new-password' }} />
            <TextField select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <MenuItem value="VIEWER">VIEWER</MenuItem><MenuItem value="OPERATOR">OPERATOR</MenuItem><MenuItem value="ADMIN">ADMIN</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="contained" onClick={() => void create()} disabled={!form.email || form.password.length < 12}>Create</Button></DialogActions>
      </Dialog>
    </>
  );
}
