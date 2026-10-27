/**
 * What the voice hook of the logic layer has to be told about this phone,
 * handed in through its seams, once.
 *
 *   the switch  "Use the system voice when Cloud is off" (E11.5) lives in the
 *               settings of the phone (strand 5, screens/settings/parts/prefs.ts).
 *   the voice   which voice this phone has is decided in ONE place,
 *               src/mobile/lib/speech.ts: `speechSynthesis` where it lists a
 *               voice, else the native bridge, else none. The chat reaches it
 *               only through this file. The hook speaks through the door built
 *               here, so an Android phone reads aloud without LU Cloud too.
 */
import { create } from 'zustand'
import { setPhoneSpeech, setSystemVoiceAllowed } from '../../../../hooks/useVoice'
import { listPhoneVoices, speakOnDevice, stopDeviceSpeech, type SpeechSource } from '../../../lib/speech'
import { useMobilePrefs } from '../../settings/parts/prefs'

/** Which voice this phone has. null until speech.ts has asked both sources. */
export const usePhoneSpeech = create<{ source: SpeechSource | null }>(() => ({ source: null }))

/** Ask again, for instance after the user came back from the settings of the system. */
export function refreshPhoneSpeech(fresh = false): Promise<SpeechSource> {
  return listPhoneVoices({ fresh })
    .then((found) => found.source)
    .catch((): SpeechSource => 'none')
    .then((source) => {
      usePhoneSpeech.setState({ source })
      return source
    })
}

const GERMAN = /[äöüß]|\b(der|die|das|und|ist|nicht|ich|ein|eine|mit|für|auf|dass|sich|auch|wird|sind)\b/gi
const ENGLISH = /\b(the|and|is|are|of|to|in|that|it|for|with|this|you|not|was|have)\b/gi

/**
 * Pure: the language to read a text in when no voice is picked. A simple
 * count of very common words tells German from English; anything else is read
 * in the language of the phone, and without one in English.
 */
export function readingLanguage(text: string, deviceLanguage: string | null | undefined): string {
  const sample = text.slice(0, 600)
  const german = sample.match(GERMAN)?.length ?? 0
  const english = sample.match(ENGLISH)?.length ?? 0
  if (german > english && german >= 2) return 'de-DE'
  if (english > german && english >= 2) return 'en-US'
  const device = (deviceLanguage ?? '').trim()
  return device || 'en-US'
}

function deviceLanguage(): string | null {
  try {
    return typeof navigator !== 'undefined' ? navigator.language || null : null
  } catch {
    return null
  }
}

let installed = false

export function installVoicePreference(): void {
  if (installed) return
  installed = true
  setSystemVoiceAllowed(() => useMobilePrefs.getState().systemVoiceFallback !== false)
  setPhoneSpeech({
    source: () => usePhoneSpeech.getState().source,
    speak: async (text, options) => {
      const result = await speakOnDevice(text, { ...options, lang: readingLanguage(text, deviceLanguage()) })
      // What was just learned is the truth for the button too.
      if (usePhoneSpeech.getState().source !== result.source) usePhoneSpeech.setState({ source: result.source })
      return { spoken: result.spoken }
    },
    stop: () => void stopDeviceSpeech(),
  })
  void refreshPhoneSpeech()
}

/** Only for tests. */
export function __resetVoicePreferenceForTests(): void {
  installed = false
  setSystemVoiceAllowed(null)
  setPhoneSpeech(null)
  usePhoneSpeech.setState({ source: null })
}
