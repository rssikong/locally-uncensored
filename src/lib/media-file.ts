/**
 * What a picked file is, and whether it may go to the cloud. Pure.
 *
 * Shared by every place a phone picks media (Create today, the chat composer
 * next), so a photo, a clip and a sound are judged the same way everywhere.
 * The byte limits come from lib/upload-limits.ts.
 */

export type MediaKind = 'image' | 'video' | 'audio'

const EXT_KIND: Record<string, MediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image', heic: 'image', heif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio',
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The kind of a file. The type decides; a file without a type (a HEIC from some pickers) is read by its name. */
export function fileKind(file: { name: string; type: string }): MediaKind | null {
  const type = file.type.toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type && type !== 'application/octet-stream') return null
  return EXT_KIND[extensionOf(file.name)] ?? null
}

export function isHeic(file: { name: string; type: string }): boolean {
  return /hei[cf]/i.test(file.type) || /^hei[cf]$/.test(extensionOf(file.name))
}

export type FileProblem =
  | { kind: 'wrong-kind'; wanted: MediaKind }
  | { kind: 'too-large'; limitMb: number; sizeMb: number }
  | { kind: 'empty' }

/** Why a file cannot be used as `wanted` with this byte limit, or null. */
export function checkFileAgainst(file: { name: string; type: string; size: number }, wanted: MediaKind, limitBytes: number): FileProblem | null {
  if (fileKind(file) !== wanted) return { kind: 'wrong-kind', wanted }
  if (file.size <= 0) return { kind: 'empty' }
  if (file.size > limitBytes) {
    return { kind: 'too-large', limitMb: Math.floor(limitBytes / 1048576), sizeMb: Math.ceil(file.size / 1048576) }
  }
  return null
}
