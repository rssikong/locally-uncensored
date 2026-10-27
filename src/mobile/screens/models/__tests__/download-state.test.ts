import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DownloadProgress } from '../../../../types/downloads'
import {
  downloadKind,
  errorKind,
  failureText,
  isActive,
  isFailure,
  isMemoryFailure,
  missingBytes,
  percentOf,
  phoneReason,
  shareOf,
  spaceShortfall,
  stateWord,
  storageDialogText,
} from '../parts/download-state'
import { activeDownloadCount } from '../downloads-badge'

const GIB = 1_073_741_824
const row = (patch: Partial<DownloadProgress>): DownloadProgress => ({ progress: 0, total: 1000, speed: 0, filename: 'a.gguf', status: 'downloading', ...patch })

describe('kind of a download row', () => {
  it('reads the cause of a failure from the native message', () => {
    expect(errorKind('Not enough free space for a.gguf. It still needs 1.4 GB and the drive has 0.2 GB free')).toBe('storage')
    expect(errorKind('a.gguf does not match the checksum of its source. The file was discarded.')).toBe('checksum')
    expect(errorKind('Download failed (HTTP 401)')).toBe('gated')
    expect(errorKind('Download failed (HTTP 403)')).toBe('gated')
    expect(errorKind('Download failed (HTTP 404)')).toBe('gone')
    expect(errorKind('Download failed (HTTP 503)')).toBe('unreachable')
    expect(errorKind('Download failed (HTTP 429)')).toBe('unreachable')
    expect(errorKind('error sending request: connection reset')).toBe('interrupted')
    expect(errorKind(undefined)).toBe('interrupted')
  })

  it('a refused address is final: its own kind, a failure, and no button that tries again', () => {
    // The sentences of the plugin (NetGuard on both platforms) for the native code `blocked`.
    expect(errorKind('This download was redirected to an address that is not allowed.')).toBe('blocked')
    expect(errorKind('Downloads from a private or local address are not allowed.')).toBe('blocked')
    expect(errorKind('An address with a user name or password in it is not allowed.')).toBe('blocked')
    // A slow or missing network is not a refusal, whatever word it used to start with.
    expect(errorKind("Could not look up 'huggingface.co'. The network seems to be slow or offline. Check the connection and try again.")).toBe('interrupted')
    expect(errorKind("Blocked: 'huggingface.co' did not resolve within 5 s")).toBe('interrupted')
    expect(isFailure('blocked')).toBe(true)
    expect(downloadKind(row({ status: 'error', error: 'This download was redirected to an address that is not allowed.' }), false)).toBe('blocked')
    expect(failureText('blocked', row({ status: 'error' })).text).toContain('will not help')
    const transfer = readFileSync(resolve(__dirname, '../parts/Transfer.tsx'), 'utf8')
    expect(transfer).toContain("kind !== 'gated' && kind !== 'gone' && kind !== 'blocked' ? (")
  })

  it('a transfer without a network waits, it has not failed', () => {
    expect(downloadKind(row({ status: 'downloading', progress: 300 }), false)).toBe('waiting-network')
    expect(downloadKind(row({ status: 'error', error: 'connection reset' }), false)).toBe('waiting-network')
    expect(downloadKind(row({ status: 'error', error: 'connection reset' }), true)).toBe('interrupted')
    // A full disk stays a failure with or without a network.
    expect(downloadKind(row({ status: 'error', error: 'no space left on device' }), false)).toBe('storage')
  })

  it('covers every state of M3', () => {
    expect(downloadKind(row({ status: 'connecting' }), true)).toBe('waiting')
    expect(downloadKind(row({ status: 'downloading', progress: 10 }), true)).toBe('running')
    expect(downloadKind(row({ status: 'downloading', progress: 1000 }), true)).toBe('verifying')
    expect(downloadKind(row({ status: 'pausing' }), true)).toBe('pausing')
    expect(downloadKind(row({ status: 'paused' }), true)).toBe('paused')
    expect(downloadKind(row({ status: 'complete' }), true)).toBe('done')
    expect(stateWord('waiting-network')).toBe('Waiting for network')
    expect(stateWord('verifying')).toBe('Verifying')
    expect(isFailure('paused')).toBe(false)
    expect(isFailure('checksum')).toBe(true)
  })

  it('counts only moving transfers for the badge', () => {
    expect(isActive(row({ status: 'downloading' }))).toBe(true)
    expect(isActive(row({ status: 'paused' }))).toBe(false)
    expect(activeDownloadCount({ a: row({ status: 'downloading' }), b: row({ status: 'connecting' }), c: row({ status: 'paused' }), d: row({ status: 'error' }), e: row({ status: 'complete' }) })).toBe(2)
  })

  it('uses the expected size when the row has no total yet', () => {
    expect(shareOf(row({ progress: 250, total: 0 }), 1000)).toBe(0.25)
    expect(percentOf(row({ progress: 380, total: 1000 }))).toBe(38)
    expect(shareOf(row({ progress: 0, total: 0 }))).toBe(0)
  })
})

describe('texts of a failure', () => {
  it('names the percent and what is kept', () => {
    const text = failureText('interrupted', row({ progress: 380, status: 'error' }))
    expect(text.title).toBe('Download interrupted')
    expect(text.text).toBe('Stopped at 38%. The part that arrived is kept, so you will not start over.')
    // Nothing arrived: no promise about a kept part.
    expect(failureText('interrupted', row({ progress: 0, total: 0, status: 'error' })).text).toBe('The download could not start. Check the connection and try again.')
  })

  it('names how much has to be freed when the native side says it', () => {
    const error = 'Not enough free space for a.gguf. It still needs 1.6 GB and the drive has 0.2 GB free'
    expect(missingBytes(error)).toBe(Math.round(1.4 * GIB))
    expect(failureText('storage', row({ progress: 710, status: 'error', error })).text).toBe('Storage ran out at 71%. Free up 1.4 GB to continue.')
    expect(failureText('storage', row({ progress: 710, status: 'error', error: 'disk full' })).text).toBe('Storage ran out at 71%. Free up space to continue.')
    expect(missingBytes('disk full')).toBeNull()
  })

  it('has a sentence for the damaged file, the sign in and the silent source', () => {
    expect(failureText('checksum', row({})).text).toBe('The file was damaged on the way. LU removed it.')
    expect(failureText('gated', row({})).text).toBe('This model needs a Hugging Face token.')
    expect(failureText('unreachable', row({})).text).toBe('Hugging Face did not answer. Try again in a moment.')
  })
})

describe('storage dialog (G9)', () => {
  it('does not block when the phone could not measure or when it fits', () => {
    expect(spaceShortfall(null, 5 * GIB)).toBeNull()
    expect(spaceShortfall({ fits: true, requiredBytes: 1, reservedBytes: 0, availableBytes: 10 }, 1)).toBeNull()
  })

  it('names need, free and what is missing', () => {
    const shortfall = spaceShortfall({ fits: false, requiredBytes: 5 * GIB, reservedBytes: 0, availableBytes: 1 * GIB }, 5 * GIB)
    expect(shortfall).toEqual({ needBytes: 5 * GIB, freeBytes: 1 * GIB, missingBytes: 4 * GIB })
    expect(storageDialogText('Llama 3.2 3B', shortfall!)).toBe('Llama 3.2 3B needs 5.0 GB. This phone has 1.0 GB free. Free up 4.0 GB, then start the download again.')
  })

  it('still says something when the free space is unknown', () => {
    const shortfall = spaceShortfall({ fits: false, requiredBytes: 5 * GIB, reservedBytes: 0, availableBytes: null }, 5 * GIB)
    expect(storageDialogText('X', shortfall!)).toContain('does not have that much free')
  })
})

describe('reasons of the engine', () => {
  it('shows the first sentence, and nothing that speaks about the desktop', () => {
    expect(phoneReason('The model file is damaged. See the log file for details.')).toBe('The model file is damaged.')
    expect(phoneReason('Open Settings, AI Backends and pick another GPU Layers value')).toBe('')
    expect(phoneReason(new Error('context too small'))).toBe('context too small.')
    expect(phoneReason(undefined)).toBe('')
  })

  it('recognizes a start that failed for memory', () => {
    expect(isMemoryFailure('Not enough memory for this model: it needs about 5000 MB and 3000 MB are free.')).toBe(true)
    expect(isMemoryFailure(new Error('out of memory'))).toBe(true)
    expect(isMemoryFailure('The model file is damaged.')).toBe(false)
  })
})

describe('the two switches that became settings', () => {
  it('the stored setting wins, an old value counts while the setting was never written', async () => {
    const { prefFrom } = await import('../parts/adapters/prefs')
    expect(prefFrom(undefined, null)).toBe(false)
    expect(prefFrom(undefined, '1')).toBe(true)
    expect(prefFrom(false, '1')).toBe(false)
    expect(prefFrom(true, null)).toBe(true)
  })

  it('writes the settings store and reads it back', async () => {
    const { getPref, setPref, resetPrefs } = await import('../parts/adapters/prefs')
    const { useSettingsStore } = await import('../../../../stores/settingsStore')
    expect(getPref('wifiOnly')).toBe(false)
    setPref('wifiOnly', true)
    setPref('unloadInBackground', true)
    expect(useSettingsStore.getState().settings.mobileDownloadWifiOnly).toBe(true)
    expect(useSettingsStore.getState().settings.mobileUnloadInBackground).toBe(true)
    expect(getPref('wifiOnly')).toBe(true)
    resetPrefs()
    // The reset of the engine page leaves the switch for downloads alone (round 12).
    expect(getPref('wifiOnly')).toBe(true)
    expect(getPref('unloadInBackground')).toBe(false)
  })
})

describe('storage runs out in the middle of a download', () => {
  it('says where it stopped, that the part is kept, and how much to free', async () => {
    const { storageRanOutText } = await import('../parts/download-state')
    const failed = row({ status: 'error', progress: 500, total: 1000, error: 'Not enough free space for a.gguf. It still needs 1.4 GB and the drive has 0.0 GB free' })
    expect(storageRanOutText('Llama 3.2 3B', failed)).toBe('The download of Llama 3.2 3B stopped at 50%. What arrived is kept. Free up 1.4 GB, then resume the download.')
    expect(storageRanOutText('X', row({ status: 'error', progress: 250, total: 1000, error: 'No space left on device' }))).toBe(
      'The download of X stopped at 25%. What arrived is kept. Free up space, then resume the download.',
    )
  })

  it('before a resume only the rest is asked for, and the text says so', async () => {
    const { remainingBytes } = await import('../parts/download-state')
    expect(remainingBytes(row({ progress: 3 * GIB, total: 5 * GIB }))).toBe(2 * GIB)
    // The size the catalogue knows counts when the row has none yet.
    expect(remainingBytes(row({ progress: 1 * GIB, total: 0 }), 4 * GIB)).toBe(3 * GIB)
    expect(remainingBytes(row({ progress: 7, total: 0 }))).toBe(0)
    expect(remainingBytes(row({ progress: 9 * GIB, total: 5 * GIB }))).toBe(0)
    const shortfall = spaceShortfall({ fits: false, requiredBytes: 2 * GIB, reservedBytes: 0, availableBytes: 0.5 * GIB }, 2 * GIB)
    expect(storageDialogText('Llama 3.2 3B', shortfall!, true)).toBe(
      'The rest of Llama 3.2 3B needs 2.0 GB. This phone has 512.0 MB free. Free up 1.5 GB, then resume the download. What arrived is kept.',
    )
    const unknown = spaceShortfall({ fits: false, requiredBytes: 2 * GIB, reservedBytes: 0, availableBytes: null }, 2 * GIB)
    expect(storageDialogText('X', unknown!, true)).toContain('What arrived is kept.')
  })

  it('a model that is too large for the memory is another state than a full storage', () => {
    // Storage is a failure of a download that can be resumed. Memory is a property of the phone:
    // no download is offered, so there is no row and no failure to mix it up with.
    expect(errorKind('Not enough free space for a.gguf')).toBe('storage')
    expect(errorKind('Not enough memory to load this model')).not.toBe('storage')
    expect(isMemoryFailure('Not enough memory to load this model')).toBe(true)
    expect(isMemoryFailure('Not enough free space for a.gguf')).toBe(false)
  })
})

describe('modelsInFlight (N2)', () => {
  it('keeps the models whose download is not finished', async () => {
    const { modelsInFlight } = await import('../parts/catalog')
    const models = [{ filename: 'a.gguf' }, { filename: 'b.gguf' }, { filename: 'c.gguf' }, { filename: 'd.gguf' }]
    const rows = { 'a.gguf': { status: 'downloading' }, 'b.gguf': { status: 'complete' }, 'd.gguf': { status: 'error' } }
    expect(modelsInFlight(models, rows).map((m) => m.filename)).toEqual(['a.gguf', 'd.gguf'])
    expect(modelsInFlight(models, {})).toEqual([])
  })
})
