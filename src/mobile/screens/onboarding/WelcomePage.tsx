/**
 * A1 Welcome. Route /welcome, first step of the onboarding, strand 4.
 *
 * Says what LU is on a phone and offers the way in. A1.1 "Get started" goes
 * to A2. A1.2 "I have an LU Cloud account" opens the account page (E2) as a
 * page of the flow; once the user is signed in the flow moves on to A2,
 * where "Skip, use Cloud only" is offered.
 *
 * "Restoring your chats" after a lost WebView storage is shown by the boot
 * (boot/index.tsx) before this page exists, so it has no state here.
 */
import { useEffect, useRef } from 'react'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { nav, useIsTop } from '../../nav'
import { COMMON } from '../../strings/common'
import { MODELS_STRINGS as S } from '../../strings/models'
import { Button, Monogram, Page } from '../../ui'
import { installModelsWatch } from '../models/parts/watch'

export default function WelcomePage() {
  const status = useCloudAuthStore((s) => s.status)
  const email = useCloudAuthStore((s) => s.user?.email)
  const signedIn = status === 'signed-in'
  const isTop = useIsTop()
  const was = useRef(signedIn)

  useEffect(() => {
    installModelsWatch()
  }, [])

  useEffect(() => {
    // Signed in while the account page lies on top of this one: move on to A2.
    if (signedIn && !was.current && !isTop) {
      const stack = nav.getState().flowStack
      if (stack[stack.length - 1]?.route === '/settings/account') nav.replace('/setup/model')
    }
    was.current = signedIn
  }, [signedIn, isTop])

  return (
    <Page
      title={S.welcome.header}
      screen="onboarding"
      noBack
      footer={
        <>
          <Button variant="primary" block testid="m-onboarding-next" el="A1.1" onPress={() => nav.push('/setup/model')}>
            {S.welcome.start}
          </Button>
          <Button variant="quiet" block testid="m-onboarding-account" el="A1.2" onPress={() => (signedIn ? nav.push('/setup/model') : nav.push('/settings/account'))}>
            {signedIn ? (email ? S.welcome.signedIn(email) : S.welcome.signedInPlain) : S.welcome.account}
          </Button>
        </>
      }
    >
      <div className="m-empty" data-m-sparse="" data-testid="m-onboarding-intro">
        {/* The mark alone, no name under it. A screen reader hears the name from the mark. */}
        <Monogram size={56} className="m-empty-mark" label={COMMON.markName} />
        <p className="m-t2" style={{ maxWidth: '22rem' }}>{S.welcome.text}</p>
      </div>
    </Page>
  )
}
