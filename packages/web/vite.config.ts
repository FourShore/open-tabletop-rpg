import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the game server runs separately on :2567 (npm run dev).
// Pack assets are proxied so image paths work the same as in production.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: { '/pack': 'http://localhost:2567', '/save': 'http://localhost:2567', '/tables': 'http://localhost:2567' },
  },
});
