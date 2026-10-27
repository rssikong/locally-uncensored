/**
 * Point 2 of the mobile groundwork: on a phone `pagehide` is an app switch,
 * not the end of the process, so it must not tear the MCP servers down. On a
 * desktop it still does (the orphaned child processes were the reason this
 * module exists).
 *
 * Run: npx vitest run src/api/mcp/__tests__/mobile-keeps-servers-on-pagehide.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standInPage, standOn } from '../../../test-support/devices'

const disconnectAll = vi.hoisted(() => vi.fn(async () => 0))
vi.mock('../external-client', () => ({ disconnectAllExternalServers: disconnectAll }))

import { installMcpShutdown, __resetMcpShutdownForTests } from '../shutdown'

beforeEach(() => { __resetMcpShutdownForTests(); disconnectAll.mockClear() })
afterEach(() => { __resetMcpShutdownForTests(); vi.unstubAllGlobals() })

describe('MCP teardown on pagehide', () => {
  it('phone: an app switch leaves the servers alone', () => {
    standOn('android')
    const page = standInPage()
    installMcpShutdown()
    page.window.dispatchEvent(new Event('pagehide'))
    page.window.dispatchEvent(new Event('beforeunload'))
    expect(disconnectAll).not.toHaveBeenCalled()
  })

  it('desktop: the page going away still sweeps them', () => {
    standOn('windows')
    const page = standInPage()
    installMcpShutdown()
    page.window.dispatchEvent(new Event('pagehide'))
    expect(disconnectAll).toHaveBeenCalledTimes(1)
  })
})
