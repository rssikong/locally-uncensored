/**
 * Every route and every sheet of the shell in one list, to open each
 * placeholder by hand and from the layout test. Internal: only reachable with
 * the developer switch (a dev build, ?dev=1, or localStorage lu-mobile-dev=1).
 */
import { navApi } from '../nav/api'
import { ROUTE_IDS, routeDef, routeParamNames } from '../nav/routes'
import { SHEET_IDS, sheetDef } from '../nav/sheets'
import { TABS } from '../nav/types'
import { ListGroup, Page, Row } from '../ui'

/** Sample values for route parameters, so every page can be opened. */
function sampleParams(route: string): Record<string, string> {
  const params: Record<string, string> = {}
  for (const name of routeParamNames(route)) params[name] = name === 'id' && route === '/chat/:id' ? 'new' : `sample-${name}`
  return params
}

export default function RoutesIndexPage() {
  const pages = ROUTE_IDS.filter((id) => routeDef(id)?.kind !== 'root')
  return (
    <Page title="All screens" screen="dev-routes">
      <ListGroup title="Tab roots">
        {TABS.map((tab) => (
          <Row key={tab} title={navApi.roots[tab]} subtitle={routeDef(navApi.roots[tab])?.title} onPress={() => navApi.switchTab(tab)} testid={`m-dev-root-${tab}`} />
        ))}
      </ListGroup>
      <ListGroup title="Pages">
        {pages.map((id) => {
          const def = routeDef(id)
          return (
            <Row
              key={id}
              title={id}
              subtitle={`${def?.code} ${def?.title}, ${def?.kind}, ${def?.owner}`}
              onPress={() => navApi.push(id, sampleParams(id))}
              testid={`m-dev-route-${def?.screen}`}
            />
          )
        })}
      </ListGroup>
      <ListGroup title="Sheets">
        {SHEET_IDS.map((id) => {
          const def = sheetDef(id)
          return <Row key={id} title={id} subtitle={`${def?.code} ${def?.title}, ${def?.owner}`} chevron={false} onPress={() => navApi.openSheet(id)} testid={`m-dev-sheet-open-${id}`} />
        })}
      </ListGroup>
      <ListGroup title="Flow">
        <Row title="Start the onboarding" subtitle="A1 to A4, without tab bar" onPress={() => navApi.startFlow('onboarding')} testid="m-dev-flow-onboarding" />
      </ListGroup>
    </Page>
  )
}
