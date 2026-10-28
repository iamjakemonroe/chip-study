import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// The e2e build (--mode e2e) talks to a pretend Supabase the tests answer for, and goes to its
// own folder so it never mixes with the real build.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwind()],
  build: {
    outDir: mode === 'e2e' ? 'dist-e2e' : 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  preview: { port: mode === 'e2e' ? 4317 : 4173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
  },
}));
