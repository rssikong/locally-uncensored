import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Making the text bigger must not take the app down with it.
 *
 * Measured on the emulator, with nothing running but LU: `settings put system
 * font_scale 1.15` while the app was open ended in
 *
 *   signal 6 (SIGABRT)
 *   Abort message: 'FORTIFY: pthread_mutex_lock called on a destroyed mutex'
 *   #05 libEGL_emulation.so (EGLContext_t::deleteOnce)
 *
 * and the system's "app keeps stopping" dialog. A font size change is not in
 * the activity's configChanges list, so Android destroys and recreates the
 * activity, and the teardown crashed inside the graphics driver. Whose bug
 * that is does not matter here: an activity that is never torn down cannot be
 * torn down badly, and the same recreation happens for display size
 * (`density`) and a right-to-left switch.
 *
 * Measured again after declaring them, one setting at a time: with fontScale
 * and density handled the process id was unchanged across both, and turning
 * on the accessibility "Bold text" setting still killed it with the identical
 * abort, so fontWeightAdjustment is declared as well.
 */

const MANIFEST = readFileSync(
  join(__dirname, '..', '..', '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  'utf-8',
)

describe('the activity survives a system setting change', () => {
  const zeile = MANIFEST.match(/android:configChanges="([^"]+)"/)

  it('declares a configChanges list at all', () => {
    expect(zeile).not.toBeNull()
  })

  for (const wert of [
    'fontScale', 'density', 'fontWeightAdjustment', 'layoutDirection',
    'uiMode', 'orientation', 'screenSize', 'locale', 'mcc', 'mnc',
    // 2026-10-08: the resource-overlay change. The system applies overlays
    // right after the first boot of a device. The activity was recreated in
    // the running process, tao ran the Rust entry point a second time, and the
    // app died (FORTIFY abort, or a wry Timeout panic after 10 s).
    'assetsPaths',
    'touchscreen', 'navigation', 'colorMode', 'grammaticalGender',
  ]) {
    it(`handles ${wert} instead of being restarted for it`, () => {
      expect(zeile![1].split('|')).toContain(wert)
    })
  }

  it('restarts in a fresh process when it is recreated anyway', () => {
    // The net under the list: a change no flag covers must not run the Rust
    // side twice in one process. onDestroy asks for a fresh start and ends
    // the process BEFORE super.onDestroy() tells Rust anything.
    const activity = readFileSync(
      join(process.cwd(), 'src-tauri/gen/android/app/src/main/java/com/purpledoubled/locallyuncensored/MainActivity.kt'),
      'utf8',
    )
    const at = activity.indexOf('override fun onDestroy()')
    expect(at).toBeGreaterThan(-1)
    const body = activity.slice(at)
    const guard = body.indexOf('if (isChangingConfigurations) {')
    const restart = body.indexOf('startActivity(Intent.makeRestartActivityTask(componentName))')
    const kill = body.indexOf('Process.killProcess(Process.myPid())')
    const superCall = body.lastIndexOf('super.onDestroy()')
    expect(guard).toBeGreaterThan(-1)
    expect(restart).toBeGreaterThan(guard)
    expect(kill).toBeGreaterThan(restart)
    expect(superCall).toBeGreaterThan(kill)
  })
})
