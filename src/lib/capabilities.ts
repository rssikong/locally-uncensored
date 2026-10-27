// What this device can do, asked by capability instead of by platform.
//
// The desktop app grew up asking "is this a Mac?" wherever it meant "is there
// ComfyUI here?" or "is there MLX here?". That was harmless with three desktop
// systems and wrong the moment a phone arrived: an iPhone used to answer yes to
// the Mac question, an Android phone answered no to every question and so fell
// into the ComfyUI branch. Each predicate below names the thing that is
// actually being asked about.
//
// Rule for every predicate: on a desktop the answer is exactly what the old
// platform check gave, so no desktop code path moves. On a phone or tablet the
// answer is "this does not exist here".
//
// The phone question comes from lib/device-kind.ts (a leaf), the desktop
// questions from api/backend.ts as before. No store is imported, so anything
// may import this module.

import { isLinux, isMacOS } from '../api/backend'
import { isAndroid, isIOS, isMobile } from './device-kind'

/** A local ComfyUI can exist on this device. Desktop: everywhere but the Mac,
 *  where local media is MLX only. Never on a phone. */
export function hasComfy(): boolean {
  return !isMobile() && !isMacOS()
}

/** The Apple MLX image and video runtime can exist here. Mac only. An iPhone
 *  has the same chip family but none of the commands. */
export function hasMlx(): boolean {
  return !isMobile() && isMacOS()
}

/** There is a shell the agent may run commands in, with processes, git and a
 *  screen to capture. */
export function hasShell(): boolean {
  return !isMobile()
}

/** Computer control can exist here: a screen to read, a mouse and a keyboard
 *  to move, and the Rust commands that do it. They are registered on a
 *  desktop only (src-tauri/src/lib.rs). */
export function hasComputerControl(): boolean {
  return !isMobile()
}

/** The host answers a save or open dialog. On a phone the Rust commands reply
 *  "This device has no file dialog"; saving goes through the share sheet. */
export function hasFileDialog(): boolean {
  return !isMobile()
}

/** Set by the shell once the native side reports a working secret store on a
 *  phone (Android Keystore, iOS Keychain). Until then a phone has none. */
let mobileKeychainReady = false

/** Seam for the mobile shell: call with true after Rust confirmed that
 *  `secret_get` and `secret_set` work on this phone. No effect on a desktop. */
export function setMobileKeychainAvailable(ready: boolean): void {
  mobileKeychainReady = ready
}

/** The OS secret store is worth asking. Desktop: yes, as before. Phone: only
 *  after the native side said so. */
export function hasKeychain(): boolean {
  return isMobile() ? mobileKeychainReady : true
}

/** Local speech (faster-whisper, Piper) can exist here. They are Python
 *  processes; a phone has neither. */
export function hasLocalVoice(): boolean {
  return !isMobile()
}

/** Other people's local servers (Ollama, LM Studio and the rest of the
 *  loopback ladder) can exist here and are worth probing. */
export function hasForeignBackends(): boolean {
  return !isMobile()
}

/** The device holds one local model at a time. The desktop runs the chat
 *  server and the embedding server side by side; a phone has the memory for
 *  one, so whoever loads a second model has to be asked for first. */
export function singleModelSlot(): boolean {
  return isMobile()
}

/** Two spellings of a path that differ only in case are the same folder.
 *  Mirrors Rust's `!cfg!(target_os = "linux")` on the desktop. Android is
 *  case sensitive like Linux, but does not report itself as Linux here. */
export function pathsFoldCase(): boolean {
  return !isLinux() && !isAndroid()
}

/** The keyboard's app modifier is Command, not Control. True on a Mac and on
 *  an iPad or iPhone with a hardware keyboard. */
export function usesCommandKey(): boolean {
  return isMacOS() || isIOS()
}
