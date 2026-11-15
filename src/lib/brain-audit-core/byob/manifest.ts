import {
	BYOB_DATA_MAX_BYTES,
	isCredentialPath,
	isDataNoise,
	isDataPath,
	isDeferredData
} from './data';
import { OWNERSHIP_FILE_RE } from './codeowners';
import { isByobMarkdown, isByobNavigationFile, isByobText } from './dialect';
import { inFolder, inScope, mirrorPairs, type ByobScope, type MirrorPair } from './scope';
import { HTML_MAX_RAW_BYTES, isHtmlPath } from './html-paths';
import { BRAIN_EXCLUDED_RE, SKILL_FILE_RE, skillFolderOf, skillFolders } from './tree-paths';
import { rulesOf } from '../method/rules';
import type { Method } from '../method/types';

export { BRAIN_EXCLUDED_RE, skillFolderOf, skillFolders };

export type TreeEntry = { path: string; sha: string; size: number };

function isBrainSidecar(method: Method, path: string): boolean {
	const r = rulesOf(method);
	if (r.rootSettings.test(path)) return true;
	const base = path.slice(path.lastIndexOf('/') + 1);
	return r.sidecarName.test(base) && base.toLowerCase() !== r.claimMapSuffix;
}
const OBSIDIAN_TEMPLATE_SETTINGS_RE =
	/(^|\/)\.obsidian\/(templates\.json|plugins\/templater-obsidian\/data\.json)$/i;

export type ByobManifestKind = 'page' | 'navigation' | 'sidecar' | 'asset' | 'data' | 'html';

export type ByobManifestFile = {
	path: string;
	sha: string;
	size: number;
	kind: ByobManifestKind;
	deferred?: true;
	html?: ByobHtmlOrigin;
};

export type ByobHtmlOrigin = {
	path: string;
	blob: string;
	nativeId: string | null;
	part: 'page' | 'comments';
};

export type ByobManifest = {
	files: ByobManifestFile[];
	skipped: { path: string; why: string }[];
	outOfScope: number;
	outOfScopePaths: string[];
	unread: ByobUnreadFormat[];
	html: TreeEntry[];
};

export type ByobUnreadFormat = { ext: string; files: number; bytes: number };

export const UNREAD_FORMATS_KEPT = 30;

export function unreadFormatOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '(none)';
}

export function unreadFormats(
	entries: readonly { path: string; size: number }[]
): ByobUnreadFormat[] {
	const byExt = new Map<string, ByobUnreadFormat>();
	for (const entry of entries) {
		const ext = unreadFormatOf(entry.path);
		const row = byExt.get(ext) ?? { ext, files: 0, bytes: 0 };
		row.files += 1;
		row.bytes += entry.size;
		byExt.set(ext, row);
	}
	const sorted = [...byExt.values()].sort((a, b) => b.files - a.files || (a.ext < b.ext ? -1 : 1));
	if (sorted.length <= UNREAD_FORMATS_KEPT) return sorted;
	const tail = sorted.slice(UNREAD_FORMATS_KEPT - 1);
	return [
		...sorted.slice(0, UNREAD_FORMATS_KEPT - 1),
		{
			ext: 'other',
			files: tail.reduce((n, r) => n + r.files, 0),
			bytes: tail.reduce((n, r) => n + r.bytes, 0)
		}
	];
}

const UNREAD_IGNORED = /(^|\/)\.[^/]+\//;

export type ByobManifestFailure = {
	code: 'tree_truncated' | 'too_many_files';
	message: string;
};

export const TREE_TRUNCATED_MESSAGE =
	'GitHub cannot list this repository in one call (over 100,000 entries). Pin a smaller repository.';

const count = (value: number) => value.toLocaleString('en-US');

export function tooManyFilesMessage(files: number, limit: number): string {
	return `The repository has ${count(files)} files the brain would read; the limit is ${count(limit)}.`;
}

export function manifestKindOf(
	method: Method,
	path: string,
	folders: readonly string[],
	data?: ReadonlySet<string>
): ByobManifestKind | null {
	if (OWNERSHIP_FILE_RE.test(path)) return 'sidecar';
	if (BRAIN_EXCLUDED_RE.test(path)) return null;
	if (!isByobMarkdown(path) && isCredentialPath(path)) return null;
	const skill = skillFolderOf(path, folders);
	if (skill !== null && !SKILL_FILE_RE.test(path.slice(skill.length))) return 'asset';
	if (isBrainSidecar(method, path) || OBSIDIAN_TEMPLATE_SETTINGS_RE.test(path)) return 'sidecar';
	if (isHtmlPath(path)) return isDataNoise(path) || /(^|\/)\./.test(path) ? null : 'html';
	if (!isByobText(path))
		return data && isDataPath(path, data) && !/(^|\/)\./.test(path) && !isDataNoise(path)
			? 'data'
			: null;
	if (!isByobMarkdown(path) && (isDataNoise(path) || /(^|\/)\./.test(path))) return null;
	return isByobNavigationFile(path) ? 'navigation' : 'page';
}

export function buildByobManifest(
	method: Method,
	tree: { truncated: boolean; entries: readonly TreeEntry[] },
	limits: { maxFiles: number; maxFileBytes: number },
	scope: Pick<ByobScope, 'include' | 'exclude'> = { include: [], exclude: [] },
	data?: ReadonlySet<string>,
	folder: string | null = null
): { ok: true; manifest: ByobManifest } | ({ ok: false } & ByobManifestFailure) {
	if (tree.truncated) return { ok: false, code: 'tree_truncated', message: TREE_TRUNCATED_MESSAGE };
	const rel = (path: string) => (folder ? path.slice(folder.length) : path);
	const folders = skillFolders(
		tree.entries.filter((entry) => inFolder(entry.path, folder)).map((entry) => rel(entry.path))
	);
	const files: ByobManifestFile[] = [];
	const skipped: ByobManifest['skipped'] = [];
	const outOfScopePaths: string[] = [];
	const unread: { path: string; size: number }[] = [];
	const html: TreeEntry[] = [];
	for (const entry of tree.entries) {
		if (!inFolder(entry.path, folder)) {
			if (manifestKindOf(method, entry.path, skillFolders([]), data))
				outOfScopePaths.push(entry.path);
			continue;
		}
		if (!isByobMarkdown(entry.path) && isCredentialPath(entry.path)) {
			if (inScope(entry.path, scope)) skipped.push({ path: entry.path, why: 'credentials' });
			continue;
		}
		const kind = manifestKindOf(method, rel(entry.path), folders, data);
		if (!kind) {
			if (
				!BRAIN_EXCLUDED_RE.test(entry.path) &&
				!UNREAD_IGNORED.test(entry.path) &&
				!/^\./.test(rel(entry.path)) &&
				inScope(entry.path, scope)
			) {
				unread.push({ path: entry.path, size: entry.size });
				if (entry.size > BYOB_DATA_MAX_BYTES)
					skipped.push({ path: entry.path, why: `over_size (${entry.size})` });
			}
			continue;
		}
		if (!inScope(entry.path, scope)) {
			outOfScopePaths.push(entry.path);
			continue;
		}
		if (kind === 'html') {
			if (entry.size > HTML_MAX_RAW_BYTES)
				skipped.push({ path: entry.path, why: `html_over_size (${entry.size})` });
			else html.push({ path: entry.path, sha: entry.sha, size: entry.size });
			continue;
		}
		if (kind === 'data' ? entry.size > BYOB_DATA_MAX_BYTES : entry.size > limits.maxFileBytes) {
			skipped.push({ path: entry.path, why: `over_size (${entry.size})` });
			continue;
		}
		files.push({
			path: entry.path,
			sha: entry.sha,
			size: entry.size,
			kind,
			...(kind === 'data' && isDeferredData(entry.path, entry.size, limits.maxFileBytes)
				? { deferred: true as const }
				: {})
		});
	}
	if (files.length + html.length > limits.maxFiles)
		return {
			ok: false,
			code: 'too_many_files',
			message: tooManyFilesMessage(files.length + html.length, limits.maxFiles)
		};
	const byPath = (a: { path: string }, b: { path: string }) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
	return {
		ok: true,
		manifest: {
			files: files.sort(byPath),
			skipped: skipped.sort(byPath),
			outOfScope: outOfScopePaths.length,
			outOfScopePaths: outOfScopePaths.sort(),
			unread: unreadFormats(unread),
			html: html.sort(byPath)
		}
	};
}

export function treeMirrorPairs(
	method: Method,
	entries: readonly TreeEntry[],
	folder: string | null = null
): MirrorPair[] {
	const inside = entries
		.filter((entry) => inFolder(entry.path, folder))
		.map((entry) => (folder ? { ...entry, path: entry.path.slice(folder.length) } : entry));
	const folders = skillFolders(inside.map((entry) => entry.path));
	const pairs = mirrorPairs(
		inside.filter((entry) => {
			const kind = manifestKindOf(method, entry.path, folders);
			return kind !== null && kind !== 'html';
		})
	);
	if (!folder) return pairs;
	return pairs.map((pair) => ({
		...pair,
		id: `${folder}${pair.kept}|${folder}${pair.mirror}`,
		kept: `${folder}${pair.kept}`,
		mirror: `${folder}${pair.mirror}`
	}));
}
