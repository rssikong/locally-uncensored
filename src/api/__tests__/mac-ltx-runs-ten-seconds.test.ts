/**
 * Fund 6 (3.0.7): on a Mac the Length slider of an LTX lane ended at 113
 * frames, 4.7 seconds, though the engine makes ten (Talking Character runs
 * 241 frames on it). The ceiling was the 120 frames every model got, not the
 * model. A clip of 241 frames at 768 x 512 ran on an M5 Pro with 48 GB in
 * 187 s at a peak of 23.6 GB, the Mac never below 58 % free (16.10.2026).
 *
 * Now an LTX lane goes to ten seconds on a Mac with that memory. A smaller
 * Mac, a Wan and Motion Control (memory left out) keep the old ceiling,
 * since none of them has run so long.
 *
 * Run: npx vitest run src/api/__tests__/mac-ltx-runs-ten-seconds.test.ts
 */
import { describe, it, expect } from 'vitest'
import { MLX_LTX_LONG_FRAMES, mlxFramesOnGrid, mlxVideoMaxFrames, mlxVideoSeconds } from '../mlx-video'

describe('the Length slider of a Mac video lane', () => {
  it('goes to ten seconds of LTX on a Mac with 48 GB or more', () => {
    for (const gb of [48, 47.9, 64, 128]) expect(mlxVideoMaxFrames(8, gb)).toBe(MLX_LTX_LONG_FRAMES)
    expect(MLX_LTX_LONG_FRAMES % 8).toBe(1)
    expect(mlxVideoSeconds(mlxFramesOnGrid(500, 8, 48), 24) * 24).toBeGreaterThanOrEqual(241)
    expect(mlxFramesOnGrid(240, 8, 48)).toBe(233)
  })

  it('keeps 113 frames on a smaller Mac, or where the memory is not known', () => {
    for (const gb of [16, 24, 32, 36, null, undefined]) {
      expect(mlxVideoMaxFrames(8, gb)).toBe(113)
      expect(mlxFramesOnGrid(241, 8, gb)).toBe(113)
    }
  })

  it('keeps a Wan at 117 frames, whatever the memory', () => {
    expect(mlxVideoMaxFrames(4, 128)).toBe(117)
    expect(mlxFramesOnGrid(241, 4, 128)).toBe(117)
  })
})
