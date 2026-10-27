/** The developer switches of this page load, read once in bootMobile. */
import type { DevSwitches } from '../platform/detect'

let switches: DevSwitches = { fontScale: null, route: null, os: null, theme: null, devPages: false, skipOnboarding: false, device: null }

export function setDevSwitches(next: DevSwitches): void {
  switches = next
}

export function devSwitches(): DevSwitches {
  return switches
}
