/**
 * Remote over the sealed channel (REMOTE-PROTOKOLL v2, LU 3.0.7), in a
 * browser without Tauri.
 *
 * The page runs as on a phone: a Tauri bridge is there, and the commands
 * remote_sealed_* are answered in the test process by the stand in of the
 * Rust side (src/mobile/remote/__tests__/fakeSealed.ts), which talks to the
 * stand in for the desktop (fakeDesktop.ts with `sealed`). The real
 * cryptography is tested in Rust. What is held here is what the user sees
 * and what goes over the wire: over the internet nothing but the bare status
 * in plain text, pairing over the internet only with the QR code, the
 * comparison code on the Wi-Fi code way, "Confirm on your computer", and
 * unpairing from Settings.
 *
 *   LU_E2E_PORT=5391 LU_E2E_ONLY=remote-sealed npx playwright test --project=mobile --workers=2
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { startFakeDesktop, type FakeDesktop } from '../../src/mobile/remote/__tests__/fakeDesktop'
import { createFakeSealedPhone, type FakeSealedPhone } from '../../src/mobile/remote/__tests__/fakeSealed'
import { deviceFingerprint } from '../../src/mobile/remote/fingerprint'
import { CLOUD_PROBE, measureLayout, openShell, shellUrl, watchErrors } from './support'

const LAN = 'http://192.168.1.20:11435'
const NET = 'https://quiet-river-lamp.trycloudflare.com'
const CODE = '482913'

interface Phone {
  sealed: FakeSealedPhone
  /** Plain calls (remote_client_request) as "METHOD origin+path". */
  plain: string[]
  secrets: Map<string, string>
}

function toDesk(desk: FakeDesktop, url: string): string {
  const u = new URL(url)
  if (u.origin !== LAN && u.origin !== NET) throw new Error('remote_client_request: The desktop could not be reached.')
  return `${desk.url}${u.pathname}${u.search}`
}

/** The phone: secure storage, the plain transport and the sealed commands, all in the test process. */
async function phone(context: BrowserContext, desk: FakeDesktop): Promise<Phone> {
  const sealed = createFakeSealedPhone(async (url, body) => {
    const res = await fetch(toDesk(desk, url), { method: 'POST', body: Buffer.from(body), headers: { 'content-type': 'application/octet-stream' } })
    const headers: Record<string, string> = {}
    const ra = res.headers.get('retry-after')
    if (ra) headers['retry-after'] = ra
    return { status: res.status, body: new Uint8Array(await res.arrayBuffer()), headers }
  })
  const state: Phone = { sealed, plain: [], secrets: new Map() }
  await context.route(CLOUD_PROBE, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))
  await context.exposeFunction('__e2eSecret', (op: string, account: string, value?: string): string | null => {
    if (op === 'set') state.secrets.set(account, String(value ?? ''))
    if (op === 'delete') state.secrets.delete(account)
    return op === 'get' ? (state.secrets.get(account) ?? null) : null
  })
  await context.exposeFunction('__e2ePlain', async (args: { baseUrl: string; path: string; method: string; token: string | null; body: string | null }) => {
    state.plain.push(`${args.method} ${args.baseUrl}${args.path}`)
    const headers: Record<string, string> = {}
    if (args.token) headers.authorization = `Bearer ${args.token}`
    if (args.body != null) headers['content-type'] = 'application/json'
    const answer = await fetch(toDesk(desk, `${args.baseUrl}${args.path}`), { method: args.method, headers, body: args.body ?? undefined })
    return { status: answer.status, body: answer.status === 204 ? '' : await answer.text(), refreshedToken: answer.headers.get('x-lu-refreshed-token'), memoryRevoked: false }
  })
  await context.exposeFunction('__e2eSealed', async (cmd: string, args: Record<string, unknown>) => {
    try {
      return { ok: true, value: await sealed.invoke(cmd, args) }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })
  await context.addInitScript(() => {
    type Hooks = {
      __e2eSecret: (op: string, account: string, value?: string) => Promise<string | null>
      __e2ePlain: (args: Record<string, unknown>) => Promise<unknown>
      __e2eSealed: (cmd: string, args: Record<string, unknown>) => Promise<{ ok: boolean; value?: unknown; error?: string }>
    }
    const hooks = window as unknown as Hooks
    let callbacks = 0
    const invoke = async (command: string, args: Record<string, unknown> = {}): Promise<unknown> => {
      const account = String(args.account ?? '')
      if (command.startsWith('remote_sealed_')) {
        const r = await hooks.__e2eSealed(command, args)
        if (!r.ok) throw r.error
        return r.value
      }
      if (command.endsWith('scan_qr')) {
        const qr = (window as unknown as { __e2eQr?: string }).__e2eQr
        return qr ? { text: qr } : null
      }
      switch (command) {
        case 'secret_set':
          return hooks.__e2eSecret('set', account, String(args.value))
        case 'secret_get':
          return hooks.__e2eSecret('get', account)
        case 'secret_delete':
          return hooks.__e2eSecret('delete', account)
        case 'remote_client_request':
          return hooks.__e2ePlain(args)
        case 'plugin:event|listen':
          return ++callbacks
        default:
          return null
      }
    }
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { configurable: true, value: { unregisterListener: () => undefined } })
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        invoke,
        transformCallback: () => ++callbacks,
        unregisterCallback: () => undefined,
        convertFileSrc: (file: string) => file,
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      },
    })
  })
  return state
}

/** The native scanner of the phone (command scan_qr) reads `text`. */
async function withCamera(page: Page, text: string): Promise<void> {
  await page.addInitScript((qr) => {
    ;(window as unknown as { __e2eQr?: string }).__e2eQr = qr
  }, text)
}

async function withoutScanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true })
  })
}

async function openHome(page: Page): Promise<void> {
  await openShell(page)
  // The shell opens on a new chat: go to the root of the chat tab, as remote.mobile.ts does.
  await page.evaluate(async () => {
    const { nav } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/nav/index.ts`)
    const state = nav.getState()
    if (state.flow || state.tab !== 'chat' || state.stacks.chat.length !== 1) nav.resetTo('chat', [])
  })
  await expect(page.locator('.m-page[data-m-exit]')).toHaveCount(0)
  await page.getByTestId('m-chats-segment-remote').tap()
  await expect(page.getByTestId('m-remote-screen')).toBeVisible()
}

/** Over the internet only the bare status ever went out in plain text. */
function nothingPlainOverTheInternet(p: Phone): void {
  for (const call of p.plain) if (call.includes('trycloudflare.com')) expect(call).toBe(`GET ${NET}/remote-api/status`)
  for (const url of p.sealed.posts) expect(url.endsWith('/remote-api/sealed')).toBe(true)
}

let desk: FakeDesktop

test.beforeEach(async () => {
  desk = await startFakeDesktop({ sealed: true, reply: 'Hello from the desktop model.' })
})
test.afterEach(async () => {
  await desk.stop()
})

test.describe('remote over the sealed channel', () => {
  test('the QR code over the internet: Pair, confirm on the computer, chat, nothing in plain text', async ({ page, context }) => {
    const errors = watchErrors(page)
    const p = await phone(context, desk)
    // The user at the computer answers only after the phone said "Confirm on your computer".
    desk.sealed!.answer = null
    await withCamera(page, desk.sealed!.qrLink({ net: NET }))
    await openHome(page)
    await page.getByTestId('m-remote-scan').tap()
    await expect(page.getByTestId('m-remote-connect-screen')).toBeVisible()
    await expect(page.getByTestId('m-remote-connect-sealed')).toContainText('Pair with Studio PC?')
    await expect(page.getByTestId('m-remote-connect-address')).toHaveCount(0)
    await expect(page.getByTestId('m-remote-connect-insecure')).toHaveCount(0)
    // Scanning paired nothing by itself.
    expect(p.sealed.posts).toEqual([])
    expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })
    await page.getByTestId('m-remote-connect-submit').tap()
    await expect(page.getByTestId('m-remote-connect-confirm')).toContainText('Confirm on your computer')
    await expect(page.getByTestId('m-remote-connect-confirm')).toContainText('Allow this phone in LU on Studio PC')
    // The computer shows a comparison code and the device ID on the QR way too (Desktop f72041dab): so does the phone.
    await expect(page.getByTestId('m-remote-connect-sas')).toHaveAttribute('data-sas', /^\d{6}$/)
    await expect(page.getByTestId('m-remote-connect-fingerprint')).toHaveAttribute('data-fingerprint', deviceFingerprint(p.sealed.deviceId))
    await expect(page.getByTestId('m-remote-connect-fingerprint')).toContainText(`device ID ${deviceFingerprint(p.sealed.deviceId)}`)
    expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })
    desk.sealed!.answer = { allow: true, afterPolls: 1 }
    await expect(page.getByTestId('m-remote-chat-screen')).toBeVisible()
    await page.getByTestId('m-remote-chat-input').fill('hello over the internet')
    await page.getByTestId('m-remote-chat-send').tap()
    await expect(page.getByTestId('m-remote-chat-answer')).toContainText('Hello from the desktop model.')
    await expect(page.getByTestId('m-remote-chat-answer')).toHaveAttribute('data-m-state', 'done')
    nothingPlainOverTheInternet(p)
    expect(p.plain).toEqual([])
    // The desktop saw only the device id the channel proves, never a token.
    expect(desk.sealed!.routed.every((r) => r.device === p.sealed.deviceId && !('authorization' in r.headers))).toBe(true)
    expect(desk.log.filter((l) => l.includes('/remote-api/auth'))).toEqual([])
    // No key of the phone in the page or in the secure storage the webview can read.
    expect([...p.secrets.keys()].filter((k) => k.includes('remote-device'))).toEqual([])
    expect(errors()).toEqual([])
  })

  test('a tunnel address with a code is refused: over the internet only the QR code', async ({ page, context }) => {
    const p = await phone(context, desk)
    desk.statusKeys = false
    await withoutScanner(page)
    await openHome(page)
    await page.getByTestId('m-remote-enter').tap()
    await page.getByTestId('m-remote-connect-address').fill(NET)
    await page.getByTestId('m-remote-connect-passcode').fill(CODE)
    await page.getByTestId('m-remote-connect-submit').tap()
    await expect(page.getByTestId('m-remote-connect-error')).toContainText('pairs with the QR code only')
    nothingPlainOverTheInternet(p)
    expect(p.plain).toEqual([`GET ${NET}/remote-api/status`])
    expect(p.sealed.posts).toEqual([])
    expect(desk.log.filter((l) => l.includes('/remote-api/auth'))).toEqual([])
  })

  test('pairing closed on the computer (H1): "Open pairing", Try again reads the status anew, then the code pairs', async ({ page, context }) => {
    const errors = watchErrors(page)
    const p = await phone(context, desk)
    desk.sealed!.code = CODE
    desk.sealed!.answer = { allow: true, afterPolls: 1 }
    desk.statusKeys = false
    await withoutScanner(page)
    await openHome(page)
    await page.getByTestId('m-remote-enter').tap()
    await page.getByTestId('m-remote-connect-address').fill(LAN)
    await page.getByTestId('m-remote-connect-passcode').fill(CODE)
    await page.getByTestId('m-remote-connect-submit').tap()
    await expect(page.getByTestId('m-remote-connect-error')).toContainText('Open pairing on your computer')
    await expect(page.getByTestId('m-remote-connect-error')).not.toContainText('Update')
    // np20 Fund 2: no "Your desktop answered" under the passcode while the notice asks to open pairing.
    await expect(page.getByText('Your desktop answered')).toHaveCount(0)
    expect(p.sealed.posts).toEqual([])
    expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })
    // Opened at the computer: Try again reads the status and pairs with the code still in the field.
    desk.statusKeys = true
    await page.getByTestId('m-remote-connect-retry').tap()
    await expect(page.getByTestId('m-remote-chat-screen')).toBeVisible()
    expect(desk.log.filter((l) => l.includes('/remote-api/auth'))).toEqual([])
    expect(errors()).toEqual([])
  })

  test('the code on Wi-Fi shows the comparison code of the computer, then the chat opens', async ({ page, context }) => {
    const errors = watchErrors(page)
    await phone(context, desk)
    desk.sealed!.code = CODE
    desk.sealed!.answer = null
    await withoutScanner(page)
    await openHome(page)
    await page.getByTestId('m-remote-enter').tap()
    await page.getByTestId('m-remote-connect-address').fill(LAN)
    await page.getByTestId('m-remote-connect-passcode').fill(CODE)
    await page.getByTestId('m-remote-connect-submit').tap()
    const sas = page.getByTestId('m-remote-connect-sas')
    await expect(sas).toBeVisible()
    const shown = desk.sealed!.shownSas()
    expect(shown).toMatch(/^\d{6}$/)
    await expect(sas).toHaveAttribute('data-sas', shown!)
    await expect(sas).toContainText(`${shown!.slice(0, 3)} ${shown!.slice(3)}`)
    expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })
    desk.sealed!.answer = { allow: true, afterPolls: 1 }
    await expect(page.getByTestId('m-remote-chat-screen')).toBeVisible()
    expect(desk.log.filter((l) => l.includes('/remote-api/auth'))).toEqual([])
    expect(errors()).toEqual([])
  })

  test('Deny on the computer is said clearly', async ({ page, context }) => {
    await phone(context, desk)
    desk.sealed!.answer = { allow: false, afterPolls: 1 }
    await withCamera(page, desk.sealed!.qrLink({ lan: LAN }))
    await openHome(page)
    await page.getByTestId('m-remote-scan').tap()
    await page.getByTestId('m-remote-connect-submit').tap()
    await expect(page.getByTestId('m-remote-connect-error')).toContainText('Pairing was not allowed on your computer')
  })

  test('unpairing in Settings asks the computer first, then forgets the key', async ({ page, context }) => {
    await phone(context, desk)
    await withCamera(page, desk.sealed!.qrLink({ lan: LAN, net: NET }))
    await openHome(page)
    await page.getByTestId('m-remote-scan').tap()
    await page.getByTestId('m-remote-connect-submit').tap()
    await expect(page.getByTestId('m-remote-chat-screen')).toBeVisible()
    expect(desk.sealed!.devices.size).toBe(1)
    await openShell(page, { route: '/settings/remote' })
    await expect(page.getByTestId('m-settings-remote-disconnect')).toContainText('Unpair this phone')
    await page.getByTestId('m-settings-remote-disconnect').tap()
    await expect(page.getByTestId('m-toast-remote-disconnected')).toContainText('no longer knows this phone')
    expect(desk.sealed!.routed.at(-1)?.path).toBe('/remote-api/devices/self/forget')
    expect(desk.sealed!.devices.size).toBe(0)
  })

  test('the App Store package has no remote, unchanged', async ({ page }) => {
    await page.goto(shellUrl({ store: 'appstore' }))
    // The App Store package asks for the age first.
    await page.getByRole('button', { name: 'Yes, I am 18 or older' }).tap()
    await page.getByTestId('m-app').waitFor()
    await expect(page.getByTestId('m-chats-segment-remote')).toHaveCount(0)
  })
})
