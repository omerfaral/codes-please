import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// For `npm run dev`: UI on 5173, API/WS proxied to the server on 4777.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4777',
      '/ws': { target: 'ws://127.0.0.1:4777', ws: true },
    },
  },
});
