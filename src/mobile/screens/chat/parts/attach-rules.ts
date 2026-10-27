/**
 * Two rules of the sheet "Add to message", pure.
 *
 * FILE_ACCEPT_IOS: on an iPhone a file field without an `accept` opens a menu
 * of iOS first ("Photo Library", "Choose Files"), one tap more, and it offers
 * photos under a sheet that may just have said the model cannot read images
 * (acceptance iPhone, second part, P5). A field whose types hold no picture
 * and no video opens the Files app at once, as "Add document" always did.
 * Pictures have their own two rows in the sheet. The list names the kinds of
 * files a chat is given: text, tables, documents, code, archives, sound.
 * Android opens its own picker for files either way and keeps "any file".
 *
 * Round 22 (check on the iPhone, N2): the menu still came. Two entries of the
 * list were the reason, and both are gone: `application/octet-stream` is
 * "any data" to iOS (public.data), and every picture is data; `.ts` is an
 * MPEG-2 transport stream to iOS (public.mpeg-2-transport-stream), a video.
 * One type that is or could be a picture or a video is enough for the menu.
 * The list is only the fallback now: on an iPhone the row "File" asks the
 * Files app directly through the bridge (platform/files.ts, pickDocuments),
 * where every file can be chosen, a TypeScript file too.
 *
 * imagesRowState: what the two picture rows say. Without a model there is no
 * "chosen model" that cannot read images (P7).
 *
 * Round 22 (check on the iPhone, N11): the rows were right after P7, but the
 * sheet "Model" they lead to still said "The chosen model cannot read
 * images" over a phone without any model. P7 had changed the rows only; the
 * title of that sheet was one fixed sentence. Both ask the same rule now, and
 * it tells four cases apart: no model on the phone, none chosen, one chosen
 * that is not in the list any more, and one chosen that reads no images.
 */
import type { MobileOS } from '../../../platform/detect'

export const FILE_ACCEPT_IOS = [
  'text/*',
  'audio/*',
  'application/pdf',
  'application/json',
  'application/xml',
  'application/zip',
  'application/rtf',
  'application/epub+zip',
  '.txt', '.md', '.markdown', '.rtf', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.epub',
  '.html', '.htm', '.css', '.js', '.mjs', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.cs', '.php', '.sh', '.sql',
  '.zip', '.gz', '.tar', '.7z',
].join(',')

/** The accept value of the row "File": none on Android and in a browser (any file), the list above on iOS. */
export function fileAccept(os: MobileOS): string | undefined {
  return os === 'ios' ? FILE_ACCEPT_IOS : undefined
}

export type ImagesRowState =
  /** The chosen model reads images. */
  | 'ready'
  /** No chat model is known to this phone: none installed, none of a provider, none of LU Cloud. */
  | 'none-installed'
  /** There are models, and none is chosen. */
  | 'no-model'
  /** One is chosen, and the list of models no longer has it (deleted, its provider gone, signed out of LU Cloud). */
  | 'gone'
  /** One is chosen, it is there, and it reads no images. */
  | 'no-vision'

/**
 * `models` are the chat models the phone knows (the list of the model
 * store). `readsImages` is asked only for a model that is in that list: a
 * name alone, of a model that is gone, promises nothing.
 */
export function imagesRowState(
  activeModel: string | null | undefined,
  models: ReadonlyArray<{ name: string; type?: string }>,
  readsImages: (name: string) => boolean,
): ImagesRowState {
  const chat = models.filter((m) => m.type === undefined || m.type === 'text')
  if (!activeModel) return chat.length === 0 ? 'none-installed' : 'no-model'
  if (!chat.some((m) => m.name === activeModel)) return 'gone'
  return readsImages(activeModel) ? 'ready' : 'no-vision'
}
