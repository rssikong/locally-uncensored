/**
 * The page a closed route shows (policy/gates.ts): one calm sentence and the
 * way back. No word about a store, no word about why.
 */
import { useContext } from 'react'
import { navApi } from '../nav/api'
import { PageContext } from '../nav/context'
import { POLICY } from '../strings/policy'
import { Button, EmptyState, Page } from '../ui'
import { routeGate, type GateSwitch } from './gates'

export function unavailableText(gate: GateSwitch | null): string {
  if (gate === 'remoteDesktop') return POLICY.unavailableRemote
  if (gate === 'externalProviders') return POLICY.unavailableProviders
  return POLICY.unavailableText
}

export default function UnavailablePage() {
  const page = useContext(PageContext)
  const gate = page ? routeGate(page.entry.route) : null
  return (
    <Page title={POLICY.unavailableTitle} screen="unavailable">
      <EmptyState
        title={POLICY.unavailableTitle}
        testid="m-unavailable"
        actions={
          <Button block onPress={() => void navApi.back()} testid="m-unavailable-back">
            {POLICY.unavailableBack}
          </Button>
        }
      >
        {unavailableText(gate)}
      </EmptyState>
    </Page>
  )
}
