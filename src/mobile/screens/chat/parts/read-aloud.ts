/**
 * Is the speaker button under an answer shown.
 *
 * The ONE place of the chat that decides it (acceptance on Android, N10: the
 * button stood under every answer on a phone that has no voice at all, with
 * "Read aloud" switched off).
 *
 * Which voice a phone has is not decided here but behind the one door of the
 * shell, src/mobile/lib/speech.ts (`speechSynthesis`, else the native bridge,
 * else none). The chat reaches that door through parts/voice-pref.ts, which
 * hands it to the voice hook: `systemVoiceUsable()` of the hook then answers
 * for both sources and for the switch "Use the system voice".
 *
 *   hook   something can speak: a voice of LU Cloud, an engine the user set
 *          up, or the voice of the phone.
 *   null   nothing can speak. The button is not shown then. "Read aloud" in
 *          the menu of a message stays and explains what is missing.
 */
export type ReadAloudWay = 'hook' | null

export interface ReadAloudFacts {
  /** A voice of LU Cloud, a local neural voice or an own engine is ready. */
  hookVoice: boolean
  /** The phone has a voice (WebView or native) and the user allows it. */
  systemVoice: boolean
}

/** Pure: can an answer be read aloud on this phone. */
export function readAloudWay(facts: ReadAloudFacts): ReadAloudWay {
  return facts.hookVoice || facts.systemVoice ? 'hook' : null
}

/** Pure: is the speaker button under an answer shown. Only when "Read aloud" is on and a tap would really speak. */
export function showsSpeakButton(enabled: boolean, way: ReadAloudWay): boolean {
  return enabled && way !== null
}
