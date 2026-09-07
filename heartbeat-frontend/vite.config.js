import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  test: {
    // Two runners, split by extension so they can never pick up each other's
    // files: `.test.js` is pure logic under node:test (no dependencies, no
    // DOM), `.test.jsx` is component tests under vitest, which needs jsdom and
    // borrows this config's JSX pipeline. `npm test` runs both.
    include: ['src/**/*.test.jsx'],
    environment: 'jsdom',
    globals: true,
    restoreMocks: true,
  },
})
