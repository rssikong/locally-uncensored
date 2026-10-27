/**
 * Texts that hold a word a store build must not show, and why they are fine:
 * each one names the switch that keeps the text off the screen in that
 * build, and the file that asks the switch. Read by store-woerter.test.ts.
 *
 * A path is the path of the text inside src/mobile/strings/
 * ("settings.SETTINGS_STRINGS.account.viewPlans") or of a group of texts,
 * which covers everything below it.
 *
 * An entry is a claim. The page-by-page guard
 * (e2e/mobile/store-waechter.mobile.ts) is what checks it on the screen.
 */
export interface LedgerEntry {
  path: string
  /** The switch of policy/storePolicy.ts that keeps it off the screen, or `not-buying` for a word with another meaning. */
  by: 'purchase' | 'externalLinks' | 'gatedModelToken' | 'unfilteredCatalog' | 'unfilteredMarketing' | 'unfilteredWords' | 'customModelUrl' | 'contentLevels' | 'not-buying'
  /** The file that asks the switch. */
  where: string
  /** Presets the entry is for. Default: both store presets. */
  presets?: Array<'appstore' | 'play'>
}

const S = 'settings.SETTINGS_STRINGS'
const C = 'create.CREATE_STRINGS'
const M = 'models.MODELS_STRINGS'
const APPSTORE: Array<'appstore' | 'play'> = ['appstore']

export const STORE_TEXT_LEDGER: LedgerEntry[] = [
  // ---- "plan" as the list of steps of an agent ----
  { path: 'agent.AGENT_STRINGS.notices.plan', by: 'not-buying', where: 'screens/agent (the steps an agent works through)' },
  { path: 'agent.AGENT_STRINGS.notices.planName', by: 'not-buying', where: 'screens/agent (the steps an agent works through)' },

  // ---- the ONE sentence of purchase 'text-only'. A Play build shows it, an App Store build never does. ----
  { path: 'policy.POLICY.plansOnWebsite', by: 'purchase', where: 'the three aliases below', presets: APPSTORE },
  { path: `${S}.store.plansOnWebsite`, by: 'purchase', where: 'screens/settings/parts/store-rules.ts buyHint', presets: APPSTORE },
  { path: 'chat.CHAT_STRINGS.policy.creditsTextOnly', by: 'purchase', where: 'screens/chat/parts/logic/policy.ts purchaseHint', presets: APPSTORE },
  { path: 'chat.CHAT_STRINGS.policy.plansTextOnly', by: 'purchase', where: 'screens/chat/parts/logic/policy.ts purchaseHint', presets: APPSTORE },
  { path: `${C}.policy.plansElsewhere`, by: 'purchase', where: 'screens/create (purchaseView().mode === "text-only")', presets: APPSTORE },

  // ---- the sheet "Add credits" and its buttons (purchase 'in-app', iOS only, in no preset; round 17) ----
  { path: `${S}.iap`, by: 'purchase', where: 'screens/settings/AddCreditsSheet.tsx and its three buttons (lib/iap.ts iapOffered)' },

  // ---- buttons and sentences of a build that links to the plans (purchase 'links') ----
  { path: `${S}.account.noPlanText`, by: 'purchase', where: 'screens/settings/AccountPage.tsx (links)' },
  { path: `${S}.account.manage`, by: 'purchase', where: 'screens/settings/AccountPage.tsx (links)' },
  { path: `${S}.account.viewPlans`, by: 'purchase', where: 'screens/settings/AccountPage.tsx (links)' },
  { path: `${S}.account.addCredits`, by: 'purchase', where: 'screens/settings/AccountPage.tsx (links)' },
  { path: `${S}.account.pastDueTitle`, by: 'purchase', where: 'AccountPage.tsx and cloud/CloudGatePage.tsx (showsBuyText)' },
  { path: `${S}.account.payInvoice`, by: 'purchase', where: 'screens/settings/AccountPage.tsx (links)' },
  { path: `${S}.account.openAccount`, by: 'externalLinks', where: 'screens/settings/AccountPage.tsx (externalLinks === "all")' },
  { path: `${S}.cloud.planProText`, by: 'purchase', where: 'cloud/plans.tsx PlanRows, shown with links only' },
  { path: `${S}.cloud.planHostedText`, by: 'purchase', where: 'cloud/plans.tsx PlanRows, shown with links only' },
  { path: `${S}.cloud.perMonth`, by: 'purchase', where: 'cloud/plans.tsx PlanRows, shown with links only' },
  { path: `${S}.cloud.signInSub`, by: 'purchase', where: 'cloud/CloudGatePage.tsx (showsBuyText)' },
  { path: `${S}.cloud.recheck`, by: 'purchase', where: 'cloud/CloudGatePage.tsx (showsBuyText)' },
  { path: `${S}.cloud.recheckPaid`, by: 'purchase', where: 'cloud/CloudGatePage.tsx (showsBuyText)' },
  { path: `${S}.cloud.payInvoice`, by: 'purchase', where: 'cloud/CloudGatePage.tsx (links)' },
  { path: `${S}.cloud.seePlans`, by: 'purchase', where: 'cloud/CloudGatePage.tsx footer (links)' },
  { path: `${S}.cloud.fromPrice`, by: 'purchase', where: 'cloud/CloudGatePage.tsx footer (links)' },
  { path: `${S}.cloud.footerOpen`, by: 'purchase', where: 'cloud/CloudGatePage.tsx and cloud/PlansSheet.tsx (showsBuyText, links)' },
  { path: `${S}.cloud.plansTitle`, by: 'purchase', where: 'cloud/PlansSheet.tsx (links; otherwise "Not part of this version")' },
  { path: `${S}.cloud.planRow`, by: 'purchase', where: 'cloud/plans.tsx PlanRows, shown with links only' },
  { path: `${S}.cloud.measuredTag`, by: 'unfilteredMarketing', where: 'parts/cloud-counts.ts measuredWithoutRefusals (cloud/CloudGatePage.tsx CountBand)' },
  { path: `${S}.cloud.noPlan`, by: 'purchase', where: 'cloud/CloudGatePage.tsx (showsBuyText)' },
  { path: `${S}.cloud.noBudget`, by: 'purchase', where: 'cloud/CloudGatePage.tsx (showsBuyText)' },
  { path: `${S}.cloud.footer`, by: 'purchase', where: 'cloud/CloudGatePage.tsx (showsBuyText)' },
  { path: `${S}.price.flashFree`, by: 'purchase', where: 'screens/settings/parts/price.ts priceCopy (plain)' },
  { path: `${S}.price.flashUnpaid`, by: 'purchase', where: 'screens/settings/parts/price.ts priceCopy (plain)' },
  { path: `${S}.price.plans`, by: 'purchase', where: 'cloud/PriceSheet.tsx (copy.buyLink)' },
  { path: `${S}.credits.titleTrain`, by: 'purchase', where: 'screens/settings/parts/store-rules.ts creditsCopyFor (plain)' },
  { path: `${S}.credits.textCredits`, by: 'purchase', where: 'screens/settings/parts/store-rules.ts creditsCopyFor (plain)' },
  { path: `${S}.credits.textVideo`, by: 'purchase', where: 'screens/settings/parts/store-rules.ts creditsCopyFor (plain)' },
  { path: `${S}.credits.textTrain`, by: 'purchase', where: 'screens/settings/parts/store-rules.ts creditsCopyFor (plain)' },
  { path: `${S}.credits.plans`, by: 'purchase', where: 'resilience/CreditsSheet.tsx (showsBuyLinks)' },
  { path: `${C}.pastDueTitle`, by: 'purchase', where: 'screens/create/CreatePage.tsx (purchase === "links")' },
  { path: `${C}.payInvoice`, by: 'purchase', where: 'screens/create/CreatePage.tsx (purchase === "links")' },
  { path: `${C}.gatePlan`, by: 'purchase', where: 'screens/create/CreatePage.tsx (purchase === "links")' },
  { path: `${C}.error.creditsText`, by: 'purchase', where: 'screens/create/parts/ErrorNotice.tsx (mode "links")' },
  { path: `${C}.error.videoBudgetText`, by: 'purchase', where: 'screens/create/parts/ErrorNotice.tsx (mode "links")' },
  { path: `${C}.error.trainingsText`, by: 'purchase', where: 'screens/create/parts/ErrorNotice.tsx (mode "links")' },
  { path: `${C}.error.seePlans`, by: 'purchase', where: 'screens/create/parts/ErrorNotice.tsx (mode "links")' },
  { path: `${C}.showcase.plans`, by: 'purchase', where: 'screens/create/ShowcasePage.tsx (purchase === "links")' },

  // ---- links out of the app (externalLinks 'all') ----
  { path: `${S}.contentPolicy.fixedOpen`, by: 'purchase', where: 'screens/settings/ContentPolicyPage.tsx (showsBuyText)' },
  { path: `${S}.about.website`, by: 'externalLinks', where: 'screens/settings/AboutPage.tsx (appLinkAllowed)', presets: APPSTORE },
  { path: `${M}.detail.viewHf`, by: 'externalLinks', where: 'screens/models/ModelDetailPage.tsx (appLinkAllowed)', presets: APPSTORE },
  { path: `${M}.detail.viewHfOpens`, by: 'externalLinks', where: 'screens/models/ModelDetailPage.tsx (appLinkAllowed, the line under viewHf)', presets: APPSTORE },

  // ---- content levels ----
  { path: `${S}.contentPolicy.offText`, by: 'contentLevels', where: 'screens/settings/parts/store-rules.ts offeredLevels (level Off only with "all")' },
  { path: `${S}.contentPolicy.offElsewhere`, by: 'contentLevels', where: 'screens/settings/ContentPolicyPage.tsx (shown with "no-off" only)', presets: APPSTORE },

  // ---- models without refusals (policy/unfiltered.ts) ----
  // The marks and their filter are advertising: no store build shows them (unfilteredMarketing).
  { path: 'chat.CHAT_STRINGS.model.filterMarked', by: 'unfilteredMarketing', where: 'screens/chat/parts/logic/policy.ts offeredPickerFilters (ModelSheet.tsx: marksShown)' },
  { path: 'chat.CHAT_STRINGS.model.tagMeasured', by: 'unfilteredMarketing', where: 'screens/chat/parts/logic/policy.ts storeCloudModels (a store build strips the mark)' },
  // The word of the statement mark: no store build writes it. Without the switch a row loses the mark and the group head
  // and reads the name the catalogue route gives it.
  { path: 'chat.CHAT_STRINGS.model.tagStatement', by: 'unfilteredMarketing', where: 'screens/chat/parts/logic/policy.ts storeCloudModels' },
  { path: `${C}.model.noFilter`, by: 'unfilteredMarketing', where: 'screens/create/parts/policy.ts createMarksShown (CreateModelSheet.tsx)' },
  { path: `${C}.guided.noFilter`, by: 'unfilteredMarketing', where: 'screens/create/parts/policy.ts createMarksShown (PresetSheet.tsx)' },
  { path: `${M}.models.tagNoFilter`, by: 'unfilteredMarketing', where: 'screens/models/parts/policy.ts shownFacts and showsMarks (ModelCard.tsx, ModelDetailPage.tsx)' },
  { path: `${M}.detail.abliterated`, by: 'unfilteredMarketing', where: 'screens/models/ModelDetailPage.tsx (showsMarks)' },
  // The word as a designation: the tab of the onboarding and the filter of the catalogue. An App Store build has no such
  // models; a Play build shows the word only with its switch unfilteredWords, and then store-rules.ts lets it pass there.
  { path: `${M}.setupModel.unfiltered`, by: 'unfilteredWords', where: 'screens/models/parts/policy.ts listsUnfiltered (onboarding/SetupModelPage.tsx)' },
  { path: `${M}.models.filterUnfiltered`, by: 'unfilteredWords', where: 'screens/models/parts/policy.ts listsUnfiltered (ModelsPage.tsx, chips)' },
  { path: `${M}.models.search`, by: 'customModelUrl', where: 'screens/models/ModelsPage.tsx', presets: APPSTORE },
  { path: `${M}.models.searchHint`, by: 'customModelUrl', where: 'screens/models/ModelsPage.tsx', presets: APPSTORE },
  { path: `${M}.models.searching`, by: 'customModelUrl', where: 'screens/models/ModelsPage.tsx', presets: APPSTORE },
  { path: `${M}.models.searchResults`, by: 'customModelUrl', where: 'screens/models/ModelsPage.tsx', presets: APPSTORE },
  { path: `${M}.storage.token`, by: 'gatedModelToken', where: 'screens/models/StoragePage.tsx', presets: APPSTORE },
  { path: `${M}.storage.tokenHint`, by: 'gatedModelToken', where: 'screens/models/StoragePage.tsx', presets: APPSTORE },
]
