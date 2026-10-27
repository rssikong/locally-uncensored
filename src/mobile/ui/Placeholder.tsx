import { Construction } from 'lucide-react'
import { devSwitches } from '../boot/dev'
import { navApi } from '../nav/api'
import { Button } from './Button'
import { Icon } from './Icon'
import { Page, RootPage } from './Page'
import { Sheet } from './Sheet'

export interface PlaceholderProps {
  /** Screen code from DESIGN.md ("C8"). */
  code: string
  title: string
  /** Screen slug for data-testid m-<screen>-screen. */
  screen: string
  /** Element numbers of this screen from DESIGN.md ("C8.1"). */
  elements: readonly string[]
  /** root: tab root with large title. flow: no back on the first step. */
  kind?: 'root' | 'page' | 'full' | 'flow'
  noBack?: boolean
}

function Body({ code, elements }: { code: string; elements: readonly string[] }) {
  return (
    <div className="m-ph" data-testid="m-placeholder">
      <span className="m-ph-code m-mono">{code}</span>
      <div className="m-rowh m-t3">
        <Icon icon={Construction} small />
        <span className="m-cap">This screen is not available.</span>
      </div>
      {elements.length > 0 ? (
        <>
          <span className="m-label">Elements from the design</span>
          <div className="m-ph-list">
            {elements.map((el) => (
              <span className="m-tag m-mono" key={el}>
                {el}
              </span>
            ))}
          </div>
        </>
      ) : null}
      {devSwitches().devPages ? (
        <div className="m-rowh">
          <Button compact onPress={() => navApi.push('/dev/routes')} testid="m-placeholder-all">
            All screens
          </Button>
          <Button compact onPress={() => navApi.push('/dev/ui')} testid="m-placeholder-ui">
            UI catalogue
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * What every route shows until its strand has built it: code, title and the
 * element numbers from DESIGN.md. The strand replaces the whole body of the
 * file and deletes this call.
 */
export function ScreenPlaceholder(props: PlaceholderProps) {
  const { code, title, screen, elements, kind = 'page', noBack } = props
  if (kind === 'root') {
    return (
      <RootPage title={title} screen={screen}>
        <Body code={code} elements={elements} />
      </RootPage>
    )
  }
  return (
    <Page title={title} screen={screen} noBack={noBack}>
      <Body code={code} elements={elements} />
    </Page>
  )
}

export function SheetPlaceholder({ code, title, elements }: { code: string; title: string; elements: readonly string[] }) {
  return (
    <Sheet title={title}>
      <Body code={code} elements={elements} />
    </Sheet>
  )
}
