import type { AuditFileWrite } from '../audit/types';
import type { Method } from '../method/types';
import type { CompanyType } from '../pack/vocab';
import { meritElementsFor, meritProfileOf } from './company-type';
import { contentHashOf } from './hash';
import {
	judgedPage,
	needsJudgement,
	overviewOf,
	PAGES_PER_ELEMENT,
	type JudgedPage
} from './judge';
import {
	pagesByElement,
	ruleMapPages,
	shapeClusters,
	TITLES_PER_CLUSTER,
	titleOf,
	type MeritClusterFacts,
	type MeritPageRow
} from './mapping';
import { meritCatalogFor, type MeritRubricElement } from './rubric';
import type { MeritSubject } from './types';

export const MERIT_PACK_VERSION = 1;

export type MeritPackPage = JudgedPage & {
	keys_unfilled: string[];
	cluster_id: string | null;
};

export type MeritPackElement = MeritRubricElement & {
	pages_total: number;
	pages: string[];
	needs_judgement: boolean;
};

export type MeritPackCluster = {
	cluster_id: string;
	top: string;
	keys: string[];
	headings: string[];
	size: string | null;
	files: number;
	pages: { path: string; title: string }[];
};

export type MeritMetadataPack = {
	merit_pack_version: number;
	rubric_version: number;
	grades_version: number;
	catalog_version: number;
	company_type: CompanyType;
	subject: MeritSubject;
	read_limit: number;
	measured_at: string;
	overview: {
		pages: number;
		by_area: [string, number][];
		by_type: [string, number][];
	};
	elements: MeritPackElement[];
	clusters: MeritPackCluster[];
	pages: MeritPackPage[];
	content_hash: string;
};

export function meritPageRowsOf(rows: readonly AuditFileWrite[]): {
	rows: MeritPageRow[];
	keysUnfilled: Map<string, string[]>;
} {
	const out: MeritPageRow[] = [];
	const keysUnfilled = new Map<string, string[]>();
	for (const file of rows) {
		if (file.role !== 'page' || file.unread || file.freshness == null) continue;
		out.push({
			path: file.path,
			title: file.title ?? null,
			type: file.type ?? null,
			area: file.area ?? null,
			tags: file.tags ?? [],
			keys: file.keys ?? [],
			chars: file.chars ?? 0,
			links_in: file.linksIn ?? 0,
			citations_out: file.citationsOut ?? 0,
			stated_date: file.statedDate ?? null,
			owner_hint: file.ownerHint ?? null,
			cluster_id: file.clusterId ?? null
		});
		if ((file.keysUnfilled ?? []).length > 0) keysUnfilled.set(file.path, [...file.keysUnfilled!]);
	}
	out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return { rows: out, keysUnfilled };
}

export function meritClusterFactsOf(
	clusters: readonly (
		| { id: string; top: string; keys: string[]; headings: string[]; size?: string | null }
		| { id: string; seed: { top: string; keys: string[]; headings: string[]; size?: string } }
	)[]
): MeritClusterFacts[] {
	return clusters.map((cluster) => {
		const facts = 'seed' in cluster ? cluster.seed : cluster;
		return {
			cluster_id: cluster.id,
			top: facts.top,
			keys: facts.keys,
			headings: facts.headings,
			size: facts.size ?? null
		};
	});
}

function sortedCounts(counts: Readonly<Record<string, number>>): [string, number][] {
	return Object.entries(counts).sort(
		(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
	);
}

export type MeritPackInput = {
	rows: readonly AuditFileWrite[];
	clusters?: Parameters<typeof meritClusterFactsOf>[0];
	companyType: CompanyType;
	measuredAt: string;
	readLimit?: number;
	method: Method;
};

export async function buildMeritPack(input: MeritPackInput): Promise<MeritMetadataPack> {
	const { method } = input;
	const profile = meritProfileOf(method.catalog, input.companyType);
	const elements = meritElementsFor(method.catalog, input.companyType);
	const catalog = meritCatalogFor(method.catalog, input.companyType);
	const { rows, keysUnfilled } = meritPageRowsOf(input.rows);
	const rule = ruleMapPages(rows, elements, method.mapping);
	const mapped = pagesByElement(rule.mapped);
	const rowOf = new Map(rows.map((row) => [row.path, row]));
	const clusters = shapeClusters(
		rows,
		rule.for_model,
		meritClusterFactsOf(input.clusters ?? [])
	).map((cluster): MeritPackCluster => ({
		cluster_id: cluster.cluster_id,
		top: cluster.top,
		keys: cluster.keys,
		headings: cluster.headings,
		size: cluster.size,
		files: cluster.files,
		pages: cluster.paths.slice(0, TITLES_PER_CLUSTER).map((path) => ({
			path,
			title: titleOf(rowOf.get(path) ?? { path, title: null })
		}))
	}));
	const overview = overviewOf(rows);
	const readLimit = input.readLimit ?? method.rubric.read_limit;
	if (!Number.isInteger(readLimit) || readLimit < 0)
		throw new Error('read limit must be a whole number ≥ 0');
	const body: Omit<MeritMetadataPack, 'content_hash'> = {
		merit_pack_version: MERIT_PACK_VERSION,
		rubric_version: method.rubric.rubric_version,
		grades_version: method.rubric.grades_version,
		catalog_version: method.catalog.catalog_version,
		company_type: profile.company_type,
		subject: profile.subject,
		read_limit: readLimit,
		measured_at: input.measuredAt,
		overview: {
			pages: overview.pages,
			by_area: sortedCounts(overview.by_area),
			by_type: sortedCounts(overview.by_type)
		},
		elements: catalog.elements.map((element, i): MeritPackElement => {
			const paths = [...(mapped.get(element.element_id) ?? [])].sort();
			return {
				...element,
				pages_total: paths.length,
				pages: paths.slice(0, PAGES_PER_ELEMENT),
				needs_judgement: needsJudgement(elements[i]!, profile.subject, paths.length)
			};
		}),
		clusters,
		pages: rows.map((row) => ({
			...judgedPage(row),
			keys_unfilled: [...(keysUnfilled.get(row.path) ?? [])],
			cluster_id: row.cluster_id
		}))
	};
	return { ...body, content_hash: await meritPackHashOf(body) };
}

export async function meritPackHashOf(
	pack: Omit<MeritMetadataPack, 'content_hash'> & { content_hash?: string }
): Promise<string> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { content_hash, ...body } = pack;
	return contentHashOf(body);
}

export function ruleMappedPages(
	method: Pick<Method, 'catalog' | 'mapping'>,
	pack: Pick<MeritMetadataPack, 'pages' | 'elements' | 'company_type'>
): Map<string, string[]> {
	const elements = meritElementsFor(method.catalog, pack.company_type);
	const rows: readonly MeritPageRow[] = pack.pages;
	return pagesByElement(ruleMapPages(rows, elements, method.mapping).mapped);
}
