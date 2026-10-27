/**
 * /dev/frame: what ui/Page does with a title that is too long and a footer
 * that is too tall. Internal, only reachable with the developer switch. The
 * layout tests measure it at 320 by 568 px and 200 percent text.
 */
import { useState } from 'react'
import { Button, ListGroup, Page, Progress, Row, toast } from '../ui'

export const FRAME_ROWS = 14

export default function FramePage() {
  const [extra, setExtra] = useState(false)
  return (
    <Page
      title="Troubleshooting and diagnostics for the models on this phone"
      subtitle="On Studio Mac, 192.168.0.12:11435"
      screen="dev-frame"
      footer={
        <>
          <Progress label="Downloading Gemma 3 4B" value={0.38} detail="of 2.5 GB" meta="4.1 MB/s, about 6 min" />
          <Button block onPress={() => setExtra((on) => !on)} testid="m-dev-frame-more">
            {extra ? 'Show fewer buttons' : 'Show more buttons'}
          </Button>
          {extra ? (
            <>
              <Button block>Pause the download</Button>
              <Button block>Pick another model</Button>
              <Button block variant="quiet">
                Skip for now
              </Button>
            </>
          ) : null}
          <Button block onPress={() => toast('Saved', { testid: 'dev-frame' })} testid="m-dev-frame-toast">
            Show a toast
          </Button>
          <Button variant="primary" block testid="m-dev-frame-main">
            Continue
          </Button>
        </>
      }
    >
      <ListGroup title="Rows">
        {Array.from({ length: FRAME_ROWS }, (_, i) => (
          <Row key={i} title={i === 0 ? 'Troubleshooting' : `Row ${i + 1}`} subtitle={i === FRAME_ROWS - 1 ? 'The last row of the list' : undefined} onPress={() => {}} testid={`m-dev-frame-row-${i + 1}`} />
        ))}
      </ListGroup>
    </Page>
  )
}
