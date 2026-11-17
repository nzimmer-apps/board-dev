import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE is set by the GitHub Pages workflow to "/<repo>/". Local dev uses "/".
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
  // Speech-to-text runs in a worker that loads its engine on demand, which needs ES-module workers.
  worker: { format: 'es' },
});
