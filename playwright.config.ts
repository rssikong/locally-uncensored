import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright harness for the 2.5.7 built-in-engine onboarding (P3b).
 *
 * The suite drives the real React app in a headless browser with the Tauri
 * bridge stubbed (see `e2e/support/tauri-mock.ts`): injecting
 * `window.__TAURI_INTERNALS__` makes `isTauri()` true, so every backend call
 * and the streaming chat proxy route through our in-page invoke router instead
 * of a real Rust sidecar. That lets the fresh-onboarding → first-chat happy
 * path run with zero external processes (no Ollama, no llama-server).
 *
 * We serve the app with `npm run dev` (Vite, port 5273 — the tauri devUrl). The
 * dev middleware only spawns on `/local-api/*` requests, which the mock never
 * triggers, so boot has no side effects.
 */
// Several worktrees on one machine: the fixed port plus reuseExistingServer made
// a run test the dev server of ANOTHER worktree (two red tests on 03.10.2026 that
// pass on their own server). LU_E2E_PORT gives a run its own server on its own
// port, and such a run never adopts a server that is already there.
const ownPort = Number(process.env.LU_E2E_PORT) || 0
const port = ownPort || 5273
const origin = `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: origin,
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // WebKit is the engine of the macOS app (WKWebView). Only the voice
    // session runs on it: its audio path is the part of the app where the two
    // engines really differ. `npx playwright test --project=webkit`.
    { name: 'webkit', testMatch: /voice-(session|cold-start|thinking)-live\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: ownPort ? `npx vite --port ${port} --strictPort` : 'npm run dev',
    url: origin,
    reuseExistingServer: !process.env.CI && !ownPort,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // The suite selects by visible copy (406 `getByText` calls and 1224
    // accessible names). This fork ships a Chinese UI, so the web server is
    // started in English: `src/lib/i18n` answers `en` when VITE_LU_LOCALE is
    // set, and every existing selector keeps working. A spec that wants to
    // assert the Chinese surface sets `locale` in its own context instead.
    env: { VITE_LU_LOCALE: 'en' },
  },
})
