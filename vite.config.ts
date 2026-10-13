import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// Static build for GitHub Pages: a project site served at /album-margarita/.
export default defineConfig({
  base: '/album-margarita/',
  plugins: [react()],
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', 'lucide-react'],
  },
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
      },
    },
  },
});
