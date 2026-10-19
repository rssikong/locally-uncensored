/**
 * The node pack manager (GitHub wish #14): which links are accepted, which
 * pack is offered for a missing node type, and what reaches the backend.
 *
 * Run: npx vitest run src/api/__tests__/custom-node-packs.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../backend', async () => {
  const actual = await vi.importActual<typeof import('../backend')>('../backend')
  return { ...actual, backendCall: vi.fn(), isTauri: () => true }
})

import { backendCall } from '../backend'
import {
  installNodePackFromLink, packsForMissingTypes, parseNodeRepoLink, registryEntryForOrigin,
  removeNodePack, updateNodePack, whyNoUpdate, type NodePack,
} from '../custom-node-packs'
import { CUSTOM_NODE_REGISTRY } from '../model-bundles'

const call = vi.mocked(backendCall)
beforeEach(() => call.mockReset())

const pack = (over: Partial<NodePack> = {}): NodePack => ({
  folder: 'ComfyUI-GGUF', name: 'ComfyUI-GGUF', enabled: true, inDisabledDir: false, kind: 'git',
  origin: 'https://github.com/city96/ComfyUI-GGUF', branch: 'main', commit: 'abcdef1',
  committedAt: '2026-10-01T10:00:00+02:00', hasRequirements: true, ...over,
})

describe('parseNodeRepoLink, the same rule as node_repo_from_url in Rust', () => {
  it('accepts a plain repository link and names the folder after the repository', () => {
    expect(parseNodeRepoLink('https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite')).toEqual({
      ok: true, url: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite', folder: 'ComfyUI-VideoHelperSuite',
    })
    expect(parseNodeRepoLink('  https://www.GitHub.com/city96/ComfyUI-GGUF.git/ ')).toEqual({
      ok: true, url: 'https://github.com/city96/ComfyUI-GGUF', folder: 'ComfyUI-GGUF',
    })
    expect(parseNodeRepoLink('https://gitlab.com/group/sub/pack.git')).toEqual({
      ok: true, url: 'https://gitlab.com/group/sub/pack', folder: 'pack',
    })
    expect(parseNodeRepoLink('https://codeberg.org/someone/comfy_nodes').ok).toBe(true)
  })

  it.each([
    'http://github.com/a/b',
    'git@github.com:a/b.git',
    'ssh://github.com/a/b',
    'ext::sh -c touch% /tmp/x',
    'https://example.com/a/b',
    'https://github.com.evil.io/a/b',
    'https://user:token@github.com/a/b',
    'https://github.com:8443/a/b',
    'https://github.com/a',
    'https://github.com/a/b/c',
    'https://github.com/a/b/tree/main',
    'https://gitlab.com/a/b/-/tree/main',
    'https://github.com/a/..',
    'https://github.com/a/-upload-pack',
    'https://github.com/a/.hidden',
    'https://github.com/a/b?x=1',
    'https://github.com/a/b#readme',
    'https://github.com/a/b c',
    'https://github.com/a/b%2F..',
    '',
  ])('refuses %s', (link) => {
    expect(parseNodeRepoLink(link).ok).toBe(false)
  })

  it('every registry entry passes the rule, so LU\'s own installs keep working', () => {
    for (const entry of Object.values(CUSTOM_NODE_REGISTRY)) {
      const parsed = parseNodeRepoLink(entry.repo)
      expect(parsed.ok, entry.repo).toBe(true)
      if (parsed.ok) expect(parsed.folder).toBe(entry.name)
    }
  })
})

describe('packsForMissingTypes, only from LU\'s own registry', () => {
  it('offers the pack for a listed type, a type by its prefix and an extra type it names', () => {
    const { installable, unknown } = packsForMissingTypes([
      'VHS_VideoCombine', 'VHS_SplitImages', 'DualCLIPLoaderGGUF', 'SomeoneElsesNode', 'VHS_VideoCombine',
    ])
    expect(installable).toEqual([
      { key: 'gguf', name: 'ComfyUI-GGUF', repo: 'https://github.com/city96/ComfyUI-GGUF', types: ['DualCLIPLoaderGGUF'] },
      {
        key: 'videohelpersuite', name: 'ComfyUI-VideoHelperSuite',
        repo: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite', types: ['VHS_SplitImages', 'VHS_VideoCombine'],
      },
    ])
    expect(unknown).toEqual(['SomeoneElsesNode'])
  })

  it('a type nobody lists stays unknown, nothing is guessed from a similar name', () => {
    expect(packsForMissingTypes(['VHSVideoCombine', 'RMBG_Custom', 'UnetLoader']).installable).toEqual([])
  })
})

describe('what reaches the backend', () => {
  it('a pasted link installs fresh only, under the repository name', async () => {
    call.mockResolvedValue({ status: 'installed' })
    await expect(installNodePackFromLink('https://github.com/a/my-pack.git')).resolves.toBe('my-pack')
    expect(call).toHaveBeenCalledWith('install_custom_node', {
      repoUrl: 'https://github.com/a/my-pack', nodeName: 'my-pack', freshOnly: true,
    })
  })

  it('a refused link never reaches the backend', async () => {
    await expect(installNodePackFromLink('https://example.com/a/b')).rejects.toThrow(/github.com, gitlab.com and codeberg.org/)
    expect(call).not.toHaveBeenCalled()
  })

  it('an update of a pinned registry pack stays on its tested commit', async () => {
    call.mockResolvedValue({ status: 'updated' })
    const rmbg = CUSTOM_NODE_REGISTRY.rmbg
    await updateNodePack(pack({ folder: 'ComfyUI-RMBG', name: 'ComfyUI-RMBG', origin: `${rmbg.repo}.git` }))
    expect(call).toHaveBeenCalledWith('install_custom_node', {
      repoUrl: `${rmbg.repo}.git`, nodeName: 'ComfyUI-RMBG', commit: rmbg.commit,
    })
    expect(registryEntryForOrigin('https://github.com/someone/fork-of-rmbg')).toBeUndefined()
  })

  it('an update of any other pack pulls its own origin', async () => {
    call.mockResolvedValue({ status: 'updated' })
    await updateNodePack(pack({ origin: 'https://github.com/x/y', folder: 'y', name: 'y' }))
    expect(call).toHaveBeenCalledWith('install_custom_node', { repoUrl: 'https://github.com/x/y', nodeName: 'y' })
  })

  it('a failed update status is an error, not a success', async () => {
    call.mockResolvedValue({ status: 'update_failed' })
    await expect(updateNodePack(pack())).rejects.toThrow(/update_failed/)
  })

  it('remove names the folder and where it lies, and reports a restart on the way', async () => {
    call.mockResolvedValue({ trashed: true, restarted: true })
    await expect(removeNodePack(pack({ folder: 'old', inDisabledDir: true }))).resolves.toBe(true)
    expect(call).toHaveBeenCalledWith('remove_custom_node', { folder: 'old', inDisabledDir: true })
  })
})

describe('whyNoUpdate', () => {
  it('only a git checkout with an accepted origin, switched on, can be updated', () => {
    expect(whyNoUpdate(pack())).toBeNull()
    expect(whyNoUpdate(pack({ kind: 'file' }))).toMatch(/single file/)
    expect(whyNoUpdate(pack({ kind: 'folder' }))).toMatch(/not a git checkout/)
    expect(whyNoUpdate(pack({ enabled: false }))).toMatch(/disabled/)
    expect(whyNoUpdate(pack({ origin: null }))).toMatch(/no origin/)
    expect(whyNoUpdate(pack({ origin: 'git@github.com:a/b.git' }))).toMatch(/with git yourself/)
  })
})
