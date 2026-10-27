/**
 * E21 What is new. Route /whats-new, page, strand 5 (Account, cloud, settings).
 *
 * The notes of the phone version (strings/release-notes.ts). Opens once per
 * version by itself (parts/services.ts), after that from About. Reading it,
 * by "Got it" or by going back, marks the version as seen.
 */
import { useEffect } from 'react'
import { Check } from 'lucide-react'
import { useReleaseNotesStore } from '../../../stores/releaseNotesStore'
import { nav } from '../../nav'
import { MOBILE_RELEASE_NOTES, mobileReleaseNoteFor } from '../../strings/release-notes'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, Icon, Page } from '../../ui'
import { APP_VERSION } from './parts/app-info'
import { Block, Heading, Hint } from './parts/layout'

const T = SETTINGS_STRINGS.whatsNew

export default function WhatsNewPage() {
  // The version that runs, or the newest one that has notes.
  const note = mobileReleaseNoteFor(APP_VERSION) ?? MOBILE_RELEASE_NOTES[0]

  useEffect(() => {
    useReleaseNotesStore.getState().markNotesSeen(APP_VERSION)
  }, [])

  return (
    <Page
      title={T.title}
      screen="whats-new"
      footer={
        <Button variant="primary" block onPress={() => void nav.back()} testid="m-whats-new-got-it" el="E21.1">
          {T.gotIt}
        </Button>
      }
    >
      {note ? (
        <Block lead testid="m-whats-new-notes">
          <span className="m-mono" data-testid="m-whats-new-version">
            {T.version(note.version)}
          </span>
          {note.headline ? <Heading>{note.headline}</Heading> : null}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--m-s3)' }}>
            {note.items.map((item) => (
              <li key={item} style={{ display: 'flex', gap: 'var(--m-s3)', alignItems: 'flex-start', color: 'var(--m-t2)' }}>
                <span style={{ color: 'var(--m-accent)', flex: 'none', marginTop: 2 }}>
                  <Icon icon={Check} small />
                </span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{item}</span>
              </li>
            ))}
          </ul>
        </Block>
      ) : (
        <Block lead testid="m-whats-new-empty">
          <Hint strong>{T.empty}</Hint>
        </Block>
      )}
    </Page>
  )
}
