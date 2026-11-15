/**
 * The digest that says two builds of `brain-audit.mjs` are the same program.
 *
 * esbuild writes each bundled module's path into the bundle (a `// path` comment above the
 * module, and the key of a CommonJS wrapper). For the audit's own sources and the CLI's, the
 * path is repository-relative. For a third-party package it is the package manager's layout:
 * pnpm writes
 * `node_modules/.pnpm/graphology@0.26.0_graphology-types@0.24.8/node_modules/graphology/…`,
 * npm (the mirror) writes `node_modules/graphology/…`. {@link normalizeBundle} rewrites every
 * such path to the npm form; nothing else is touched. Two bundles whose normalized texts have
 * the same sha256 are byte-identical but for those path strings.
 *
 * Shared by the mirror generator and the mirror's own test.
 */
import { createHash } from 'node:crypto';

/**
 * `[dirs/ or ../]*node_modules/[.pnpm/<store entry>/node_modules/]` → `node_modules/`. The
 * leading directories cover a `node_modules` reached through a symbolic link (esbuild writes
 * the real path, relative to the build's root).
 */
const PACKAGE_PATH = /(?:\.\.\/|[\w.@+-]+\/)*node_modules\/(?:\.pnpm\/[^/"'\s]+\/node_modules\/)?/g;

/** @param {string} text the bundle */
export function normalizeBundle(text) {
	return text.replace(PACKAGE_PATH, 'node_modules/');
}

/** @param {string | Uint8Array} data */
export function sha256(data) {
	return createHash('sha256').update(data).digest('hex');
}

/** @param {string} text the bundle @returns {string} the sha256 of its normalized text */
export function bundleDigest(text) {
	return sha256(normalizeBundle(text));
}
