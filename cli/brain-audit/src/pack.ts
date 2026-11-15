/**
 * The sealed pack (`SealedPack`) and the plain summary (`PlainSummary`) from a local
 * structural audit and, at `finish`, the agent's merit grades. The pack carries every name
 * (paths, titles, tags, area names, edges, the files behind each finding) and is only ever
 * uploaded sealed; the summary carries numbers and closed-vocabulary words and is checked by
 * `parsePlainSummary`, the server's own gate, before anything is sent.
 *
 * A finding's files are exactly the files the platform lists for it, so a count in the
 * summary and its list in the pack always agree.
 */
import type {
	AuditFileWrite,
	AuditSummary,
	BroughtAudit,
	ScoreResult
} from '$lib/brain-audit-core';
import {
	CONSTELLATION_LINK_KINDS,
	CONSTELLATION_PAGE_CAP,
	FILE_ROLES,
	FINDING_CATEGORIES,
	PACK_VERSION,
	SUBSCORE_KEYS,
	topFiveOf,
	totalScoreOf,
	type BrainFormat,
	type SummaryTotalWeights,
	type CompanyType,
	type FindingCategory,
	type PackConstellation,
	type PackFile,
	type PackMerit,
	type ScoreProjection,
	type PlainMeasures,
	type PlainSummary,
	type SealedPack
} from '$lib/brain-audit-core/pack';
import {
	isScaffolding,
	LOOSE_AREA,
	starLabel,
	type ConstellationNode
} from '$lib/brain-audit-core/constellation/model';
import {
	areaSignature,
	fallbackAreaName,
	findAreas
} from '$lib/brain-audit-core/constellation/areas';
import type { LinkEdges } from './edges';

export type StructuralFinding = Exclude<FindingCategory, 'merit_absent' | 'merit_thin'>;

/** A checked page as every count measures it: role page or unclear, read, kept (not a copy). */
const isChecked = (row: AuditFileWrite) =>
	(row.role === 'page' || row.role === 'unclear') && !row.unread && row.freshness != null;

/** `AUDIT_FLAG_SQL`, one predicate per structural finding category. */
export const FINDING_PREDICATES: Record<StructuralFinding, (row: AuditFileWrite) => boolean> = {
	missing_links: (r) => isChecked(r) && (r.linksMissing ?? 0) > 0,
	orphan: (r) => isChecked(r) && r.isOrphan === true,
	dead_end: (r) => isChecked(r) && r.isDeadEnd === true,
	ambiguous_links: (r) => isChecked(r) && (r.linksAmbiguous ?? 0) > 0,
	outside_links: (r) => isChecked(r) && (r.linksOutside ?? 0) > 0,
	uncited_evidence: (r) => r.role === 'evidence' && r.isOrphan === true,
	undated: (r) => isChecked(r) && (r.statedDate ?? null) === null,
	stale: (r) => isChecked(r) && r.freshness === 'stale',
	no_owner: (r) => isChecked(r) && (r.ownerHint ?? '').trim() === '',
	missing_expected: (r) => isChecked(r) && (r.expectedMissing ?? []).length > 0,
	empty_sections: (r) => isChecked(r) && (r.emptySections ?? 0) > 0,
	keys_unfilled: (r) => isChecked(r) && (r.keysUnfilled ?? []).length > 0,
	order_off: (r) => isChecked(r) && r.headingOrderOk === false,
	untagged: (r) => isChecked(r) && (r.tags ?? []).length === 0,
	unread: (r) => r.unread === true,
	copy: (r) =>
		(r.role === 'page' || r.role === 'unclear') && !r.unread && (r.freshness ?? null) === null
};

/** Missing targets kept in the pack, most linked first. */
export const PACK_MISSING_TARGETS_CAP = 1000;

/** What `extract` computes once and `finish` completes with merit: the pack but its summary and merit. */
export type PackBase = Omit<SealedPack, 'summary' | 'merit'>;

/** The summary's structural half, kept beside the pack base until `finish`. */
export type StructuralSummary = {
	company_type: CompanyType;
	brain_format: BrainFormat;
	structural_score: number | null;
	/** Every measure but the two merit finding counts (0 until `finish`). */
	measures: PlainMeasures;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function packBaseOf(args: {
	auditId: string;
	measuredAt: string;
	audit: BroughtAudit;
	links: LinkEdges;
}): Promise<PackBase> {
	const rows = [...args.audit.rows].sort((a, b) => byText(a.path, b.path));
	const indexOf = new Map(rows.map((row, i) => [row.path, i]));
	const areas = [...new Set(rows.flatMap((row) => (row.area ? [row.area] : [])))].sort(byText);
	const areaIndex = new Map(areas.map((area, i) => [area, i]));

	const files: PackFile[] = rows.map((row) => ({
		path: row.path,
		title: row.title ?? null,
		role: row.role,
		type: row.type ?? null,
		area: row.area ? (areaIndex.get(row.area) ?? null) : null,
		owner: row.ownerHint ?? null,
		chars: row.chars ?? 0,
		words: row.words ?? 0,
		depth: row.depth ?? 0,
		links_in: row.linksIn ?? 0,
		links_out: row.linksOut ?? 0,
		links_missing: row.linksMissing ?? 0,
		stated_date: row.statedDate && DAY.test(row.statedDate) ? row.statedDate : null,
		freshness: row.freshness ?? null,
		tags: row.tags ?? [],
		expected_missing: row.expectedMissing ?? [],
		empty_sections: row.emptySections ?? 0,
		unread: row.unread === true
	}));

	const edges = args.links.edges.flatMap(([from, to, code]) => {
		const a = indexOf.get(from);
		const b = indexOf.get(to);
		return a === undefined || b === undefined ? [] : [[a, b, code] as [number, number, 0 | 1 | 2]];
	});
	const missingTargets = args.links.missing.slice(0, PACK_MISSING_TARGETS_CAP).map((target) => ({
		name: target.name,
		count: target.count,
		from: target.from.flatMap((path) => {
			const i = indexOf.get(path);
			return i === undefined ? [] : [i];
		})
	}));

	const findings = Object.fromEntries(
		(Object.keys(FINDING_PREDICATES) as StructuralFinding[]).map((category) => [
			category,
			rows.flatMap((row, i) => (FINDING_PREDICATES[category](row) ? [i] : []))
		])
	) as Record<StructuralFinding, number[]>;

	return {
		pack_version: PACK_VERSION,
		audit_id: args.auditId,
		measured_at: args.measuredAt,
		areas,
		tree: { files },
		graph: { edges, missing_targets: missingTargets },
		constellation: await constellationOf(rows, edges),
		findings,
		tags: { ...args.audit.summary.tags.pages },
		structure: args.audit.summary.structure.groups.map((group) => ({
			id: `${group.basis}:${group.id}`,
			files: group.files,
			too_few_peers: group.too_few_peers,
			expected_headings: group.expected_headings,
			expected_keys: group.expected_keys
		}))
	};
}

/**
 * The constellation: one star per checked page that is not scaffolding, links between stars
 * (a proof citation as `cites`, every other link as `relates`, one per ordered pair, the
 * stronger kind kept), and areas found by the platform's own Louvain (`findAreas`, seeded) with
 * the deterministic folder-and-hub names (`fallbackAreaName`). Above
 * `CONSTELLATION_PAGE_CAP` stars only the areas and the links between them are kept.
 */
async function constellationOf(
	rows: readonly AuditFileWrite[],
	edges: readonly [number, number, 0 | 1 | 2][]
): Promise<PackConstellation> {
	const stars: number[] = [];
	let hidden = 0;
	rows.forEach((row, i) => {
		if (!isChecked(row)) return;
		if (isScaffolding(row.path, row.type ?? null)) hidden += 1;
		else stars.push(i);
	});
	const starOf = new Map(stars.map((fileIndex, star) => [fileIndex, star]));
	const CITES = CONSTELLATION_LINK_KINDS.indexOf('cites');
	const RELATES = CONSTELLATION_LINK_KINDS.indexOf('relates');
	const byPair = new Map<string, [number, number, number]>();
	for (const [from, to, code] of edges) {
		const s = starOf.get(from);
		const t = starOf.get(to);
		if (s === undefined || t === undefined || s === t) continue;
		const kind = code === 2 ? CITES : RELATES;
		const key = `${s}>${t}`;
		const existing = byPair.get(key);
		if (existing && existing[2] === CITES) continue;
		byPair.set(key, [s, t, kind]);
	}
	const links = [...byPair.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

	const nodes: ConstellationNode[] = stars.map((fileIndex, star) => ({
		pageId: String(fileIndex),
		path: rows[fileIndex]!.path,
		label: starLabel(rows[fileIndex]!.path),
		type: rows[fileIndex]!.type ?? null,
		owner: rows[fileIndex]!.ownerHint ?? null,
		freshAt: null,
		observedAt: null,
		occurredAt: null,
		inDegree: 0,
		outDegree: 0,
		area: star
	}));
	for (const [s, t] of links) {
		nodes[s]!.outDegree += 1;
		nodes[t]!.inDegree += 1;
	}
	const starArea = findAreas(
		nodes,
		links.map(([source, target]) => ({ source, target }))
	);
	const count = starArea.reduce((n, a) => Math.max(n, a + 1), 0);
	const areas: PackConstellation['areas'] = [];
	for (let a = 0; a < count; a += 1) {
		const members = nodes.filter((_, i) => starArea[i] === a);
		areas.push({
			name: fallbackAreaName(members),
			size: members.length,
			signature: await areaSignature(members.map((node) => node.pageId))
		});
	}
	const areaLinks = new Map<string, number>();
	for (const [s, t] of links) {
		const a = starArea[s]!;
		const b = starArea[t]!;
		if (a === LOOSE_AREA || b === LOOSE_AREA || a === b) continue;
		const key = a < b ? `${a}:${b}` : `${b}:${a}`;
		areaLinks.set(key, (areaLinks.get(key) ?? 0) + 1);
	}
	const pages = stars.length <= CONSTELLATION_PAGE_CAP;
	return {
		mode: pages ? 'pages' : 'areas',
		hidden,
		stars: pages ? stars : [],
		star_area: pages ? starArea : [],
		links: pages ? links : [],
		areas,
		area_links: [...areaLinks.entries()]
			.map(([key, n]) => {
				const [a, b] = key.split(':').map(Number) as [number, number];
				return [a, b, n] as [number, number, number];
			})
			.sort((x, y) => x[0] - y[0] || x[1] - y[1]),
		loose: starArea.filter((a) => a === LOOSE_AREA).length
	};
}

/** The structural audit's numbers, flattened to the plain summary's fixed keys. */
export function plainMeasuresOf(
	summary: AuditSummary,
	score: ScoreResult,
	findings: Record<StructuralFinding, number[]>
): PlainMeasures {
	const groups = summary.structure.groups;
	const sum = (pick: (group: (typeof groups)[number]) => number) =>
		groups.reduce((n, group) => n + pick(group), 0);
	const counts = Object.fromEntries(FINDING_CATEGORIES.map((c) => [c, 0])) as Record<
		FindingCategory,
		number
	>;
	for (const [category, list] of Object.entries(findings))
		counts[category as StructuralFinding] = list.length;
	return {
		totals: { ...summary.totals },
		by_role: Object.fromEntries(
			FILE_ROLES.map((role) => [role, summary.by_role[role]?.files ?? 0])
		) as PlainMeasures['by_role'],
		links: {
			resolved: summary.links.resolved,
			ambiguous: summary.links.ambiguous,
			missing: summary.links.missing,
			outside: summary.links.outside,
			orphans: summary.links.orphans,
			dead_ends: summary.links.dead_ends,
			citations: summary.links.citations,
			links_in_nav: summary.links.links_in_nav
		},
		freshness: {
			fresh: summary.freshness.fresh,
			ageing: summary.freshness.ageing,
			stale: summary.freshness.stale,
			none: summary.freshness.none
		},
		tags: {
			distinct: Object.keys(summary.tags.frequency).length,
			pages_without: summary.tags.pages_without
		},
		structure: {
			groups: groups.length,
			groups_too_few_peers: groups.filter((g) => g.too_few_peers).length,
			files_missing_expected: sum((g) => g.files_missing_expected),
			files_with_empty_sections: sum((g) => g.files_with_empty_sections),
			files_order_off: sum((g) => g.files_order_off),
			files_keys_unfilled: sum((g) => g.files_keys_unfilled)
		},
		areas: Object.keys(summary.by_area).filter((area) => area !== '(none)').length,
		depth_max: Object.keys(summary.depth).reduce((n, depth) => Math.max(n, Number(depth)), 0),
		subscores: Object.fromEntries(
			SUBSCORE_KEYS.map((key) => [key, score.subscores[key].score])
		) as PlainMeasures['subscores'],
		findings: counts
	};
}

/** The plain summary once merit is scored: merit counts in, Top 5 and total derived. */
export function plainSummaryOf(args: {
	engineVersion: string;
	/** The method pack scored with: its `method_version` and `content_hash`. */
	method: { version: string; hash: string };
	/** The method pack's `weights.total`. */
	totalWeights: SummaryTotalWeights;
	structural: StructuralSummary;
	merit: { score: number | null; absent: number; thin: number };
}): PlainSummary {
	const findings = {
		...args.structural.measures.findings,
		merit_absent: args.merit.absent,
		merit_thin: args.merit.thin
	};
	const measures = { ...args.structural.measures, findings };
	return {
		engine_version: args.engineVersion,
		method_version: args.method.version,
		method_hash: args.method.hash,
		company_type: args.structural.company_type,
		brain_format: args.structural.brain_format,
		file_count: measures.totals.files,
		structural_score: args.structural.structural_score,
		merit_score: args.merit.score,
		total_score: totalScoreOf(
			args.totalWeights,
			args.structural.structural_score,
			args.merit.score
		),
		top5: topFiveOf(findings),
		measures
	};
}

export function sealedPackOf(
	base: PackBase,
	summary: PlainSummary,
	merit: PackMerit | null,
	projection?: ScoreProjection
): SealedPack {
	return projection ? { ...base, summary, merit, projection } : { ...base, summary, merit };
}
