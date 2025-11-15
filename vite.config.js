import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: '0.0.0.0', // Listen on all network interfaces (IPv4 and IPv6)
    open: true
  }
});

