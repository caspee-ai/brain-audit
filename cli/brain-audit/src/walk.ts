/**
 * The local folder as the platform sees a pinned repository's tree: every regular file, its
 * path relative to the folder (`/`-separated), its size and its git blob id. Symbolic links are
 * not followed (a git tree holds a link as a path, never its target). The core's manifest then
 * decides what is read; its own exclusions are the platform's and stay as they are.
 *
 * Never entered, before the tree is built (CLI-only; a git pin would not carry them):
 * - `.git`, `node_modules`;
 * - the AI agents' own folders: `.cursor` and `.codex` whole (Cursor's project rule for this
 *   audit lands in `.cursor/rules/`), and in `.claude` everything but `skills/` — the platform
 *   reads `.claude/skills/<name>/` as a brain's skills, so they stay, but `.claude/worktrees`,
 *   settings and the audit's own `skills/brain-audit/` do not;
 * - this CLI's own work directories (`~/.caspee`, `--work`) when they lie inside the folder.
 */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TreeEntry } from '$lib/brain-audit-core';

/** Folders never entered. */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
	'.git',
	'node_modules',
	'.cursor',
	'.codex'
]);

/** Claude Code's folder: only its `skills/` is a brain's (the platform's skill folders). */
const CLAUDE_DIR = '.claude';
const CLAUDE_KEPT = 'skills';
/** The audit's own skill, should it be installed in the project rather than in `~`. */
const AUDIT_SKILL = 'brain-audit';

/** Far above the platform's 50,000-file limit: past it the walk stops rather than run on. */
export const WALK_MAX_ENTRIES = 200_000;

/** Files larger than this get a size-based id instead of their blob id (never read anyway). */
const HASH_MAX_BYTES = 64 * 1024 * 1024;

export class WalkError extends Error {}

/** The git blob id of some bytes: what GitHub's tree gives as `sha`. */
export function gitBlobSha(bytes: Uint8Array): string {
	return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

/** How much of a file is read at a time while hashing it. */
const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * The git blob id and size of the file at `abs`, read in chunks so a large file is never held
 * whole. The size comes from the open descriptor, so header and bytes describe the same file.
 * Above {@link HASH_MAX_BYTES} the file is not read and gets a size-based id from `index`.
 */
export function fileBlobSha(abs: string, index = 0): { sha: string; size: number } {
	const fd = openSync(abs, 'r');
	try {
		const size = fstatSync(fd).size;
		if (size > HASH_MAX_BYTES) return { sha: `size-${size}-${index}`, size };
		const hash = createHash('sha1').update(`blob ${size}\0`);
		const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(size, 1)));
		let left = size;
		while (left > 0) {
			const read = readSync(fd, chunk, 0, Math.min(chunk.byteLength, left), null);
			// A file that shrank while it was read: hash what there was.
			if (read === 0) break;
			hash.update(chunk.subarray(0, read));
			left -= read;
		}
		return { sha: hash.digest('hex'), size };
	} finally {
		closeSync(fd);
	}
}

export type WalkedEntry = TreeEntry & { abs: string };

/** `skip`: absolute folders never entered (the CLI's work directories). */
export function walkFolder(root: string, skip: readonly string[] = []): WalkedEntry[] {
	const skipped = new Set(skip.map((path) => resolve(path)));
	const out: WalkedEntry[] = [];
	/** `inClaude`: `dir` is a `.claude`; `inClaudeSkills`: it is a `.claude/skills`. */
	const visit = (dir: string, rel: string, inClaude = false, inClaudeSkills = false) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
			const abs = join(dir, entry.name);
			if (inClaude && !(entry.isDirectory() && entry.name === CLAUDE_KEPT)) continue;
			if (entry.isDirectory()) {
				if (SKIPPED_DIRS.has(entry.name) || skipped.has(resolve(abs))) continue;
				if (inClaudeSkills && entry.name === AUDIT_SKILL) continue;
				visit(abs, relPath, entry.name === CLAUDE_DIR, inClaude);
			} else if (entry.isFile()) {
				if (out.length >= WALK_MAX_ENTRIES)
					throw new WalkError(
						`The folder holds more than ${WALK_MAX_ENTRIES} files; point the audit at the brain's own folder.`
					);
				const { sha, size } = fileBlobSha(abs, out.length);
				out.push({ path: relPath, sha, size, abs });
			}
		}
	};
	visit(root, '');
	return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
