import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@vice/shared'],
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
    fs: {
      allow: ['..'],
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
