import type { MethodElement, MethodHint } from '../method/types';
import type { MeritHow } from './types';

export type MeritPageRow = {
	path: string;
	title: string | null;
	type: string | null;
	area: string | null;
	tags: readonly string[];
	keys: readonly string[];
	chars: number;
	links_in: number;
	citations_out: number;
	stated_date: string | null;
	owner_hint: string | null;
	cluster_id: string | null;
};

export type MeritClusterFacts = {
	cluster_id: string;
	top: string;
	keys: readonly string[];
	headings: readonly string[];
	size?: string | null;
};

export type MappingHow = MeritHow;

export type PageAssignment = {
	path: string;
	element_id: string | null;
	how: MappingHow | null;
};

export type MappingElement = Pick<MethodElement, 'id' | 'atom_types' | 'proposed_atom_types'>;

export const TITLES_PER_CLUSTER = 20;
export const TITLES_PER_CLUSTER_MIN = 5;
export const CLUSTER_KEYS_MAX = 24;

export type ElementHints = Readonly<Record<string, MethodHint>>;

export function wordsOf(text: string): string[] {
	return text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.map(singular);
}

function singular(word: string): string {
	if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
	if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
	return word;
}

function hintMatches(hint: string, words: readonly string[]): boolean {
	const want = wordsOf(hint);
	if (want.length === 0) return false;
	for (let i = 0; i + want.length <= words.length; i += 1) {
		if (want.every((word, j) => words[i + j] === word)) return true;
	}
	return false;
}

function hintsFor(hintsById: ElementHints, elementId: string): MethodHint {
	const hints = Object.prototype.hasOwnProperty.call(hintsById, elementId)
		? hintsById[elementId]
		: undefined;
	if (hints) return hints;
	const slug = elementId.replace(/^\d+-/, '').replace(/-/g, ' ');
	return { folders: [slug], kinds: [slug] };
}

function normaliseType(type: string | null): string | null {
	const t = type?.trim().toLowerCase();
	return t ? t : null;
}

export function elementsOfType(type: string | null, elements: readonly MappingElement[]): string[] {
	const t = normaliseType(type);
	if (!t) return [];
	return elements
		.filter(
			(element) =>
				element.atom_types.some((a) => a.toLowerCase() === t) ||
				element.proposed_atom_types.some((a) => a.toLowerCase() === t)
		)
		.map((element) => element.id);
}

function folderWords(row: Pick<MeritPageRow, 'path' | 'area'>): string[][] {
	const folders = row.path.split('/').slice(0, -1);
	return [...(row.area ? [row.area] : []), ...folders].map(wordsOf);
}

function kindWords(row: Pick<MeritPageRow, 'tags' | 'keys'>): string[][] {
	return [...row.tags, ...row.keys].map(wordsOf);
}

function narrow(
	candidates: string[],
	groups: string[][],
	field: 'folders' | 'kinds',
	hints: ElementHints
): string[] {
	return candidates.filter((id) =>
		hintsFor(hints, id)[field].some((hint) => groups.some((words) => hintMatches(hint, words)))
	);
}

export function ruleElementFor(
	row: Pick<MeritPageRow, 'path' | 'type' | 'area' | 'tags' | 'keys'>,
	elements: readonly MappingElement[],
	hints: ElementHints
): string | null {
	let candidates = elementsOfType(row.type, elements);
	if (candidates.length <= 1) return candidates[0] ?? null;
	for (const [field, groups] of [
		['folders', folderWords(row)],
		['kinds', kindWords(row)]
	] as const) {
		const narrowed = narrow(candidates, groups, field, hints);
		if (narrowed.length === 1) return narrowed[0]!;
		if (narrowed.length > 1) candidates = narrowed;
	}
	return null;
}

export type RuleMapping = {
	mapped: PageAssignment[];
	for_model: string[];
};

export function ruleMapPages(
	rows: readonly MeritPageRow[],
	elements: readonly MappingElement[],
	hints: ElementHints
): RuleMapping {
	const mapped: PageAssignment[] = [];
	const forModel: string[] = [];
	for (const row of sortByPath(rows)) {
		const elementId = ruleElementFor(row, elements, hints);
		if (elementId) mapped.push({ path: row.path, element_id: elementId, how: 'type' });
		else forModel.push(row.path);
	}
	return { mapped, for_model: forModel };
}

export type MappingCluster = {
	cluster_id: string;
	top: string;
	keys: string[];
	headings: string[];
	size: string | null;
	files: number;
	titles: string[];
	paths: string[];
};

export function areaClusterId(area: string | null): string {
	return `area:${area?.trim() || '(none)'}`;
}

export function titleOf(row: Pick<MeritPageRow, 'path' | 'title'>): string {
	const title = row.title?.trim();
	if (title) return title;
	const name = row.path.split('/').pop() ?? row.path;
	return name.replace(/\.[^.]+$/, '');
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function sortByPath<T extends { path: string }>(rows: readonly T[]): T[] {
	return [...rows].sort((a, b) => compare(a.path, b.path));
}

function derivedKeys(rows: readonly MeritPageRow[]): string[] {
	const count = new Map<string, number>();
	for (const row of rows)
		for (const key of new Set(row.keys)) count.set(key, (count.get(key) ?? 0) + 1);
	return [...count.entries()]
		.sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
		.slice(0, CLUSTER_KEYS_MAX)
		.map(([key]) => key);
}

export function shapeClusters(
	rows: readonly MeritPageRow[],
	forModel: readonly string[],
	facts: readonly MeritClusterFacts[] = [],
	titlesPerCluster: number = TITLES_PER_CLUSTER
): MappingCluster[] {
	const wanted = new Set(forModel);
	const factsOf = new Map(facts.map((fact) => [fact.cluster_id, fact]));
	const groups = new Map<string, MeritPageRow[]>();
	for (const row of sortByPath(rows)) {
		if (!wanted.has(row.path)) continue;
		const id = row.cluster_id?.trim() || areaClusterId(row.area);
		const group = groups.get(id);
		if (group) group.push(row);
		else groups.set(id, [row]);
	}
	const limit = Math.max(0, Math.floor(titlesPerCluster));
	const clusters = [...groups.entries()].map(([id, members]): MappingCluster => {
		const fact = factsOf.get(id);
		return {
			cluster_id: id,
			top: fact ? fact.top : (members[0]!.area ?? ''),
			keys: fact ? [...fact.keys] : derivedKeys(members),
			headings: fact ? [...fact.headings] : [],
			size: fact?.size ?? null,
			files: members.length,
			titles: members.slice(0, limit).map(titleOf),
			paths: members.map((row) => row.path)
		};
	});
	return clusters.sort((a, b) => b.files - a.files || compare(a.cluster_id, b.cluster_id));
}

export function withTitles(
	clusters: readonly MappingCluster[],
	rows: readonly MeritPageRow[],
	titlesPerCluster: number
): MappingCluster[] {
	const byPath = new Map(rows.map((row) => [row.path, row]));
	const limit = Math.max(0, Math.floor(titlesPerCluster));
	return clusters.map((cluster) => ({
		...cluster,
		titles: cluster.paths
			.slice(0, limit)
			.map((path) => titleOf(byPath.get(path) ?? { path, title: null }))
	}));
}

export type ClusterVerdict = { cluster_id: string; element_id: string | 'none' | 'mixed' };

export type TitlesFollowUp = {
	cluster_id: string;
	titles: { path: string; title: string }[];
};

export type ClusterInheritance = {
	assigned: PageAssignment[];
	mixed: TitlesFollowUp[];
	unanswered: string[];
};

export function inheritClusterVerdicts(
	clusters: readonly MappingCluster[],
	verdicts: readonly ClusterVerdict[],
	rows: readonly MeritPageRow[]
): ClusterInheritance {
	const verdictOf = new Map(verdicts.map((v) => [v.cluster_id, v.element_id]));
	const byPath = new Map(rows.map((row) => [row.path, row]));
	const assigned: PageAssignment[] = [];
	const mixed: TitlesFollowUp[] = [];
	const unanswered: string[] = [];
	for (const cluster of clusters) {
		const verdict = verdictOf.get(cluster.cluster_id);
		if (verdict === undefined) {
			unanswered.push(cluster.cluster_id);
			continue;
		}
		if (verdict === 'mixed') {
			mixed.push({
				cluster_id: cluster.cluster_id,
				titles: cluster.paths.map((path) => ({
					path,
					title: titleOf(byPath.get(path) ?? { path, title: null })
				}))
			});
			continue;
		}
		for (const path of cluster.paths)
			assigned.push({ path, element_id: verdict === 'none' ? null : verdict, how: 'cluster' });
	}
	return { assigned: sortByPath(assigned), mixed, unanswered };
}

export type TitleVerdict = { path: string; element_id: string | 'none' };

export function applyTitleVerdicts(
	followUps: readonly TitlesFollowUp[],
	verdicts: readonly TitleVerdict[]
): PageAssignment[] {
	const verdictOf = new Map(verdicts.map((v) => [v.path, v.element_id]));
	const out: PageAssignment[] = [];
	for (const followUp of followUps)
		for (const { path } of followUp.titles) {
			const verdict = verdictOf.get(path);
			if (verdict === undefined) out.push({ path, element_id: null, how: null });
			else out.push({ path, element_id: verdict === 'none' ? null : verdict, how: 'title' });
		}
	return sortByPath(out);
}

export function combineAssignments(
	rows: readonly Pick<MeritPageRow, 'path'>[],
	...parts: readonly (readonly PageAssignment[])[]
): PageAssignment[] {
	const chosen = new Map<string, PageAssignment>();
	for (const part of parts)
		for (const assignment of part)
			if (!chosen.has(assignment.path)) chosen.set(assignment.path, assignment);
	return sortByPath(rows).map(
		(row) => chosen.get(row.path) ?? { path: row.path, element_id: null, how: null }
	);
}

export function pagesByElement(assignments: readonly PageAssignment[]): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const a of sortByPath(assignments)) {
		if (!a.element_id) continue;
		const list = out.get(a.element_id);
		if (list) list.push(a.path);
		else out.set(a.element_id, [a.path]);
	}
	return out;
}
