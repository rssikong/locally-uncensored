/**
 * The one door from the mobile shell to the native layer.
 *
 * Screens never call invoke. They call a function in platform/*, and that
 * function comes through here. A guard test keeps it that way
 * (src/mobile/__tests__/platform-naht.test.ts).
 */
import { backendCall, isTauri } from '../../api/backend'
import { commandIsUnavailable } from '../../lib/engine-command-availability'
import type { NativeCommand } from './contract'

/** The command is not there: plain browser, or a native build that does not have it yet. */
export class NativeUnavailableError extends Error {
  readonly command: string
  constructor(command: string) {
    super(`${command} is not available on this device`)
    this.name = 'NativeUnavailableError'
    this.command = command
  }
}

export function isNativeUnavailable(err: unknown): err is NativeUnavailableError {
  return err instanceof NativeUnavailableError
}

/** True inside the Tauri WebView. In a plain browser every native call takes its web fallback. */
export function hasNativeBridge(): boolean {
  return isTauri()
}

export async function callNative<T>(command: NativeCommand, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new NativeUnavailableError(command)
  try {
    return await backendCall<T>(command, args)
  } catch (err) {
    if (commandIsUnavailable(err)) throw new NativeUnavailableError(command)
    throw err
  }
}

/**
 * Try the native command, and take the fallback only when the command does
 * not exist. A real failure of an existing command is passed on, so a failed
 * share is never papered over by a second attempt in another way.
 */
export async function nativeOr<T>(
  command: NativeCommand,
  args: Record<string, unknown> | undefined,
  fallback: () => Promise<T> | T,
): Promise<T> {
  try {
    return await callNative<T>(command, args)
  } catch (err) {
    if (isNativeUnavailable(err)) return fallback()
    throw err
  }
}
