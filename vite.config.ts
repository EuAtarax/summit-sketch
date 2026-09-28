import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/. Override with BASE_PATH for other hosts.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/summit-sketch/',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { main: 'index.html', spike: 'spike.html' },
    },
  },
});
