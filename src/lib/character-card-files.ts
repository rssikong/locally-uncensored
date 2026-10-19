/**
 * The file side of character cards: shrinking a card's picture for the
 * persona tile, and saving a card export. Kept apart from character-card.ts,
 * which stays free of DOM and backend calls.
 */
import type { Persona } from '../types/settings'
import { personaToCardJson, cardFileName } from './character-card'
import { downloadFile } from './chat-export'
import { backendCall, isTauri } from '../api/backend'

/**
 * The picture of a PNG character card, shrunk for the persona tile.
 *
 * The card file itself can be megabytes; the persona lives in the settings
 * blob in localStorage, so only a small JPEG of at most 256 px goes in. Any
 * failure (no canvas, a PNG the browser cannot draw) gives no picture and the
 * persona keeps its icon, never a failed import.
 */
const MAX_EDGE = 256

export async function cardImageDataUrl(bytes: Uint8Array): Promise<string | undefined> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      // An image that never loads must not hold the import up.
      const timer = setTimeout(() => reject(new Error('image timeout')), 5000)
      el.onload = () => { clearTimeout(timer); resolve(el) }
      el.onerror = () => { clearTimeout(timer); reject(new Error('image')) }
      el.src = url
    })
    if (!img.width || !img.height) return undefined
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    // JPEG has no transparency; a neutral grey under see-through art.
    ctx.fillStyle = '#808080'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const out = canvas.toDataURL('image/jpeg', 0.85)
    return out.startsWith('data:image/') ? out : undefined
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Save a character card persona as chara_card_v2 JSON. Desktop: the native
 * Save As dialog (the same command the chat export uses); browser: a download.
 */
export async function saveCardExport(
  persona: Pick<Persona, 'name' | 'systemPrompt' | 'card'>,
): Promise<{ status: 'saved' | 'cancelled' | 'downloaded'; path?: string }> {
  const content = personaToCardJson(persona)
  const filename = cardFileName(persona.name)
  if (isTauri()) {
    try {
      const path = await backendCall<string | null>('save_text_file_dialog', {
        content,
        defaultName: filename,
        extension: 'json',
        extLabel: 'JSON',
      })
      return path ? { status: 'saved', path } : { status: 'cancelled' }
    } catch {
      // Fall through to the download like the chat export does.
    }
  }
  downloadFile(content, filename, 'application/json')
  return { status: 'downloaded' }
}
