/**
 * G14 Continue?. Sheet "link-offer", opened with nav.openSheet('link-offer'),
 * strand 5 (Account, cloud, settings).
 *
 * A link from outside (lu://remote...) never acts by itself. It leaves an
 * offer (nav/deeplink.ts), and this sheet asks. "Continue" opens the Connect
 * page of the remote strand with the link handed over: it fills the fields,
 * nothing is connected before "Connect" there. An offer is valid for 5
 * minutes, after that the sheet says so and offers nothing.
 *
 * A sign in link is never offered here (review N3): the real return from
 * signing in is finished by the logic layer, and no other link can finish one.
 */
import { useEffect, useState } from 'react'
import { getRemoteClientStore } from '../remote/remoteClientStore'
import { currentLinkOffer, nav, useLinkOfferStore, useSheet, type LinkOffer } from '../nav'
import { Block, Hint } from '../screens/settings/parts/layout'
import { SETTINGS_STRINGS } from '../strings/settings'
import { Button, Notice, Sheet } from '../ui'

const T = SETTINGS_STRINGS.linkOffer

export default function LinkOfferSheet() {
  const { close } = useSheet()
  // Read once when the sheet opens, then watched: the offer can expire while it is on screen.
  const [offer, setOffer] = useState<LinkOffer | null>(() => currentLinkOffer())
  const [unreadable, setUnreadable] = useState(false)

  useEffect(() => {
    if (!offer) return
    const timer = window.setInterval(() => {
      if (!currentLinkOffer()) setOffer(null)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [offer])

  const dismiss = () => {
    useLinkOfferStore.getState().clear()
    close()
  }

  const goOn = () => {
    if (!offer) return
    if (!currentLinkOffer()) {
      setOffer(null)
      return
    }
    // Hand the link to the remote strand, which checks it and asks for the code on its Connect page.
    // Offer and Connect page read with the same reader, so this holds. If it ever does not, say so
    // instead of opening a page with empty fields.
    if (!getRemoteClientStore().useStore.getState().offerLink(offer.url)) {
      setUnreadable(true)
      return
    }
    useLinkOfferStore.getState().clear()
    close()
    nav.push('/remote/connect')
  }

  if (!offer) {
    return (
      <Sheet
        title={T.titleGone}
        footer={
          <Button block onPress={dismiss} testid="m-link-offer-dismiss" el="G14.2">
            {T.dismiss}
          </Button>
        }
      >
        <Block lead testid="m-link-offer-gone">
          <Hint strong>{T.textGone}</Hint>
        </Block>
      </Sheet>
    )
  }

  return (
    <Sheet
      title={T.titleRemote(offer.address)}
      footer={
        <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          {unreadable ? null : (
            <Button variant="primary" block onPress={goOn} testid="m-link-offer-continue" el="G14.1">
              {T.continue}
            </Button>
          )}
          <Button variant="quiet" block onPress={dismiss} testid="m-link-offer-dismiss" el="G14.2">
            {T.dismiss}
          </Button>
        </div>
      }
    >
      <Block lead>
        <div data-testid="m-link-offer-kind" data-kind={offer.kind}>
          <Hint strong>{T.textRemote}</Hint>
        </div>
        {unreadable ? (
          <Notice variant="error" testid="m-link-offer-failed">
            {T.unreadable}
          </Notice>
        ) : null}
      </Block>
    </Sheet>
  )
}
