import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const commitHash = (process.env.VITE_COMMIT_SHA || 'dev').slice(0, 7);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(commitHash),
  },
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4000', ws: true },
    }
  }
});
