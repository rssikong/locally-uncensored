/**
 * The sheet "ai-consent": what goes to LU Cloud and on to third-party AI
 * providers, a link to the privacy policy, and the two answers (Apple
 * 5.1.2(i)). Opened only by ensureAiConsent() in policy/consent.ts.
 */
import { ExternalLink } from 'lucide-react'
import { navApi } from '../nav/api'
import { POLICY } from '../strings/policy'
import { Button, Sheet, toast } from '../ui'
import { answerAiConsent } from './consent'
import { LEGAL_LINKS, openAppLink } from './links'

async function openPrivacy(): Promise<void> {
  const result = await openAppLink(LEGAL_LINKS.privacy)
  if (!result.opened) toast(POLICY.consentPrivacyFailed, { tone: 'error', testid: 'consent-privacy-failed' })
}

export default function ConsentSheet() {
  const answer = (agreed: boolean) => {
    answerAiConsent(agreed)
    navApi.closeSheet()
  }
  return (
    <Sheet
      title={POLICY.consentTitle}
      footer={
        <div className="m-policy-actions">
          {/* In the footer and not in the text: the text scrolls, and on a small phone its end lay half under
              the footer, the link with it (round 30, H1). Here it is whole at every size the footer stands. */}
          <Button compact variant="quiet" icon={ExternalLink} onPress={() => void openPrivacy()} risk="leaves-app" testid="m-consent-privacy">
            {POLICY.consentPrivacy}
          </Button>
          <Button variant="primary" block onPress={() => answer(true)} testid="m-consent-agree">
            {POLICY.consentAgree}
          </Button>
          <Button block onPress={() => answer(false)} testid="m-consent-decline">
            {POLICY.consentDecline}
          </Button>
        </div>
      }
    >
      <div className="m-policy-text m-pad" data-testid="m-consent-text">
        <p>{POLICY.consentText}</p>
        <p>{POLICY.consentLocal}</p>
        <p className="m-cap">{POLICY.consentRevoke}</p>
      </div>
    </Sheet>
  )
}
