import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { localePreload } from './vite-plugin-locale-preload.js';

export default defineConfig({
  plugins: [react(), localePreload()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
