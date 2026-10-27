/**
 * Texts of the store building blocks (src/mobile/policy): reporting content,
 * the consent to LU Cloud, the age question. English, the app's language.
 * No promise the code does not keep, no provider is named.
 */
export const POLICY = {
  // ---- report ----
  reportTitle: 'Report this content',
  reportIntro: 'Tell us what is wrong with it. The report goes to the LU team.',
  /** While this build has no report service: say what really happens (durchsicht-mobile M4). */
  reportIntroNoService: 'Tell us what is wrong with it. The report is saved on this phone and sent once the report service is available.',
  reportReasonLabel: 'What is wrong',
  reportNoteLabel: 'Anything to add (optional)',
  reportNotePlaceholder: 'What should we know',
  reportIncludeText: 'Include the reported text',
  reportIncludeTextHint: 'Without it we only see which model wrote it.',
  reportSendsLocal: 'This content was made on this phone. Only what you pick here is sent.',
  reportSendsLocalNoService: 'This content was made on this phone. Only what you pick here is saved for the report.',
  reportSendsComputer: 'This content was made on your computer. Only what you pick here is sent.',
  reportSendsComputerNoService: 'This content was made on your computer. Only what you pick here is saved for the report.',
  reportSend: 'Send report',
  reportSave: 'Save report',
  reportPickReason: 'Pick what is wrong first',
  reportSent: 'Report sent. Thank you.',
  reportQueued: 'Report saved. It is sent as soon as LU can reach the report service.',
  reportQueuedNoService: 'Report saved on this phone. It is sent once the report service is available.',
  reportNotSaved: 'The report could not be saved. Please try again.',
  // ---- consent ----
  consentTitle: 'LU Cloud processes your content',
  consentText:
    'When you use LU Cloud, your messages, attached files, images and voice recordings are sent to LU Cloud. LU Cloud passes them to third-party AI providers that run its models, so they can be processed.',
  consentLocal: 'On device models keep them on this phone.',
  /** The link to the privacy policy inside the sheet (one of the four legal links). */
  consentPrivacy: 'Read the privacy policy',
  consentPrivacyFailed: 'Could not open the browser.',
  consentRevoke: 'You can take this back at any time. LU then asks again before it sends anything to LU Cloud.',
  consentAgree: 'Agree and continue',
  consentDecline: 'Not now',
  // ---- age ----
  ageTitle: 'Are you 18 or older?',
  ageText: 'LU is made for adults. Your answer is saved on this phone and stays on this device. LU does not ask for your date of birth.',
  ageYes: 'Yes, I am 18 or older',
  ageNo: 'No',
  ageConfirmTitle: 'You said you are under 18',
  ageConfirmText: 'LU will stay closed on this device. Is that right?',
  ageConfirmBack: 'Go back',
  ageConfirmMinor: 'Yes, I am under 18',
  ageBlockedTitle: 'LU is for adults',
  ageBlockedText: 'You need to be 18 or older to use LU. Your answer is saved on this phone.',
  // ---- buying (switch purchase: 'text-only') ----
  /** The ONE sentence about buying a store build may show, without a link. Every strand shows this one and no other. */
  plansOnWebsite: 'Plans and credits are available on lu-labs.ai.',
  // ---- the mark "Direct" (switch directBadge, policy/unfiltered.ts) ----
  /** The mark of a LU Cloud model that is named, on the server, by a word a store build does not show. */
  directMark: 'Direct',
  /** The same mark where there is no room for the word. Its name for a screen reader is the word. */
  directMarkShort: 'D',
  /** The one sentence a tap on the mark shows. */
  directSentence: 'Direct models follow instructions closely and add fewer refusals of their own. Your content settings still apply.',
  /** What a store build calls a LU Cloud model it has no name for that it may show. Never the id. */
  unnamedCloudModel: 'LU Cloud model',
  // ---- personas (switch unfilteredPersonas) ----
  /** The default persona, which sends no instruction of its own, in a build that does not call it by its product name. */
  plainPersonaName: 'No persona',
  // ---- closed by the store switches (policy/gates.ts) ----
  /** Round 17 (purchase 'in-app'): a purchase of an earlier run of the app got its credit now. */
  iapCredited: 'Your credits were added.',
  unavailableTitle: 'Not part of this version',
  unavailableText: 'This version of LU does not include this feature.',
  unavailableRemote: 'This version of LU does not include Remote desktop.',
  unavailableProviders: 'This version of LU does not include providers with your own key.',
  unavailableBack: 'Back',
  unavailableClose: 'Close',
  unavailableLink: 'This version of LU does not open this link.',
} as const

export const REPORT_REASONS = [
  { id: 'sexual', label: 'Sexual content' },
  { id: 'minors', label: 'Involves a minor' },
  { id: 'violence', label: 'Violence or gore' },
  { id: 'hate', label: 'Hate or harassment' },
  { id: 'self-harm', label: 'Self harm' },
  { id: 'illegal', label: 'Illegal activity' },
  { id: 'other', label: 'Something else' },
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]['id']
