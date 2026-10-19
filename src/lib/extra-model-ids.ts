// GitHub #112 (DwarfStar): a server can serve a model it does not list in
// /models, and LU only ever offered what the list said. The ids a user types
// for an endpoint are added to that endpoint's list here, behind the ones the
// server named itself.
import type { ProviderModel } from '../api/providers/types'

/** How many ids one endpoint keeps, and how long one may be. */
export const MAX_EXTRA_MODEL_IDS = 20
const MAX_ID_LENGTH = 200

/** The key an endpoint's ids are stored under: the address without a trailing
 *  slash, in lower case, so "…/v1" and "…/V1/" are one endpoint. */
export function endpointKey(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').toLowerCase()
}

/** The ids in what the user typed: one per line or separated by commas, without
 *  blanks, doubles, control characters or overlong entries. */
export function parseExtraModelIds(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\n,]/)) {
    const id = raw.trim()
    // eslint-disable-next-line no-control-regex
    if (!id || id.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f\s]/.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length === MAX_EXTRA_MODEL_IDS) break
  }
  return out
}

/** The server's list with the typed ids behind it. An id the server already
 *  lists keeps the server's entry. */
export function withExtraModels(
  listed: ProviderModel[],
  extra: readonly string[],
  make: (id: string) => ProviderModel,
): ProviderModel[] {
  const have = new Set(listed.map((m) => m.id))
  return [...listed, ...extra.filter((id) => !have.has(id)).map(make)]
}
