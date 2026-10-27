/**
 * E5 Chat defaults. Route /settings/chat, page, strand 5 (Account, cloud, settings).
 *
 * The sampling values every new answer starts with, when LU sums up a long
 * chat by itself, and where reading aloud is switched. Every control saves at once.
 */
import { RotateCcw } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useVoiceStore } from '../../../stores/voiceStore'
import { nav } from '../../nav'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, ListGroup, NumberField, Page, Row, Slider, toast } from '../../ui'
import { CHAT_DEFAULT_KEYS, RANGES, percentToThreshold, thresholdToPercent } from './parts/chat-defaults'
import { Block, Hint } from './parts/layout'

const T = SETTINGS_STRINGS.chat

export default function ChatDefaultsPage() {
  const temperature = useSettingsStore((s) => s.settings.temperature)
  const topP = useSettingsStore((s) => s.settings.topP)
  const topK = useSettingsStore((s) => s.settings.topK)
  const maxTokens = useSettingsStore((s) => s.settings.maxTokens)
  const threshold = useSettingsStore((s) => s.settings.autoCompactThreshold)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const autoRead = useVoiceStore((s) => s.autoReadAloud)
  const ttsEnabled = useVoiceStore((s) => s.ttsEnabled)
  const percent = thresholdToPercent(threshold)

  const reset = async () => {
    const yes = await nav.confirm({ title: T.resetQuestion, text: T.resetText, confirmLabel: T.resetConfirm, tone: 'danger', testid: 'chat-defaults-reset' })
    if (!yes) return
    useSettingsStore.getState().resetSettingsKeys([...CHAT_DEFAULT_KEYS])
    toast(T.resetDone, { testid: 'chat-defaults-reset' })
  }

  return (
    <Page title={T.title} screen="settings-chat">
      <Block lead>
        <Hint>{T.intro}</Hint>
        <Slider
          label={T.temperature}
          value={temperature}
          onChange={(value) => updateSettings({ temperature: value })}
          {...RANGES.temperature}
          format={(v) => v.toFixed(1)}
          testid="m-settings-chat-temperature"
          el="E5.1"
        />
        <Hint>{T.temperatureHint}</Hint>
        <Slider label={T.topP} value={topP} onChange={(value) => updateSettings({ topP: value })} {...RANGES.topP} format={(v) => v.toFixed(2)} testid="m-settings-chat-top-p" el="E5.2" />
        <Slider label={T.topK} value={topK} onChange={(value) => updateSettings({ topK: value })} {...RANGES.topK} testid="m-settings-chat-top-k" el="E5.3" />
        <Slider
          label={T.maxTokens}
          value={maxTokens}
          onChange={(value) => updateSettings({ maxTokens: value })}
          {...RANGES.maxTokens}
          format={(v) => (v === 0 ? T.maxTokensAuto : String(v))}
          testid="m-settings-chat-max-tokens"
          el="E5.4"
        />
        <Hint>{T.maxTokensHint}</Hint>
      </Block>

      <Block>
        <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          <strong id="m-compact-label">{T.compact}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--m-s3)', flexWrap: 'wrap' }}>
            <NumberField
              label={T.compact}
              value={percent}
              onChange={(value) => updateSettings({ autoCompactThreshold: percentToThreshold(value) })}
              {...RANGES.compactPercent}
              testid="m-settings-chat-compact"
              el="E5.5"
            />
            <span className="m-mono" data-testid="m-settings-chat-compact-value">
              {percent === 0 ? T.compactOff : `${percent}%`}
            </span>
          </div>
          <Hint>{T.compactHint}</Hint>
        </div>
      </Block>

      {/* One place switches reading aloud: Voice (E11.4). This row shows the state and leads there. */}
      <ListGroup>
        <Row
          title={T.readAloud}
          subtitle={T.readAloudSub}
          value={autoRead && ttsEnabled ? SETTINGS_STRINGS.common.on : SETTINGS_STRINGS.common.off}
          onPress={() => nav.push('/settings/voice')}
          testid="m-settings-chat-read-aloud"
          el="E5.6"
        />
      </ListGroup>

      <Block lead>
        <Button block icon={RotateCcw} onPress={() => void reset()} risk="destructive" testid="m-settings-chat-reset" el="E5.7">
          {T.reset}
        </Button>
      </Block>
    </Page>
  )
}
