// The characters trained on this machine, at the reference strip of Edit. One
// click loads the photos the character was trained on, the way a saved
// character loads its photos: they join the strip, and the first becomes the
// source only when none is loaded. A model reads only as many as it has
// reference slots, so only that many are fetched. A character with no kept
// photos (trained before 3.0.7, or brought in from LU Cloud) is not listed.
import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { LOCAL_PREFIX, listLocalCharacters, type CharacterRef } from '../../../lib/characters'
import { photoBlobs, trainingPhotoCount, trainingPhotos } from '../../../lib/character-photos'
import { loadPhotosAsReferences } from './characterPhotos'
import { cn } from '../ui/cn'

/** The local characters that have training photos to hand out. */
export async function charactersWithPhotos(
  list: () => Promise<CharacterRef[]> = () => listLocalCharacters(),
  count: (ref: CharacterRef) => Promise<number> = trainingPhotoCount,
): Promise<{ ref: CharacterRef; count: number }[]> {
  const refs = (await list()).filter((r) => r.id.startsWith(LOCAL_PREFIX))
  const counted = await Promise.all(refs.map(async (ref) => ({ ref, count: await count(ref).catch(() => 0) })))
  return counted.filter((c) => c.count > 0)
}

/** Loads up to `slots` training photos of `ref` into the reference strip.
 *  Returns how many were loaded. */
export async function loadTrainingPhotos(ref: CharacterRef, slots: number): Promise<number> {
  const urls = await trainingPhotos(ref, slots)
  if (urls.length === 0) throw new Error(`No training photos of ${ref.name} are kept on this computer.`)
  return loadPhotosAsReferences(ref.name, photoBlobs(urls))
}

export function TrainedCharacterChips({ slots, disabled, onBusy }: {
  slots: number
  disabled?: boolean
  onBusy: (busy: boolean) => void
}) {
  const charactersVersion = useCreateStore((s) => s.charactersVersion)
  const loraKey = useCreateStore((s) => s.loraListKey)
  const [list, setList] = useState<{ ref: CharacterRef; count: number }[]>([])

  useEffect(() => {
    let live = true
    charactersWithPhotos()
      .then((l) => { if (live) setList(l) })
      .catch(() => { if (live) setList([]) })
    return () => { live = false }
  }, [charactersVersion, loraKey])

  if (list.length === 0) return null
  return (
    <div className="flex flex-col items-center gap-1.5 max-w-full" data-testid="trained-characters">
      <span className="t-label text-gray-600">Trained characters</span>
      <div className="flex flex-wrap justify-center gap-1.5">
        {list.map(({ ref, count }) => (
          <button
            key={ref.id}
            disabled={disabled}
            onClick={() => {
              const { setError } = useCreateStore.getState()
              onBusy(true)
              setError(null)
              void loadTrainingPhotos(ref, slots)
                .catch((err: unknown) => setError(`Could not load the photos: ${err instanceof Error ? err.message : String(err)}`))
                .finally(() => onBusy(false))
            }}
            title={`Load ${Math.min(count, slots)} training photos of ${ref.name}`}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] hover:border-white/15 t-control text-gray-300 hover:text-white transition-colors',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            <UserRound size={12} className="text-gray-500" />
            <span className="truncate max-w-[9rem]">{ref.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
