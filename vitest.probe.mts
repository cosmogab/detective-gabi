import { defineConfig } from 'vitest/config'
const root = '/Users/gabi/Desktop/dev/dg-ui'
export default defineConfig({
  resolve: { alias: { '@': root } },
  test: {
    environment: 'node',
    include: ['/private/tmp/claude-501/-Users-gabi-Desktop-dev-detective-gabi/55e04412-9dd5-485a-a987-e42a9f3bbca7/scratchpad/*.probe.ts'],
    testTimeout: 120000,
  },
})
