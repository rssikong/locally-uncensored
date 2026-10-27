// Permission defaults on a phone.
//
// A file of its own, without an import: api/mcp/types.ts needs this function
// for defaultPermissionsForDevice(), and lib/mobile-tools.ts needs the types
// of api/mcp/types.ts. With the function in mobile-tools.ts the two files
// imported each other (`npm run cycles`). mobile-tools.ts hands it on under
// the same name, so every caller keeps its import.

/** The categories whose tools do not exist on a phone. */
export const MOBILE_BLOCKED_CATEGORIES = ['terminal', 'desktop', 'image', 'video'] as const

type MobileBlockedCategory = (typeof MOBILE_BLOCKED_CATEGORIES)[number]

/** Permission defaults on a phone: the four categories whose tools do not
 *  exist there start blocked. An addition to the registration filter, not a
 *  replacement for it (a user can switch a permission back, and the sub agent
 *  never asked the permissions when it offered tools). */
export function mobilePermissionDefaults<T extends Record<MobileBlockedCategory, string>>(base: T): T {
  return { ...base, terminal: 'blocked', desktop: 'blocked', image: 'blocked', video: 'blocked' }
}
