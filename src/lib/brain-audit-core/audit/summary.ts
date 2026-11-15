import type { ByobRole } from '../vocabulary/byob';
import { freshnessBand } from './dates';
import {
	citationsOutByFile,
	extractFileFacts,
	isAuditChecked,
	placeholderSet,
	type AuditFileFacts,
	type AuditLens
} from './extract';
import { linkGraph, sortedRecord, type FileLinkFacts, type LinkGraph } from './graph';
import { scoreOf } from './score';
import { structureOf, type FileConformance, type StructureFacts } from './structure';
import {
	AUDIT_RANKED_CAP,
	type AuditHub,
	type AuditMissingTarget,
	type AuditShare,
	type AuditSize,
	type AuditStructureGroup,
	type AuditSummary,
	type AuditFileWrite,
	type ScoreInputs,
	type ScoreResult
} from './types';
import type { Method } from '../method/types';

export type BroughtAuditEntry = {
	path: string;
	body: string | null;
	role: ByobRole;
	type: string | null;
	type_decided: boolean;
	area: string | null;
	owner_hint: string | null;
	cluster_id: string | null;
	navigation: boolean;
	copy_of: string | null;
};

export type BroughtAuditSource = {
	method: Method;
	entries: readonly BroughtAuditEntry[];
	citations: readonly { from: string; to: string; proof: boolean }[];
	root: string | null;
	strip: readonly string[];
	outOfScopePaths: readonly string[];
	lens: AuditLens;
	unreadUnlisted?: number;
};

export type BroughtAudit = {
	rows: AuditFileWrite[];
	summary: AuditSummary;
	inputs: ScoreInputs;
	score: ScoreResult;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const share = (numerator: number, denominator: number): AuditShare => ({
	numerator,
	denominator
});

function addSize(record: Record<string, AuditSize>, key: string, chars: number, words: number) {
	const size = (record[key] ??= { files: 0, chars: 0, words: 0 });
	size.files += 1;
	size.chars += chars;
	size.words += words;
}

const sortedSizes = (record: Record<string, AuditSize>) => sortedRecord(record);

export const AUDIT_NONE_KEY = '(none)';

export function broughtAudit(source: BroughtAuditSource, measuredAt: string): BroughtAudit {
	const entries = [...source.entries].sort((a, b) => byText(a.path, b.path));
	const entryOf = new Map(entries.map((entry) => [entry.path, entry]));
	const copies = new Map(
		entries.flatMap((entry) => (entry.copy_of ? [[entry.path, entry.copy_of] as const] : []))
	);
	const placeholders = placeholderSet(source.lens.placeholders);
	const citations = citationsOutByFile(source.citations, (path) => entryOf.get(path)?.role);
	const { method } = source;
	const facts = entries.map((entry) =>
		extractFileFacts(
			method,
			{
				path: entry.path,
				body: entry.body,
				role: entry.role,
				type: entry.type,
				type_decided: entry.type_decided,
				area: entry.area,
				owner_hint: entry.owner_hint,
				cluster_id: entry.cluster_id,
				root: source.root,
				navigation: entry.navigation,
				citations_out: citations.get(entry.path)
			},
			source.lens,
			placeholders
		)
	);
	const cited = new Set<string>();
	for (const edge of source.citations) if (edge.proof && edge.from !== edge.to) cited.add(edge.to);
	const graph = linkGraph(facts, {
		copies,
		outOfScopePaths: source.outOfScopePaths,
		strip: source.strip,
		cited
	});
	const structure = structureOf(facts, method.weights.structural, { copies });
	for (const row of facts) if (!row.unread) row.links = [];

	const linkOf = new Map(graph.files.map((file) => [file.path, file]));
	const conformanceOf = new Map(structure.files.map((file) => [file.path, file]));
	const rows = facts.map((row) =>
		fileRowOf(entryOf.get(row.path)!, row, linkOf.get(row.path)!, conformanceOf.get(row.path)!, {
			measuredAt
		})
	);
	const summary = summaryOf({
		method,
		entries,
		facts,
		graph,
		structure,
		unreadUnlisted: source.unreadUnlisted ?? 0,
		measuredAt
	});
	const inputs = scoreInputsOf({ entries, facts, graph, structure, measuredAt });
	return { rows, summary, inputs, score: scoreOf(inputs, method.weights) };
}

export function fileRowOf(
	entry: BroughtAuditEntry,
	row: ReturnType<typeof extractFileFacts>,
	links: FileLinkFacts,
	conformance: FileConformance,
	at: { measuredAt: string }
): AuditFileWrite {
	const base = {
		path: entry.path,
		role: entry.role,
		type: entry.type,
		area: entry.area,
		ownerHint: entry.owner_hint,
		clusterId: entry.cluster_id
	};
	if (row.unread) return { ...base, title: null, unread: true };
	const checked = isAuditChecked(row.role) && !entry.copy_of;
	return {
		...base,
		title: row.title,
		chars: row.chars,
		words: row.words,
		depth: row.depth,
		linksIn: links.links_in,
		linksOut: links.links_out,
		expectedMissing: conformance.expected_missing ?? [],
		keysUnfilled: conformance.keys_unfilled ?? [],
		emptySections: row.empty_sections ?? 0,
		tags: row.tags ?? [],
		keys: row.keys ?? [],
		citationsOut: row.citations_out ?? 0,
		statedDate: row.stated_date,
		linksResolved: links.link_status.resolved,
		linksAmbiguous: links.link_status.ambiguous,
		linksMissing: links.link_status.missing,
		linksOutside: links.link_status.outside,
		headings: row.headings ? [...new Set(row.headings.map((h) => h.text))] : [],
		headingOrderOk: conformance.heading_order_ok,
		isOrphan: links.is_orphan === true,
		isDeadEnd: links.is_dead_end === true,
		freshness: checked ? freshnessBand(row.stated_date, at.measuredAt) : null,
		unread: false,
		peerGroup: conformance.peer_group,
		linksInNav: links.links_in_nav,
		cited: links.cited
	};
}

function checkedFacts(
	entries: readonly BroughtAuditEntry[],
	facts: readonly ReturnType<typeof extractFileFacts>[]
): AuditFileFacts[] {
	const copies = new Set(entries.flatMap((entry) => (entry.copy_of ? [entry.path] : [])));
	return facts.filter(
		(row): row is AuditFileFacts => !row.unread && !copies.has(row.path) && isAuditChecked(row.role)
	);
}

export function summaryOf(args: {
	method: Method;
	entries: readonly BroughtAuditEntry[];
	facts: readonly ReturnType<typeof extractFileFacts>[];
	graph: LinkGraph;
	structure: StructureFacts;
	unreadUnlisted: number;
	measuredAt: string;
}): AuditSummary {
	const entryOf = new Map(args.entries.map((entry) => [entry.path, entry]));
	const totals = { files: 0, chars: 0, words: 0, pages: 0, unread: 0, copies: 0 };
	const byRole: Record<string, AuditSize> = {};
	const byType: Record<string, AuditSize> = {};
	const byArea: Record<string, AuditSize> = {};
	const depth: Record<string, number> = {};
	for (const row of args.facts) {
		const entry = entryOf.get(row.path)!;
		if (entry.copy_of) {
			totals.copies += 1;
			continue;
		}
		const chars = row.unread ? 0 : row.chars;
		const words = row.unread ? 0 : row.words;
		totals.files += 1;
		totals.chars += chars;
		totals.words += words;
		if (entry.role === 'page') totals.pages += 1;
		if (row.unread) totals.unread += 1;
		addSize(byRole, entry.role, chars, words);
		addSize(byArea, entry.area ?? AUDIT_NONE_KEY, chars, words);
		if (isAuditChecked(entry.role)) addSize(byType, entry.type ?? AUDIT_NONE_KEY, chars, words);
		if (!row.unread) depth[String(row.depth)] = (depth[String(row.depth)] ?? 0) + 1;
	}
	for (let i = 0; i < args.unreadUnlisted; i += 1) {
		totals.files += 1;
		totals.unread += 1;
		addSize(byRole, 'noise', 0, 0);
		addSize(byArea, AUDIT_NONE_KEY, 0, 0);
	}

	const checked = checkedFacts(args.entries, args.facts);
	const emptyOf = new Map(checked.map((row) => [row.path, row.empty_sections ?? 0]));
	const linkOf = new Map(args.graph.files.map((file) => [file.path, file]));
	const frequency: Record<string, number> = {};
	const tagPages: Record<string, number> = {};
	let withoutTags = 0;
	const freshness = { fresh: 0, ageing: 0, stale: 0, none: 0 };
	let orphans = 0;
	let deadEnds = 0;
	let citations = 0;
	let linksInNav = 0;
	for (const row of checked) {
		const links = linkOf.get(row.path)!;
		linksInNav += links.links_in_nav;
		if (links.is_orphan) orphans += 1;
		if (links.is_dead_end) deadEnds += 1;
		citations += row.citations_out ?? 0;
		if (row.tags !== null) {
			if (row.tags.length === 0) withoutTags += 1;
			for (const tag of row.tags) {
				frequency[tag] = (frequency[tag] ?? 0) + (row.tag_uses?.[tag] ?? 1);
				tagPages[tag] = (tagPages[tag] ?? 0) + 1;
			}
		}
		freshness[freshnessBand(row.stated_date, args.measuredAt)] += 1;
	}

	return {
		totals,
		by_role: sortedSizes(byRole),
		by_type: sortedSizes(byType),
		by_area: sortedSizes(byArea),
		depth: Object.fromEntries(
			Object.keys(depth)
				.sort((a, b) => Number(a) - Number(b))
				.map((key) => [key, depth[key]!])
		),
		links: {
			...args.graph.totals,
			orphans,
			dead_ends: deadEnds,
			citations,
			missing_targets: rankedTargets(args.graph.missing_targets),
			hubs: rankedHubs(args.graph.hubs),
			links_in_nav: linksInNav,
			density: {
				all: { ...args.graph.density.all },
				by_area: sortedRecord(
					Object.fromEntries(
						Object.entries(args.graph.density.by_area).map(([area, density]) => [
							area === '' ? AUDIT_NONE_KEY : area,
							{ ...density }
						])
					)
				)
			}
		},
		tags: {
			frequency: sortedRecord(frequency),
			pages: sortedRecord(tagPages),
			pages_without: withoutTags
		},
		freshness: { ...freshness, measured_at: args.measuredAt },
		structure: {
			groups: args.structure.groups.map((group) =>
				groupOf(group, args.structure, (path) => emptyOf.get(path) ?? 0)
			)
		},
		thresholds: {
			expected_share: args.method.weights.structural.expected_share,
			min_peers: args.method.weights.structural.min_peers
		}
	};
}

function rankedTargets(targets: LinkGraph['missing_targets']): AuditMissingTarget[] {
	return targets
		.filter((target) => target.count > 0)
		.map((target) => ({ name: target.name, count: target.count }))
		.sort((a, b) => b.count - a.count || byText(a.name, b.name))
		.slice(0, AUDIT_RANKED_CAP);
}

function rankedHubs(hubs: LinkGraph['hubs']): Record<string, AuditHub[]> {
	const out: Record<string, AuditHub[]> = {};
	for (const [area, list] of Object.entries(hubs)) {
		const key = area === '' ? AUDIT_NONE_KEY : area;
		(out[key] ??= []).push(...list.filter((hub) => hub.links_in > 0).map((hub) => ({ ...hub })));
	}
	for (const key of Object.keys(out)) {
		out[key] = out[key]!.sort((a, b) => b.links_in - a.links_in || byText(a.path, b.path)).slice(
			0,
			AUDIT_RANKED_CAP
		);
		if (out[key].length === 0) delete out[key];
	}
	return sortedRecord(out);
}

function groupOf(
	group: StructureFacts['groups'][number],
	structure: StructureFacts,
	emptySectionsOf: (path: string) => number
): AuditStructureGroup {
	const colon = group.group.indexOf(':');
	const files = structure.files.filter((file) => file.peer_group === group.group);
	return {
		id: group.group.slice(colon + 1),
		basis: group.group.startsWith('type:') ? 'type' : 'cluster',
		files: group.expected.files,
		too_few_peers: group.expected.too_few_peers,
		expected_headings: group.expected.headings.map((h) => h.name),
		expected_keys: group.expected.keys.map((k) => k.name),
		files_missing_expected: files.filter((file) => (file.expected_missing?.length ?? 0) > 0).length,
		files_with_empty_sections: files.filter((file) => emptySectionsOf(file.path) > 0).length,
		files_order_off: files.filter((file) => file.heading_order_ok === false).length,
		files_keys_unfilled: files.filter((file) => (file.keys_unfilled?.length ?? 0) > 0).length,
		expected_share: group.expected.expected_share,
		min_peers: group.expected.min_peers
	};
}

export function scoreInputsOf(args: {
	entries: readonly BroughtAuditEntry[];
	facts: readonly ReturnType<typeof extractFileFacts>[];
	graph: LinkGraph;
	structure: StructureFacts;
	measuredAt: string;
}): ScoreInputs {
	const checked = checkedFacts(args.entries, args.facts);
	const linkOf = new Map(args.graph.files.map((file) => [file.path, file]));
	const totals = args.graph.totals;
	const links = totals.resolved + totals.ambiguous + totals.missing + totals.outside;
	const sum = (pick: (group: StructureFacts['groups'][number]) => number) =>
		args.structure.groups.reduce((n, group) => n + pick(group), 0);
	return {
		pages: checked.filter((row) => row.role === 'page').length,
		links: {
			resolved: share(totals.resolved, links),
			not_orphan: share(
				checked.filter((row) => linkOf.get(row.path)!.is_orphan === false).length,
				checked.length
			)
		},
		structure: {
			expected_headings: share(
				sum((g) => g.headings_present),
				sum((g) => g.headings_expected)
			),
			no_empty_section: share(
				sum((g) => g.no_empty_section),
				sum((g) => g.section_files)
			)
		},
		metadata: {
			expected_keys_filled: share(
				sum((g) => g.keys_filled),
				sum((g) => g.keys_expected)
			),
			with_owner: share(
				checked.filter((row) => row.owner_hint !== null && row.owner_hint.trim() !== '').length,
				checked.length
			)
		},
		dating: {
			dated: share(checked.filter((row) => row.stated_date !== null).length, checked.length),
			current: share(
				checked.filter((row) => {
					const band = freshnessBand(row.stated_date, args.measuredAt);
					return band === 'fresh' || band === 'ageing';
				}).length,
				checked.length
			)
		}
	};
}
