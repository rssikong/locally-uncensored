/**
 * Renders the sheets and dialogs above the stack, in order. Only the top one
 * takes focus and taps; the ones below are `inert`.
 */
import { Button, Dialog, ErrorState, Sheet, SkeletonRows } from '../ui'
import { navApi } from './api'
import { SheetContext } from './context'
import { LazyScreen } from './LazyScreen'
import { sheetLoader } from './loaders'
import { sheetDef } from './sheets'
import { useNavStore } from './store'
import type { SheetEntry } from './types'

function SheetSlot({ entry, isTop, depth }: { entry: SheetEntry; isTop: boolean; depth: number }) {
  const def = sheetDef(entry.sheet)
  const load = sheetLoader(entry.sheet)
  const title = def?.title ?? ''
  const broken = (retry?: () => void) => (
    <Sheet title={title}>
      <ErrorState
        title="This could not be shown"
        testid="m-sheet-error"
        actions={
          <>
            {retry ? (
              <Button variant="primary" block onPress={retry}>
                Try again
              </Button>
            ) : null}
            <Button block onPress={() => navApi.closeSheet()}>
              Close
            </Button>
          </>
        }
      >
        Something went wrong while opening it.
      </ErrorState>
    </Sheet>
  )
  return (
    <div inert={!isTop} style={{ position: 'absolute', inset: 0 }}>
      <SheetContext.Provider value={{ entry, isTop, locked: !!def?.locked, title, depth }}>
        {def && load ? (
          <LazyScreen
            load={load}
            fallback={
              <Sheet title={title}>
                <SkeletonRows rows={3} />
              </Sheet>
            }
            renderError={(retry) => broken(retry)}
          />
        ) : (
          broken()
        )}
      </SheetContext.Provider>
    </div>
  )
}

/** Pure: how many sheets lie above the overlay at `index`. Dialogs do not count. */
export function sheetsAbove(overlays: ReadonlyArray<{ kind: string }>, index: number): number {
  return overlays.slice(index + 1).filter((entry) => entry.kind === 'sheet').length
}

export function Overlays() {
  const overlays = useNavStore((s) => s.overlays)
  if (overlays.length === 0) return null
  return (
    <div className="m-overlays" data-testid="m-overlays">
      {overlays.map((entry, i) => {
        const isTop = i === overlays.length - 1
        if (entry.kind === 'dialog') {
          return (
            <div key={entry.key} inert={!isTop} style={{ position: 'absolute', inset: 0 }}>
              <Dialog entry={entry} isTop={isTop} />
            </div>
          )
        }
        return <SheetSlot key={entry.key} entry={entry} isTop={isTop} depth={sheetsAbove(overlays, i)} />
      })}
    </div>
  )
}
