/**
 * One list of Cloud voices. The phone reads lib/cloud-voices.ts; the desktop
 * still has its own copy in SpeechSettings.tsx. This holds the two together
 * until the desktop component imports the list.
 *
 * Run: npx vitest run src/lib/__tests__/cloud-voices.test.ts
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { CLOUD_VOICES, DEFAULT_CLOUD_VOICE, cloudVoiceLabel, pickedCloudVoice } from '../cloud-voices'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('cloud voices', () => {
  it('has unique ids the server route accepts, and the default is one of them', () => {
    const ids = CLOUD_VOICES.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_]+$/)
    expect(ids).toContain(DEFAULT_CLOUD_VOICE)
  })

  it('offers the same ids, in the same order, as the desktop settings', () => {
    const desktop = readFileSync(join(HERE, '../../components/settings/SpeechSettings.tsx'), 'utf8')
    const block = /const CLOUD_TTS_VOICES[^=]*=\s*\[([\s\S]*?)\n\]/.exec(desktop)
    expect(block, 'the desktop list was not found; if it imports lib/cloud-voices now, drop this test').not.toBeNull()
    const ids = [...block![1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
    expect(ids).toEqual(CLOUD_VOICES.map((v) => v.id))
  })

  it('falls back to the default for an id that is not in the list', () => {
    expect(pickedCloudVoice('Calm_Woman')).toBe('Calm_Woman')
    expect(pickedCloudVoice('Gone_Voice')).toBe(DEFAULT_CLOUD_VOICE)
    expect(pickedCloudVoice(undefined)).toBe(DEFAULT_CLOUD_VOICE)
    expect(pickedCloudVoice('')).toBe(DEFAULT_CLOUD_VOICE)
  })

  it('names a voice, and shows an unknown id as it is', () => {
    expect(cloudVoiceLabel('Sweet_Girl_2')).toBe('Sweet Girl')
    expect(cloudVoiceLabel('Other_Voice')).toBe('Other_Voice')
  })
})
