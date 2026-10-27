/**
 * K7.8 Enhance video. Sheet "create-enhance", opened with
 * nav.openSheet('create-enhance', { id }), strand 3 (Create).
 *
 * Resolution and price of a sharper copy of a cloud clip. The run itself is
 * hooks/useCloudCreate.ts enhanceVideo; it lands as a new clip in the gallery.
 */
import { useState } from 'react'
import { useCloudCreate } from '../../../hooks/useCloudCreate'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { runCredits } from '../../../stores/cloudCatalogStore'
import { useCreateStore } from '../../../stores/createStore'
import { nav, useSheet } from '../../nav'
import { useCloudOnline } from '../../resilience/useOnline'
import { CREATE_STRINGS as T } from '../../strings/create'
import { Button, EmptyState, Segmented, Sheet } from '../../ui'
import { creditsLabel } from './parts/params'
import { withAiConsent } from './parts/policy'
import { refreshQuota } from './parts/services'
import { useGalleryItem } from './parts/ui'

export default function EnhanceVideoSheet() {
  const { props } = useSheet<{ id?: string } | undefined>()
  const item = useGalleryItem(props?.id)
  const quota = useCloudAuthStore((s) => s.quota)
  const busy = useCreateStore((s) => s.isGenerating)
  const online = useCloudOnline()
  const { enhanceVideo } = useCloudCreate({ onQuotaChange: () => void refreshQuota() })
  const [target, setTarget] = useState<'720p' | '1080p'>('1080p')

  if (!item || item.type !== 'video' || !item.jobId) {
    return (
      <Sheet title={T.enhance.title}>
        <EmptyState title={T.result.gone} />
      </Sheet>
    )
  }
  const price = quota ? runCredits('video', 'upscale', item.model, undefined, quota.costs.video, target) : null
  const start = () =>
    void withAiConsent(() => {
      // The stage of K1 shows the run; the sharper clip lands in the gallery.
      void enhanceVideo(item, target)
      nav.resetTo('create')
    })
  return (
    <Sheet
      title={T.enhance.title}
      footer={
        <Button variant="cloud" risk="paid" block testid="m-create-enhance-render" el="K7.8" disabled={busy || !online} disabledReason={!online ? T.block.offline : undefined} onPress={start}>
          {price !== null ? T.enhance.start(creditsLabel(price)) : T.enhance.startPlain}
        </Button>
      }
    >
      <p className="m-cap m-k-pad">{T.enhance.text}</p>
      <div className="m-k-sec" style={{ paddingTop: 12 }}>
        <span className="m-label">{T.enhance.target}</span>
        <Segmented
          label={T.enhance.target}
          value={target}
          onChange={setTarget}
          options={[
            { value: '720p', label: '720p', testid: 'm-create-enhance-720p' },
            { value: '1080p', label: '1080p', testid: 'm-create-enhance-1080p' },
          ]}
          testid="m-create-enhance-target"
        />
      </div>
    </Sheet>
  )
}
