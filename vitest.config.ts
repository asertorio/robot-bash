import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['tests/helpers.ts'], testTimeout: 30000 },
});
