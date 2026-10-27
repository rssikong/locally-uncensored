/**
 * The voices of LU Cloud for reading aloud, at ONE place.
 *
 * The server route (/api/voice/tts) takes the id as it is and only checks its
 * character set, so this list is what the app offers, not what the server
 * knows. The phone reads it here (Settings, Voice; the chat may use it for a
 * voice picker of its own). The desktop still carries its own copy inside
 * components/settings/SpeechSettings.tsx; the test next to this file reads
 * that copy and fails when the ids of the two drift apart, until the desktop
 * component imports from here.
 *
 * A leaf: no imports, so every layer may use it.
 */
export interface CloudVoice {
  id: string
  label: string
}

export const DEFAULT_CLOUD_VOICE = 'Wise_Woman'

export const CLOUD_VOICES: readonly CloudVoice[] = [
  { id: 'Wise_Woman', label: 'Wise Woman' },
  { id: 'Calm_Woman', label: 'Calm Woman' },
  { id: 'Lively_Girl', label: 'Lively Girl' },
  { id: 'Lovely_Girl', label: 'Lovely Girl' },
  { id: 'Sweet_Girl_2', label: 'Sweet Girl' },
  { id: 'Friendly_Person', label: 'Friendly Person' },
  { id: 'Deep_Voice_Man', label: 'Deep Voice Man' },
  { id: 'Casual_Guy', label: 'Casual Guy' },
  { id: 'Patient_Man', label: 'Patient Man' },
  { id: 'Determined_Man', label: 'Determined Man' },
  { id: 'Elegant_Man', label: 'Elegant Man' },
  { id: 'Young_Knight', label: 'Young Knight' },
]

/** The saved voice, or the default when the saved id is not one of the list. */
export function pickedCloudVoice(saved: string | undefined | null): string {
  return CLOUD_VOICES.some((v) => v.id === saved) ? (saved as string) : DEFAULT_CLOUD_VOICE
}

/** The name to show for an id, or the id itself for one the list does not know. */
export function cloudVoiceLabel(id: string): string {
  return CLOUD_VOICES.find((v) => v.id === id)?.label ?? id
}
