import { defineConfig } from 'vitest/config';

// Colyseus talks to process.send() when it exists (for pm2), which collides
// with vitest's forked workers, so run in threads.
export default defineConfig({ test: { pool: 'threads' } });
