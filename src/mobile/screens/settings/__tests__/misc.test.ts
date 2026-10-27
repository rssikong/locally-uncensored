/** The small rules of the strand: defaults, voices, notes, session watch, texts. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOBILE_RELEASE_NOTES, mobileReleaseNoteFor } from '../../../strings/release-notes'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { chatModelLabel } from '../../chat/parts/model-name'
import { avatarCrop } from '../parts/avatar'
import { resetAllText } from '../parts/checks'
import { CHAT_DEFAULT_KEYS, RANGES, percentToThreshold, thresholdToPercent } from '../parts/chat-defaults'
import { isTopRoute } from '../parts/go'
import { LICENSES } from '../parts/licenses'
import { LINKS, checkoutUrl } from '../parts/links'
import { remoteBoxText, remoteLine } from '../parts/remote-view'
import { sessionEndedUnasked } from '../parts/services'
import { creditsCopyFor } from '../parts/store-rules'
import { CLOUD_VOICES, DEFAULT_CLOUD_VOICE, pickedCloudVoice, previewFailure } from '../parts/voices'
import { dictationState } from '../parts/voice-state'
import { usableAvatar } from '../parts/UserAvatar'
import { RISK_BY_ID, RISK_BY_PREFIX, riskOf } from '../parts/risk'
import { shouldShowMobileNotes } from '../parts/whats-new'

describe('chat defaults', () => {
  it('turns the stored share into percent and back', () => {
    expect(thresholdToPercent(0.8)).toBe(80)
    expect(thresholdToPercent(0)).toBe(0)
    expect(thresholdToPercent(undefined)).toBe(0)
    expect(thresholdToPercent(2)).toBe(RANGES.compactPercent.max)
    expect(percentToThreshold(80)).toBe(0.8)
    expect(percentToThreshold(0)).toBe(0)
    expect(percentToThreshold(-5)).toBe(0)
    expect(percentToThreshold(400)).toBe(0.95)
  })

  it('resets the five values of the page and nothing else', () => {
    expect([...CHAT_DEFAULT_KEYS].sort()).toEqual(['autoCompactThreshold', 'maxTokens', 'temperature', 'topK', 'topP'])
  })
})

describe('voices', () => {
  it('has the default in the list, and every id once', () => {
    const ids = CLOUD_VOICES.map((v) => v.id)
    expect(ids).toContain(DEFAULT_CLOUD_VOICE)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('falls back to the default for an id it does not know', () => {
    expect(pickedCloudVoice('Calm_Woman')).toBe('Calm_Woman')
    expect(pickedCloudVoice('en_US-lessac-medium')).toBe(DEFAULT_CLOUD_VOICE)
    expect(pickedCloudVoice(undefined)).toBe(DEFAULT_CLOUD_VOICE)
  })

  it('tells an empty wallet from a failed preview', () => {
    expect(previewFailure({ status: 429, code: 'credits_exhausted' }, true)).toBe('no-credits')
    expect(previewFailure({ status: 429 }, true)).toBe('failed')
    expect(previewFailure(new Error('x'), false)).toBe('offline')
  })
})

describe('what is new', () => {
  const current = MOBILE_RELEASE_NOTES[0].version

  it('opens once per version, never during the first steps', () => {
    expect(shouldShowMobileNotes(current, '0.0.1', true)).toBe(true)
    expect(shouldShowMobileNotes(current, current, true)).toBe(false)
    expect(shouldShowMobileNotes(current, '0.0.1', false)).toBe(false)
  })

  it('stays shut for a version nobody wrote notes for', () => {
    expect(shouldShowMobileNotes('0.0.0-none', '0.0.1', true)).toBe(false)
    expect(mobileReleaseNoteFor('0.0.0-none')).toBeUndefined()
  })

  it('has notes without long dashes, desktop words or empty lines', () => {
    for (const note of MOBILE_RELEASE_NOTES) {
      expect(note.items.length).toBeGreaterThan(0)
      for (const item of [note.headline ?? '', ...note.items]) {
        expect(item).not.toMatch(/[\u2013\u2014]/)
        expect(item).not.toMatch(/\bclick|your machine|your computer's|Ollama|LM Studio|ComfyUI/i)
      }
    }
  })
})

describe('session watch', () => {
  it('fires only when a session ended that the user did not end', () => {
    expect(sessionEndedUnasked({ status: 'signed-in' }, { status: 'signed-out' }, false)).toBe(true)
    expect(sessionEndedUnasked({ status: 'signed-in' }, { status: 'signed-out' }, true)).toBe(false)
    expect(sessionEndedUnasked({ status: 'probing' }, { status: 'signed-out' }, false)).toBe(false)
    expect(sessionEndedUnasked({ status: 'signed-in' }, { status: 'signed-in' }, false)).toBe(false)
  })
})

describe('credits sheet', () => {
  it('has a title per cap, and reads an unknown reason as the shared pool', () => {
    expect(creditsCopyFor('credits', 'links').title).toBe("You're out of credits")
    expect(creditsCopyFor('video_budget', 'links').title).toBe("This month's video budget is used up")
    expect(creditsCopyFor('trainings', 'links').title).toBe('Top up to keep training')
    expect(creditsCopyFor(undefined, 'links').reason).toBe('credits')
    expect(creditsCopyFor({ evil: true }, 'links').reason).toBe('credits')
  })
})

describe('remote line', () => {
  it('has a sentence for every state of the link', () => {
    expect(remoteLine('unpaired', '').title).toBe('Not connected')
    expect(remoteLine('unpaired', 'studio.local').title).toBe('Paired with studio.local, not connected')
    expect(remoteLine('connected', 'studio.local').title).toBe('Connected to studio.local')
    expect(remoteLine('offline', 'studio.local').tone).toBe('warn')
    expect(remoteLine('blocked', 'studio.local').tone).toBe('error')
    expect(remoteLine('needs-code', 'studio.local').title).toContain('pairing code')
    expect(remoteLine('connecting', '').title).toBe('Connecting')
  })

  it('N19: every state names its next step, and none repeats the introduction of the page', () => {
    const intro = SETTINGS_STRINGS.remote.intro
    for (const status of ['unpaired', 'connected', 'needs-code', 'offline', 'blocked']) {
      for (const address of ['', '192.168.1.20:11435']) {
        const line = remoteLine(status, address)
        expect(line.text.length, `${status} ${address}`).toBeGreaterThan(0)
        expect(remoteBoxText(line, status, null)).not.toBe(intro)
      }
    }
    const offline = remoteLine('offline', '192.168.1.20:11435')
    expect(remoteBoxText(offline, 'offline', null)).toBe('Check that the computer is on, that LU is open there and that both are on the same Wi-Fi. Then tap Try again.')
    expect(remoteBoxText(offline, 'offline', '10/8/2026')).toMatch(/Then tap Try again\. Last reached 10\/8\/2026\.$/)
    // While it connects the box shows the address, without a stale "last reached".
    expect(remoteBoxText(remoteLine('connecting', 'studio.local'), 'connecting', 'yesterday')).toBe('studio.local')
  })
})

describe('avatar', () => {
  it('cuts the centred square', () => {
    expect(avatarCrop(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 })
    expect(avatarCrop(200, 400)).toEqual({ sx: 0, sy: 100, side: 200 })
    expect(avatarCrop(0, 0).side).toBe(0)
  })
})

describe('links', () => {
  it('opens only https pages', () => {
    for (const url of Object.values(LINKS)) expect(url.startsWith('https://')).toBe(true)
  })

  it('sends a plan to the checkout of the website and says it came from the phone', () => {
    expect(checkoutUrl('hosted-pro')).toBe(`${LINKS.website}/checkout/start?plan=hosted-pro&src=mobile`)
  })
})

describe('licenses', () => {
  it('names each part once', () => {
    const names = LICENSES.map((l) => l.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('llama.cpp')
  })
})

describe('texts of the strand', () => {
  const all: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') all.push(node)
    else if (typeof node === 'function') all.push(String((node as (...a: unknown[]) => unknown)('x', 'y')))
    else if (node && typeof node === 'object') Object.values(node).forEach(walk)
  }
  walk(SETTINGS_STRINGS)

  it('has no long dash, no desktop verb and no desktop program', () => {
    expect(all.length).toBeGreaterThan(300)
    for (const text of all) {
      expect(text, text).not.toMatch(/[\u2013\u2014]/)
      expect(text, text).not.toMatch(/\bclick/i)
      expect(text, text).not.toMatch(/Ollama|LM Studio|ComfyUI|your machine/)
    }
  })
})

describe('isTopRoute', () => {
  const state = { flow: null, flowStack: [], tab: 'settings', stacks: { chat: [{ route: '/chats' }], settings: [{ route: '/settings' }, { route: '/settings/account' }] } }

  it('looks at the top of the active tab', () => {
    expect(isTopRoute(state, '/settings/account')).toBe(true)
    expect(isTopRoute(state, '/settings')).toBe(false)
    expect(isTopRoute({ ...state, tab: 'chat' }, '/settings/account')).toBe(false)
  })

  it('looks at the flow while one runs', () => {
    expect(isTopRoute({ ...state, flow: 'onboarding', flowStack: [{ route: '/welcome' }] }, '/settings/account')).toBe(false)
    expect(isTopRoute({ ...state, flow: 'onboarding', flowStack: [{ route: '/welcome' }] }, '/welcome')).toBe(true)
  })
})

describe('dictationState', () => {
  const ok = { probing: false, signedIn: true, cloudUsable: true, micDenied: false, online: true }

  it('is ready only when nothing stands in the way', () => {
    expect(dictationState(ok)).toBe('ready')
  })

  it('names the first thing to fix, in the order the user can fix it', () => {
    expect(dictationState({ ...ok, probing: true })).toBe('checking')
    expect(dictationState({ ...ok, signedIn: false, cloudUsable: false, micDenied: true, online: false })).toBe('signed-out')
    expect(dictationState({ ...ok, cloudUsable: false, micDenied: true })).toBe('no-plan')
    expect(dictationState({ ...ok, micDenied: true, online: false })).toBe('blocked')
    expect(dictationState({ ...ok, online: false })).toBe('offline')
  })
})

describe('usableAvatar', () => {
  it('draws only a picture this app made: an image data URL', () => {
    expect(usableAvatar('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(usableAvatar('data:image/jpeg;base64,/9j/4AAQ')).toBe('data:image/jpeg;base64,/9j/4AAQ')
    expect(usableAvatar('')).toBeNull()
    expect(usableAvatar(undefined)).toBeNull()
    expect(usableAvatar('https://example.com/a.png')).toBeNull()
    expect(usableAvatar('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(usableAvatar('data:text/html;base64,PGI+')).toBeNull()
  })
})

describe('riskOf: the mark the acceptance frame reads (data-m-risk)', () => {
  it('what deletes for good or signs out is destructive', () => {
    for (const id of ['m-account-signout', 'm-account-delete', 'm-account-delete-go-delete', 'm-settings-data-all-delete', 'm-settings-data-restore-confirm', 'm-settings-provider-delete', 'm-settings-provider-key-delete', 'm-settings-remote-forget-delete', 'm-settings-remote-disconnect', 'm-settings-chat-reset', 'm-settings-troubleshooting-reset', 'm-settings-privacy-ai-withdraw-reset', 'm-settings-appearance-picture-remove']) {
      expect(riskOf(id), id).toBe('destructive')
    }
  })

  it('what sends a mail or leads to deleting the account is destructive (acceptance Android, re-run, N9)', () => {
    for (const id of ['m-account-delete-website', 'm-account-reset-send', 'm-account-reset-again']) expect(riskOf(id), id).toBe('destructive')
    // The ways out of the sheet stay free.
    for (const id of ['m-account-reset-cancel', 'm-account-reset-done']) expect(riskOf(id), id).toBeNull()
  })

  it('what costs money or credits is paid', () => {
    for (const id of ['m-account-buy', 'm-account-manage', 'm-account-pay-invoice', 'm-cloud-plans', 'm-cloud-plan-hosted', 'm-cloud-plan-hosted-max', 'm-cloud-pay-invoice', 'm-credits-plans', 'm-price-plans', 'm-settings-voice-test', 'm-settings-voice-preview-Wise_Woman']) {
      expect(riskOf(id), id).toBe('paid')
    }
  })

  it('the way out of a question, a free check and a plain row carry no mark', () => {
    for (const id of ['m-account-delete-keep', 'm-credits-not-now', 'm-price-close', 'm-cloud-plans-text', 'm-settings-voice-test-system', 'm-settings-troubleshooting-run', 'm-settings-troubleshooting-self-test', 'm-account-refresh', 'm-settings-voice', '', null, undefined]) {
      expect(riskOf(id), String(id)).toBeNull()
    }
  })
})

describe('the mark is written at the control itself, through the risk prop of the kit', () => {
  const dirs = [resolve(__dirname, '..'), resolve(__dirname, '../../../resilience')]
  const sources: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full)
      } else if (name.endsWith('.tsx') && !full.endsWith(join('parts', 'risk.tsx'))) sources.push(readFileSync(full, 'utf8'))
    }
  }
  for (const dir of dirs) walk(dir)
  const all = sources.join('\n')

  it('every control of the list carries its risk next to its test id', () => {
    for (const [id, risk] of Object.entries(RISK_BY_ID)) {
      const asProp = all.includes(`risk="${risk}" testid="${id}"`)
      const asAttribute = all.includes(`data-testid="${id}" data-m-risk="${risk}"`)
      expect(asProp || asAttribute, id).toBe(true)
    }
    for (const [prefix, risk] of RISK_BY_PREFIX) {
      expect(all.includes(`risk="${risk}" testid={\`${prefix}`), prefix).toBe(true)
    }
  })

  it('nothing sets the attribute after the fact any more', () => {
    expect(all).not.toMatch(/RiskMarks|setAttribute\('data-m-risk'/)
  })
})

describe('a tap that had no effect in the sweep (acceptance Android, re-run, W5: N14 and N15)', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')

  it('"Try again" for a desktop that does not answer shows the attempt and says how it ended', () => {
    const page = read('../RemoteSettingsPage.tsx')
    const button = page.slice(page.indexOf('icon={RefreshCw}'), page.indexOf('testid="m-settings-remote-retry"'))
    expect(button).toContain('busy={retrying}')
    expect(button).toContain('onPress={() => void retry()}')
    expect(page).toContain("testid: 'remote-still-offline'")
    expect(SETTINGS_STRINGS.remote.stillOffline('192.0.2.7:8443')).toBe('192.0.2.7:8443 still does not answer')
  })

  it('the photo rows of a remote chat are locked with the reason when there is no chat', () => {
    const sheet = read('../../remote/RemoteAttachSheet.tsx')
    expect(sheet).toContain('const blocked = !chatId ? S.attach.noChat')
    expect(sheet.match(/disabled=\{!!blocked\}\n\s+disabledReason=\{blocked\}/g)?.length).toBe(2)
  })
})

describe('"Reset all settings" (round 12, F13)', () => {
  it('says "You stay signed in" only to someone who is signed in', () => {
    expect(resetAllText(true)).toBe('Every setting goes back to its default. Your chats and models stay. You stay signed in.')
    expect(resetAllText(false)).toBe('Every setting goes back to its default. Your chats and models stay.')
    expect(resetAllText(false)).not.toContain('signed in')
  })

  it('the page asks with that text and no other', () => {
    const page = readFileSync(resolve(__dirname, '..', 'TroubleshootingPage.tsx'), 'utf8')
    expect(page).toContain("text: resetAllText(useCloudAuthStore.getState().status === 'signed-in')")
    expect(page).not.toContain('T.resetText')
  })
})

describe('the price sheet names the model as the chat does (small iPhone, K11)', () => {
  it('a model of this phone by its name, not by its id', () => {
    expect(chatModelLabel([], 'openai::Qwen3.5-2B-Q4_K_M')).toBe('Qwen 3.5 2B')
    const sheet = readFileSync(resolve(__dirname, '..', 'cloud', 'PriceSheet.tsx'), 'utf8')
    expect(sheet).toContain('{chatModelLabel(models, model.name)}')
    expect(sheet).not.toContain("model.name.replace(/^lu-cloud::/, '')")
  })
})
