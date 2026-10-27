/**
 * Add credits. Sheet "settings-add-credits", strand 5 (Account, cloud, settings).
 *
 * Credits as an in-app purchase of the system (StoreKit, iOS). Exists only in
 * a build whose store switch `purchase` is 'in-app' AND that names the
 * address which credits a purchase (lib/iap.ts, iapOffered). No preset is
 * such a build today; in every other build this sheet says "Not part of this
 * version", and no button leads here.
 *
 * The packs, their names and their prices are the store's: the app shows
 * `displayPrice` as it comes and has no price of its own. Nothing here names
 * another place to buy, and nothing is a link.
 *
 * States: loading, no packs, packs could not be loaded, buying is switched
 * off on this device, bought and credited, waiting for approval ("Ask to
 * Buy"), bought and not credited yet. The last one is said as it is; the
 * purchase stays open and is handed in again (lib/iap-flow.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { buyCredits, iapAccountToken, iapOffered, loadIapProducts, resumeIapPurchases, useIapStore } from '../../lib/iap'
import { useSheet } from '../../nav'
import { iapFailureText, type IapProduct } from '../../platform/iap'
import { POLICY } from '../../strings/policy'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, EmptyState, ListGroup, Notice, Row, Sheet, SkeletonRows, Spinner } from '../../ui'
import { Block, Hint } from './parts/layout'

const T = SETTINGS_STRINGS.iap

type Packs = { state: 'loading' } | { state: 'error'; text: string } | { state: 'ready'; products: IapProduct[]; canPurchase: boolean }
type Result = { kind: 'credited' } | { kind: 'pending' } | { kind: 'late' } | { kind: 'error'; text: string } | { kind: 'note'; text: string } | null

export default function AddCreditsSheet() {
  const { close } = useSheet()
  // Read again when the account changes: a sheet that is open while the session ends has nothing left to sell to.
  const userId = useCloudAuthStore((s) => s.user?.id)
  const offered = iapOffered()
  const account = userId ? iapAccountToken() : null
  const late = useIapStore((s) => s.late)
  const [packs, setPacks] = useState<Packs>({ state: 'loading' })
  const [result, setResult] = useState<Result>(null)
  const [buying, setBuying] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const alive = useRef(true)
  const said = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    setPacks({ state: 'loading' })
    loadIapProducts().then(
      (answer) => {
        if (alive.current) setPacks({ state: 'ready', products: answer.products, canPurchase: answer.canPurchase })
      },
      (err) => {
        if (alive.current) setPacks({ state: 'error', text: iapFailureText(err) })
      },
    )
  }, [])

  useEffect(() => {
    alive.current = true
    if (offered && account) load()
    return () => {
      alive.current = false
    }
  }, [offered, account, load])

  // What a purchase ended in is said above the packs. With large text the tapped pack is far below that, so the
  // sentence is brought on screen: nobody should have to look for "your purchase went through".
  const resultKind = result?.kind ?? null
  useEffect(() => {
    if (resultKind) said.current?.scrollIntoView?.({ block: 'nearest' })
  }, [resultKind])

  if (!offered) {
    return (
      <Sheet
        title={POLICY.unavailableTitle}
        footer={
          <Button block onPress={close} testid="m-unavailable-close">
            {POLICY.unavailableClose}
          </Button>
        }
      >
        <p className="m-pad" data-testid="m-unavailable">
          {POLICY.unavailableText}
        </p>
      </Sheet>
    )
  }

  const buy = async (product: IapProduct) => {
    if (buying || restoring) return
    setBuying(product.id)
    setResult(null)
    try {
      const outcome = await buyCredits(product.id)
      if (!alive.current) return
      if (outcome.state === 'credited') setResult({ kind: 'credited' })
      else if (outcome.state === 'pending') setResult({ kind: 'pending' })
      else if (outcome.state === 'late') setResult({ kind: 'late' })
      // Closing the sheet of the system is not an error: nothing is said.
    } catch (err) {
      if (alive.current) setResult({ kind: 'error', text: iapFailureText(err) })
    } finally {
      if (alive.current) setBuying(null)
    }
  }

  const restore = async () => {
    if (buying || restoring) return
    setRestoring(true)
    setResult(null)
    try {
      const report = await resumeIapPurchases()
      if (!alive.current) return
      if (report.failed) setResult({ kind: 'error', text: T.restoreFailed })
      else if (report.late > 0) setResult({ kind: 'late' })
      else if (report.credited > 0) setResult({ kind: 'credited' })
      else setResult({ kind: 'note', text: T.restoreNothing })
    } catch {
      if (alive.current) setResult({ kind: 'error', text: T.restoreFailed })
    } finally {
      if (alive.current) setRestoring(false)
    }
  }

  // One sentence for a purchase that is bought and not credited, whether it happened just now or in an earlier run.
  const showLate = result?.kind === 'late' || (late > 0 && result?.kind !== 'credited')
  const busy = buying !== null || restoring

  return (
    <Sheet
      title={T.title}
      testid="m-iap-sheet"
      footer={
        <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          {account ? (
            <Button variant="quiet" block busy={restoring} disabled={buying !== null} label={restoring ? T.restoring : undefined} onPress={() => void restore()} testid="m-iap-restore">
              {T.restore}
            </Button>
          ) : null}
          <Button block onPress={close} testid="m-iap-close">
            {T.close}
          </Button>
        </div>
      }
    >
      <div data-testid="m-iap-state" data-state={!account ? 'signed-out' : packs.state} data-result={result?.kind ?? (showLate ? 'late' : 'none')}>
        {!account ? (
          <Notice testid="m-iap-sign-in">{T.signIn}</Notice>
        ) : (
          <>
            <Block lead>
              <Hint>{T.lead}</Hint>
            </Block>

            <div ref={said}>
              {showLate ? (
                <Notice variant="warn" testid="m-iap-late">
                  {T.late}
                </Notice>
              ) : null}
              {result?.kind === 'credited' ? (
                <Notice title={T.creditedTitle} testid="m-iap-credited">
                  {T.creditedText}
                </Notice>
              ) : null}
              {result?.kind === 'pending' ? (
                <Notice title={T.pendingTitle} testid="m-iap-pending">
                  {T.pendingText}
                </Notice>
              ) : null}
              {result?.kind === 'error' ? (
                <Notice variant="error" testid="m-iap-error">
                  {result.text}
                </Notice>
              ) : null}
              {result?.kind === 'note' ? <Notice testid="m-iap-note">{result.text}</Notice> : null}
            </div>

            {packs.state === 'loading' ? <SkeletonRows rows={3} label={T.loading} testid="m-iap-loading" /> : null}

            {packs.state === 'error' ? (
              <Notice
                variant="error"
                title={T.loadErrorTitle}
                testid="m-iap-load-error"
                actions={
                  <Button compact onPress={load} testid="m-iap-retry">
                    {T.retry}
                  </Button>
                }
              >
                {packs.text}
              </Notice>
            ) : null}

            {packs.state === 'ready' && packs.products.length === 0 ? (
              <EmptyState title={T.emptyTitle} testid="m-iap-empty">
                {T.emptyText}
              </EmptyState>
            ) : null}

            {packs.state === 'ready' && packs.products.length > 0 ? (
              <>
                {!packs.canPurchase ? (
                  <Notice variant="warn" testid="m-iap-not-allowed">
                    {T.notAllowed}
                  </Notice>
                ) : null}
                <ListGroup>
                  {packs.products.map((product) => (
                    <Row
                      key={product.id}
                      id={product.id}
                      title={product.displayName}
                      subtitle={product.description || undefined}
                      // The price is the text of the store, as it came. The app has none of its own.
                      value={buying === product.id ? undefined : product.displayPrice}
                      end={buying === product.id ? <Spinner label={T.buying} /> : undefined}
                      label={T.packLabel(product.displayName, product.displayPrice)}
                      chevron={false}
                      disabled={!packs.canPurchase || (busy && buying !== product.id)}
                      onPress={() => void buy(product)}
                      risk="paid"
                      testid="m-iap-pack"
                    />
                  ))}
                </ListGroup>
              </>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  )
}
