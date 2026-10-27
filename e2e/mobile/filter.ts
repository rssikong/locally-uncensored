/**
 * Which files the Playwright project `mobile` runs.
 *
 * Every file that ends in `.mobile.ts`, or, with LU_E2E_ONLY set, only the
 * strands named there:
 *
 *   LU_E2E_ONLY=agent npx playwright test --project=mobile
 *   LU_E2E_ONLY=shell,geruest,store npx playwright test --project=mobile
 *
 * The filter Playwright takes on the command line is matched against the
 * whole path of a file. In a worktree called `s-agent` the word "agent" is
 * in the path of every file, so `playwright test agent` ran all of them.
 * This pattern is tied to the name of the file itself.
 *
 * No import from @playwright/test: playwright.config.ts loads this file, and
 * a unit test does as well (src/mobile/__tests__/e2e-filter.test.ts).
 */
export function mobileTestMatch(only: string | undefined): RegExp {
  const names = (only ?? '')
    .split(',')
    .map((name) => name.trim().replace(/\.mobile(\.ts)?$/, ''))
    .filter((name) => /^[a-z0-9-]+$/i.test(name))
  if (names.length === 0) return /.*\.mobile\.ts$/
  return new RegExp(`(?:^|[\\\\/])(?:${names.join('|')})\\.mobile\\.ts$`)
}
