import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { useAuth } from '../auth';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Paper sx={{ p: 4, width: '100%', maxWidth: 400 }} component="form" onSubmit={submit} noValidate>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <HubOutlinedIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>KP Integration Hub</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">Sign in to manage integrations between KP WFM and KP QA Agent.</Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" variant="contained" size="large" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        </Stack>
      </Paper>
    </Box>
  );
}
