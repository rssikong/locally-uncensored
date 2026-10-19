// The LU Cloud line in Create, for the run on screen whose local model does
// not fit (lib/cloud-offer.ts: createOfferReason). It stands with the other
// quiet lines above the stage and can be closed for the session.
//
// The verdict is the one the model picker and the waiting area already use
// (hooks/useLocalModelFit) on a PC, and the two Mac sentences of
// MacVideoMemoryNotice on a Mac. Nothing is estimated here.

import { useMemo } from 'react'
import { Cloud } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { useUIStore } from '../../../stores/uiStore'
import { isMlxImageHost } from '../../../api/mlx-image'
import { useLocalModelFits } from '../../../hooks/useLocalModelFit'
import { Hinweis } from '../../ui/Hinweis'
import { createOfferLine, createOfferReason, isCloudOfferIntent, offerCreditsLine } from '../../../lib/cloud-offer'
import { CloudOfferButton, useCloudOfferAllowed, useOfferCredits } from '../../cloud/CloudOffer'
import { useLocalPick } from './localPick'
import { useMacVideoFacts } from './MacVideoMemoryNotice'

export function CreateCloudOffer() {
  const backend = useCreateStore((s) => s.backend)
  const intent = useCreateStore((s) => s.intent())
  const dismissed = useUIStore((s) => s.cloudOfferDismissed)
  const setDismissed = useUIStore((s) => s.setCloudOfferDismissed)
  const allowed = useCloudOfferAllowed()
  const local = backend === 'local'
  const macHost = isMlxImageHost()
  const { list, value } = useLocalPick()
  // Off the local lane nothing is weighed: no disk read for a card verdict
  // nobody is going to see.
  const picked = useMemo(
    () => (local && !macHost ? list.filter((m) => m.name === value) : []),
    [local, macHost, list, value],
  )
  const { fitOf } = useLocalModelFits(picked)
  const mac = useMacVideoFacts()
  const task = isCloudOfferIntent(intent) ? intent : 'image'
  const credits = useOfferCredits(task)

  if (!local || !allowed || dismissed || !isCloudOfferIntent(intent)) return null
  const reason = createOfferReason({
    intent,
    macHost,
    fit: macHost ? 'unknown' : fitOf(value),
    macMemoryShort: !!mac.line,
    macLongRun: !!mac.duration,
  })
  if (!reason) return null
  const price = offerCreditsLine(credits)
  return (
    <Hinweis
      icon={<Cloud size={12} className="shrink-0 mt-px text-lu-cloud dark:text-lu-cloud-lift" />}
      onDismiss={() => setDismissed(true)}
      className="px-4 py-2 shrink-0"
    >
      <span data-testid="cloud-offer-create" data-reason={reason}>
        {createOfferLine(reason, intent)}
        {price && <span data-testid="cloud-offer-credits"> {price}</span>}
      </span>{' '}
      <CloudOfferButton task={intent} />
    </Hinweis>
  )
}
