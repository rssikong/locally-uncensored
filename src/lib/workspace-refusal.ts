// ─── A file the agent may not open, and what the user can do about it ───
//
// Discord 2026-09-28 (a user: "I've tried configuring this every possible
// way, but I still can't get my models to access my files"). Every agent
// permission stood on Auto, and it did not help: the file tools only ever work
// inside the chat's working folder, the Sandbox or a folder picked in LU's
// dialog, and the refusal for anything else reached the user as a grey line
// inside a collapsed tool block. The model got the raw sentence without a
// hint, and a small one answered "I can't access your files".
//
// The refusal comes from the folder jail in commands/filesystem.rs
// (`contain_within`, `check_workspace_root`), mirrored for the dev server in
// lib/dev-fs-jail.ts. Its wording is pinned there; this only recognises it.

import { isRecovered } from './recovered-failure'
import { platformText } from './platform-text'

/** Both jail refusals: a path that leaves the working folder, and a working
 *  folder the jail does not accept at all. */
export const OUTSIDE_WORKSPACE = /escapes the allowed workspace|Not an allowed workspace folder/i

/** The tools that go through the jail. */
const FILE_TOOLS = new Set(['file_read', 'file_write', 'file_edit', 'file_list', 'file_search'])

/** Did a file tool fail because the path is outside the chat's folder? */
export function isOutsideWorkspaceRefusal(toolName: string, error: string | null | undefined): boolean {
  return FILE_TOOLS.has(toolName) && !!error && OUTSIDE_WORKSPACE.test(error)
}

/** A refused file the run did not get by itself (a later call of the same
 *  tool on the same file name succeeded). Only then is the line worth
 *  showing; see lib/recovered-failure.ts. */
export function hasUnrecoveredOutsideRefusal(
  steps: readonly { toolName: string; status: string; error?: string | null; args?: unknown }[],
): boolean {
  return steps.some((c, i) => c.status === 'failed' && isOutsideWorkspaceRefusal(c.toolName, c.error) && !isRecovered(steps, i))
}

/** The line above the chat, in the words of the buttons the user sees. */
export const OUTSIDE_WORKSPACE_NOTICE = platformText('outsideWorkspaceNotice')
