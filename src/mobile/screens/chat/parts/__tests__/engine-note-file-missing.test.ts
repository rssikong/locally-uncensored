/**
 * Check on Android, package 9: the box about a model file that is not on the phone was cut off with the keyboard
 * open. It says the name once and has no guesses now.
 *
 * Run: npx vitest run src/mobile/screens/chat/parts/__tests__/engine-note-file-missing.test.ts
 */
import { describe, expect, it } from 'vitest'
import { phoneEngineNote, phoneModelName, shortEngineNote, FILE_MISSING_SHORT } from '../engine-note'
import { phoneReason } from '../../../models/parts/download-state'

const LONG = 'Couldn\'t start the LU Engine with "Qwen3-0.6B-Q4_K_M": The model file "Qwen3-0.6B-Q4_K_M" is not on this device. It may have been deleted, or the download did not finish. Open Models and download it again, then pick it in the chat.'

describe('the note about a model file that is not on the phone', () => {
  it('says the name once and the way out, nothing else', () => {
    const text = phoneEngineNote(LONG)
    expect(text).toBe('The model file "Qwen3 0.6B" is not on this device. Open Models and download it again.')
    expect(text.length).toBeLessThan(LONG.length / 2)
  })

  it('leaves every other note as it was', () => {
    expect(phoneEngineNote('Not enough memory for this model.')).toBe('Not enough memory for this model.')
    expect(phoneEngineNote(null)).toBeNull()
    expect(phoneEngineNote('x. Open Models, Get new and download it again.')).toBe('x. Open Models, delete this model there and download it again.')
  })
})

/** Short check of package 10 on iOS, F2: the file went while the model was still listed; the native side words it with the full path. */
const RAW = 'Couldn\'t start the LU Engine with "Qwen3-0.6B-Q4_K_M": Model file not found: /private/var/mobile/Containers/Data/Application/4F2A-91/Library/Application Support/models/Qwen3-0.6B-Q4_K_M.gguf'

describe('the same note when the native side words it with a path (iOS F2)', () => {
  it('says the short sentence and never shows a folder', () => {
    const text = phoneEngineNote(RAW)
    expect(text).toBe('The model file "Qwen3 0.6B" is not on this device. Open Models and download it again.')
    expect(text).not.toMatch(/\/|Containers|Application/)
  })

  it('works without the prefix and for the embedding model, name taken from the file', () => {
    expect(phoneEngineNote('Model file not found: /data/user/0/app/files/models/Foo-Q4.gguf')).toBe('The model file "Foo-Q4" is not on this device. Open Models and download it again.')
    expect(phoneEngineNote('Embedding model file not found: C:\\x\\y\\Bar.gguf')).toBe('The model file "Bar" is not on this device. Open Models and download it again.')
  })

  it('keeps a sentence in front of it and gets the short line with the keyboard open', () => {
    expect(phoneEngineNote(`The chat provider moved. ${RAW}`)).toMatch(/^The chat provider moved\. The model file "Qwen3 0\.6B" is not on this device/)
    expect(shortEngineNote(RAW)).toBe(FILE_MISSING_SHORT)
  })

  it('cuts any other path in an engine sentence down to the file name', () => {
    expect(phoneEngineNote('Source model not found: /var/mobile/x/models/a.gguf')).toBe('Source model not found: a.gguf')
    expect(phoneEngineNote('Could not delete /var/mobile/x/models/a.gguf: busy')).toBe('Could not delete a.gguf: busy')
    expect(phoneEngineNote('Open Models/Settings and/or retry.')).toBe('Open Models/Settings and/or retry.')
    expect(phoneReason(new Error('Could not read /var/mobile/x/models/a.gguf. Other.'))).toBe('Could not read a.gguf.')
  })
})

/** Check iOS package 11, N1: the note named the file, the chip one line below the name of the catalogue. */
describe('the note names a model of the catalogue as the phone does everywhere', () => {
  const SMOL_LONG = 'Couldn\'t start the LU Engine with "SmolLM2-360M-Instruct-Q4_K_M": The model file "SmolLM2-360M-Instruct-Q4_K_M" is not on this device. It may have been deleted, or the download did not finish. Open Models and download it again, then pick it in the chat.'
  const SMOL_RAW = 'Couldn\'t start the LU Engine with "SmolLM2-360M-Instruct-Q4_K_M": Model file not found: /private/var/mobile/Containers/Data/Application/4F2A-91/Library/Application Support/models/SmolLM2-360M-Instruct-Q4_K_M.gguf'
  const SAID = 'The model file "SmolLM2 360M" is not on this device. Open Models and download it again.'

  it('in the sentence of the engine start', () => {
    expect(phoneEngineNote(SMOL_LONG)).toBe(SAID)
  })

  it('in the sentence of the native side with a path, with and without the prefix', () => {
    expect(phoneEngineNote(SMOL_RAW)).toBe(SAID)
    expect(phoneEngineNote('Model file not found: /data/user/0/app/files/models/SmolLM2-360M-Instruct-Q4_K_M.gguf')).toBe(SAID)
  })

  it('another packing of a catalogue model with its packing, a file of its own by its cleaned name', () => {
    expect(phoneModelName('openai::SmolLM2-360M-Instruct-Q8_0')).toBe('SmolLM2 360M Q8_0')
    expect(phoneModelName('/x/models/My-Own-Model.Q5.gguf')).toBe('My-Own-Model.Q5')
    expect(phoneEngineNote('Model file not found: /data/user/0/app/files/models/Foo-Q4.gguf')).toBe('The model file "Foo-Q4" is not on this device. Open Models and download it again.')
  })
})
