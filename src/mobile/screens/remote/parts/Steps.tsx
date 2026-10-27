/**
 * The tool steps of one answer in Agent mode: what the model did on the
 * desktop, in order. Each step opens to its input and its result. A step
 * that was refused names the switch on the desktop that is off.
 */
import { useState } from 'react'
import { Download } from 'lucide-react'
import type { RemoteAgentStep, RemoteStepMedia } from '../../../remote/remoteAgent'
import { REMOTE_STRINGS as S } from '../../../strings/remote'
import { Button, Spinner } from '../../../ui'
import { saveWithToast } from '../../create/parts/actions'
import { ResultMediaView, useGalleryItem } from '../../create/parts/ui'
import { stepPermissionName, stepTitle } from './view'

/**
 * A17: an image or a video that image_generate or video_generate made on the
 * computer. It lives in the gallery of the phone; here it shows, plays, opens
 * in the result view and saves.
 */
function StepMedia({ media, n, total }: { media: RemoteStepMedia; n: number; total: number }) {
  const item = useGalleryItem(media.id)
  const [saving, setSaving] = useState(false)
  if (!item) {
    return (
      <p className="m-remote-step-hint" data-testid="m-remote-chat-step-media-gone">
        {S.steps.gone}
      </p>
    )
  }
  return (
    <div className="m-k-box m-remote-step-media" data-testid="m-remote-chat-step-media" data-m-id={item.id} data-m-kind={item.type} aria-label={S.steps.madeLabel(n, total)}>
      <ResultMediaView item={item} openTestid="m-remote-chat-step-media-open" />
      <Button
        compact
        icon={Download}
        busy={saving}
        risk="sensor"
        onPress={() => {
          setSaving(true)
          void saveWithToast(item).finally(() => setSaving(false))
        }}
        testid="m-remote-chat-step-media-save"
      >
        {S.steps.save}
      </Button>
    </div>
  )
}

function stateText(step: RemoteAgentStep): string {
  return step.state === 'running' ? S.steps.running : step.state === 'done' ? S.steps.done : S.steps.failed
}

export function Steps({ steps }: { steps: readonly RemoteAgentStep[] }) {
  if (steps.length === 0) return null
  return (
    <div className="m-remote-steps-box" data-testid="m-remote-chat-steps" aria-label={S.steps.title(steps.length)}>
      <p className="m-remote-steps-title">{S.steps.title(steps.length)}</p>
      {steps.map((step) => (
        <div key={step.id}>
          <details className="m-remote-step" data-testid="m-remote-chat-step" data-m-state={step.state} data-m-tool={step.tool}>
            <summary>
              <span className="m-remote-step-name">{stepTitle(step)}</span>
              <span className={`m-remote-step-state m-remote-step-state--${step.state}`}>
                {step.state === 'running' ? <Spinner label={S.steps.running} /> : null}
                {stateText(step)}
              </span>
            </summary>
            <div className="m-remote-step-body">
              {step.needsPermission ? (
                <p className="m-remote-step-hint" data-testid="m-remote-chat-step-permission">
                  {S.steps.needsPermission(stepPermissionName(step))}
                </p>
              ) : null}
              {step.args && step.args !== '{}' ? (
                <>
                  <span className="m-remote-step-label">{S.steps.input}</span>
                  <pre>{step.args}</pre>
                </>
              ) : null}
              {step.state === 'running' ? null : (
                <>
                  <span className="m-remote-step-label">{S.steps.result}</span>
                  <pre>{step.result || S.steps.noResult}</pre>
                </>
              )}
            </div>
          </details>
          {step.media?.map((m, i) => <StepMedia key={m.id} media={m} n={i + 1} total={step.media?.length ?? 1} />)}
        </div>
      ))}
    </div>
  )
}
