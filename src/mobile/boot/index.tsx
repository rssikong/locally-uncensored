/**
 * Start of the mobile shell. This module is the ONE way into src/mobile:
 * src/main.tsx loads it with a dynamic import when the host is a phone, so
 * nothing below this folder reaches the desktop bundle.
 *
 * No desktop assumptions here: no probing of desktop backends, no second
 * window, no tray, no keyboard shortcuts. What a phone needs from the desktop
 * start (components/layout/AppShell.tsx) was carried over piece by piece:
 * store restore and backup, provider key hydration, the cloud account start,
 * the model list of the built in engine, the mode follow rule.
 *
 * Order, each step bounded so none holds the start for long:
 *  1. mark html as the mobile shell and load the stylesheet
 *  2. platform seams: viewport, keyboard, lifecycle, text scale, safe areas
 *  3. theme before the first frame
 *  4. restore stores if the WebView lost them ("Restoring your chats")
 *  5. provider keys from the keychain, at most 3 s
 *  6. provider slots and Create pinned for a phone
 *  7. the saved navigation stack, then the seams of the logic layer
 *     (lifecycle, share, model slot, storage, cloud jobs) and the links
 *  8. hand <MobileRoot /> to main.tsx
 */
import '../styles/index.css'
import type { ReactNode } from 'react'
import { setDownloadTitleResolver } from '../../api/discover'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { MobileRoot } from '../MobileRoot'
import { installCloudContentGate } from '../../lib/cloud-content-gate'
import { installContentPolicyCap } from '../../lib/content-policy-cap'
import { installNav } from '../nav/api'
import { installDeepLinks, setLinkOfferPreloader, setLinkUnavailableNotice } from '../nav/deeplink'
import { preloadScreen } from '../nav/LazyScreen'
import { sheetLoader } from '../nav/loaders'
import { restoreNav } from '../nav/restore'
import { chatsCutByKill } from '../../lib/interrupted-runs'
import { nativeBridge } from '../platform/bridge'
import { NATIVE_EVENTS } from '../platform/contract'
import { mobileOS, readDevSwitches } from '../platform/detect'
import { applyFontScale } from '../platform/font-scale'
import { startIap } from '../lib/iap'
import { installKeyboard } from '../platform/keyboard'
import { installLifecycle } from '../platform/lifecycle'
import { applyTheme } from '../platform/theme'
import { installSafeAreaOverride, installViewport } from '../platform/viewport'
import { ensureAiConsent, hasAiConsent, syncAiConsentWithDevice } from '../policy/consent'
import { installReports } from '../policy/report'
import { applyDevStorePreset, contentPolicyCapFor, storePolicy } from '../policy/storePolicy'
import { FatalScreen } from '../resilience/FatalScreen'
import { COMMON } from '../strings/common'
import { POLICY } from '../strings/policy'
import { syncNotifyOfferedWithDevice } from '../screens/models/parts/notify'
import { downloadLabel } from '../screens/models/parts/watch'
import { toast } from '../ui/Toast'
import { installFieldInView } from '../ui/field-in-view'
import { installTextZoom } from '../ui/text-zoom'
import { backupStoresSoon, startBackup } from './backup'
import { setDevSwitches } from './dev'
import type { BootInfo } from './info'
import { applyMemoryLearningDefault } from './memory-default'
import { enforceModelPolicy } from './models'
import { enforcePersonaPolicy } from './personas'
import { enforceProviderPolicy, enforceSearchKeyPolicy, pinCreateToCloud, pinMobileProviders } from './providers'
import { runStoreRestore } from './restore'
import { installSettingsDurability, onSettingsChanged, recoverSettingsAtStart, reloadOnceForSettings } from './settings-durable'
import { applyWifiOnlyDefault } from './wifi-default'
import { probeKeychain, wireLogic } from './wiring'
import { moveLegacySearchKeys } from '../../lib/search-keys'
import { ensureWebViewPolyfills } from '../../lib/webview-polyfills'

const KEYCHAIN_BUDGET_MS = 3000
const CHAT_HYDRATION_BUDGET_MS = 1500
/** The marks of open runs are a few bytes in the database of the answers. A database that does not answer must not hold the start. */
const CUT_CHATS_BUDGET_MS = 800

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function saySplash(text: string): void {
  // The loading screen from index.html is still up. Its second child is the label.
  const label = document.querySelector('#splash > div')
  if (label) label.textContent = text
}

async function chatLookup(): Promise<((id: string) => boolean) | undefined> {
  const hydrated = new Promise<void>((resolve) => {
    if (useChatStore.persist.hasHydrated()) resolve()
    else useChatStore.persist.onFinishHydration(() => resolve())
  })
  await Promise.race([hydrated, timeout(CHAT_HYDRATION_BUDGET_MS)])
  if (!useChatStore.persist.hasHydrated()) return undefined
  const ids = new Set(useChatStore.getState().conversations.map((c) => c.id))
  return (id) => ids.has(id)
}

export type { BootInfo } from './info'

export async function bootMobile(): Promise<ReactNode> {
  try {
    // Before anything else of the app runs: shared code (the Cloud client,
    // the agent loop) joins abort signals with a function a web view on the
    // floor does not have (lib/webview-polyfills.ts, src/dev/webview-target.ts).
    ensureWebViewPolyfills()
    const dev = readDevSwitches(undefined, undefined, import.meta.env.DEV)
    setDevSwitches(dev)
    // ?store=play shows a store preset, in a developer build only (policy/storePolicy.ts).
    applyDevStorePreset(location.search, import.meta.env.DEV)
    // The title of the document (index.html, shared with the desktop) carries the long name. A store build has the short one,
    // for whatever reads the title of a web view: a screen reader, a debug list of the system.
    if (!storePolicy().unfilteredMarketing) document.title = 'LU'
    const os = dev.os ?? mobileOS()

    // 1
    const root = document.documentElement
    root.dataset.shell = 'mobile'
    if (os) root.dataset.os = os

    // 2
    installViewport()
    installKeyboard()
    installLifecycle()
    installSafeAreaOverride(NATIVE_EVENTS.safeArea)
    void applyFontScale(dev.fontScale)
    // After the text size: what the WebView enlarges on its own (Android), for the stylesheet.
    installTextZoom()
    // The field with the focus stays in sight when the keyboard opens, on every page and sheet.
    installFieldInView()

    // 3
    applyTheme(dev.theme)
    // The bridge keeps the bars and the window of the system in step with the page from the moment it
    // is loaded (src/lib/lu-native.ts, set_system_bars with the theme). Loaded here by name and not by
    // whoever needs it first: the age question and its closed page stand in front of the shell and
    // must get the same bars as every page behind them (acceptance on the large iPhone, G12).
    void nativeBridge()

    // 4
    const restore = await runStoreRestore(() => saySplash(COMMON.restoring))
    if (restore.kind === 'reloading') {
      // The page is about to reload. Keep the splash, render nothing.
      return null
    }
    // A setting changed right before the app was ended: localStorage may have lost it, the copy has it (settings-durable.ts).
    // Without that copy (IndexedDB dropped after a full phone) the native backup is asked (L5, mobile-docs/r41/funde.md).
    if ((await recoverSettingsAtStart()) === 'recovered' && reloadOnceForSettings()) return null
    installSettingsDurability()
    // A changed setting goes into the native backup within a second (L5).
    onSettingsChanged(backupStoresSoon)
    // The consent and the note of the notification question have a second home in the native layer
    // (policy/decision-vault.ts): a decision localStorage lost at a full phone comes back from there.
    // Not waited for here; the two places that read them wait for it.
    void syncAiConsentWithDevice()
    void syncNotifyOfferedWithDevice()
    if (restore.onboardingMarker && !useSettingsStore.getState().settings.onboardingDone) {
      useSettingsStore.getState().updateSettings({ onboardingDone: true })
    }

    // 5
    // First whether this phone has a vault at all, so the keys are read from the right place.
    await probeKeychain()
    try {
      await Promise.race([useProviderStore.getState().hydrateProviderKeys(), timeout(KEYCHAIN_BUDGET_MS)])
    } catch {
      /* keychain hydration is best effort */
    }

    // 6
    pinMobileProviders()
    enforceProviderPolicy()
    enforceSearchKeyPolicy()
    // A phone keeps web search keys in the keychain, never in the settings
    // blob (lib/search-keys.ts). A plain key can still be there: an older
    // mobile build wrote one, or a backup from a desktop brought one. It moves
    // once, right after the store is read (was in settingsStore's rehydrate
    // until 3.0.8, which made a circle with api/backend).
    void moveLegacySearchKeys().catch(() => {})
    enforcePersonaPolicy()
    enforceModelPolicy()
    // A fresh install on a phone starts with "Learn from chats" off (boot/memory-default.ts).
    void applyMemoryLearningDefault({ skipOnboarding: dev.skipOnboarding }).catch(() => {})
    // And with "Download on Wi-Fi only" on (boot/wifi-default.ts).
    applyWifiOnlyDefault({ skipOnboarding: dev.skipOnboarding })
    pinCreateToCloud()
    // The notification of a download carries the name the pages show, not the file name.
    setDownloadTitleResolver(downloadLabel)
    startBackup()

    // 7
    installNav()
    restoreNav({
      onboardingDone: useSettingsStore.getState().settings.onboardingDone || dev.skipOnboarding,
      devPages: dev.devPages,
      devRoute: dev.route,
      chatExists: await chatLookup(),
      // Asked before wireLogic: the recovery there labels the answers and clears the ledger this reads.
      cutChats: await Promise.race<string[]>([chatsCutByKill().catch(() => []), timeout(CUT_CHATS_BUDGET_MS).then(() => [])]),
    })
    // 7b: the seams of the logic layer, once (boot/wiring.ts). Before the
    // links, so a sign in that comes back with the start link finds its hub.
    wireLogic({ device: dev.device })
    setLinkOfferPreloader(async () => {
      const load = sheetLoader('link-offer')
      if (load) await preloadScreen(load)
    })
    setLinkUnavailableNotice(() => toast(POLICY.unavailableRemote, { testid: 'unavailable-remote' }))
    installDeepLinks()
    // Reports that wait on the phone are sent when there is a place to send them.
    installReports()
    // Round 17, store switch purchase 'in-app' (iOS, in no preset): a purchase of credits whose credit did not arrive
    // in an earlier run is handed in again. Returns at its first line in a build that does not offer the purchase.
    startIap(() => toast(POLICY.iapCredited, { testid: 'iap-credited' }))
    // Dictation, read-aloud and the memory sync ask the same consent as a chat send (M1).
    installCloudContentGate({ has: hasAiConsent, ensure: ensureAiConsent })
    // A build that must not offer "Off" caps the content policy of the account as well (M6).
    installContentPolicyCap(() => contentPolicyCapFor(storePolicy().contentLevels))

    // 7c: the hook of the acceptance build (mobile-tests/). The constant is
    // replaced when the app is built, so a store build has neither the object
    // nor the file behind it.
    if (import.meta.env.VITE_LU_ABNAHME === '1') {
      const { applySavedTestPreset, installTestHook } = await import('../dev/test-hook')
      applySavedTestPreset()
      installTestHook()
    }

    // 8
    const info: BootInfo = { restoreFailed: restore.kind === 'failed', edgeSwipe: os === 'ios' }
    return <MobileRoot boot={info} />
  } catch (error) {
    document.documentElement.dataset.shell = 'mobile'
    return <FatalScreen error={error} />
  }
}
