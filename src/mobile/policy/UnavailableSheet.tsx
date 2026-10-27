/**
 * The sheet a closed sheet shows (policy/gates.ts). See UnavailablePage.tsx.
 */
import { useContext } from 'react'
import { navApi } from '../nav/api'
import { SheetContext } from '../nav/context'
import { POLICY } from '../strings/policy'
import { Button, Sheet } from '../ui'
import { sheetGate } from './gates'
import { unavailableText } from './UnavailablePage'

export default function UnavailableSheet() {
  const sheet = useContext(SheetContext)
  const gate = sheet ? sheetGate(sheet.entry.sheet) : null
  return (
    <Sheet
      title={POLICY.unavailableTitle}
      footer={
        <Button block onPress={() => navApi.closeSheet()} testid="m-unavailable-close">
          {POLICY.unavailableClose}
        </Button>
      }
    >
      <p className="m-pad" data-testid="m-unavailable">
        {unavailableText(gate)}
      </p>
    </Sheet>
  )
}
