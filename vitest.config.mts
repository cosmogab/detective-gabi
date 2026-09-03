import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Mirrors the "@/*" path alias in tsconfig.json so tests import the same way the app does.
  resolve: {
    alias: { '@': root },
  },
  test: {
    environment: 'node',
    // Deliberately wide: no lane owns this file, so adding a test must never require editing it.
    include: ['tests/**/*.test.{ts,tsx}'],
    // The scaffold ships zero tests on purpose. The guardrails are written in T4.
    passWithNoTests: true,
  },
})
