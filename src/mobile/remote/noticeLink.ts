/**
 * The link behind a notice of the computer (A17): a tap on "Answer ready",
 * "Approval needed" or "Render ready" opens the chat or the result. It is a
 * link of the app's own, on the host Android already lets in (lu://remote),
 * and never pairs anything: it only names where to go.
 *
 *   lu://remote/notice?chat=<id>    a shared chat of the computer
 *   lu://remote/notice?item=<id>    a result in the gallery of the phone
 */
export type NoticeTarget = { kind: 'chat'; id: string } | { kind: 'item'; id: string }

const ID = /^[A-Za-z0-9_.:-]{1,128}$/

export function noticeUrl(target: NoticeTarget): string {
  return `lu://remote/notice?${target.kind}=${encodeURIComponent(target.id)}`
}

/** Pure: where a notice link leads, or null when it is not one. */
export function parseNoticeUrl(url: string | null | undefined): NoticeTarget | null {
  if (typeof url !== 'string') return null
  const m = /^lu:\/\/remote\/notice\?(chat|item)=([^&#]{1,200})$/i.exec(url.trim())
  if (!m) return null
  let id = ''
  try {
    id = decodeURIComponent(m[2])
  } catch {
    return null
  }
  if (!ID.test(id) || id.includes('..')) return null
  return { kind: m[1].toLowerCase() as 'chat' | 'item', id }
}
