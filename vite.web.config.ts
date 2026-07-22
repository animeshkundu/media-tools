import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/media-tools/app/',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  build: {
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    outDir: fileURLToPath(new URL('./site/app', import.meta.url)),
  },
});
