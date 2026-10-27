/**
 * The store building blocks: what a store demands, as switches, and the
 * three parts every strand shares (report, consent, age question).
 * Explained in mobile-docs/STORE-BAUSTEINE.md.
 */
export { storePolicy, setStorePresetForTests, setPurchaseForTests, outwardPurchase, STORE_PRESETS, STORE_PRESET_IDS, DEFAULT_STORE_PRESET, type StorePolicy, type StorePreset } from './storePolicy'
export { unfilteredMarksShown, unfilteredWordsShown, directMarkShown, cloudModelListed, cloudModelStoreName, cloudModelShown, cloudModelsShown, cloudModelShownAmong, shownName, shownDescription, DIRECT_MARK, DIRECT_MARK_SHORT, DIRECT_SENTENCE, UNNAMED_CLOUD_MODEL, type UnfilteredSwitches, type NamedCloudModel, type ShownName } from './unfiltered'
export { namesUnfiltered, carriesUnfilteredWord, withoutUnfilteredWords, UNFILTERED_SPELLINGS, type UnfilteredSpelling } from './unfiltered-names'
export { openReport, sendReport, queuedReports, type ReportTarget, type ReportInput, type ReportKind, type ReportOutcome } from './report'
export { ensureAiConsent, hasAiConsent, revokeAiConsent, aiConsentGivenAt, useAiConsent } from './consent'
export { ageState, useAgeState, type AgeState } from './age'
