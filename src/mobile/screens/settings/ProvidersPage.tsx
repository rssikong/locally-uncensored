/**
 * E12 Providers. Route /settings/providers, page, strand 5 (Account, cloud, settings).
 *
 * What LU can answer with: the engine on this phone, LU Cloud, and providers
 * the user brings a key for. Each row shows its state and leads to its page.
 */
import { Cloud, Cpu, KeyRound, Link2 } from 'lucide-react'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { useProviderStore } from '../../../stores/providerStore'
import { nav } from '../../nav'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { ListGroup, Page, Row } from '../../ui'
import { Block, Hint } from './parts/layout'
import { ownProviders, slotOf, type OwnProvider } from './parts/providers'

const T = SETTINGS_STRINGS.providers

export default function ProvidersPage() {
  const signedIn = useCloudAuthStore((s) => s.status === 'signed-in' && !!s.user)
  const slots = useProviderStore((s) => s.providers)

  const stateOf = (provider: OwnProvider): string => {
    const config = slots[slotOf(provider)]
    if (!config?.apiKey) return T.stateNotSetUp
    return config.enabled ? T.stateOn : T.stateKeySaved
  }

  return (
    <Page title={T.title} screen="settings-providers">
      <Block lead>
        <Hint>{T.intro}</Hint>
      </Block>
      <ListGroup title={T.groupBuiltIn}>
        <Row icon={Cpu} title={T.engine} subtitle={T.engineSub} onPress={() => nav.push('/settings/engine')} testid="m-settings-providers-engine" el="E12.1" />
        <Row
          icon={Cloud}
          title={T.cloud}
          value={signedIn ? T.cloudOn : T.cloudOff}
          onPress={() => nav.push('/settings/account')}
          testid="m-settings-providers-cloud"
          el="E12.1"
        />
      </ListGroup>
      <ListGroup title={T.groupOwn} testid="m-settings-providers-own">
        {ownProviders(T.custom).map((p) => (
          <Row
            key={p.id}
            icon={p.id === 'custom' ? Link2 : KeyRound}
            title={p.name}
            value={stateOf(p)}
            onPress={() => nav.push('/settings/providers/:id', { id: p.id })}
            testid={`m-settings-providers-row-${p.id}`}
            el="E12.1"
          />
        ))}
      </ListGroup>
      <Block>
        <Hint>{T.keyStorage}</Hint>
      </Block>
    </Page>
  )
}
