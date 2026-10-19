/**
 * What a local model sees of REA (lib/plugins/rea-model.ts). On the real run
 * with Qwen 3.8 27B (17.10.2026) the model copied complete Evidence records
 * into trace tools, which REA refused, and one result of 343,583 characters
 * had its endpoint far past what LU's cap keeps. The schema now takes earlier
 * records by reference only, and a result reaches the model as its facts.
 *
 * Run: npx vitest run src/lib/plugins/__tests__/rea-model.test.ts
 */
import { describe, it, expect } from 'vitest'
import { REA_RESULT_MAX, reaArgsFromModel, reaResultForModel, reaToolForModel } from '../rea-model'
import type { MCPToolDefinition } from '../../../api/mcp/types'

const RETAINED = {
  type: 'object',
  properties: {
    kind: { type: 'string', const: 'retained-evidence' },
    evidence_id: { type: 'string', pattern: '^ev_[a-f0-9]{64}$' },
  },
  required: ['kind', 'evidence_id'],
  additionalProperties: false,
}
// REA's complete record, cut to the keys that mark it.
const RECORD = {
  type: 'object',
  properties: {
    evidence_id: { type: 'string' },
    subject: { anyOf: [{ type: 'object', properties: { name: { type: 'string' } } }, { type: 'null' }] },
    normalized_result: {},
  },
  required: ['evidence_id', 'subject', 'normalized_result'],
}

function tool(inputSchema: unknown): MCPToolDefinition {
  return {
    name: 'trace_javascript_semantics', description: 'Trace static JavaScript data-flow.',
    inputSchema: inputSchema as MCPToolDefinition['inputSchema'],
    category: 'workflow', source: 'external', serverId: 'plugin:rea',
  }
}

describe('a REA tool as the model sees it', () => {
  it('takes an earlier record by reference only, as REA recommends', () => {
    const t = reaToolForModel(tool({
      type: 'object',
      properties: { application: { anyOf: [RECORD, RETAINED] }, query: { type: 'object', properties: { seed: { type: 'string' } } } },
      required: ['application', 'query'],
    }))
    expect(t.inputSchema.properties.application).toEqual(RETAINED)
    expect(t.inputSchema.properties.query).toEqual({ type: 'object', properties: { seed: { type: 'string' } } })
    expect(t.inputSchema.required).toEqual(['application', 'query'])
    expect(t.name).toBe('trace_javascript_semantics')
  })

  it('finds the reference in a oneOf and in nested properties too (compare tools: left, right)', () => {
    const t = reaToolForModel(tool({
      type: 'object',
      properties: { pair: { type: 'object', properties: { left: { oneOf: [RECORD, RETAINED], description: 'Left side.' } } } },
      required: [],
    }))
    const left = (t.inputSchema.properties.pair.properties as Record<string, unknown>).left
    expect(left).toEqual({ ...RETAINED, description: 'Left side.' })
  })

  it('a list that takes complete records only keeps a short line instead of their schema', () => {
    const t = reaToolForModel(tool({
      type: 'object', properties: { native_observations: { type: 'array', items: RECORD } }, required: [],
    }))
    const items = t.inputSchema.properties.native_observations.items as unknown as Record<string, unknown>
    expect(items.type).toBe('object')
    expect(items.properties).toBeUndefined()
    expect(String(items.description)).toMatch(/complete Evidence record/)
  })

  it('leaves a tool without records as it was', () => {
    const schema = { type: 'object', properties: { path: { type: 'string', description: 'Local path.' } }, required: ['path'] }
    expect(reaToolForModel(tool(schema)).inputSchema).toEqual(schema)
  })
})

const EV = `ev_${'5b'.repeat(32)}`

describe('the model\'s arguments as REA takes them', () => {
  const schema = reaToolForModel(tool({
    type: 'object',
    properties: {
      application: { anyOf: [RECORD, RETAINED] },
      filters: { type: 'object', properties: { evidence_id: { type: 'string' } } },
      sides: { type: 'array', items: { oneOf: [RECORD, RETAINED] } },
    },
    required: ['application'],
  })).inputSchema

  it('a reference with the wrong kind, or none, is the reference (Qwen 3.8 27B wrote "evidence")', () => {
    expect(reaArgsFromModel(schema, { application: { kind: 'evidence', evidence_id: EV }, seed: { kind: 'string', value: 'http' } }))
      .toEqual({ application: { kind: 'retained-evidence', evidence_id: EV }, seed: { kind: 'string', value: 'http' } })
    expect(reaArgsFromModel(schema, { application: { evidence_id: EV } })).toEqual({ application: { kind: 'retained-evidence', evidence_id: EV } })
    expect(reaArgsFromModel(schema, { sides: [{ evidence_id: EV, operation: 'x' }] })).toEqual({ sides: [{ kind: 'retained-evidence', evidence_id: EV }] })
  })

  it('leaves an evidence id where no reference is taken, and an id that is none, to REA', () => {
    expect(reaArgsFromModel(schema, { filters: { evidence_id: EV } })).toEqual({ filters: { evidence_id: EV } })
    expect(reaArgsFromModel(schema, { application: { kind: 'evidence', evidence_id: 'ev_made_up' } }))
      .toEqual({ application: { kind: 'evidence', evidence_id: 'ev_made_up' } })
    expect(reaArgsFromModel(undefined, { a: 1 })).toEqual({ a: 1 })
  })
})
const HEX = 'ab'.repeat(32)

// The shape of analyze_javascript_application's record, with one IPC channel
// and the endpoint literal the real run lost.
function evidence(nodes = 1) {
  return {
    evidence_id: EV,
    subject: { name: 'app.asar', digest: { sha256: HEX }, local_path: '/x/app.asar', format: 'asar' },
    provider: { id: 'rea-javascript-application', name: 'REA JavaScript application analyzer', version: '1' },
    operation: 'analyze_javascript_application',
    limitations: ['index.html has 1 inline JavaScript body that was not analyzed.'],
    normalized_result: {
      root_artifact_sha256: HEX,
      summary: { electron: { ipc: { literal_channels: 1 } } },
      coverage: { status: 'partial' },
      graph: {
        nodes: Array.from({ length: nodes }, () => ({
          node_id: `jag_node_${HEX}`,
          kind: 'ipc-channel',
          identity: { strategy: 'observation-fingerprint', observation_sha256: HEX },
          observations: [{
            label: 'notes:save',
            properties: { side: 'main', operation: 'handle', channel: 'notes:save' },
            evidence: { authority: 'ast-static-analysis', location: { source: 'main.js' } },
            observation_id: `jag_observation_${HEX}`,
            limitations: ['Static syntax only.'],
          }],
        })),
      },
      semantic_graph: {
        evidence_contexts: [{ context_id: 'jsrg_evidence_x', files: ['main.js'] }],
        nodes: [{ kind: 'literal', role_key: 'literal:SYNC_ENDPOINT', properties: { value: 'https://sync.tinynotes.example/v2/notes' } }],
      },
    },
  }
}

describe('a REA result as the model sees it', () => {
  it('keeps the facts and the evidence id, drops hashes, identities and repeated provenance', () => {
    const raw = JSON.stringify(evidence())
    const out = reaResultForModel(raw)
    const j = JSON.parse(out)
    expect(j.evidence_id).toBe(EV)
    expect(j.limitations).toEqual(['index.html has 1 inline JavaScript body that was not analyzed.'])
    expect(j.normalized_result.coverage).toEqual({ status: 'partial' })
    expect(j.normalized_result.summary.electron.ipc.literal_channels).toBe(1)
    expect(j.normalized_result.graph.nodes[0].kind).toBe('ipc-channel')
    expect(j.normalized_result.graph.nodes[0].observations[0].properties.channel).toBe('notes:save')
    expect(j.normalized_result.semantic_graph.nodes[0].properties.value).toBe('https://sync.tinynotes.example/v2/notes')
    expect(out).not.toContain(HEX)
    expect(out).not.toMatch(/identity|observation_id|evidence_contexts|role_key|Static syntax only/)
  })

  it('is a fraction of the record where nodes repeat their provenance', () => {
    const raw = JSON.stringify(evidence(50))
    expect(reaResultForModel(raw).length).toBeLessThan(raw.length / 2)
  })

  it('passes a text that is not JSON as it is', () => {
    expect(reaResultForModel('Input validation error: application: Invalid input')).toBe('Input validation error: application: Invalid input')
  })

  it('cuts what is still too long itself and says how to go on, by reference', () => {
    const out = reaResultForModel(JSON.stringify(evidence(2000)))
    expect(out.length).toBeLessThan(REA_RESULT_MAX + 600)
    expect(out).toContain(`[LU cut this result at ${REA_RESULT_MAX} of`)
    expect(out).toContain(`{"kind":"retained-evidence","evidence_id":"${EV}"}`)
    expect(out).toMatch(/detail "summary"/)
  })
})
