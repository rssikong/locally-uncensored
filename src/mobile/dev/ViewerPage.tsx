/**
 * /dev/viewer: ui/MediaViewer with a file name that is longer than the bar.
 * Internal, only reachable with the developer switch.
 */
import { Share2 } from 'lucide-react'
import { IconButton, MediaViewer, toast } from '../ui'

/** A small picture that needs no network: a violet square. */
const PICTURE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><rect width='320' height='320' fill='%237c3aed'/><circle cx='160' cy='160' r='90' fill='%23a094f8'/></svg>"

export const VIEWER_FILE_NAME = 'beach-holiday-lisbon-day-two-evening-light-final-export.png'

export default function ViewerPage() {
  return (
    <MediaViewer
      kind="image"
      src={PICTURE}
      title={VIEWER_FILE_NAME}
      testid="m-dev-viewer-screen"
      actions={<IconButton icon={Share2} label="Share" onPress={() => toast('Share sheet', { testid: 'dev-viewer' })} />}
    />
  )
}
