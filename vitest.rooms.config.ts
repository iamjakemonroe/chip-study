import { defineConfig } from 'vitest/config';

// The room server's integration test: `wrangler dev` with mock upstreams (tests/integration).
// Separate from the unit tests (vite.config.ts) because it starts a local Worker and takes about a
// minute: npm run test:rooms
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
