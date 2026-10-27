/**
 * The document the preview frame shows (C11), and the one message it may
 * send out: "an error happened in the page".
 *
 * The frame is closed off (sandbox without same origin), so the page cannot
 * read anything of LU. The only thing let through is a small reporter that
 * is put in front of the page code and tells the frame's owner when a script
 * of the page throws. The message carries a token made per page view, so a
 * page cannot fake the message of another view.
 */
import { buildDocument } from '../../../../lib/html-preview'

export const PREVIEW_MESSAGE = 'lu-preview-error'
/**
 * Sent by the reporter the moment it runs: "scripts run in this frame". In
 * the installed app they do not: the frame is a srcdoc document and takes
 * over the content security policy of the app, which allows no inline script
 * (measured in Chromium and WebKit with the policy of tauri.conf.json, review
 * N5). The page then shows its markup and styles only, and the preview says
 * so instead of leaving a page that looks broken. Styles are allowed by that
 * policy as long as it carries no nonce (round 10, N16: a style block in
 * index.html made Tauri add one, and every style attribute was refused, in
 * the preview as well; second check on Android, F2).
 */
export const PREVIEW_READY = 'lu-preview-ready'
/** How long the preview waits for PREVIEW_READY before it says that scripts do not run. */
export const PREVIEW_READY_WAIT_MS = 1200
/** The width "Wide" lays the page out in. It is then scaled down to the screen. */
export const WIDE_WIDTH = 1024

function reporter(token: string): string {
  const safe = token.replace(/[^a-zA-Z0-9]/g, '')
  return (
    '<script>(function(){function r(m){try{parent.postMessage({type:"' +
    PREVIEW_MESSAGE +
    '",token:"' +
    safe +
    '",message:String(m).slice(0,300)},"*")}catch(e){}}' +
    'try{parent.postMessage({type:"' +
    PREVIEW_READY +
    '",token:"' +
    safe +
    '"},"*")}catch(e){}' +
    'window.addEventListener("error",function(e){r(e.message||"Script error")});' +
    'window.addEventListener("unhandledrejection",function(e){r(e.reason&&e.reason.message||e.reason||"Promise rejected")});})();</' +
    'script>'
  )
}

/**
 * The policy of the previewed page itself, as the first thing in its head.
 *
 * The frame is a srcdoc document and takes over the policy of the app. That
 * one is written for LU: it lets a page reach localhost and a list of hosts
 * (images, media), which a page the model wrote has no business doing. This
 * one closes the network for the page entirely and says what the preview is
 * for: the page's own markup and its own styles, in a style attribute and in
 * a style block, and pictures it carries inside itself.
 *
 * A second policy can only take away. It cannot allow what the policy of the
 * app refuses, so scripts stay off in the installed app (script-src there is
 * 'self'), whatever this line says about them. It names inline scripts only
 * so that the developer server, which has no policy, behaves as before.
 */
export const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"

function policyTag(): string {
  return '<meta http-equiv="Content-Security-Policy" content="' + PREVIEW_CSP + '">'
}

/** The attributes of a start tag, quoted values included (a quoted value may hold a ">"). */
const TAG_ATTRS = `(?:\\s(?:[^>"']|"[^"]*"|'[^']*')*)?`

/**
 * What may stand in front of the policy: a doctype, the html tag, the head tag, in that order and nothing else.
 *
 * Anchored at the start on purpose (review r49). The policy has to come before anything the page could run or
 * load. Searching the text for the first head tag put it after a script that stood in front of the head, and
 * inside a header element of the body, where a policy tag is ignored. Whatever the page puts in front of its
 * head now comes after the policy: a policy tag in front of the html tag still lands in the head the parser makes.
 */
const POLICY_SPOT = new RegExp(`^\\s*(?:<!doctype[^>]*>\\s*)?(?:<html${TAG_ATTRS}>\\s*)?(?:<head${TAG_ATTRS}>)?`, 'i')

function insertInHead(doc: string, script: string): string {
  const at = POLICY_SPOT.exec(doc)?.[0].length ?? 0
  return doc.slice(0, at) + script + doc.slice(at)
}

/** Pure: put the policy and the reporter where they come before the page's own code without breaking the document. */
export function withReporter(doc: string, token: string): string {
  return insertInHead(doc, policyTag() + reporter(token))
}

/** Pure: put the policy alone in front of the page, no script of ours. */
export function withPolicyOnly(doc: string): string {
  return insertInHead(doc, policyTag())
}

/**
 * Whether the frames of this app are known not to run scripts (the policy of
 * the app allows no inline script). Learned from the first page that wanted
 * scripts and did not say "ready" (PreviewPage). A reporter written into a
 * frame like that is refused by the policy, and the refusal is an error in the
 * console at every load (finding N10 of the Android review).
 */
let scriptsBlocked = false
export function scriptsKnownBlocked(): boolean {
  return scriptsBlocked
}
export function noteScriptsBlocked(blocked: boolean): void {
  scriptsBlocked = blocked
}

/** Pure: does the page the model wrote need scripts at all (a script tag, or a handler in the markup)? */
export function pageWantsScripts(code: string): boolean {
  return /<script[\s>]/i.test(code) || /<[a-z][^>]*\son[a-z]+\s*=/i.test(code)
}

/**
 * Pure: the page without its scripts and without the handlers in its markup (onclick and the like).
 *
 * For a frame that is known not to run them. The policy refuses each of them and the refusal is a line in the
 * console at every load; the page looks the same without them (short check of package 10, iOS: four lines in three
 * views of one page, one expected). Only ever applied where they cannot run anyway.
 */
export function withoutScripts(doc: string): string {
  const noBlocks = doc.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
  // Walk the tags by hand: a ">" inside a quoted value does not end a tag, and the work stays linear on any text.
  let out = ''
  let i = 0
  while (i < noBlocks.length) {
    const open = noBlocks.indexOf('<', i)
    if (open < 0 || !/[a-z]/i.test(noBlocks[open + 1] ?? '')) {
      if (open < 0) break
      out += noBlocks.slice(i, open + 1)
      i = open + 1
      continue
    }
    out += noBlocks.slice(i, open)
    let j = open + 1
    let quote = ''
    while (j < noBlocks.length) {
      const c = noBlocks[j]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      j++
    }
    if (j >= noBlocks.length) {
      out += noBlocks.slice(open)
      i = noBlocks.length
      break
    }
    const tag = noBlocks.slice(open, j + 1)
    out += /\son[a-z]+\s*=/i.test(tag) ? tag.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '') : tag
    i = j + 1
  }
  return out + noBlocks.slice(i)
}

/**
 * The document of a page view. The reporter is only written into a page that
 * has scripts of its own (without any, there is no error to report), and not
 * into a frame that is known not to run them. `reporterOn: false` says so; the
 * page's own scripts are left out of such a frame (they would only be refused).
 */
export function previewDocument(code: string, language: string, token: string, reporterOn: boolean = pageWantsScripts(code)): string {
  const doc = buildDocument(code, language)
  return reporterOn ? withReporter(doc, token) : withPolicyOnly(withoutScripts(doc))
}

/** Pure: is this the error message of the page view with this token? */
export function readPreviewMessage(data: unknown, token: string): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { type?: unknown; token?: unknown; message?: unknown }
  if (d.type !== PREVIEW_MESSAGE || d.token !== token.replace(/[^a-zA-Z0-9]/g, '')) return null
  return typeof d.message === 'string' ? d.message : ''
}

/** Pure: did the frame of the page view with this token say that its scripts run? */
export function readPreviewReady(data: unknown, token: string): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as { type?: unknown; token?: unknown }
  return d.type === PREVIEW_READY && d.token === token.replace(/[^a-zA-Z0-9]/g, '')
}

/** Pure: the scale that fits a page laid out `WIDE_WIDTH` wide into `stageWidth`. Never above 1. */
export function wideScale(stageWidth: number): number {
  if (stageWidth <= 0) return 1
  return Math.min(1, stageWidth / WIDE_WIDTH)
}
