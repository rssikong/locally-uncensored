/**
 * K6 Gallery as a picker. Route /create/gallery/pick/:purpose, strand 3
 * (Create).
 *
 * The purpose says what is picked and where it goes: `source` an image as
 * the source of the current tool, `extend` a clip to extend, `voice` a sound
 * as the voice of a talking character. It is a part of the address, so the
 * route table knows it and nothing has to be passed around it.
 */
import { useParams } from '../../nav'
import { GalleryBody } from './parts/GalleryBody'
import { pickPurposeOf } from './parts/pick'

export default function GalleryPickPage() {
  const { purpose } = useParams<{ purpose?: string }>()
  return <GalleryBody purpose={pickPurposeOf(purpose)} />
}
