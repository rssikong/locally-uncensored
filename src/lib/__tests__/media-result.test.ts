import { describe, it, expect } from 'vitest'
import { isMediaFailureResult, isMediaTool, mediaCallSucceeded } from '../media-result'

// D#81 (TheRealNovelist, 2026-07-21): "sometimes when I requested an image, it
// bugs out and not send an image, and it change the entire context for the chat
// … after image make an 400 or 500 error code."
//
// Root cause: the media tools never reject. Every failure comes back as a
// RESOLVED result string, so the tool call is 'completed' and the chat layer
// counted it as a delivered image, wrote the error into long-term memory, and
// injected "(The image is now displayed to the user…)" into the model's context.
// These lock the classifier that stops all four.

describe('media-result — failed generations must not pass as delivered media', () => {
  // Exact strings emitted by src/api/vram-handoff.ts + src/api/mcp/tool-registry.ts
  const REAL_FAILURES = [
    'Image generation failed: ComfyUI rejected workflow: 400 Bad Request',
    'Video generation failed: CUDA out of memory',
    'Cannot generate: wan2.1 supports at most 81 frames (you requested 200).',
    'Error: fetch failed',
    'Image generation completed but no output produced.',
    'Video generation timed out after 10 minutes.',
  ]

  const REAL_SUCCESSES = [
    'Generated image: http://localhost:8188/view?filename=LU_00012_.png&type=output',
    'Generated video: /comfyui/view?filename=LU_00003_.mp4&type=output',
    'Saved to /view?filename=out.webp&type=output',
  ]

  describe('isMediaFailureResult', () => {
    for (const text of REAL_FAILURES) {
      it(`flags: ${text.slice(0, 46)}`, () => {
        expect(isMediaFailureResult(text)).toBe(true)
      })
    }

    for (const text of REAL_SUCCESSES) {
      it(`passes: ${text.slice(0, 46)}`, () => {
        expect(isMediaFailureResult(text)).toBe(false)
      })
    }

    it('treats a missing result as not-delivered', () => {
      expect(isMediaFailureResult(undefined)).toBe(true)
      expect(isMediaFailureResult(null)).toBe(true)
      expect(isMediaFailureResult('')).toBe(true)
    })

    it('does not trip on prose that merely mentions failure', () => {
      // Conservative by design: only our own failure shapes count, so an unknown
      // success format is never misread as an error.
      expect(isMediaFailureResult('Generated image of a failed rocket launch: /view?filename=a.png')).toBe(false)
    })
  })

  describe('isMediaTool', () => {
    it('covers exactly the two generating tools', () => {
      expect(isMediaTool('image_generate')).toBe(true)
      expect(isMediaTool('video_generate')).toBe(true)
      expect(isMediaTool('file_read')).toBe(false)
      expect(isMediaTool('screenshot')).toBe(false)
    })
  })

  describe('mediaCallSucceeded', () => {
    it('THE FIX: a ComfyUI 400 no longer counts as a delivered image', () => {
      expect(mediaCallSucceeded('image_generate', REAL_FAILURES[0])).toBe(false)
    })

    it('a real generation still counts as delivered', () => {
      expect(mediaCallSucceeded('image_generate', REAL_SUCCESSES[0])).toBe(true)
      expect(mediaCallSucceeded('video_generate', REAL_SUCCESSES[1])).toBe(true)
    })

    it('never reclassifies a non-media tool, whatever its result says', () => {
      // A grep hit containing the word "Error:" must stay a completed file_search.
      expect(mediaCallSucceeded('file_search', 'Error: not found')).toBe(true)
      expect(mediaCallSucceeded('shell_execute', 'Cannot generate: whatever')).toBe(true)
      expect(mediaCallSucceeded('file_read', '')).toBe(true)
    })
  })
})

// A13 (21.10.2026): every way a local render ends without media is a failure,
// not only the shapes the old list knew. These are the texts render-budget.ts
// and vram-handoff.ts really return.
describe('media-result: budget, stop and cancel are not delivered media', () => {
  const ENDED_WITHOUT_MEDIA = [
    'Image generation hit the 5 minute budget and was cancelled so the GPU is free again. Lower the steps.',
    'Video generation stopped early: at the measured pace this render needs about 40 minutes, more than the 10 minute budget.',
    'Image generation stopped: after 6 minutes the model was still loading into VRAM and sampling never started.',
    'Video generation cancelled.',
    'Image generation was not started. The companion file was not downloaded.',
    'Video generation timed out after 60 minutes; the generation was stopped.',
  ]
  for (const text of ENDED_WITHOUT_MEDIA) {
    it(`flags: ${text.slice(0, 50)}`, () => {
      expect(isMediaFailureResult(text)).toBe(true)
      expect(mediaCallSucceeded('image_generate', text)).toBe(false)
    })
  }

  it('passes the real result lines of ComfyUI and of the Mac engines', () => {
    expect(isMediaFailureResult('Image generated: LU_00012_.png (prompt: "a cat")\nhttp://127.0.0.1:8188/view?filename=LU_00012_.png&subfolder=&type=output')).toBe(false)
    expect(isMediaFailureResult('Video generated: clip.mp4 (prompt: "a cat")\nfile:///Users/a/Library/clip.mp4')).toBe(false)
    expect(isMediaFailureResult('Image generated: mlx-1.png (prompt: "a cat")\ndata:image/png;base64,iVBOR')).toBe(false)
  })
})
