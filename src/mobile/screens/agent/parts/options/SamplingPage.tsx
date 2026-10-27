import { AGENT_STRINGS as T } from '../../../../strings/agent'
import { Button, Sheet, Slider, toast } from '../../../../ui'
import type { ChatSettings } from './chat-settings'

const S = T.options.samplingPage

/** Largest "Max length" the slider offers. 0 means the model decides. */
export const MAX_LENGTH_TOP = 8192
export const MAX_LENGTH_STEP = 256

/** C5.12: Temperature, Top P, Max length and "Reset to defaults", for this chat. */
export function SamplingPage({ chat }: { chat: ChatSettings }) {
  const { sampling } = chat
  return (
    <Sheet title={S.title}>
      <p className="m-ag-text">{chat.saved ? S.text : S.textNew}</p>
      <div className="m-ag-block m-stackv">
        <Slider label={S.temperature} value={sampling.temperature} min={0} max={2} step={0.1} format={(v) => v.toFixed(1)} onChange={(temperature) => chat.setSampling({ temperature })} testid="m-options-temperature" el="C5.12" />
        <span className="m-cap">{S.temperatureHint}</span>
        <Slider label={S.topP} value={sampling.topP} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(topP) => chat.setSampling({ topP })} testid="m-options-top-p" el="C5.12" />
        <Slider
          label={S.maxLength}
          value={Math.min(sampling.maxTokens, MAX_LENGTH_TOP)}
          min={0}
          max={MAX_LENGTH_TOP}
          step={MAX_LENGTH_STEP}
          format={(v) => (v === 0 ? S.noLimit : S.tokens(v))}
          onChange={(maxTokens) => chat.setSampling({ maxTokens })}
          testid="m-options-max-length"
          el="C5.12"
        />
        <span className="m-cap">{S.maxLengthHint}</span>
      </div>
      <div className="m-ag-actions">
        <Button
          block
          disabled={!chat.ownSampling}
          onPress={() => {
            chat.resetSampling()
            toast(S.resetDone, { testid: 'sampling-reset' })
          }}
          testid="m-options-sampling-reset"
          el="C5.12"
        >
          {S.reset}
        </Button>
      </div>
    </Sheet>
  )
}
