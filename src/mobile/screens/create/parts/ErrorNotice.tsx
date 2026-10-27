/**
 * The box for a run that went wrong: what happened, whether it cost
 * anything, and the next step.
 */
import type { ReactNode } from 'react'
import { useCreateStore } from '../../../../stores/createStore'
import { signalCreditsExhausted } from '../../../../lib/credits-exhausted'
import { Button, Notice, toast } from '../../../ui'
import { copyText } from '../../../platform/clipboard'
import { nav } from '../../../nav'
import { CREATE_STRINGS as T } from '../../../strings/create'
import { storeSentence } from '../../../policy/server-text'
import { explainError, phoneSentence, type ExplainedError } from './errors'
import { creditsLabel } from './params'
import { purchaseView } from './policy'

export interface ErrorNoticeProps {
  message: string
  /** A job of this run is still booked: a lost connection did not end it. */
  stillBooked: boolean
  onRetry: () => void
  retryDisabled?: boolean
  testid?: string
  /** What "Dismiss" does. Default: clear the error of the main page of Create. */
  onDismiss?: () => void
  /**
   * The notice stands on a page that shows price and inputs itself (a guided
   * preset): no button that leads to the sheets of the main page.
   */
  inPlace?: boolean
}

interface Shown {
  /** None for a request limit: there the sentence of the server stands alone. */
  title?: string
  text: ReactNode
  variant: 'error' | 'warn' | 'info'
  action?: { label: string; onPress: () => void }
  /** An error the app has no own sentence for: the wording of the server can be copied for support. */
  details?: string
}

async function copyDetails(raw: string): Promise<void> {
  const ok = await copyText(raw)
  toast(ok ? T.copied : T.copyFailed, { tone: ok ? 'default' : 'error', testid: 'create-copied' })
}

function shown(e: ExplainedError, p: ErrorNoticeProps): Shown {
  const E = T.error
  const retry = { label: E.retry, onPress: p.onRetry }
  switch (e.kind) {
    case 'network':
      if (p.stillBooked) return { title: E.networkRunningTitle, text: T.runningOffline, variant: 'warn', action: { label: E.openGallery, onPress: () => nav.push('/create/gallery') } }
      return { title: E.networkTitle, text: E.networkText, variant: 'error', action: retry }
    case 'credits':
    case 'video-budget':
    case 'trainings': {
      // A surface that leads to buying follows the store rules: a button, a sentence, or neither.
      const reason = e.kind === 'credits' ? 'credits' : e.kind === 'video-budget' ? 'video_budget' : 'trainings'
      const title = e.kind === 'credits' ? E.creditsTitle : e.kind === 'video-budget' ? E.videoBudgetTitle : E.trainingsTitle
      const mode = purchaseView().mode
      const neutral = e.kind === 'credits' ? T.policy.creditsNeutral : e.kind === 'video-budget' ? T.policy.videoBudgetNeutral : T.policy.trainingsNeutral
      if (mode === 'none') return { title, text: neutral, variant: 'error' }
      // 'text-only': the neutral text and the one sentence a store allows, no other word about plans.
      if (mode === 'text-only') return { title, text: `${neutral} ${T.policy.plansElsewhere}`, variant: 'error' }
      const text = e.kind === 'credits' ? E.creditsText : e.kind === 'video-budget' ? E.videoBudgetText : E.trainingsText
      return { title, text, variant: 'error', action: { label: E.seePlans, onPress: () => signalCreditsExhausted(reason) } }
    }
    case 'price-changed':
      return {
        title: E.priceTitle,
        text: e.credits ? E.priceText(creditsLabel(e.credits).replace(/ credits?$/, '')) : E.priceTextPlain,
        variant: 'warn',
        action: p.inPlace ? undefined : { label: E.reviewPrice, onPress: () => nav.openSheet('run-settings') },
      }
    case 'signed-out':
      return { title: E.signedOutTitle, text: E.signedOutText, variant: 'error', action: { label: E.signIn, onPress: () => nav.push('/settings/account') } }
    case 'policy':
      return { title: E.policyServerTitle, text: phoneSentence(e.raw), variant: 'error' }
    case 'policy-account':
      return { title: E.policyTitle, text: E.policyAccountText, variant: 'error', action: { label: E.openPolicy, onPress: () => nav.push('/settings/content-policy') } }
    case 'still-rendering':
      return { title: E.stillTitle, text: E.stillText, variant: 'info', action: { label: E.openGallery, onPress: () => nav.push('/create/gallery') } }
    case 'cannot-stop':
      return { title: E.cannotStopTitle, text: E.cannotStopText, variant: 'warn', action: { label: E.openGallery, onPress: () => nav.push('/create/gallery') } }
    case 'too-fast':
      // The sentence of the server is the message itself, word for word and with no title above it (lib/request-limit.ts).
      return { text: e.raw, variant: 'warn', action: retry }
    case 'too-large':
      return { title: E.tooLargeTitle, text: E.tooLargeText, variant: 'error', action: p.inPlace ? undefined : { label: E.chooseAnother, onPress: () => nav.openSheet('source') } }
    case 'format':
      return { title: E.formatTitle, text: E.formatText, variant: 'error', action: p.inPlace ? undefined : { label: E.chooseAnother, onPress: () => nav.openSheet('source') } }
    case 'expired':
      return { title: E.expiredTitle, text: E.expiredText, variant: 'error', action: { label: E.openGallery, onPress: () => nav.push('/create/gallery') } }
    case 'not-live':
      return { title: E.notLiveTitle, text: E.notLiveText, variant: 'warn' }
    case 'partial':
      return { title: E.partialTitle, text: phoneSentence(e.raw), variant: 'warn' }
    case 'needs-input':
      return { title: E.inputTitle, text: phoneSentence(e.raw), variant: 'warn' }
    default:
      return { title: E.failedTitle, text: phoneSentence(e.raw), variant: 'error', action: retry, details: storeSentence(e.raw).trim() || undefined }
  }
}

export function ErrorNotice(props: ErrorNoticeProps) {
  const e = explainError(props.message)
  const s = shown(e, props)
  const testid = props.testid ?? 'm-create-error'
  return (
    <div data-m-kind={e.kind} data-m-purchase={e.kind === 'credits' || e.kind === 'video-budget' || e.kind === 'trainings' ? purchaseView().mode : undefined}>
      <Notice
        variant={s.variant}
        title={s.title}
        testid={testid}
        actions={
          <>
            {s.action ? (
              <Button compact onPress={s.action.onPress} disabled={props.retryDisabled && s.action.label === T.error.retry} testid={`${testid}-action`}>
                {s.action.label}
              </Button>
            ) : null}
            {s.details ? (
              <Button compact variant="quiet" onPress={() => void copyDetails(s.details ?? '')} testid={`${testid}-copy`}>
                {T.error.copyDetails}
              </Button>
            ) : null}
            <Button compact variant="quiet" onPress={props.onDismiss ?? (() => useCreateStore.getState().setError(null))} testid={`${testid}-dismiss`}>
              {T.error.dismiss}
            </Button>
          </>
        }
      >
        {s.text}
      </Notice>
    </div>
  )
}
