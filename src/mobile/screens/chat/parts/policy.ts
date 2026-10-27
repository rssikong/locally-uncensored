/**
 * The ONE place this strand imports the store policy from: the scaffold
 * module src/mobile/policy/ (switches, report sheet, consent sheet).
 */
export { storePolicy, openReport, ensureAiConsent } from '../../../policy'
