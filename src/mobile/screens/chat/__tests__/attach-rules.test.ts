/**
 * The sheet "Add to message" (acceptance iPhone, second part, P5 and P7).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FILE_ACCEPT_IOS, fileAccept, imagesRowState } from '../parts/attach-rules'
import { CHAT_STRINGS } from '../../../strings/chat'

const sheet = readFileSync(join(__dirname, '..', 'AttachSheet.tsx'), 'utf8')
const modelSheet = readFileSync(join(__dirname, '..', 'ModelSheet.tsx'), 'utf8')

describe('P5: "File" on an iPhone opens the Files app, not a menu with the photo library', () => {
  it('on iOS the field names its types, and none of them is a picture or a video', () => {
    const types = FILE_ACCEPT_IOS.split(',')
    expect(fileAccept('ios')).toBe(FILE_ACCEPT_IOS)
    expect(types.length).toBeGreaterThan(30)
    for (const type of types) {
      expect(type, type).not.toMatch(/^(image|video)\//)
      expect(type, type).not.toMatch(/^\.(png|jpe?g|gif|heic|heif|webp|mov|mp4|m4v)$/i)
      expect(type, type).not.toBe('*/*')
    }
    // What a chat is given most: text, tables, documents, code.
    for (const wanted of ['.txt', '.md', '.csv', '.json', '.pdf', '.docx', '.py', '.zip', 'text/*']) expect(types).toContain(wanted)
  })

  it('Android and a browser keep "any file"', () => {
    expect(fileAccept('android')).toBeUndefined()
    expect(fileAccept(null)).toBeUndefined()
  })

  it('round 22, N2: no type iOS reads as "could be a picture or a video" (the menu came because of two of them)', () => {
    const types = FILE_ACCEPT_IOS.split(',')
    // public.data: every picture is data. The menu "Photo Library, Choose Files" came with it.
    expect(types).not.toContain('application/octet-stream')
    // public.mpeg-2-transport-stream: to iOS a .ts file is a video, not TypeScript.
    expect(types).not.toContain('.ts')
    for (const type of types) expect(type, type).not.toMatch(/^\.(ts|mts|m2ts|mpg|mpeg|avi|mkv|webm|3gp)$/i)
    for (const type of types) expect(type, type).not.toMatch(/^application\/(octet-stream|x-binary)$/i)
  })

  it('the row asks the Files app through the bridge, with the list as the fallback, and asks for no camera', () => {
    expect(sheet).toContain("pickDocuments({ multiple: true, maxFiles: MAX_CHAT_FILES + 1, maxBytes: MAX_CHAT_FILE_BYTES, accept: fileAccept(mobileOS()) })")
    expect(sheet).not.toContain('pickFiles(')
    const row = sheet.slice(sheet.indexOf('title={S.file}'), sheet.indexOf('title={S.documents}'))
    expect(row).not.toContain('capture')
  })
})

describe('P7 and round 22, N11: the picture rows and the sheet "Model" only speak of a chosen model that is there', () => {
  const reads = (name: string) => name.includes('gemma')
  const installed = [{ name: 'openai::SmolLM2-360M', type: 'text' }, { name: 'openai::gemma-3-4b', type: 'text' }]

  it('no model on the phone at all', () => {
    expect(imagesRowState(null, [], reads)).toBe('none-installed')
    expect(imagesRowState('', [], reads)).toBe('none-installed')
    expect(imagesRowState(undefined, [], reads)).toBe('none-installed')
    // An image model is not a model a chat can be given.
    expect(imagesRowState(null, [{ name: 'flux-schnell', type: 'image' }], reads)).toBe('none-installed')
  })

  it('models are there and none is chosen', () => {
    expect(imagesRowState(null, installed, reads)).toBe('no-model')
    expect(imagesRowState('', installed, reads)).toBe('no-model')
  })

  it('one is chosen and the list no longer has it: its name promises nothing', () => {
    // The store keeps the choice while the list is empty (an empty list validates nothing).
    expect(imagesRowState('openai::gemma-3-4b', [], reads)).toBe('gone')
    expect(imagesRowState('openai::gemma-3-4b', [installed[0]], reads)).toBe('gone')
    expect(imagesRowState('openai::gemma-3-4b', [{ name: 'openai::gemma-3-4b', type: 'image' }], reads)).toBe('gone')
  })

  it('one is chosen and there: it reads images or it does not', () => {
    expect(imagesRowState('openai::SmolLM2-360M', installed, reads)).toBe('no-vision')
    expect(imagesRowState('openai::gemma-3-4b', installed, reads)).toBe('ready')
    // A list without types (older callers) counts as chat models.
    expect(imagesRowState('a', [{ name: 'a' }], () => true)).toBe('ready')
  })

  it('each case has its own sentence in the row, and only one of them says "cannot read images"', () => {
    const A = CHAT_STRINGS.attach
    const rows = [A.noneInstalled, A.noModel, A.modelGone, A.noVision]
    expect(new Set(rows).size).toBe(4)
    expect(rows.filter((r) => /cannot read images/.test(r))).toEqual([A.noVision])
    expect(A.noModel).toMatch(/^Choose a model first\./)
    expect(A.noneInstalled).toMatch(/^Get a model first\./)
    for (const row of [A.noneInstalled, A.noModel]) expect(row).not.toContain('chosen model')
    for (const row of rows) expect(row).not.toMatch(/[\u2013\u2014]/)
  })

  it('the sheet "Add to message" asks the rule, with the list of models, and takes the sentence from it', () => {
    expect(sheet).toContain('const images = imagesRowState(activeModel, models, (name) => modelReadsImages(name, models))')
    expect(sheet).toContain("const canSee = images === 'ready'")
    expect(sheet).toContain('const blocked = BLOCKED[images]')
    expect(sheet.match(/: blocked\}/g)?.length).toBe(2)
    expect(sheet).not.toMatch(/: S\.noVision\}/)
    for (const line of ["'none-installed': S.noneInstalled", "'no-model': S.noModel", 'gone: S.modelGone', "'no-vision': S.noVision"]) expect(sheet).toContain(line)
  })

  it('the sheet "Model" takes its title from the same rule: the fixed sentence was why N11 stayed after P7', () => {
    const M = CHAT_STRINGS.model
    const titles = [M.visionTitleNoneInstalled, M.visionTitleNoModel, M.visionTitleGone, M.visionTitle]
    expect(new Set(titles).size).toBe(4)
    expect(titles.filter((t) => /cannot read images/.test(t))).toEqual([M.visionTitle])
    expect(M.visionTitleNoneInstalled).not.toMatch(/chosen/i)
    expect(M.visionTitleNoModel).toBe('No model is chosen')
    expect(modelSheet).toContain('const visionAsk = imagesRowState(activeModel, allModels, (name) => modelReadsImages(name, allModels))')
    expect(modelSheet).toContain('title={VISION_TITLE[visionAsk]}')
    expect(modelSheet).not.toContain('title={S.visionTitle}')
    for (const line of ["'none-installed': S.visionTitleNoneInstalled", "'no-model': S.visionTitleNoModel", 'gone: S.visionTitleGone', "'no-vision': S.visionTitle,"]) expect(modelSheet).toContain(line)
  })
})

describe('N15 (round 23): a PDF in "File" is read by the reader of the documents of a chat', () => {
  it('the sheet hands the reader to the file preparation and says it when a document cannot be read', () => {
    expect(sheet).toMatch(/prepareChatFile\(item\.file, \{ readDocument:/)
    expect(sheet).toContain("import('../../../api/rag')")
    expect(sheet).toContain('prepared.notice')
  })
})
