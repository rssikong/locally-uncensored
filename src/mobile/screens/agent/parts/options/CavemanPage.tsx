import { useSettingsStore } from '../../../../../stores/settingsStore'
import type { CavemanMode } from '../../../../../types/settings'
import { AGENT_STRINGS as T } from '../../../../strings/agent'
import { Segmented, Sheet } from '../../../../ui'

const S = T.options.cavemanPage
const LEVELS: readonly CavemanMode[] = ['off', 'lite', 'full', 'ultra']

/** C5.9: Off, Lite, Full, Ultra. */
export function CavemanPage() {
  const level = useSettingsStore((s) => s.settings.cavemanMode)
  return (
    <Sheet title={S.title}>
      <div className="m-ag-block">
        <Segmented
          label={S.label}
          value={level}
          onChange={(next) => useSettingsStore.getState().updateSettings({ cavemanMode: next })}
          options={LEVELS.map((value) => ({ value, label: T.options.cavemanLevels[value], testid: `m-options-caveman-${value}` }))}
          testid="m-options-caveman"
          el="C5.9"
        />
      </div>
      <p className="m-ag-text">{S.text}</p>
    </Sheet>
  )
}
