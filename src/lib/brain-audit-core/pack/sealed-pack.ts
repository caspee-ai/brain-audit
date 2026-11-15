import type { ConstellationData, ConstellationLinkKind } from '../constellation/model';
import type { PlainSummary } from './summary';
import {
	AUDIT_FRESHNESS_BANDS,
	FILE_ROLES,
	FINDING_CATEGORIES,
	type AuditFreshnessBand,
	type FileRole,
	type FindingCategory
} from './vocab';

export const PACK_VERSION = 1;

export const CONSTELLATION_PAGE_CAP = 10_000;

export type PackFile = {
	path: string;
	title: string | null;
	role: FileRole;
	type: string | null;
	area: number | null;
	owner: string | null;
	chars: number;
	words: number;
	depth: number;
	links_in: number;
	links_out: number;
	links_missing: number;
	stated_date: string | null;
	freshness: AuditFreshnessBand | null;
	tags: string[];
	expected_missing: string[];
	empty_sections: number;
	unread: boolean;
};

export const EDGE_CODES = ['resolved', 'ambiguous', 'citation'] as const;
export type EdgeCode = 0 | 1 | 2;

export type PackEdge = [number, number, EdgeCode];

export type PackMissingTarget = { name: string; count: number; from: number[] };

export const CONSTELLATION_LINK_KINDS: readonly ConstellationLinkKind[] = [
	'relates',
	'cites',
	'depends_on',
	'used_by'
];

export type PackArea = { name: string; size: number; signature: string };

export type PackConstellation = {
	mode: 'pages' | 'areas';
	hidden: number;
	stars: number[];
	star_area: number[];
	links: [number, number, number][];
	areas: PackArea[];
	area_links: [number, number, number][];
	loose: number;
};

export type MeritGrade = {
	element_id: string;
	name: string;
	group: string;
	tier: 'always' | 'when_present' | 'by_type';
	applies: 'yes' | 'no' | 'unsure';
	level: 0 | 1 | 2 | 3 | null;
	evidence: number[];
	read: number[];
	reason: string | null;
	missing: string[];
};

export type PackMerit = {
	rubric_version: number;
	score: number | null;
	read_limit: number;
	elements: MeritGrade[];
};

export type PackStructureGroup = {
	id: string;
	files: number;
	too_few_peers: boolean;
	expected_headings: string[];
	expected_keys: string[];
};

export type ProjectedScores = {
	structural: number | null;
	merit: number | null;
	total: number | null;
};

export type ScoreProjection = {
	by_category: Record<FindingCategory, ProjectedScores>;
	top5: ProjectedScores;
};

export type SealedPack = {
	pack_version: typeof PACK_VERSION;
	audit_id: string;
	measured_at: string;
	summary: PlainSummary;
	areas: string[];
	tree: { files: PackFile[] };
	graph: { edges: PackEdge[]; missing_targets: PackMissingTarget[] };
	constellation: PackConstellation;
	findings: Record<Exclude<FindingCategory, 'merit_absent' | 'merit_thin'>, number[]>;
	tags: Record<string, number>;
	structure: PackStructureGroup[];
	merit: PackMerit | null;
	projection?: ScoreProjection;
};

export const STRUCTURAL_FINDINGS = FINDING_CATEGORIES.filter(
	(category): category is Exclude<FindingCategory, 'merit_absent' | 'merit_thin'> =>
		category !== 'merit_absent' && category !== 'merit_thin'
);

export type PackResult = { ok: true; pack: SealedPack } | { ok: false; errors: string[] };

const MAX_ERRORS = 50;

export function parseSealedPack(input: unknown, auditId?: string): PackResult {
	const errors: string[] = [];
	const fail = (message: string) => {
		if (errors.length < MAX_ERRORS) errors.push(message);
	};
	const isObj = (v: unknown): v is Record<string, unknown> =>
		typeof v === 'object' && v !== null && !Array.isArray(v);
	const isCount = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
	const isStr = (v: unknown) => typeof v === 'string';
	const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';

	if (!isObj(input)) return { ok: false, errors: ['pack: not an object'] };
	if (input.pack_version !== PACK_VERSION)
		return { ok: false, errors: [`pack.pack_version: not ${PACK_VERSION}`] };
	if (!isStr(input.audit_id)) fail('pack.audit_id: not a string');
	else if (auditId !== undefined && input.audit_id !== auditId)
		fail('pack.audit_id: not this audit');
	if (!isStr(input.measured_at) || Number.isNaN(Date.parse(input.measured_at as string)))
		fail('pack.measured_at: not an ISO time');
	if (!isObj(input.summary)) fail('pack.summary: not an object');

	const areas = input.areas;
	if (!Array.isArray(areas) || !areas.every(isStr)) fail('pack.areas: not a list of names');
	const areaCount = Array.isArray(areas) ? areas.length : 0;

	const tree = input.tree;
	const files = isObj(tree) && Array.isArray(tree.files) ? (tree.files as unknown[]) : null;
	if (!files) return { ok: false, errors: [...errors, 'pack.tree.files: not a list'] };
	const n = files.length;
	const inFiles = (v: unknown) => isCount(v) && (v as number) < n;

	files.forEach((file, i) => {
		const at = `pack.tree.files[${i}]`;
		if (!isObj(file)) return fail(`${at}: not an object`);
		if (!isStr(file.path) || file.path === '') fail(`${at}.path`);
		if (!isStrOrNull(file.title)) fail(`${at}.title`);
		if (!(FILE_ROLES as readonly unknown[]).includes(file.role)) fail(`${at}.role`);
		if (!isStrOrNull(file.type)) fail(`${at}.type`);
		if (!(file.area === null || (isCount(file.area) && (file.area as number) < areaCount)))
			fail(`${at}.area`);
		if (!isStrOrNull(file.owner)) fail(`${at}.owner`);
		for (const key of [
			'chars',
			'words',
			'depth',
			'links_in',
			'links_out',
			'links_missing',
			'empty_sections'
		])
			if (!isCount(file[key])) fail(`${at}.${key}`);
		if (!(
			file.stated_date === null ||
			(isStr(file.stated_date) && /^\d{4}-\d{2}-\d{2}$/.test(file.stated_date as string))
		))
			fail(`${at}.stated_date`);
		if (!(
			file.freshness === null ||
			(AUDIT_FRESHNESS_BANDS as readonly unknown[]).includes(file.freshness)
		))
			fail(`${at}.freshness`);
		if (!Array.isArray(file.tags) || !file.tags.every(isStr)) fail(`${at}.tags`);
		if (!Array.isArray(file.expected_missing) || !file.expected_missing.every(isStr))
			fail(`${at}.expected_missing`);
		if (typeof file.unread !== 'boolean') fail(`${at}.unread`);
	});

	const graph = input.graph;
	if (!isObj(graph) || !Array.isArray(graph.edges) || !Array.isArray(graph.missing_targets))
		fail('pack.graph: not { edges, missing_targets }');
	else {
		(graph.edges as unknown[]).forEach((edge, i) => {
			if (
				!Array.isArray(edge) ||
				edge.length !== 3 ||
				!inFiles(edge[0]) ||
				!inFiles(edge[1]) ||
				!(edge[2] === 0 || edge[2] === 1 || edge[2] === 2)
			)
				fail(`pack.graph.edges[${i}]`);
		});
		(graph.missing_targets as unknown[]).forEach((target, i) => {
			if (
				!isObj(target) ||
				!isStr(target.name) ||
				!isCount(target.count) ||
				!Array.isArray(target.from) ||
				!target.from.every(inFiles)
			)
				fail(`pack.graph.missing_targets[${i}]`);
		});
	}

	const c = input.constellation;
	if (!isObj(c)) fail('pack.constellation: not an object');
	else {
		if (c.mode !== 'pages' && c.mode !== 'areas') fail('pack.constellation.mode');
		if (!isCount(c.hidden)) fail('pack.constellation.hidden');
		if (!isCount(c.loose)) fail('pack.constellation.loose');
		const cAreas = Array.isArray(c.areas) ? (c.areas as unknown[]) : null;
		if (
			!cAreas ||
			!cAreas.every((a) => isObj(a) && isStr(a.name) && isCount(a.size) && isStr(a.signature))
		)
			fail('pack.constellation.areas');
		const k = cAreas?.length ?? 0;
		const stars = Array.isArray(c.stars) ? (c.stars as unknown[]) : null;
		const starArea = Array.isArray(c.star_area) ? (c.star_area as unknown[]) : null;
		if (!stars || !stars.every(inFiles)) fail('pack.constellation.stars');
		if (
			!starArea ||
			starArea.length !== (stars?.length ?? -1) ||
			!starArea.every((a) => a === -1 || (isCount(a) && (a as number) < k))
		)
			fail('pack.constellation.star_area');
		if (c.mode === 'areas' && (stars?.length ?? 0) > 0)
			fail('pack.constellation.stars: not empty in areas mode');
		if ((stars?.length ?? 0) > CONSTELLATION_PAGE_CAP)
			fail('pack.constellation.stars: above the page cap');
		const s = stars?.length ?? 0;
		if (
			!Array.isArray(c.links) ||
			!(c.links as unknown[]).every(
				(l) =>
					Array.isArray(l) &&
					l.length === 3 &&
					isCount(l[0]) &&
					l[0] < s &&
					isCount(l[1]) &&
					l[1] < s &&
					isCount(l[2]) &&
					l[2] < CONSTELLATION_LINK_KINDS.length
			)
		)
			fail('pack.constellation.links');
		if (
			!Array.isArray(c.area_links) ||
			!(c.area_links as unknown[]).every(
				(l) =>
					Array.isArray(l) &&
					l.length === 3 &&
					isCount(l[0]) &&
					isCount(l[1]) &&
					l[0] < l[1] &&
					l[1] < k &&
					isCount(l[2])
			)
		)
			fail('pack.constellation.area_links');
	}

	const findings = input.findings;
	if (!isObj(findings)) fail('pack.findings: not an object');
	else {
		for (const category of STRUCTURAL_FINDINGS) {
			const list = findings[category];
			if (!Array.isArray(list) || !list.every(inFiles)) fail(`pack.findings.${category}`);
		}
		if (
			Object.keys(findings).some((key) => !(STRUCTURAL_FINDINGS as readonly string[]).includes(key))
		)
			fail('pack.findings: unknown category');
	}

	if (!isObj(input.tags) || !Object.values(input.tags).every(isCount)) fail('pack.tags');
	if (
		!Array.isArray(input.structure) ||
		!(input.structure as unknown[]).every(
			(g) =>
				isObj(g) &&
				isStr(g.id) &&
				isCount(g.files) &&
				typeof g.too_few_peers === 'boolean' &&
				Array.isArray(g.expected_headings) &&
				Array.isArray(g.expected_keys)
		)
	)
		fail('pack.structure');

	if (input.projection !== undefined) {
		const isScore = (v: unknown) => v === null || (isCount(v) && (v as number) <= 100);
		const isScores = (v: unknown) =>
			isObj(v) &&
			Object.keys(v).length === 3 &&
			isScore(v.structural) &&
			isScore(v.merit) &&
			isScore(v.total);
		const p = input.projection;
		if (
			!isObj(p) ||
			Object.keys(p).length !== 2 ||
			!isScores(p.top5) ||
			!isObj(p.by_category) ||
			Object.keys(p.by_category).length !== FINDING_CATEGORIES.length ||
			!FINDING_CATEGORIES.every((c) => isScores((p.by_category as Record<string, unknown>)[c]))
		)
			fail('pack.projection');
	}

	const merit = input.merit;
	if (merit !== null) {
		if (
			!isObj(merit) ||
			!isCount(merit.rubric_version) ||
			!isCount(merit.read_limit) ||
			!(merit.score === null || (isCount(merit.score) && (merit.score as number) <= 100)) ||
			!Array.isArray(merit.elements)
		)
			fail('pack.merit');
		else
			(merit.elements as unknown[]).forEach((g, i) => {
				const ok =
					isObj(g) &&
					isStr(g.element_id) &&
					isStr(g.name) &&
					isStr(g.group) &&
					['always', 'when_present', 'by_type'].includes(g.tier as string) &&
					['yes', 'no', 'unsure'].includes(g.applies as string) &&
					(g.level === null || [0, 1, 2, 3].includes(g.level as number)) &&
					Array.isArray(g.evidence) &&
					g.evidence.every(inFiles) &&
					Array.isArray(g.read) &&
					g.read.every(inFiles) &&
					isStrOrNull(g.reason) &&
					Array.isArray(g.missing) &&
					g.missing.every(isStr);
				if (!ok) fail(`pack.merit.elements[${i}]`);
			});
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true, pack: input as SealedPack };
}

function labelOf(file: PackFile): string {
	if (file.title) return file.title;
	const base = (file.path.split('/').pop() ?? file.path).replace(/\.md$/i, '').replace(/^_+/, '');
	return base.replace(/[-_]+/g, ' ').trim();
}

export function constellationDataOf(pack: SealedPack): ConstellationData {
	const c = pack.constellation;
	const nodes = c.stars.map((fileIndex, i) => {
		const file = pack.tree.files[fileIndex];
		return {
			pageId: String(fileIndex),
			path: file.path,
			label: labelOf(file),
			type: file.type,
			owner: file.owner,
			freshAt: file.stated_date,
			observedAt: null,
			occurredAt: file.stated_date,
			inDegree: 0,
			outDegree: 0,
			area: c.star_area[i]
		};
	});
	const links = c.links.map(([source, target, kind]) => ({
		source,
		target,
		kind: CONSTELLATION_LINK_KINDS[kind]
	}));
	for (const link of links) {
		nodes[link.source].outDegree += 1;
		nodes[link.target].inDegree += 1;
	}
	return {
		nodes,
		links,
		hidden: c.hidden,
		areas: c.areas.map((area) => ({ ...area, named: false })),
		naming: false,
		readAt: pack.measured_at
	};
}
