// The memory of this Mac, read once and kept: the Length slider of a Mac
// video lane goes by it (api/mlx-video.ts mlxVideoMaxFrames), and the start
// reads the same number without waiting for it.

import { useEffect, useState } from 'react'
import { getSharedMemoryGb } from './hardware'

let known: number | null = null
let asking: Promise<number | null> | null = null

function ask(): Promise<number | null> {
  asking ??= getSharedMemoryGb()
    .then((gb) => (known = gb > 0 ? gb : null))
    .catch(() => null)
  return asking
}

/** The memory read so far, or null before the first answer. */
export function knownMacMemoryGb(): number | null {
  return known
}

/** The memory of this Mac in GB, null until it is known or off a Mac lane. */
export function useMacMemoryGb(on: boolean): number | null {
  const [gb, setGb] = useState<number | null>(known)
  useEffect(() => {
    if (!on) return
    let stale = false
    ask().then((v) => { if (!stale) setGb(v) })
    return () => { stale = true }
  }, [on])
  return on ? gb : null
}
