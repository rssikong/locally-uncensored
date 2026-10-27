/**
 * Another screen sends the user to Models with a wish (acceptance Android
 * 08.10.2026, N13): the view takes it over and counts the arrival, so the
 * page starts at its top.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS } from '../parts/fit'
import { showFittingModels, showModelsWith, useModelsView } from '../parts/view'

const view = () => useModelsView.getState()

describe('the view of Models, set from outside', () => {
  beforeEach(() => {
    useModelsView.setState({ segment: 'installed', filters: { fitsOnly: false, mainstream: true, unfiltered: false, vision: false }, query: 'old', wantsVision: false, arrivals: 0 })
  })

  it('"Pick a smaller model": Get new, only what fits, no search text, one arrival', () => {
    showFittingModels()
    expect(view()).toMatchObject({ segment: 'new', filters: { ...DEFAULT_FILTERS, fitsOnly: true }, query: '', wantsVision: false, arrivals: 1 })
    showFittingModels()
    expect(view().arrivals).toBe(2)
  })

  it('takes a wish over whole and leaves nothing of the view before', () => {
    showModelsWith({ unfiltered: true, all: true, query: 'dolphin' })
    expect(view()).toMatchObject({ segment: 'new', filters: { fitsOnly: false, mainstream: false, unfiltered: true, vision: false }, query: 'dolphin', arrivals: 1 })
    showModelsWith({ installed: true })
    expect(view()).toMatchObject({ segment: 'installed', filters: DEFAULT_FILTERS, query: '', arrivals: 2 })
  })

  it('keeps the wish for a model that reads images until the user changes a filter', () => {
    showModelsWith({ vision: true })
    expect(view()).toMatchObject({ wantsVision: true, filters: { ...DEFAULT_FILTERS, vision: true } })
    view().toggleFilter('mainstream')
    expect(view().wantsVision).toBe(false)
    showModelsWith({ vision: true })
    view().setFilters(DEFAULT_FILTERS)
    expect(view().wantsVision).toBe(false)
    // A view change that is no arrival does not count as one.
    expect(view().arrivals).toBe(2)
  })
})
