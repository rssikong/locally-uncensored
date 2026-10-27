/**
 * The error of an answer: the logic layer keeps it as a field of the message and reads it there
 * (src/lib/message-error.ts). The phone takes the reading that also cleans the text for a reader
 * (src/lib/reader-text.ts): the bubble, Copy, Share, the preview and the search of the chat list, the notice
 * after a return and the export all ask here, so a saved part of an answer is cleaned exactly like a
 * finished one (check 4 on Android, F4: `<reminder>` at the start of a saved part).
 */
export { answerBodyForReader as answerBody, viewAnswerForReader as viewAnswer, type AnswerView, type RunError, type RunErrorKind } from '../../../../../lib/reader-text'
