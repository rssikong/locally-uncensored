/**
 * Discord D2: the voice engine and LU's own Python can live on another
 * drive. The sentences of the Settings row and the one rule the frontend
 * applies itself (not inside the model folder).
 *
 * Run: npx vitest run src/lib/__tests__/runtime-folder.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  canMoveRuntime,
  moveConfirmText,
  moveOutcomeLine,
  runtimeEntryNote,
  runtimeFolderClash,
} from '../runtime-folder'
import type { RuntimeEntry } from '../../api/runtime-folder'

const entry = (over: Partial<RuntimeEntry>): RuntimeEntry => ({
  kind: 'voice',
  path: 'D:\\LU Runtime\\voice',
  installed: true,
  atTarget: true,
  bytes: 0,
  ...over,
})

describe('the folder must not be the model folder', () => {
  it('refuses the model folder itself and anything inside it, whatever the slashes and case', () => {
    expect(runtimeFolderClash('D:\\AI\\Models', 'D:\\AI\\Models')).toBe(true)
    expect(runtimeFolderClash('d:/ai/models/runtime', 'D:\\AI\\Models\\')).toBe(true)
    expect(runtimeFolderClash('/Volumes/Data/models/LU', '/Volumes/Data/models')).toBe(true)
  })

  it('allows a sibling, a parent and a folder whose name only starts the same', () => {
    expect(runtimeFolderClash('D:\\AI\\Runtime', 'D:\\AI\\Models')).toBe(false)
    expect(runtimeFolderClash('D:\\AI', 'D:\\AI\\Models')).toBe(false)
    expect(runtimeFolderClash('D:\\AI\\Models 2', 'D:\\AI\\Models')).toBe(false)
    expect(runtimeFolderClash('D:\\LU Runtime', '')).toBe(false)
    expect(runtimeFolderClash('', 'D:\\AI')).toBe(false)
  })
})

describe('what each entry says', () => {
  it('names an empty place as where a new install goes', () => {
    expect(runtimeEntryNote(entry({ installed: false }), 'D:\\LU Runtime')).toBe('Not installed. A new install goes here.')
  })

  it('says an install in the old folder keeps working there', () => {
    const note = runtimeEntryNote(entry({ atTarget: false, bytes: 2 * 1024 ** 3 }), 'D:\\LU Runtime')
    expect(note).toBe('Installed in the old folder (2.0 GB). It keeps working there until you move it.')
  })

  it('an install in place needs no move', () => {
    expect(runtimeEntryNote(entry({ bytes: 1024 }), null)).toBe('Installed here (1.0 KB).')
  })
})

describe('moving', () => {
  it('is offered only with a chosen folder and something installed elsewhere', () => {
    const away = entry({ atTarget: false })
    expect(canMoveRuntime([away], 'D:\\LU Runtime')).toBe(true)
    expect(canMoveRuntime([away], null)).toBe(false)
    expect(canMoveRuntime([entry({}), entry({ kind: 'python', installed: false, atTarget: false })], 'D:\\LU Runtime')).toBe(false)
  })

  it('promises the trash of the system and no deleting for good', () => {
    expect(moveConfirmText(true)).toContain('Recycle Bin')
    expect(moveConfirmText(false)).toContain('Trash')
    for (const text of [moveConfirmText(true), moveConfirmText(false)]) {
      expect(text).toContain('checks the copy')
      expect(text).toContain('Nothing is deleted for good')
      expect(text).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('reports each folder in one line', () => {
    const base = { kind: 'python' as const, from: 'C:\\old\\python', to: 'D:\\LU Runtime\\python', detail: '' }
    expect(moveOutcomeLine({ ...base, status: 'moved' })).toBe("LU's own Python: moved to D:\\LU Runtime\\python.")
    expect(moveOutcomeLine({ ...base, status: 'movedOldKept', detail: 'The old copy stays.' })).toBe(
      "LU's own Python: moved to D:\\LU Runtime\\python. The old copy stays.",
    )
    expect(moveOutcomeLine({ ...base, kind: 'piperVoices', status: 'failed', detail: 'Disk full.' })).toBe(
      'Read-aloud voices: not moved. Disk full.',
    )
  })
})
