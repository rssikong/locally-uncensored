/**
 * "Dictation uses LU Cloud" and "Read aloud uses LU Cloud" (C2.7, C2.18).
 * Sheet "chat-voice-gate", opened with { kind: 'dictate' | 'speak' } when
 * this phone has no way to do it on its own, and with { kind: 'speak-off' }
 * when "Read aloud" is switched off in the settings: then the way leads there.
 */
import { nav, useSheet } from '../../nav'
import { CHAT_STRINGS } from '../../strings/chat'
import { Button, Sheet } from '../../ui'
import { enterCloud } from '../settings/parts/cloud-mode'
import { useMobilePrefs } from '../settings/parts/prefs'
import './parts/chat.css'
import { usePhoneSpeech } from './parts/voice-pref'

const S = CHAT_STRINGS

export default function VoiceGateSheet() {
  const sheet = useSheet<{ kind?: 'dictate' | 'speak' | 'speak-off' } | undefined>()
  const asked = sheet.props?.kind
  const kind = asked === 'speak' || asked === 'speak-off' ? asked : 'dictate'
  // The system voice exists but the user switched it off: the text says that, not "no voice installed".
  const systemOff = useMobilePrefs((s) => s.systemVoiceFallback === false)
  // "No voice installed" is only said when both sources were asked and neither has one (lib/speech.ts).
  const noVoice = usePhoneSpeech((s) => s.source === 'none')
  // On top of the chat, not in the Settings tab: back from the voice settings leads to the chat again
  // (acceptance on Android, M4: it led to the settings overview).
  const toVoiceSettings = () => {
    sheet.close()
    nav.push('/settings/voice')
  }

  const turnOn = async () => {
    // The one door of the mode (settings/parts/cloud-mode.ts): without a plan or a sign in it leads to
    // E3, which explains LU Cloud; otherwise G11 asks and it switches.
    if (await enterCloud({ quiet: true })) nav.closeSheet()
  }

  if (kind === 'speak-off') {
    return (
      <Sheet
        title={S.voice.speakOffTitle}
        footer={
          <div className="m-chat-stack">
            <Button variant="primary" block onPress={toVoiceSettings} testid="m-chat-voice-gate-settings">
              {S.voice.voiceSettings}
            </Button>
            <Button block onPress={() => sheet.close()} testid="m-chat-voice-gate-later">
              {S.voice.notNow}
            </Button>
          </div>
        }
      >
        <p className="m-chat-sheet-text" data-testid="m-chat-voice-gate-text" data-m-kind={kind}>
          {S.voice.speakOffText}
        </p>
      </Sheet>
    )
  }

  return (
    <Sheet
      title={kind === 'speak' ? S.voice.speakGateTitle : S.voice.dictateGateTitle}
      footer={
        <div className="m-chat-stack">
          <Button variant="cloud" block onPress={() => void turnOn()} testid="m-chat-voice-gate-cloud">
            {S.voice.turnOnCloud}
          </Button>
          {kind === 'speak' && systemOff && !noVoice ? (
            <Button block onPress={toVoiceSettings} testid="m-chat-voice-gate-settings">
              {S.voice.voiceSettings}
            </Button>
          ) : null}
          <Button block onPress={() => sheet.close()} testid="m-chat-voice-gate-later">
            {S.voice.notNow}
          </Button>
        </div>
      }
    >
      <p className="m-chat-sheet-text" data-testid="m-chat-voice-gate-text" data-m-kind={kind}>
        {kind === 'speak' ? (noVoice ? S.voice.speakGateText : systemOff ? S.voice.speakGateTextSystemOff : S.voice.speakGateTextPlain) : S.voice.dictateGateText}
      </p>
    </Sheet>
  )
}
