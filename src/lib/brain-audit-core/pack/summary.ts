import {
	COMPANY_TYPES,
	BRAIN_FORMATS,
	FILE_ROLES,
	FINDING_CATEGORIES,
	FINDING_WEIGHTS,
	type BrainFormat,
	type CompanyType,
	type FileRole,
	type FindingCategory
} from './vocab';

export const SUBSCORE_KEYS = ['links', 'structure', 'metadata', 'dating'] as const;
export type SubscoreKey = (typeof SUBSCORE_KEYS)[number];

export type PlainMeasures = {
	totals: {
		files: number;
		chars: number;
		words: number;
		pages: number;
		unread: number;
		copies: number;
	};
	by_role: Record<FileRole, number>;
	links: {
		resolved: number;
		ambiguous: number;
		missing: number;
		outside: number;
		orphans: number;
		dead_ends: number;
		citations: number;
		links_in_nav: number;
	};
	freshness: { fresh: number; ageing: number; stale: number; none: number };
	tags: { distinct: number; pages_without: number };
	structure: {
		groups: number;
		groups_too_few_peers: number;
		files_missing_expected: number;
		files_with_empty_sections: number;
		files_order_off: number;
		files_keys_unfilled: number;
	};
	areas: number;
	depth_max: number;
	subscores: Record<SubscoreKey, number | null>;
	findings: Record<FindingCategory, number>;
};

export type TopFinding = { category: FindingCategory; count: number };

export type PlainSummary = {
	engine_version: string;
	method_version: string;
	method_hash: string;
	company_type: CompanyType;
	brain_format: BrainFormat;
	file_count: number;
	structural_score: number | null;
	merit_score: number | null;
	total_score: number | null;
	top5: TopFinding[];
	measures: PlainMeasures;
};

export type SummaryTotalWeights = { structural: number; merit: number };

export function totalScoreOf(
	weights: SummaryTotalWeights,
	structural: number | null,
	merit: number | null
): number | null {
	if (structural === null || merit === null) return null;
	return Math.round(weights.structural * structural + weights.merit * merit);
}

export function topFiveOf(findings: Record<FindingCategory, number>): TopFinding[] {
	return FINDING_CATEGORIES.map((category, order) => ({
		category,
		count: findings[category] ?? 0,
		order
	}))
		.filter((entry) => entry.count > 0)
		.sort(
			(a, b) =>
				b.count * FINDING_WEIGHTS[b.category] - a.count * FINDING_WEIGHTS[a.category] ||
				a.order - b.order
		)
		.slice(0, 5)
		.map(({ category, count }) => ({ category, count }));
}

export type EngineVersion = { cli: string; audit: number; rubric: number; pack: number };

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const ENGINE_VERSION =
	/^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)\+a([1-9]\d{0,3})\.r([1-9]\d{0,3})\.p([1-9]\d{0,3})$/;

export function engineVersionOf(version: EngineVersion): string {
	const text = `${version.cli}+a${version.audit}.r${version.rubric}.p${version.pack}`;
	if (!SEMVER.test(version.cli) || parseEngineVersion(text) === null)
		throw new Error('engineVersionOf: not a semver CLI version or a positive integer version');
	return text;
}

export function parseEngineVersion(text: string): EngineVersion | null {
	const match = ENGINE_VERSION.exec(text);
	if (!match) return null;
	return {
		cli: match[1],
		audit: Number(match[2]),
		rubric: Number(match[3]),
		pack: Number(match[4])
	};
}

export type SummaryResult = { ok: true; summary: PlainSummary } | { ok: false; errors: string[] };

const MAX_COUNT = 1e12;

const METHOD_HASH = /^sha256:[0-9a-f]{64}$/;

type Ctx = { errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(ctx: Ctx, at: string, value: unknown, keys: readonly string[]): boolean {
	if (!isRecord(value)) {
		ctx.errors.push(`${at}: not an object`);
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) {
		ctx.errors.push(`${at}: not a plain object`);
		return false;
	}
	let ok = true;
	for (const key of Object.keys(value))
		if (!keys.includes(key)) {
			ctx.errors.push(`${at}: unknown key`);
			ok = false;
		}
	for (const key of keys)
		if (!(key in value)) {
			ctx.errors.push(`${at}.${key}: missing`);
			ok = false;
		}
	return ok;
}

function count(ctx: Ctx, at: string, value: unknown): void {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_COUNT)
		ctx.errors.push(`${at}: not a count`);
}

function score(ctx: Ctx, at: string, value: unknown, nullable: boolean): void {
	if (value === null && nullable) return;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100)
		ctx.errors.push(`${at}: not a score 0–100${nullable ? ' or null' : ''}`);
}

function word(ctx: Ctx, at: string, value: unknown, vocabulary: readonly string[]): void {
	if (typeof value !== 'string' || !vocabulary.includes(value))
		ctx.errors.push(`${at}: not one of the allowed words`);
}

function counts(ctx: Ctx, at: string, value: unknown, keys: readonly string[]): void {
	if (!exactKeys(ctx, at, value, keys)) return;
	for (const key of keys) count(ctx, `${at}.${key}`, (value as Record<string, unknown>)[key]);
}

const SUMMARY_KEYS = [
	'engine_version',
	'method_version',
	'method_hash',
	'company_type',
	'brain_format',
	'file_count',
	'structural_score',
	'merit_score',
	'total_score',
	'top5',
	'measures'
] as const;

const MEASURE_KEYS = [
	'totals',
	'by_role',
	'links',
	'freshness',
	'tags',
	'structure',
	'areas',
	'depth_max',
	'subscores',
	'findings'
] as const;

export function parsePlainSummary(input: unknown, weights: SummaryTotalWeights): SummaryResult {
	const ctx: Ctx = { errors: [] };
	if (!exactKeys(ctx, 'summary', input, SUMMARY_KEYS)) return { ok: false, errors: ctx.errors };
	const s = input as Record<string, unknown>;

	if (typeof s.engine_version !== 'string' || parseEngineVersion(s.engine_version) === null)
		ctx.errors.push('summary.engine_version: not <semver>+a<n>.r<n>.p<n>');
	if (
		typeof s.method_version !== 'string' ||
		s.method_version.length > 64 ||
		!SEMVER.test(s.method_version)
	)
		ctx.errors.push('summary.method_version: not a method version');
	if (typeof s.method_hash !== 'string' || !METHOD_HASH.test(s.method_hash))
		ctx.errors.push('summary.method_hash: not sha256:<64 hex>');
	word(ctx, 'summary.company_type', s.company_type, COMPANY_TYPES);
	word(ctx, 'summary.brain_format', s.brain_format, BRAIN_FORMATS);
	count(ctx, 'summary.file_count', s.file_count);
	score(ctx, 'summary.structural_score', s.structural_score, true);
	score(ctx, 'summary.merit_score', s.merit_score, true);
	score(ctx, 'summary.total_score', s.total_score, true);

	const m = s.measures;
	if (exactKeys(ctx, 'summary.measures', m, MEASURE_KEYS)) {
		const r = m as Record<string, unknown>;
		counts(ctx, 'measures.totals', r.totals, [
			'files',
			'chars',
			'words',
			'pages',
			'unread',
			'copies'
		]);
		counts(ctx, 'measures.by_role', r.by_role, FILE_ROLES);
		counts(ctx, 'measures.links', r.links, [
			'resolved',
			'ambiguous',
			'missing',
			'outside',
			'orphans',
			'dead_ends',
			'citations',
			'links_in_nav'
		]);
		counts(ctx, 'measures.freshness', r.freshness, ['fresh', 'ageing', 'stale', 'none']);
		counts(ctx, 'measures.tags', r.tags, ['distinct', 'pages_without']);
		counts(ctx, 'measures.structure', r.structure, [
			'groups',
			'groups_too_few_peers',
			'files_missing_expected',
			'files_with_empty_sections',
			'files_order_off',
			'files_keys_unfilled'
		]);
		count(ctx, 'measures.areas', r.areas);
		count(ctx, 'measures.depth_max', r.depth_max);
		if (exactKeys(ctx, 'measures.subscores', r.subscores, SUBSCORE_KEYS))
			for (const key of SUBSCORE_KEYS)
				score(
					ctx,
					`measures.subscores.${key}`,
					(r.subscores as Record<string, unknown>)[key],
					true
				);
		counts(ctx, 'measures.findings', r.findings, FINDING_CATEGORIES);
	}

	if (!Array.isArray(s.top5) || s.top5.length > 5)
		ctx.errors.push('summary.top5: not a list of 5 or fewer');
	else
		s.top5.forEach((entry, i) => {
			if (!exactKeys(ctx, `summary.top5[${i}]`, entry, ['category', 'count'])) return;
			const e = entry as Record<string, unknown>;
			word(ctx, `summary.top5[${i}].category`, e.category, FINDING_CATEGORIES);
			count(ctx, `summary.top5[${i}].count`, e.count);
		});

	if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };

	const summary = input as PlainSummary;
	if (summary.total_score !== totalScoreOf(weights, summary.structural_score, summary.merit_score))
		ctx.errors.push(
			`summary.total_score: not round(${weights.structural} × structural + ${weights.merit} × merit)`
		);
	if (summary.file_count !== summary.measures.totals.files)
		ctx.errors.push('summary.file_count: not measures.totals.files');
	const expected = topFiveOf(summary.measures.findings);
	if (
		expected.length !== summary.top5.length ||
		expected.some(
			(entry, i) =>
				entry.category !== summary.top5[i].category || entry.count !== summary.top5[i].count
		)
	)
		ctx.errors.push('summary.top5: not topFiveOf(measures.findings)');
	return ctx.errors.length > 0 ? { ok: false, errors: ctx.errors } : { ok: true, summary };
}
