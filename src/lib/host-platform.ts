// Which machine the agent is standing on, and the one line of prompt that says
// so.
//
// This replaces the desktop_open and app_launch tools (removed 2026-08-06).
// Those were wrappers around `open` / `explorer` / `xdg-open`, which is the
// anti-pattern Anthropic names outright in "Writing effective tools for AI
// agents": tools that merely wrap existing software functionality. No competitor
// ships one either; Claude Code, Cline and the rest use a single shell tool.
// They also cost ~478 tokens of every system prompt on a registry where the
// full tool set already does not fit a 4k-context local model, so they hurt
// exactly the models they were meant to help. And they bought no safety:
// shell_execute sits behind the same confirmation gate.
//
// The one real thing they gave a weak model was not having to guess between
// `open` and `explorer`. That is a prompt problem, and this is the fix: ~60
// tokens that also spare the agent a system_info round trip and improve every
// other shell task, not just opening a folder.

import { isMobile, nativeHost } from './device-kind'

export type HostPlatform = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'unknown'

interface NavLike {
  platform?: string
  userAgent?: string
  maxTouchPoints?: number
}

function currentNav(): NavLike {
  return typeof navigator === 'undefined' ? {} : navigator
}

/** Injectable so every branch is testable from one machine. */
export function hostPlatform(nav?: NavLike): HostPlatform {
  // Asked about this very machine, the app answers first: it knows what it
  // was built for (lib/device-kind.ts, nativeHost). A handed-in navigator is
  // a question about some other machine and is read as it stands.
  if (nav === undefined) {
    const told = nativeHost()
    if (told !== null) return told
  }
  return platformOf(nav ?? currentNav())
}

function platformOf(nav: NavLike): HostPlatform {
  const plat = nav.platform || ''
  const ua = nav.userAgent || ''
  const both = `${plat} ${ua}`
  // The phones first. An iPhone says "like Mac OS X", an iPad since iPadOS 13
  // says "MacIntel" and differs from a Mac only by its touch screen, and an
  // Android WebView says "Linux armv8l". Read as macOS and Linux the agent was
  // told about bash, Finder and xdg-open on a device that has none of them.
  // The same rules as isIOS and isAndroid in api/backend.ts, spelled against
  // the injectable navigator so every branch stays testable.
  if (/iPhone|iPad|iPod/.test(both)) return 'ios'
  if (/Mac/.test(plat) && (nav.maxTouchPoints || 0) > 1) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Mac|Macintosh/.test(both)) return 'macos'
  if (/Win/.test(both)) return 'windows'
  if (/Linux|X11|CrOS/.test(both)) return 'linux'
  return 'unknown'
}

/** The platform sentence on a phone or tablet. No shell, no desktop verbs:
 *  the tools that would run them are not registered there (see
 *  registerBuiltinTools), and a model told about `open` goes looking for it. */
export const MOBILE_PLATFORM_LINE =
  'This device is a phone or tablet. There is no shell, no terminal and no desktop to open things on. Files live only in the working folder of this app; use the file tools with paths relative to that folder.'

/**
 * The platform sentence for the agent system prompt.
 *
 * It names the OS, the shell shell_execute will actually use, and the three
 * desktop verbs a model would otherwise guess at. Kept to one line per platform
 * because the models that need it most are the ones with the least room.
 */
export function platformPromptLine(p: HostPlatform = hostPlatform()): string {
  switch (p) {
    case 'macos':
      return 'This machine runs macOS and shell_execute runs bash. Open a file or folder with `open <path>`, reveal it in Finder with `open -R <path>`, start an application with `open -a "<App Name>"`.'
    case 'windows':
      return 'This machine runs Windows and shell_execute runs PowerShell. Open a file or folder with `Invoke-Item <path>`, reveal it in Explorer with `explorer "/select,<path>"` (one argument, the comma matters), start an application with `Start-Process "<App Name>"`.'
    case 'ios':
    case 'android':
      return MOBILE_PLATFORM_LINE
    case 'linux':
      return 'This machine runs Linux and shell_execute runs bash. Open a file or folder with `xdg-open <path>`, start an application with `gtk-launch <name>`. There is no reveal, so open the containing folder instead.'
    default:
      // Never invent a platform: a wrong incantation is worse than none. The
      // shell itself is the probe now that system_info is gone (2.6.6).
      return 'The operating system of this machine is unknown. Probe it with shell_execute (`uname -s`, and on failure assume Windows PowerShell) before running a platform-specific command.'
  }
}

/**
 * The environment block for agent system prompts: platform sentence plus
 * clock, timezone and (when known) working directory.
 *
 * This retires system_info and get_current_time from the tool catalog
 * (2.6.6, plan section E3) with the same argument that removed desktop_open
 * and app_launch above: a few prompt tokens replace two schemas (~218 tokens
 * per step) AND the round trip small models spent asking what machine they
 * are on. The timestamp is taken when the run starts; that is what the old
 * tool call would have returned too.
 */
export function hostEnvironmentBlock(
  p: HostPlatform = hostPlatform(),
  now: Date = new Date(),
): string {
  return [platformPromptLine(p), hostClockLine(now)].join('\n')
}

/**
 * The clock half of the environment block, on its own.
 *
 * This one line is the single most expensive character sequence in the whole
 * system prompt (2.6.6, plan A5). It changes every minute, and it used to sit
 * near the TOP of the prompt, ahead of the persona, the rules and the repo
 * map. An upstream prefix cache matches from byte 0 and stops at the first
 * difference, so a timestamp up there means every new turn re-prices the ENTIRE
 * prompt as a cache miss. Everything volatile now goes last, and the stable
 * head in front of it is byte-identical from turn to turn.
 *
 * The wording is unchanged, only the position: it still replaces the retired
 * clock tool, so it still has to name the date of the run.
 */
export function hostClockLine(now: Date = new Date()): string {
  let tz = ''
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    // No timezone is better than a wrong one.
  }
  const stamp = now.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
  const line = `Date and time at the start of this run: ${stamp}${tz ? ` (${tz})` : ''}. Trust this line; there is no clock tool.`
  return isMobile() ? `${line} ${todayIsLaterNote(now)}` : line
}

/**
 * What a small model on a phone needs said on top of the date.
 *
 * Acceptance on Android with 8 GB, B7: asked who won the World Cup of 2026,
 * Qwen 3.5 2B answered that the tournament lies in the future and did not
 * search, although the line above named the date. Another run wrote "2024"
 * into a search query. A model of that size reads a date as a fact about the
 * run and does not conclude that its own knowledge is older. So the
 * conclusion is spelled out: the year, and what follows from it.
 *
 * Phone only. The desktop line is word for word what it was.
 */
export function todayIsLaterNote(now: Date = new Date()): string {
  const year = now.getFullYear()
  return `The current year is ${year}. Your own knowledge ends earlier, so never call something up to this date "in the future": for anything recent, look it up if you have a search tool, and write ${year} in the query, not an earlier year.`
}
