// Runs before every test file (vitest.config.ts, setupFiles).
//
// The composer lays its drafts down in a module-level shelf when it unmounts
// (lib/chat-drafts.ts). Testing Library unmounts after every test, so without
// this the next test would open with the text of the last one.
import { beforeEach } from 'vitest'
import { clearChatDrafts } from './lib/chat-drafts'

beforeEach(() => clearChatDrafts())
