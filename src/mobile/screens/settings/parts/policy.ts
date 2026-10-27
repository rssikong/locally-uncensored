/**
 * The ONE place this strand asks what the store allows, and for the consent
 * to send content to LU Cloud. Every screen imports from here. It is the
 * scaffold module `src/mobile/policy/`, which brings its own sheet
 * ("ai-consent") for the question.
 */
export { storePolicy, hasAiConsent, revokeAiConsent, ensureAiConsent, aiConsentGivenAt, useAiConsent, setStorePresetForTests, type StorePolicy, type StorePreset } from '../../../policy'
