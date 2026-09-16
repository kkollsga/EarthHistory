/**
 * The application version, inlined from package.json by Vite's `define`.
 *
 * The header logo advertises this string so a tester or a bug report can name
 * the exact build without opening the deployed artifact's manifest.
 */
export const APP_VERSION: string = __APP_VERSION__;

/** The version label shown in the logo tooltip and its accessible name. */
export const APP_VERSION_LABEL = `EarthHistory v${APP_VERSION}`;
