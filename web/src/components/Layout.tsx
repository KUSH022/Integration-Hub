import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  AppBar, Box, Chip, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Toolbar, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import CableOutlinedIcon from '@mui/icons-material/CableOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import { useAuth } from '../auth';
import type { Role } from '../api/types';

const WIDTH = 248;
const NAV: Array<{ to: string; label: string; icon: ReactNode; role: Role }> = [
  { to: '/', label: 'Dashboard', icon: <DashboardOutlinedIcon />, role: 'VIEWER' },
  { to: '/integrations', label: 'Integrations', icon: <HubOutlinedIcon />, role: 'VIEWER' },
  { to: '/source-data', label: 'Source Data', icon: <StorageOutlinedIcon />, role: 'VIEWER' },
  { to: '/executions', label: 'Execution History', icon: <HistoryOutlinedIcon />, role: 'VIEWER' },
  { to: '/connections', label: 'Connections', icon: <CableOutlinedIcon />, role: 'VIEWER' },
  { to: '/templates', label: 'Templates', icon: <ContentCopyOutlinedIcon />, role: 'VIEWER' },
  { to: '/api-docs', label: 'API Documentation', icon: <MenuBookOutlinedIcon />, role: 'VIEWER' },
  { to: '/audit-logs', label: 'Audit Logs', icon: <ReceiptLongOutlinedIcon />, role: 'OPERATOR' },
  { to: '/users', label: 'Users', icon: <PeopleOutlineIcon />, role: 'ADMIN' },
];

export function Layout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { user, logout, can } = useAuth();
  const loc = useLocation();

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ px: 2 }}>
        <HubOutlinedIcon color="primary" sx={{ mr: 1 }} />
        <Typography variant="subtitle1" fontWeight={700} noWrap>KP Integration Hub</Typography>
      </Toolbar>
      <Divider />
      <List component="nav" aria-label="Main navigation" sx={{ px: 1, py: 1 }}>
        {NAV.filter((n) => can(n.role)).map((n) => {
          const selected = n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to);
          return (
            <ListItemButton key={n.to} component={NavLink} to={n.to} selected={selected} onClick={() => setOpen(false)} sx={{ borderRadius: 1, mb: 0.5 }}>
              <ListItemIcon sx={{ minWidth: 36 }}>{n.icon}</ListItemIcon>
              <ListItemText primary={n.label} primaryTypographyProps={{ fontSize: 14 }} />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', width: { md: `calc(100% - ${WIDTH}px)` }, ml: { md: `${WIDTH}px` } }}>
        <Toolbar>
          {!desktop && (
            <IconButton edge="start" aria-label="Open navigation" onClick={() => setOpen(true)} sx={{ mr: 1 }}><MenuIcon /></IconButton>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {user && <Chip size="small" label={user.role} sx={{ mr: 1 }} />}
          <IconButton aria-label="Account menu" onClick={(e) => setAnchor(e.currentTarget)}><AccountCircleOutlinedIcon /></IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            <MenuItem disabled>{user?.email}</MenuItem>
            <MenuItem onClick={() => { setAnchor(null); void logout(); }}>Sign out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Box component="aside" sx={{ width: { md: WIDTH }, flexShrink: { md: 0 } }}>
        {desktop ? (
          <Drawer variant="permanent" open sx={{ '& .MuiDrawer-paper': { width: WIDTH, boxSizing: 'border-box' } }}>{drawer}</Drawer>
        ) : (
          <Drawer variant="temporary" open={open} onClose={() => setOpen(false)} ModalProps={{ keepMounted: true }} sx={{ '& .MuiDrawer-paper': { width: WIDTH } }}>{drawer}</Drawer>
        )}
      </Box>
      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, sm: 3 }, width: { md: `calc(100% - ${WIDTH}px)` }, minWidth: 0 }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
