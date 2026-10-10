import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, /api is proxied to the local backend so the browser uses same-origin cookies.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000', changeOrigin: false } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 1500 },
});
