/**
 * E20.2 Licenses. Sheet "settings-licenses", opened from About LU, strand 5
 * (Account, cloud, settings). The license of LU itself and of the software
 * it is built with; the full texts are in the source repository.
 */
import { ExternalLink } from 'lucide-react'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, ListGroup, Row, Sheet } from '../../ui'
import { Block, Hint } from './parts/layout'
import { LICENSES } from './parts/licenses'
import { LINKS, openLink } from './parts/links'
import { appLinkAllowed } from '../../policy/links'

const T = SETTINGS_STRINGS.licenses

export default function LicensesSheet() {
  return (
    <Sheet
      title={T.title}
      // The full texts are in the repository. A build with the legal links only does not lead there (switch externalLinks).
      footer={
        appLinkAllowed(LINKS.licenses) ? (
          <Button block icon={ExternalLink} onPress={() => void openLink(LINKS.licenses)} risk="leaves-app" testid="m-settings-licenses-full">
            {T.full}
          </Button>
        ) : undefined
      }
    >
      <Block lead>
        <Hint>{T.intro}</Hint>
      </Block>
      <ListGroup>
        <Row title={T.own} subtitle={T.ownLicense} testid="m-settings-licenses-own" />
      </ListGroup>
      <ListGroup title={T.group} testid="m-settings-licenses-list">
        {LICENSES.map((entry) => (
          <Row key={entry.name} title={entry.name} value={entry.license} />
        ))}
      </ListGroup>
    </Sheet>
  )
}
