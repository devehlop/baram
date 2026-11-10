import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// В разработке запросы к /api уходят на бота, запущенного рядом (npm run dev в корне).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8080' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
