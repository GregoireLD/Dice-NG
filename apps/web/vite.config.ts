import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: {
    // Rapier is a WASM module — Vite's pre-bundler can't process it
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
