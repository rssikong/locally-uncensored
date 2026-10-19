/**
 * The version of this build, for the whole interface.
 *
 * The one place the interface reads it. Everything that shows, logs or sends
 * the app's version imports it from here, so a release bump has exactly one
 * file to reach on this side (package.json, held equal to tauri.conf.json and
 * Cargo.toml by src/lib/__tests__/eine-versionsquelle.test.ts). The Rust side
 * has its own single source in src-tauri/src/app_identity.rs.
 */
import { version } from '../../package.json'

export const APP_VERSION: string = version
