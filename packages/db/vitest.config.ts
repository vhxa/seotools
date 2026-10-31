import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'db', environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 20_000 },
})
