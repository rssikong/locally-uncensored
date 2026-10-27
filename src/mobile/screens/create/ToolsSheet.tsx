/**
 * K2 Tools. Sheet "tools", opened with nav.openSheet('tools'), strand 3 (Create).
 *
 * A grid of every tool the cloud catalog offers, with icon and full name.
 * K2.1 tool tile (radio): picks and closes. K2.2 Close is the close button
 * of the sheet. K2.3 Presets leads to the guided runs (K12).
 */
import { useCreateStore } from '../../../stores/createStore'
import { Layers } from 'lucide-react'
import { nav, useSheet } from '../../nav'
import { CREATE_STRINGS as T } from '../../strings/create'
import { EmptyState, Icon, ListGroup, Row, Sheet, riskProps } from '../../ui'
import { setTool } from './parts/actions'
import { toolProbe, useCatalogVersion } from './parts/catalog'
import { availableTools, toolChoiceRisk } from './parts/tools'
import { TOOL_ICON } from './parts/ui'

export default function ToolsSheet() {
  const { close } = useSheet()
  useCatalogVersion()
  const current = useCreateStore((s) => s.intent())
  const busy = useCreateStore((s) => s.isGenerating)
  const tools = availableTools(toolProbe())
  return (
    <Sheet title={T.tools.title}>
      {tools.length === 0 ? (
        <EmptyState title={T.model.empty}>{T.model.emptyText}</EmptyState>
      ) : (
        <div className="m-k-tools" role="radiogroup" aria-label={T.tools.group} data-testid="m-create-tools-grid">
          {tools.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === current}
              disabled={busy && id !== current}
              data-testid={`m-create-tools-${id}`}
              data-el="K2.1"
              {...riskProps(toolChoiceRisk(id))}
              onClick={() => {
                setTool(id)
                close()
              }}
            >
              <Icon icon={TOOL_ICON[id]} />
              {T.tool[id].name}
            </button>
          ))}
        </div>
      )}
      <ListGroup>
        <Row
          icon={Layers}
          title={T.guided.entry}
          subtitle={T.guided.entrySub}
          onPress={() => {
            close()
            nav.push('/create/presets')
          }}
          testid="m-create-tools-presets"
          el="K2.3"
        />
      </ListGroup>
    </Sheet>
  )
}
