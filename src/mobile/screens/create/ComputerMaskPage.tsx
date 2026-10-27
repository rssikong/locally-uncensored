/**
 * K9 Paint the area, for an edit on "My computer" (A17). Route
 * /create/computer-mask, full screen, strand 3 (Create).
 *
 * The editor of the cloud (MaskEditorPage.tsx) with another owner: the
 * picture is photo 1 of the computer form, the mask goes back there as a PNG
 * of the same size (white = change), and painting is optional, as the
 * computer takes an edit without a mask.
 */
import { Brush } from 'lucide-react'
import type { ImageRef } from '../../../stores/createStore'
import { nav } from '../../nav'
import { COMPUTER_STRINGS as C, CREATE_STRINGS as T } from '../../strings/create'
import { Button, EmptyState, Page, toast } from '../../ui'
import { dataUrlToBlob } from '../../../lib/render/data-url'
import { Editor } from './MaskEditorPage'
import { useComputerForm } from './parts/computer-form'

async function keepMask(mask: ImageRef | null): Promise<void> {
  if (!mask) {
    useComputerForm.getState().setMask(null)
    return
  }
  try {
    const bytes = new Uint8Array(await dataUrlToBlob(mask.url).arrayBuffer())
    useComputerForm.getState().setMask({ bytes, preview: mask.url, width: mask.width, height: mask.height })
  } catch {
    toast(T.mask.saveFailed, { tone: 'error', testid: 'create-mask-failed' })
  }
}

export default function ComputerMaskPage() {
  const first = useComputerForm((s) => s.inputs[0] ?? null)
  if (first?.ref) return <Editor key={first.preview.length + first.width} source={first.ref} owner={{ mustPaint: false, save: (m) => void keepMask(m) }} />
  return (
    <Page title={T.mask.title} screen="create-computer-mask">
      <EmptyState
        title={T.mask.noSource}
        icon={Brush}
        testid="m-create-computer-mask-empty"
        actions={
          <Button variant="primary" block onPress={() => nav.back()} testid="m-create-computer-mask-back">
            {C.dismiss}
          </Button>
        }
      >
        {C.needsPhoto}
      </EmptyState>
    </Page>
  )
}
