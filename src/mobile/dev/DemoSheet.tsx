/**
 * A sheet for the UI catalogue and the smoke test: first page, one sub page,
 * a footer, and a way to stack a dialog on top. Internal, never shown to users.
 */
import { useState } from 'react'
import { nav, useSheet } from '../nav'
import { Button, ListGroup, Row, Sheet, toast } from '../ui'

export default function DemoSheet() {
  const sheet = useSheet<{ note?: string }>()
  const [on, setOn] = useState(true)

  if (sheet.sub === 'details') {
    return (
      <Sheet title="Sub page">
        <ListGroup>
          <Row title="Back returns to the first page of the sheet" subtitle="The sheet itself stays open" />
          <Row title="Close closes the whole sheet" />
        </ListGroup>
      </Sheet>
    )
  }
  return (
    <Sheet
      title="Demo sheet"
      footer={
        <Button variant="primary" block onPress={() => sheet.close()} testid="m-dev-sheet-done">
          Done
        </Button>
      }
    >
      <ListGroup>
        <Row title="A switch that acts at once" switch={{ checked: on, onChange: setOn }} testid="m-dev-sheet-switch" />
        <Row title="Open a sub page" subtitle="Same sheet, with a back arrow in its header" onPress={() => sheet.pushSub('details')} testid="m-dev-sheet-sub" />
        <Row
          title="Ask a question on top"
          subtitle="A dialog above the sheet"
          onPress={() => {
            void nav.confirm({ title: 'Delete this chat?', text: 'This cannot be undone.', confirmLabel: 'Delete', cancelLabel: 'Keep', tone: 'danger', testid: 'demo' }).then((yes) => {
              toast(yes ? 'Deleted' : 'Kept')
            })
          }}
          testid="m-dev-sheet-confirm"
        />
        <Row
          title="Open another sheet on top"
          subtitle="Sheets stack; Close and Back belong to the top one"
          onPress={() => nav.openSheet('dev-demo', { note: 'This sheet lies on top of another one.' })}
          testid="m-dev-sheet-stack"
        />
      </ListGroup>
      {sheet.props?.note ? (
        <p className="m-cap m-pad" data-testid="m-dev-sheet-note">
          {sheet.props.note}
        </p>
      ) : null}
    </Sheet>
  )
}
