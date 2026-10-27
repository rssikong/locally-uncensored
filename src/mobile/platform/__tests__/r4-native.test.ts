/**
 * Round 4 of the native layer, as the shell sees it: the speed limit of the
 * downloads, the import of a model file, and the fixed error codes of
 * "save to photos".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhotoSaveError, photoSaveErrorCode, toPhotoSaveError } from '../../../lib/lu-native'
import { failureOf } from '../../screens/create/parts/media-out'
import { __setBridgeForTests } from '../bridge'
import { cancelModelImport, importModelFile, modelImportSupported } from '../model-import'
import { downloadLimitSupported, limitToBytesPerSecond, setDownloadLimit } from '../network'

afterEach(() => __setBridgeForTests(undefined))

describe('download speed limit', () => {
  it('counts 1 MB as 1 000 000 bytes, like the desktop', () => {
    expect(limitToBytesPerSecond(5)).toBe(5_000_000)
    expect(limitToBytesPerSecond(0.5)).toBe(500_000)
    expect(limitToBytesPerSecond(0)).toBe(0)
    expect(limitToBytesPerSecond(-1)).toBe(0)
    expect(limitToBytesPerSecond(Number.NaN)).toBe(0)
  })

  it('is offered only where the native layer says it can hold a download to it', async () => {
    __setBridgeForTests({ bgDownloadLimit: async () => ({ supported: true, bytesPerSecond: 0 }) })
    expect(await downloadLimitSupported()).toBe(true)
    // iOS: the system carries the download, there is nothing to limit.
    __setBridgeForTests({ bgDownloadLimit: async () => ({ supported: false, bytesPerSecond: 0 }) })
    expect(await downloadLimitSupported()).toBe(false)
    // An older build, a browser, a failing command.
    __setBridgeForTests({})
    expect(await downloadLimitSupported()).toBe(false)
    __setBridgeForTests(null)
    expect(await downloadLimitSupported()).toBe(false)
    __setBridgeForTests({ bgDownloadLimit: async () => { throw new Error('boom') } })
    expect(await downloadLimitSupported()).toBe(false)
  })

  it('is true only when the number that holds is the number that was asked for', async () => {
    const native = vi.fn(async (bps?: number) => ({ supported: true, bytesPerSecond: bps ?? 0 }))
    __setBridgeForTests({ bgDownloadLimit: native })
    expect(await setDownloadLimit(5)).toBe(true)
    expect(native).toHaveBeenLastCalledWith(5_000_000)
    expect(await setDownloadLimit(0)).toBe(true)
    expect(native).toHaveBeenLastCalledWith(0)
    __setBridgeForTests({ bgDownloadLimit: async () => ({ supported: true, bytesPerSecond: 1 }) })
    expect(await setDownloadLimit(5)).toBe(false)
    __setBridgeForTests({ bgDownloadLimit: async () => ({ supported: false, bytesPerSecond: 0 }) })
    expect(await setDownloadLimit(5)).toBe(false)
  })
})

describe('import a model file', () => {
  it('is offered only in a build that has the native import', async () => {
    __setBridgeForTests({ importModelFile: async () => ({ status: 'cancelled' }) })
    expect(await modelImportSupported()).toBe(true)
    __setBridgeForTests({})
    expect(await modelImportSupported()).toBe(false)
    __setBridgeForTests(null)
    expect(await modelImportSupported()).toBe(false)
  })

  it('passes on what the native layer found, with its sentence', async () => {
    const seen: Array<[number, number, string]> = []
    __setBridgeForTests({
      importModelFile: async (options) => {
        options?.onProgress?.({ id: 'x', fileName: 'SmolLM2.gguf', receivedBytes: 50, totalBytes: 100 })
        return { status: 'imported', fileName: 'SmolLM2.gguf', path: '/models/SmolLM2.gguf', bytes: 100 }
      },
    })
    expect(await importModelFile((r, t, n) => seen.push([r, t, n]))).toEqual({ status: 'imported', fileName: 'SmolLM2.gguf', bytes: 100, message: null })
    expect(seen).toEqual([[50, 100, 'SmolLM2.gguf']])

    for (const status of ['not-gguf', 'no-space', 'exists', 'failed', 'cancelled'] as const) {
      __setBridgeForTests({ importModelFile: async () => ({ status, message: status === 'cancelled' ? null : 'A sentence.' }) })
      expect((await importModelFile()).status).toBe(status)
    }
  })

  it('never throws: a word it does not know and a failing call are `failed`, no native layer is `unavailable`', async () => {
    __setBridgeForTests({ importModelFile: async () => ({ status: 'something-new' }) })
    expect((await importModelFile()).status).toBe('failed')
    __setBridgeForTests({ importModelFile: async () => { throw new Error('A model file is being imported already. Wait for it to finish.') } })
    expect(await importModelFile()).toEqual({ status: 'failed', fileName: null, bytes: 0, message: 'A model file is being imported already. Wait for it to finish.' })
    __setBridgeForTests(null)
    expect((await importModelFile()).status).toBe('unavailable')
    await expect(cancelModelImport()).resolves.toBeUndefined()
  })
})

describe('save to photos: three fixed error codes', () => {
  // The sentences are the ones Kotlin and Swift reject with (LuNativePlugin.kt, Share.swift).
  const NO_SPACE = '[photos:no-space] There is not enough free space on this phone to save this. Free up space, then try again.'
  const DENIED_IOS = '[photos:denied] LU is not allowed to add to your photo library. Allow it under Settings, Privacy and Security, Photos.'
  const DENIED_ANDROID = '[photos:denied] LU is not allowed to add to the gallery of this phone.'
  const FAILED = '[photos:failed] The photo library did not accept this file (3302). The format may not be supported.'

  it('the bridge reads the code and hands on the plain sentence', () => {
    const noSpace = toPhotoSaveError(NO_SPACE)
    expect(noSpace).toBeInstanceOf(PhotoSaveError)
    expect(noSpace.code).toBe('no-space')
    expect(noSpace.message).toBe('There is not enough free space on this phone to save this. Free up space, then try again.')
    expect(toPhotoSaveError(new Error(DENIED_IOS)).code).toBe('denied')
    expect(toPhotoSaveError(FAILED).code).toBe('failed')
    expect(photoSaveErrorCode(toPhotoSaveError(DENIED_ANDROID))).toBe('denied')
    expect(photoSaveErrorCode(new Error('x'))).toBeNull()
  })

  it('an error without a code (an older native side) counts as failed and keeps its text', () => {
    const err = toPhotoSaveError('That file does not exist.')
    expect(err.code).toBe('failed')
    expect(err.message).toBe('That file does not exist.')
    expect(toPhotoSaveError(undefined).code).toBe('failed')
    expect(toPhotoSaveError('[photos:made-up] Odd.').code).toBe('failed')
  })

  it('Create reads the same answer out of each error (failureOf, the place that was prepared)', () => {
    expect(failureOf(toPhotoSaveError(NO_SPACE))).toEqual({ status: 'storage' })
    expect(failureOf(toPhotoSaveError(DENIED_IOS))).toEqual({ status: 'denied' })
    expect(failureOf(toPhotoSaveError(DENIED_ANDROID))).toEqual({ status: 'denied' })
    expect(failureOf(toPhotoSaveError(FAILED))).toEqual({ status: 'failed' })
    expect(failureOf(toPhotoSaveError('[photos:failed] Saving to the gallery needs Android 10 or newer. Use Share instead.'))).toEqual({ status: 'failed' })
    expect(failureOf(toPhotoSaveError('[photos:failed] The gallery did not accept this file (IllegalStateException). The format may not be supported.'))).toEqual({ status: 'failed' })
  })
})

describe('a native sentence never shows what only a developer can read (acceptance Android, re-run, N10)', () => {
  it('drops the class of an exception and a system code from the sentence the user reads', async () => {
    const { withoutNativeDetail } = await import('../../../lib/lu-native')
    expect(withoutNativeDetail('The gallery did not accept this file (IllegalArgumentException). The format may not be supported.')).toBe('The gallery did not accept this file. The format may not be supported.')
    expect(withoutNativeDetail('The photo library did not accept this file (3302). The format may not be supported.')).toBe('The photo library did not accept this file. The format may not be supported.')
    expect(withoutNativeDetail('Failed (java.io.IOException).')).toBe('Failed.')
    // Ordinary brackets stay.
    expect(withoutNativeDetail('Saving needs Android 10 or newer (API 29).')).toBe('Saving needs Android 10 or newer (API 29).')
  })

  it('the error of a save carries the cleaned sentence and keeps its code', () => {
    const err = toPhotoSaveError('[photos:failed] The gallery did not accept this file (IllegalArgumentException). The format may not be supported.')
    expect(err.code).toBe('failed')
    expect(err.message).not.toContain('Exception')
    expect(err.message).toContain('The gallery did not accept this file.')
  })
})
