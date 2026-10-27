/**
 * What the Models page shows: the segment, the filters, the search text.
 * Kept outside the page so it survives a tab switch and so other pages can
 * send the user there with a view set ("Manage installed models" in G9,
 * "Pick a smaller model" in M2).
 */
import { create } from 'zustand'
import { DEFAULT_FILTERS, type CatalogFilters } from './fit'

export type ModelsSegment = 'new' | 'installed'

interface ModelsViewState {
  segment: ModelsSegment
  filters: CatalogFilters
  query: string
  /** Bare name of the model the benchmark page opens with (M2.5). */
  benchModel: string | null
  /** Counts every time another screen sent the user here with a view set: the page then starts at its top. */
  arrivals: number
  /** The wish the user arrived with was "a model that reads images". Cleared by the next change of a filter. */
  wantsVision: boolean
  setSegment: (segment: ModelsSegment) => void
  toggleFilter: (key: keyof CatalogFilters) => void
  setFilters: (filters: CatalogFilters) => void
  setQuery: (query: string) => void
  setBenchModel: (name: string | null) => void
}

export const useModelsView = create<ModelsViewState>((set) => ({
  segment: 'new',
  filters: DEFAULT_FILTERS,
  query: '',
  benchModel: null,
  arrivals: 0,
  wantsVision: false,
  setSegment: (segment) => set({ segment }),
  toggleFilter: (key) => set((s) => ({ filters: { ...s.filters, [key]: !s.filters[key] }, wantsVision: false })),
  setFilters: (filters) => set({ filters, wantsVision: false }),
  setQuery: (query) => set({ query }),
  setBenchModel: (benchModel) => set({ benchModel }),
}))

/** Models, "Get new", only what fits: where "Pick a smaller model" leads. */
export function showFittingModels(): void {
  showModelsWith({})
}

/** What another screen may ask the Models page to show. Everything left out is the default view. */
export interface ModelsWish {
  /** Only models that read images (the chat asks for this when a photo was attached). */
  vision?: boolean
  mainstream?: boolean
  unfiltered?: boolean
  /** Also show what is too large for this phone. Default: only what fits. */
  all?: boolean
  /** Start with this text in the search field. */
  query?: string
  /** Open "Installed" instead of "Get new". */
  installed?: boolean
}

/**
 * Set the view of the Models page for a user who is sent there, WITHOUT
 * moving: the caller navigates itself (nav.switchTab('models') or
 * nav.resetTo('models')). The page takes the wish over and starts at its top
 * instead of where it was left (acceptance Android 08.10.2026, N13).
 *
 * A wish for a model that reads images is kept even while no model of the
 * phone catalogue can: the page then says so and points to LU Cloud, instead
 * of showing the usual list as if nothing was asked.
 */
export function showModelsWith(wish: ModelsWish): void {
  useModelsView.setState((s) => ({
    segment: wish.installed ? 'installed' : 'new',
    filters: { ...DEFAULT_FILTERS, fitsOnly: !wish.all, mainstream: !!wish.mainstream, unfiltered: !!wish.unfiltered, vision: !!wish.vision },
    query: wish.query ?? '',
    wantsVision: !!wish.vision,
    arrivals: s.arrivals + 1,
  }))
}
