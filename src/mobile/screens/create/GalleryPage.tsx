/**
 * K6 Gallery. Route /create/gallery, strand 3 (Create).
 *
 * The page itself is parts/GalleryBody.tsx, shared with the picker
 * (GalleryPickPage, /create/gallery/pick/:purpose).
 */
import { GalleryBody } from './parts/GalleryBody'

export default function GalleryPage() {
  return <GalleryBody purpose={null} />
}
