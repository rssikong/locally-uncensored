/**
 * Version of the running app, from the one place the build reads it from.
 *
 * The phone packages carry their own version (scripts/mobile/release/
 * version-setzen.sh), which need not be the desktop's. A phone build
 * (VITE_LU_BUILD_TARGET=mobile) gets it as the build constant below, from the
 * same field Tauri turns into versionName and CFBundleShortVersionString, so
 * this page and the package always say the same (src/dev/phone-version.ts).
 *
 * Where the constant is not defined (unit tests, a bundle that was not built
 * as the phone one) the product version (package.json, through lib/app-version.ts) stands in. `typeof`
 * is what makes the missing constant a plain "no" and not an error.
 */
// The desktop's one version source (3.0.8), which reads package.json.
import { APP_VERSION as version } from '../../../../lib/app-version'

declare const __LU_PHONE_VERSION__: string | undefined

export const APP_VERSION: string = typeof __LU_PHONE_VERSION__ === 'string' ? __LU_PHONE_VERSION__ : version
