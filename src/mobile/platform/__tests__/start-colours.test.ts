/**
 * Round 5, N8, the native half: from the tap on the icon to the finished
 * interface the ground colour never changes. Light in light mode, dark in
 * dark mode.
 *
 * Before the page draws, three native layers are on the screen: the start
 * screen of the system, the window, and the empty web view. Each of them
 * carries the two canvas colours of the phone shell as a literal, because
 * none of them can read a stylesheet. This guard reads every one of those
 * places and holds them to src/mobile/styles/tokens.css, so a new canvas
 * colour cannot be changed in one layer only.
 *
 * What it cannot see is the screen. The steps for the device are in
 * mobile-docs/r5/start.md.
 *
 * Run: npx vitest run src/mobile/platform/__tests__/start-colours.test.ts
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { THEME_EVENT, THEME_KEY } from '../theme'

const root = resolve(__dirname, '../../../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

const RES = 'src-tauri/gen/android/app/src/main/res'
const APPLE = 'src-tauri/gen/apple'
const PLUGIN = 'src-tauri/plugins/lu-native'

/** `--m-canvas` of one block of tokens.css, lower case with the hash. */
function canvasOf(block: 'dark' | 'light'): string {
  const css = read('src/mobile/styles/tokens.css')
  const from = css.indexOf(`/* tokens:${block} */`)
  expect(from, `tokens:${block}`).toBeGreaterThan(-1)
  const match = /--m-canvas:\s*(#[0-9a-fA-F]{6})\s*;/.exec(css.slice(from))
  expect(match, `--m-canvas in tokens:${block}`).not.toBeNull()
  return match![1].toLowerCase()
}

const LIGHT = canvasOf('light')
const DARK = canvasOf('dark')
const bare = (hex: string): string => hex.slice(1).toUpperCase()

/** The colour of one entry of an Xcode colour set, as `#rrggbb`. */
function colourOfEntry(entry: { color: { components: Record<string, string> } }): string {
  const c = entry.color.components
  return `#${[c.red, c.green, c.blue].map((part) => part.replace(/^0x/i, '')).join('')}`.toLowerCase()
}

describe('the two canvas colours', () => {
  it('are what this guard was written for', () => {
    // A changed token is fine. It then has to be changed in every file below.
    expect(LIGHT).toMatch(/^#[0-9a-f]{6}$/)
    expect(DARK).toMatch(/^#[0-9a-f]{6}$/)
    expect(LIGHT).not.toBe(DARK)
  })
})

describe('Android: start screen and window', () => {
  const day = read(`${RES}/values/lu_colors.xml`)
  const night = read(`${RES}/values-night/lu_colors.xml`)

  it('names the two canvas colours once, with the values of the tokens', () => {
    expect(day.toLowerCase()).toContain(`<color name="lu_canvas_light">${LIGHT}</color>`)
    expect(day.toLowerCase()).toContain(`<color name="lu_canvas_dark">${DARK}</color>`)
  })

  it('follows the system: light by day, dark by night, bar symbols to match', () => {
    expect(day).toContain('<color name="lu_splash_background">@color/lu_canvas_light</color>')
    expect(night).toContain('<color name="lu_splash_background">@color/lu_canvas_dark</color>')
    expect(day).toContain('<bool name="lu_light_bars">true</bool>')
    expect(night).toContain('<bool name="lu_light_bars">false</bool>')
  })

  it('both themes take colour and bar symbols from there, no fixed value', () => {
    for (const file of ['values/themes.xml', 'values-v31/themes.xml']) {
      const theme = read(`${RES}/${file}`)
      expect(theme, file).toContain('<item name="android:windowBackground">@color/lu_splash_background</item>')
      expect(theme, file).toContain('<item name="android:windowLightStatusBar">@bool/lu_light_bars</item>')
      expect(theme.replace(/<!--[\s\S]*?-->/g, ''), file).not.toMatch(/#[0-9a-fA-F]{6}|>(true|false)</)
    }
    const v31 = read(`${RES}/values-v31/themes.xml`)
    expect(v31).toContain('<item name="android:windowSplashScreenBackground">@color/lu_splash_background</item>')
    expect(v31).toContain('<item name="android:windowLightNavigationBar">@bool/lu_light_bars</item>')
    // A theme file of its own for the night would be a second place to forget.
    expect(existsSync(resolve(root, `${RES}/values-night/themes.xml`))).toBe(false)
    expect(existsSync(resolve(root, `${RES}/values-night-v31/themes.xml`))).toBe(false)
  })

  it('has the icon of the start screen for both grounds, in every density', () => {
    for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      const onLight = readFileSync(resolve(root, `${RES}/drawable-${density}/lu_splash_icon.png`))
      const onDark = readFileSync(resolve(root, `${RES}/drawable-night-${density}/lu_splash_icon.png`))
      expect(onLight.equals(onDark), density).toBe(false)
    }
  })

  it('the window and the web view take the theme of the app before the first frame', () => {
    const kotlin = read(`${PLUGIN}/android/src/main/java/com/purpledoubled/lunative/StartTheme.kt`)
    expect(kotlin).toContain(`const val CANVAS_LIGHT: Int = 0xFF${bare(LIGHT)}.toInt()`)
    expect(kotlin).toContain(`const val CANVAS_DARK: Int = 0xFF${bare(DARK)}.toInt()`)
    const activity = read('src-tauri/gen/android/app/src/main/java/com/purpledoubled/locallyuncensored/MainActivity.kt')
    // Decided before super.onCreate, so before anything of the activity is drawn.
    expect(activity.indexOf('StartTheme.isDark(this)')).toBeGreaterThan(-1)
    expect(activity.indexOf('StartTheme.isDark(this)')).toBeLessThan(activity.indexOf('super.onCreate('))
    expect(activity).toContain('window.setBackgroundDrawable(ColorDrawable(canvas))')
    expect(activity).toMatch(/override fun onWebViewCreate\(webView: WebView\) \{\s*webView\.setBackgroundColor\(StartTheme\.canvas\(/)
    // A-06 (D3, D4): the system is told about a fixed theme, so its start screen and the bar symbols of that
    // screen have the chosen theme too. Told when the choice is stored, and caught up before anything is drawn.
    expect(kotlin).toContain('manager.setApplicationNightMode(nightMode(pref))')
    expect(kotlin).toContain('if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return')
    expect(kotlin).toMatch(/fun store\(context: Context, pref: String\?\) \{[\s\S]*?tellSystem\(context\)\n {2}\}/)
    expect(activity.indexOf('StartTheme.tellSystem(this)')).toBeGreaterThan(-1)
    expect(activity.indexOf('StartTheme.tellSystem(this)')).toBeLessThan(activity.indexOf('StartTheme.isDark(this)'))
    // A change of uiMode must not create the activity again: that ends the process (MainActivity.onDestroy).
    expect(read('src-tauri/gen/android/app/src/main/AndroidManifest.xml')).toMatch(/android:configChanges="[^"]*\buiMode\b/)
    // No colour of its own next to StartTheme.
    expect(activity).not.toMatch(/0xFF[0-9A-Fa-f]{6}\b/)
    // wry applies a colour from the configuration after the hook above.
    const conf = JSON.parse(read('src-tauri/tauri.android.conf.json'))
    expect(conf.app.windows[0].backgroundColor).toBeUndefined()
  })
})

describe('iOS: launch screen, window and web view', () => {
  it('the colour set of the launch screen has the light canvas and the dark one', () => {
    const set = JSON.parse(read(`${APPLE}/Assets.xcassets/LaunchBackground.colorset/Contents.json`))
    const any = set.colors.filter((entry: { appearances?: unknown }) => !entry.appearances)
    const dark = set.colors.filter(
      (entry: { appearances?: { appearance: string; value: string }[] }) =>
        entry.appearances?.some((a) => a.appearance === 'luminosity' && a.value === 'dark'),
    )
    expect(set.colors).toHaveLength(2)
    expect(any).toHaveLength(1)
    expect(dark).toHaveLength(1)
    expect(colourOfEntry(any[0])).toBe(LIGHT)
    expect(colourOfEntry(dark[0])).toBe(DARK)
  })

  it('the logo has a version for each ground, and every file is there', () => {
    const set = JSON.parse(read(`${APPLE}/Assets.xcassets/LaunchLogo.imageset/Contents.json`))
    const images = set.images as { filename: string; scale: string; appearances?: { value: string }[] }[]
    for (const scale of ['1x', '2x', '3x']) {
      const any = images.filter((image) => image.scale === scale && !image.appearances)
      const dark = images.filter((image) => image.scale === scale && image.appearances?.[0]?.value === 'dark')
      expect(any, scale).toHaveLength(1)
      expect(dark, scale).toHaveLength(1)
      const onLight = readFileSync(resolve(root, `${APPLE}/Assets.xcassets/LaunchLogo.imageset/${any[0].filename}`))
      const onDark = readFileSync(resolve(root, `${APPLE}/Assets.xcassets/LaunchLogo.imageset/${dark[0].filename}`))
      expect(onLight.equals(onDark), scale).toBe(false)
    }
  })

  it('the launch screen uses the colour set and the logo by name', () => {
    const storyboard = read(`${APPLE}/LaunchScreen.storyboard`)
    expect(storyboard).toContain('<color key="backgroundColor" name="LaunchBackground"/>')
    expect(storyboard).toContain('image="LaunchLogo"')
  })

  it('window and web view take the same colour set, with the same two values as a fallback', () => {
    const swift = read(`${PLUGIN}/ios/Sources/StartTheme.swift`)
    expect(swift).toContain(`static let canvasLight = 0x${bare(LIGHT)}`)
    expect(swift).toContain(`static let canvasDark = 0x${bare(DARK)}`)
    expect(swift).toContain('UIColor(named: "LaunchBackground")')
    // The web view, its scroll view, the view around it and the window.
    for (const line of [
      'webview.isOpaque = false',
      'webview.backgroundColor = canvas',
      'webview.scrollView.backgroundColor = canvas',
      'window.backgroundColor = canvas',
      'window.overrideUserInterfaceStyle = style',
    ]) {
      expect(swift, line).toContain(line)
    }
    const plugin = read(`${PLUGIN}/ios/Sources/LuNativePlugin.swift`)
    expect(plugin).toMatch(/override func load\(webview: WKWebView\) \{\s*StartTheme\.apply\(webview: webview\)/)
    expect(plugin).toContain('observe(UIWindow.didBecomeVisibleNotification)')
  })

  it('what wry paints until the plugin has the web view is a canvas colour too', () => {
    const conf = JSON.parse(read('src-tauri/tauri.ios.conf.json'))
    expect(conf.app.windows[0].backgroundColor).toBe(DARK)
  })
})

describe('the page', () => {
  it('starts on the same two colours on a phone', () => {
    const script = read('public/first-paint.js')
    expect(script).toContain(`root.style.background = '${LIGHT}'`)
    expect(script).toContain(`root.style.background = '${DARK}'`)
    const css = read('public/first-paint.css')
    expect(css).toContain(`html.lu-first-light #splash { background: ${LIGHT} !important; }`)
    expect(css).toContain(`html.lu-first-dark #splash { background: ${DARK} !important; }`)
    const theme = read('src/mobile/platform/theme.ts')
    expect(theme).toContain(`root.style.background = resolved === 'dark' ? '${DARK}' : '${LIGHT}'`)
  })

  it('hands the choice of the user to the native side under the key the shell uses', () => {
    const bridge = read('src/lib/lu-native.ts')
    expect(bridge).toContain(`const START_THEME_KEY = '${THEME_KEY}'`)
    expect(bridge).toContain(`const START_THEME_EVENT = '${THEME_EVENT}'`)
    expect(bridge).toContain('window.addEventListener(START_THEME_EVENT, sync)')
    expect(bridge).toContain("await call('set_system_bars', { light: page.light, color: page.color, theme })")
    expect(read('public/first-paint.js')).toContain(`getItem('${THEME_KEY}')`)
  })
})

describe('the script that draws the start screen', () => {
  it('writes the same two colours', () => {
    const script = read('scripts/mobile/release/make_icons.py')
    expect(script).toContain(`CANVAS_LIGHT = "${bare(LIGHT)}"`)
    expect(script).toContain(`CANVAS_DARK = "${bare(DARK)}"`)
  })
})
