/**
 * The package version, as a value.
 *
 * Kept in the source rather than read from `package.json`, so the constant
 * works identically in the CommonJS build, the ESM build and a bundle, with no
 * JSON import and no filesystem read. Bumped by hand with `package.json`.
 */
export const SHARED_VERSION = "0.0.0";
