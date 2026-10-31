import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['ui/**/*.test.ts', 'crates/**/*.test.ts', 'scripts/**/*.test.ts', 'e2e/**/*.test.ts'] } })
