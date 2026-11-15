import { globMatches } from './glob';

export type ByobScope = { include: string[]; exclude: string[]; strip: string[] };

export function emptyScope(): ByobScope {
	return { include: [], exclude: [], strip: [] };
}

export const BYOB_FOLDER_MAX = 400;

export function normalizeByobFolder(raw: string): string | null | undefined {
	const trimmed = raw
		.trim()
		.replace(/\\/g, '/')
		.replace(/^(\.\/)+/, '');
	if (trimmed === '' || trimmed === '/' || trimmed === '.') return null;
	if (trimmed.startsWith('/') || trimmed.length > BYOB_FOLDER_MAX || /[*?[\]\0]/.test(trimmed))
		return undefined;
	const parts = trimmed.split('/').filter(Boolean);
	if (parts.length === 0) return null;
	if (parts.some((part) => part === '.' || part === '..')) return undefined;
	return `${parts.join('/')}/`;
}

export function inFolder(path: string, folder: string | null | undefined): boolean {
	return !folder || path.startsWith(folder);
}

export type MirrorPair = {
	id: string;
	kept: string;
	mirror: string;
	why: string;
	files: number;
	identical: number;
	differing: string[];
	differingCount: number;
	freshness?: { kept_newer: number; mirror_newer: number; undated: number };
	proposal_basis?: 'dates' | 'commits' | 'name';
	dated?: { path: string; kept: string | null; mirror: string | null }[];
	one_sided?: string[];
	one_sided_count?: number;
};

export const MIRROR_SHARE_MIN = 0.9;
export const MIRROR_FILES_MIN = 3;
export const MIRROR_DIFFERING_MAX = 50;
export const MIRROR_TWINS_MAX = 20;
const COPY_NAME = /^(vault|backup|backups|copy|copies|archive|archived|export|exports|old)$/i;

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const depth = (folder: string) => folder.split('/').filter(Boolean).length;
const isUnder = (path: string, folder: string) => folder === '' || path.startsWith(folder);

function foldersOf(path: string): string[] {
	const parts = path.split('/');
	const out: string[] = [];
	for (let i = 1; i < parts.length; i += 1) out.push(`${parts.slice(0, i).join('/')}/`);
	return out;
}

function copySignal(a: string, b: string): string | null {
	const segments = a.split('/').filter(Boolean);
	if (segments.some((s) => s.startsWith('.'))) return 'it sits under a dot-folder';
	const named = segments.find((s) => COPY_NAME.test(s));
	if (named && !b.split('/').some((s) => s.toLowerCase() === named.toLowerCase()))
		return `it sits under a folder named ${named}`;
	if (depth(a) > depth(b)) return 'it is the deeper of the two';
	return null;
}

export function mirrorPairs(entries: readonly { path: string; sha: string }[]): MirrorPair[] {
	const byFolder = new Map<string, Map<string, string>>();
	const bySha = new Map<string, string[]>();
	for (const entry of entries) {
		for (const folder of foldersOf(entry.path)) {
			const files = byFolder.get(folder) ?? new Map<string, string>();
			files.set(entry.path.slice(folder.length), entry.sha);
			byFolder.set(folder, files);
		}
		bySha.set(entry.sha, [...(bySha.get(entry.sha) ?? []), entry.path]);
	}
	const candidates: { a: string; b: string; identical: number; files: number }[] = [];
	for (const [a, files] of byFolder) {
		if (files.size < MIRROR_FILES_MIN) continue;
		const votes = new Map<string, number>();
		for (const [rel, sha] of files) {
			const twins = bySha.get(sha) ?? [];
			if (twins.length > MIRROR_TWINS_MAX) continue;
			for (const twin of twins) {
				if (isUnder(twin, a) || !twin.endsWith(`/${rel}`)) continue;
				const b = twin.slice(0, twin.length - rel.length);
				if (isUnder(a, b) || isUnder(b, a)) continue;
				votes.set(b, (votes.get(b) ?? 0) + 1);
			}
		}
		for (const [b, identical] of votes)
			if (identical / files.size >= MIRROR_SHARE_MIN)
				candidates.push({ a, b, identical, files: files.size });
	}
	const seen = new Set<string>();
	const pairs = candidates
		.filter((c) => {
			const key = [c.a, c.b].sort().join('|');
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.filter(
			(c) =>
				!candidates.some(
					(o) =>
						o !== c &&
						o.a.length < c.a.length &&
						c.a.startsWith(o.a) &&
						c.b.startsWith(o.b) &&
						c.a.slice(o.a.length) === c.b.slice(o.b.length)
				)
		);
	return pairs
		.map((c) => {
			const aSignal = copySignal(c.a, c.b);
			const bSignal = copySignal(c.b, c.a);
			const mirrorIsA = aSignal !== null && (bSignal === null || depth(c.a) >= depth(c.b));
			const [kept, mirror] = mirrorIsA
				? [c.b, c.a]
				: bSignal !== null
					? [c.a, c.b]
					: [c.a, c.b].sort();
			const why = (mirrorIsA ? aSignal : bSignal) ?? 'nothing marks either side; the later one';
			const keptFiles = byFolder.get(kept)!;
			const mirrorFiles = byFolder.get(mirror)!;
			const differing = [
				...new Set(
					[...keptFiles.keys(), ...mirrorFiles.keys()].filter(
						(rel) => keptFiles.get(rel) !== mirrorFiles.get(rel)
					)
				)
			].sort();
			return {
				id: `${kept}|${mirror}`,
				kept,
				mirror,
				why: `${mirror} is the copy: ${why}`,
				files: mirrorFiles.size,
				identical: [...mirrorFiles].filter(([rel, sha]) => keptFiles.get(rel) === sha).length,
				differing: differing.slice(0, MIRROR_DIFFERING_MAX),
				differingCount: differing.length
			} satisfies MirrorPair;
		})
		.sort((x, y) => (x.mirror < y.mirror ? -1 : 1));
}

export type MirrorDecision = { id: string; kept: string; by: string; at: string };

export function undecidedMirrors(
	pairs: readonly MirrorPair[],
	decisions: readonly MirrorDecision[]
): string[] {
	const ids = new Set(decisions.map((d) => d.id));
	return pairs.filter((pair) => !ids.has(pair.id)).map((pair) => pair.id);
}

function specificity(glob: string): number {
	const wild = glob.search(/[*?[]/);
	return wild < 0 ? glob.length : wild;
}

export function inScope(path: string, scope: Pick<ByobScope, 'include' | 'exclude'>): boolean {
	const included = scope.include.filter((glob) => globMatches(glob, path));
	if (scope.include.length > 0 && included.length === 0) return false;
	const excluded = scope.exclude.filter((glob) => globMatches(glob, path));
	if (excluded.length === 0) return true;
	const most = Math.max(...excluded.map(specificity));
	return included.some((glob) => specificity(glob) > most);
}

export function withIncluded(scope: ByobScope, folder: string): ByobScope {
	const glob = folder.endsWith('/') ? folder : `${folder}/`;
	if (scope.include.includes(glob)) return scope;
	return {
		...scope,
		include: scope.include.length === 0 ? ['**', glob] : [...scope.include, glob]
	};
}

export function effectiveScope(scope: ByobScope | null | undefined): ByobScope {
	const base = scope ?? emptyScope();
	return { include: base.include, exclude: base.exclude, strip: base.strip };
}

export function stripFolders(scope: ByobScope, paths: readonly string[]): string[] {
	if (scope.strip.length > 0)
		return scope.strip.map((s) => (s.endsWith('/') ? s : `${s}/`)).filter((s) => s !== '/');
	const roots = scope.include.map(globRoot).filter((root): root is string => root !== null);
	if (roots.length > 0 && roots.length === scope.include.length) return [...new Set(roots)];
	const tops = new Set(
		paths
			.filter((path) => path.includes('/') && /\.(md|markdown|mdx)$/i.test(path))
			.map((path) => path.slice(0, path.indexOf('/') + 1))
	);
	return tops.size === 1 ? [...tops] : [];
}

function globRoot(glob: string): string | null {
	const first = glob.replace(/^\.?\//, '').split('/')[0] ?? '';
	if (first === '' || /[*?[]/.test(first) || !glob.includes('/')) return null;
	return `${first}/`;
}

export function strippedPath(path: string, strip: readonly string[]): string {
	const hit = strip.find((folder) => path.toLowerCase().startsWith(folder.toLowerCase()));
	return hit ? path.slice(hit.length) : path;
}

const ROLE_RANK: Record<string, number> = {
	page: 0,
	procedure: 1,
	history: 2,
	evidence: 3,
	setting: 4,
	note: 5
};

export function duplicateGroups(
	files: readonly { sourcePath: string; blob: string }[],
	roleOf: (path: string) => string,
	sideOf: (path: string) => number = () => 0
): Map<string, string[]> {
	const byBlob = new Map<string, string[]>();
	for (const file of files)
		byBlob.set(file.blob, [...(byBlob.get(file.blob) ?? []), file.sourcePath]);
	const out = new Map<string, string[]>();
	for (const paths of byBlob.values()) {
		if (paths.length < 2) continue;
		const ranked = [...paths].sort(
			(a, b) =>
				sideOf(a) - sideOf(b) ||
				(ROLE_RANK[roleOf(a)] ?? 9) - (ROLE_RANK[roleOf(b)] ?? 9) ||
				a.length - b.length ||
				(a < b ? -1 : 1)
		);
		out.set(ranked[0]!, ranked.slice(1));
	}
	return out;
}

export { folderOf };

export function withExcluded(scope: ByobScope, folder: string): ByobScope {
	const glob = folder.endsWith('/') ? folder : `${folder}/`;
	if (scope.exclude.includes(glob)) return scope;
	return { ...scope, exclude: [...scope.exclude, glob] };
}

export type ParallelTree = {
	kind: 'language' | 'version';
	folders: string[];
	files: number[];
	overlap: number;
};

const LOCALE = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i;
const VERSION = /^(?:v?\d+(?:\.\d+)*|version-[\w.-]+)$/i;
const NOT_LOCALES = new Set([
	'hr',
	'it',
	'qa',
	'ui',
	'ux',
	'ml',
	'ai',
	'pr',
	'ci',
	'cd',
	'go',
	'js',
	'db',
	'os',
	'ops'
]);
export const PARALLEL_OVERLAP_MIN = 0.6;
const PARALLEL_FILES_MIN = 3;

export function parallelTrees(paths: readonly string[]): ParallelTree[] {
	const byParent = new Map<string, Map<string, Set<string>>>();
	for (const path of paths) {
		if (!/\.(md|markdown|mdx)$/i.test(path)) continue;
		const parts = path.split('/');
		for (let i = 0; i < parts.length - 1; i += 1) {
			const name = parts[i]!;
			const kind = VERSION.test(name)
				? 'version'
				: LOCALE.test(name) && !NOT_LOCALES.has(name.toLowerCase())
					? 'language'
					: null;
			if (!kind) continue;
			const parent = parts.slice(0, i).join('/');
			const key = `${kind}|${parent}`;
			const children = byParent.get(key) ?? new Map<string, Set<string>>();
			const pages = children.get(name) ?? new Set<string>();
			pages.add(
				parts
					.slice(i + 1)
					.join('/')
					.toLowerCase()
			);
			children.set(name, pages);
			byParent.set(key, children);
		}
	}
	const out: ParallelTree[] = [];
	for (const [key, children] of byParent) {
		if (children.size < 2) continue;
		const [kind, parent] = key.split('|') as ['language' | 'version', string];
		const sorted = [...children]
			.filter(([, pages]) => pages.size >= PARALLEL_FILES_MIN)
			.sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1));
		if (sorted.length < 2) continue;
		const [, largest] = sorted[0]!;
		const siblings = sorted.filter(([, pages], i) => {
			if (i === 0) return true;
			let shared = 0;
			for (const page of pages) if (largest.has(page)) shared += 1;
			return shared / pages.size >= PARALLEL_OVERLAP_MIN;
		});
		if (siblings.length < 2) continue;
		const overlaps = siblings.slice(1).map(([, pages]) => {
			let shared = 0;
			for (const page of pages) if (largest.has(page)) shared += 1;
			return shared / pages.size;
		});
		out.push({
			kind,
			folders: siblings.map(([name]) => `${parent ? `${parent}/` : ''}${name}/`),
			files: siblings.map(([, pages]) => pages.size),
			overlap: Math.round(Math.min(...overlaps) * 100) / 100
		});
	}
	return out.sort((a, b) => (a.folders[0]! < b.folders[0]! ? -1 : 1));
}
