export type ConstellationLinkKind = 'relates' | 'cites' | 'depends_on' | 'used_by';

export type ConstellationNode = {
	pageId: string;
	path: string;
	label: string;
	type: string | null;
	owner: string | null;
	freshAt: string | null;
	observedAt: string | null;
	occurredAt: string | null;
	inDegree: number;
	outDegree: number;
	area: number;
};

export const LOOSE_AREA = -1;

export type ConstellationLink = {
	source: number;
	target: number;
	kind: ConstellationLinkKind;
};

export const SCAFFOLDING_TYPES: ReadonlySet<string> = new Set([
	'navigation',
	'schema',
	'changelog',
	'render_profile'
]);

export function isScaffolding(path: string, type: string | null): boolean {
	if (type && SCAFFOLDING_TYPES.has(type)) return true;
	const base = path.split('/').pop()?.replace(/\.md$/i, '') ?? '';
	return base === 'readme' || base === '_schema' || base === '_render';
}

export function starLabel(path: string): string {
	const base = (path.split('/').pop() ?? path).replace(/\.md$/i, '').replace(/^_+/, '');
	const words = base.replace(/[-_]+/g, ' ').trim();
	return path.startsWith('registry/') ? `registry · ${words}` : words;
}

export function degreeOf(node: Pick<ConstellationNode, 'inDegree' | 'outDegree'>): number {
	return node.inDegree + node.outDegree;
}

export type ConstellationArea = {
	signature: string;
	name: string;
	named: boolean;
	size: number;
};

export type ConstellationData = {
	nodes: ConstellationNode[];
	links: ConstellationLink[];
	hidden: number;
	areas: ConstellationArea[];
	naming: boolean;
	readAt: string;
};

export type Freshness = 'fresh' | 'ageing' | 'stale' | 'none';

const DAY_MS = 86_400_000;

export function ageInDays(freshAt: string | null, readAt: string): number | null {
	if (freshAt === null) return null;
	const age = Date.parse(readAt) - Date.parse(freshAt);
	if (!Number.isFinite(age)) return null;
	return Math.max(0, Math.floor(age / DAY_MS));
}

export function freshnessOf(freshAt: string | null, readAt: string): Freshness {
	const days = ageInDays(freshAt, readAt);
	if (days === null) return 'none';
	if (days <= 14) return 'fresh';
	if (days <= 30) return 'ageing';
	return 'stale';
}
