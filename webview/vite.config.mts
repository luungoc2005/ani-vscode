import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/index.html')
    }
  },
  resolve: {
    alias: {
      '@framework': path.resolve(__dirname, 'src/framework/src')
    }
  },
  server: {
    port: 5174
  }
});


