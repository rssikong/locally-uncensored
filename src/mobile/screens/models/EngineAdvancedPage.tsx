/**
 * E13.8 Advanced. Route /settings/engine/advanced, strand 4.
 *
 * The engine settings few people touch: the layers on the graphics chip (not
 * on Android, which has no graphics path), flash attention and the cache
 * types for keys and values. All of them act on the phone engine
 * (mobile-docs/ENGINE-NACHZUG.md section 5), and a change loads the model
 * again, because the settings are part of what the running engine is.
 *
 * Not here on purpose: memory mapping and locking memory (the phone engine
 * never changes them) and the cache type q4_0 (it makes small models
 * unusable; a stored q4_0 runs as q8_0 and is shown as that).
 */
import { MODELS_STRINGS as S } from '../../strings/models'
import { NumberField, Page, Segmented } from '../../ui'
import { EngineNotices } from '../../resilience/EngineNotices'
import { Block, Para } from './parts/bits'
import { useDevice } from './parts/device'
import { applyEngineSettings, applyEngineSettingsSoon } from './parts/engine'
import { sayApplied } from './parts/say'
import { phoneCacheType, setTuning, useTuning, type PhoneCacheType } from './parts/tuning'

type Flash = 'auto' | 'on' | 'off'

const CACHE: ReadonlyArray<{ value: PhoneCacheType; label: string }> = [
  { value: 'f16', label: 'f16' },
  { value: 'q8_0', label: 'q8_0' },
]

const ALL_LAYERS = 100

function applyNow(): void {
  void applyEngineSettings().then((outcome) => sayApplied(outcome))
}

export default function EngineAdvancedPage() {
  const tuning = useTuning()
  const { device } = useDevice()
  const graphics = device?.platform !== 'android'
  const flashOff = tuning.flashAttn === 'off'

  return (
    <Page title={S.engine.advancedTitle} screen="settings-engine-advanced">
      <Para cap testid="m-settings-engine-advanced-lead">
        {S.engine.advancedLead}
      </Para>
      <EngineNotices variant="box" only="tuning" />

      {graphics ? (
        <>
          <h2 className="m-label m-group-label">{S.engine.layers}</h2>
          <Block>
            <NumberField
              label={S.engine.layers}
              value={tuning.gpuLayers < 0 ? ALL_LAYERS : Math.min(tuning.gpuLayers, ALL_LAYERS)}
              min={0}
              max={ALL_LAYERS}
              step={10}
              format={(v) => (v >= ALL_LAYERS ? S.engine.layersAll : String(v))}
              onChange={(value) => {
                setTuning({ gpuLayers: value >= ALL_LAYERS ? -1 : value })
                applyEngineSettingsSoon((outcome) => sayApplied(outcome))
              }}
              testid="m-settings-engine-advanced-layers"
            />
          </Block>
          <Para cap>{S.engine.layersSub}</Para>
        </>
      ) : null}

      <h2 className="m-label m-group-label">{S.engine.flash}</h2>
      <Block>
        <Segmented<Flash>
          label={S.engine.flash}
          testid="m-settings-engine-advanced-flash"
          value={tuning.flashAttn}
          onChange={(value) => {
            setTuning({ flashAttn: value })
            applyNow()
          }}
          options={[
            { value: 'auto', label: S.engine.flashAuto, testid: 'm-settings-engine-advanced-flash-auto' },
            { value: 'on', label: S.engine.flashOn, testid: 'm-settings-engine-advanced-flash-on' },
            { value: 'off', label: S.engine.flashOff, testid: 'm-settings-engine-advanced-flash-off' },
          ]}
        />
      </Block>
      <Para cap>{S.engine.flashSub}</Para>

      <h2 className="m-label m-group-label">{S.engine.cacheK}</h2>
      <Block>
        <Segmented<PhoneCacheType>
          label={S.engine.cacheK}
          testid="m-settings-engine-advanced-cachek"
          value={phoneCacheType(tuning.cacheTypeK)}
          onChange={(value) => {
            setTuning({ cacheTypeK: value })
            applyNow()
          }}
          options={CACHE.map((o) => ({ ...o, testid: `m-settings-engine-advanced-cachek-${o.value}` }))}
        />
      </Block>

      <h2 className="m-label m-group-label">{S.engine.cacheV}</h2>
      <Block>
        <Segmented<PhoneCacheType>
          label={S.engine.cacheV}
          testid="m-settings-engine-advanced-cachev"
          value={phoneCacheType(tuning.cacheTypeV)}
          onChange={(value) => {
            setTuning({ cacheTypeV: value })
            applyNow()
          }}
          options={CACHE.map((o) => ({ ...o, testid: `m-settings-engine-advanced-cachev-${o.value}` }))}
        />
      </Block>
      <Para cap testid="m-settings-engine-advanced-cache-hint">
        {flashOff && phoneCacheType(tuning.cacheTypeV) === 'q8_0' ? S.engine.cacheSubFlashOff : S.engine.cacheSub}
      </Para>
    </Page>
  )
}
