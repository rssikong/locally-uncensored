/**
 * E18 Content policy. Route /settings/content-policy, page, strand 5 (Account, cloud, settings).
 *
 * The setting belongs to the LU Cloud account and lives on the server; the
 * page shows what the server says and sends the choice back. "Off" asks for
 * the age first where the server wants that. A choice that could not be
 * saved goes back to what it was, and the page says so.
 */
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, LogIn, RefreshCw } from 'lucide-react'
import { getContentPolicy, setContentPolicy, type ContentPolicy, type ContentPolicyState } from '../../../api/cloud/jobs'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { nav } from '../../nav'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, ListGroup, Notice, Page, Progress, Row, toast } from '../../ui'
import { Block, Hint } from './parts/layout'
import { LINKS, openLink } from './parts/links'
import { storePolicy } from './parts/policy'
import { levelName, offeredLevels, showsBuyText } from './parts/store-rules'

const T = SETTINGS_STRINGS.contentPolicy

const CHOICES: ReadonlyArray<{ value: ContentPolicy; title: string; text: string }> = [
  { value: 'strict', title: T.strict, text: T.strictText },
  { value: 'soft', title: T.standard, text: T.standardText },
  { value: 'off', title: T.off, text: T.offText },
]

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; state: ContentPolicyState }

export default function ContentPolicyPage() {
  const signedIn = useCloudAuthStore((s) => s.status === 'signed-in' && !!s.user)
  const probing = useCloudAuthStore((s) => s.status === 'probing')
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [saving, setSaving] = useState<ContentPolicy | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)

  const read = useCallback(async () => {
    setLoad({ kind: 'loading' })
    try {
      setLoad({ kind: 'ready', state: await getContentPolicy() })
    } catch {
      setLoad({ kind: 'failed' })
    }
  }, [])

  useEffect(() => {
    if (signedIn) void read()
  }, [signedIn, read])

  const choose = async (policy: ContentPolicy) => {
    if (load.kind !== 'ready' || saving || policy === load.state.policy) return
    // Never send a level this build does not offer, whatever was tapped.
    if (!offeredLevels(storePolicy().contentLevels).includes(policy)) return
    let ageConfirmed = false
    if (policy === 'off' && load.state.ageConfirmationRequired && !load.state.ageConfirmedAt) {
      ageConfirmed = await nav.confirm({ title: T.ageQuestion, text: T.ageText, confirmLabel: T.ageConfirm, cancelLabel: T.ageCancel, testid: 'content-policy-age' })
      if (!ageConfirmed) return
    }
    setSaving(policy)
    setSaveFailed(false)
    try {
      const saved = await setContentPolicy(policy, ageConfirmed)
      setLoad({ kind: 'ready', state: { ...load.state, policy: saved, ageConfirmedAt: ageConfirmed ? new Date().toISOString() : load.state.ageConfirmedAt } })
      toast(T.saved, { testid: 'content-policy-saved' })
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(null)
    }
  }

  const state = probing ? 'probing' : !signedIn ? 'signed-out' : load.kind
  const current = load.kind === 'ready' ? load.state.policy : null
  // Which levels this build may offer is the store's call: all, without "Off", or none (shown, not chosen).
  const policy = storePolicy()
  const offered = offeredLevels(policy.contentLevels)
  const choices = CHOICES.filter((choice) => offered.includes(choice.value))

  return (
    <Page title={T.title} screen="settings-content-policy" needsNetwork>
      <div data-testid="m-settings-content-policy-state" data-state={state} data-policy={current ?? ''}>
        <Block lead>
          <Hint>{T.intro}</Hint>
        </Block>

        {state === 'signed-out' ? (
          <Notice
            title={T.signedOutTitle}
            testid="m-settings-content-policy-signed-out"
            actions={
              <Button compact icon={LogIn} onPress={() => nav.push('/settings/account')} testid="m-settings-content-policy-signin">
                {SETTINGS_STRINGS.common.signIn}
              </Button>
            }
          >
            {T.signedOutText}
          </Notice>
        ) : null}

        {state === 'probing' || state === 'loading' ? (
          <Block testid="m-settings-content-policy-loading">
            <Progress label={T.loading} detail={T.loading} />
          </Block>
        ) : null}

        {state === 'failed' ? (
          <Notice
            variant="error"
            testid="m-settings-content-policy-load-failed"
            actions={
              <Button compact icon={RefreshCw} onPress={() => void read()} testid="m-settings-content-policy-retry">
                {SETTINGS_STRINGS.common.checkAgain}
              </Button>
            }
          >
            {T.loadFailed}
          </Notice>
        ) : null}

        {choices.length === 0 ? (
          <>
            <ListGroup title={T.fixedTitle}>
              <Row title={current ? levelName(current) : SETTINGS_STRINGS.common.notAvailable} testid="m-settings-content-policy-fixed" />
            </ListGroup>
            <Block>
              <Hint strong testid="m-settings-content-policy-fixed-text">
                {T.fixedText}
              </Hint>
              {showsBuyText(policy.purchase) ? (
                <Button block icon={ExternalLink} onPress={() => void openLink(LINKS.account)} risk="leaves-app" testid="m-settings-content-policy-fixed-open">
                  {T.fixedOpen}
                </Button>
              ) : null}
            </Block>
          </>
        ) : null}

        {choices.length > 0 && current && !offered.includes(current) ? <Notice testid="m-settings-content-policy-off-elsewhere">{T.offElsewhere}</Notice> : null}

        {choices.length > 0 ? (
        <ListGroup title={T.group} role="radiogroup" label={T.group} testid="m-settings-content-policy-list" el="E18.1">
          {choices.map((choice) => (
            <Row
              key={choice.value}
              title={choice.title}
              subtitle={saving === choice.value ? T.saving : choice.text}
              disabled={state !== 'ready' || !!saving}
              radio={{ checked: (saving ?? current) === choice.value, onSelect: () => void choose(choice.value) }}
              testid={`m-settings-content-policy-${choice.value}`}
              el="E18.1"
            />
          ))}
        </ListGroup>
        ) : null}

        {saveFailed ? (
          <Notice variant="error" testid="m-settings-content-policy-save-failed">
            {T.saveFailed}
          </Notice>
        ) : null}
      </div>
    </Page>
  )
}
