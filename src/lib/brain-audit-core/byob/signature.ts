import { sha1Hex } from '../sha1';
import { headerValuesOf } from './access';
import { isByobText } from './dialect';
import type { ByobRole } from './types';

export type SignatureStem = 'date' | 'slug' | 'id_suffix' | 'title' | 'other';
export type SignatureSize = 'xs' | 's' | 'm' | 'l' | 'xl';

export type FileSignature = {
	path: string;
	top: string;
	depth: number;
	keys: string[];
	headings: string[];
	stem: SignatureStem;
	size: SignatureSize;
	links: { out: number; in: number };
	features: { bullets: number; table: boolean; code: boolean; prose: boolean };
};

export const SIGNATURE_KEYS_MAX = 24;
export const SIGNATURE_HEADINGS_MAX = 8;
export const CLUSTER_MERGE_JACCARD = 0.7;
export const BYOB_CLUSTERS_MAX = 80;
const MEMBERS_KEPT = 24;
const SAMPLES_KEPT = 3;

const DATE_STEM = /^\d{4}-\d{2}-\d{2}/;
const ID_SUFFIX = /[ _-][0-9a-f]{32}$/i;
const SLUG_STEM = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const TITLE_STEM = /^\p{Lu}[\p{L}\p{N}'’.,&()-]*(?: [\p{L}\p{N}'’.,&()-]+)+$/u;
const H2 = /^##\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const FRONTMATTER_BLOCK = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function normalizeHeading(text: string): string {
	return text
		.toLowerCase()
		.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

function stemOf(path: string): SignatureStem {
	const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
	if (DATE_STEM.test(stem)) return 'date';
	if (ID_SUFFIX.test(stem)) return 'id_suffix';
	if (SLUG_STEM.test(stem)) return 'slug';
	if (TITLE_STEM.test(stem)) return 'title';
	return 'other';
}

function sizeOf(chars: number): SignatureSize {
	return chars < 400
		? 'xs'
		: chars < 2_000
			? 's'
			: chars < 8_000
				? 'm'
				: chars < 32_000
					? 'l'
					: 'xl';
}

export function signatureOf(
	file: { path: string; body: string },
	options: { root?: string | null; links?: { out: number; in: number } } = {}
): FileSignature {
	const root = options.root ?? '';
	const rel = root && file.path.startsWith(root) ? file.path.slice(root.length) : file.path;
	const folders = rel.split('/').slice(0, -1);
	const keys = [...headerValuesOf(file.body).keys()].sort().slice(0, SIGNATURE_KEYS_MAX);
	const header = FRONTMATTER_BLOCK.exec(file.body)?.[0].length ?? 0;
	const headings: string[] = [];
	let lines = 0;
	let listed = 0;
	let table = false;
	let code = false;
	let prose = false;
	let fenced = false;
	let start = header;
	while (start <= file.body.length) {
		let end = file.body.indexOf('\n', start);
		if (end < 0) end = file.body.length;
		const line = file.body.slice(start, end).replace(/\r$/, '');
		start = end + 1;
		if (FENCE.test(line)) {
			code = true;
			fenced = !fenced;
			continue;
		}
		if (fenced || line.trim() === '') continue;
		lines += 1;
		const h2 = H2.exec(line);
		if (h2) {
			if (headings.length < SIGNATURE_HEADINGS_MAX) {
				const heading = normalizeHeading(h2[1]!);
				if (heading) headings.push(heading);
			}
			continue;
		}
		if (/^#/.test(line)) continue;
		if (LIST_LINE.test(line)) listed += 1;
		else if (TABLE_RULE.test(line)) table = true;
		else if (!prose && line.length >= 80 && !line.trimStart().startsWith('|')) prose = true;
	}
	const share = lines > 0 ? listed / lines : 0;
	return {
		path: file.path,
		top: folders.length > 0 ? folders[0]! : '',
		depth: folders.length,
		keys,
		headings,
		stem: stemOf(rel),
		size: sizeOf(file.body.length - header),
		links: options.links ?? { out: 0, in: 0 },
		features: {
			bullets: share < 0.05 ? 0 : share < 0.25 ? 1 : share < 0.5 ? 2 : 3,
			table,
			code,
			prose
		}
	};
}

export function signatureId(signature: Pick<FileSignature, 'top' | 'keys' | 'headings' | 'stem'>) {
	const key = [
		signature.top,
		signature.keys.join(','),
		signature.headings.slice(0, 3).join(','),
		signature.stem
	].join('|');
	return `c_${sha1Hex(key).slice(0, 10)}`;
}

export type SignatureCluster = {
	id: string;
	members: string[];
	seed: FileSignature;
	paths: string[];
};

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	let both = 0;
	for (const item of a) if (b.has(item)) both += 1;
	return both / (a.size + b.size - both);
}

export function clustersOf(signatures: readonly FileSignature[]): SignatureCluster[] {
	const exact = new Map<string, { id: string; seed: FileSignature; paths: string[] }>();
	const sorted = [...signatures].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	for (const signature of sorted) {
		const id = signatureId(signature);
		const group = exact.get(id);
		if (group) group.paths.push(signature.path);
		else exact.set(id, { id, seed: signature, paths: [signature.path] });
	}
	const ordered = [...exact.values()].sort(
		(a, b) => b.paths.length - a.paths.length || (a.id < b.id ? -1 : 1)
	);
	const out: (SignatureCluster & { features: Set<string> })[] = [];
	for (const group of ordered) {
		const features = new Set([...group.seed.keys, ...group.seed.headings.map((h) => `#${h}`)]);
		const into = out.find(
			(cluster) =>
				cluster.seed.top === group.seed.top &&
				cluster.seed.stem === group.seed.stem &&
				jaccard(cluster.features, features) >= CLUSTER_MERGE_JACCARD
		);
		if (into) {
			into.members.push(group.id);
			into.paths.push(...group.paths);
		} else
			out.push({
				id: group.id,
				members: [group.id],
				seed: group.seed,
				paths: [...group.paths],
				features
			});
	}
	return out
		.map((cluster) => ({
			id: cluster.id,
			members: [...cluster.members].sort(),
			seed: cluster.seed,
			paths: [...cluster.paths].sort()
		}))
		.sort((a, b) => b.paths.length - a.paths.length || (a.id < b.id ? -1 : 1));
}

export function clusterIndexOf(
	files: readonly { sourcePath: string; body: string }[],
	root?: string | null
): Map<string, { id: string; members: readonly string[] }> {
	const signatures = files
		.filter((file) => isByobText(file.sourcePath))
		.map((file) => signatureOf({ path: file.sourcePath, body: file.body }, { root }));
	const out = new Map<string, { id: string; members: readonly string[] }>();
	for (const cluster of clustersOf(signatures))
		for (const path of cluster.paths) out.set(path, { id: cluster.id, members: cluster.members });
	return out;
}

export type ByobCluster = {
	id: string;
	members: string[];
	top: string;
	keys: string[];
	headings: string[];
	stem: SignatureStem;
	size: SignatureSize;
	files: number;
	samples: string[];
	linked?: string;
	roles: Partial<Record<ByobRole, number>>;
	types: Record<string, number>;
	unclear: number;
};

export function intakeClustersOf(
	clusters: readonly SignatureCluster[],
	pageOf: (
		path: string
	) => { role: ByobRole; type?: string | null; chars: number; inLinks?: number } | undefined
): { clusters: ByobCluster[]; truncated: number } {
	const kept = clusters.slice(0, BYOB_CLUSTERS_MAX).map((cluster): ByobCluster => {
		const roles: Partial<Record<ByobRole, number>> = {};
		const types: Record<string, number> = {};
		let unclear = 0;
		const sized: { path: string; chars: number }[] = [];
		let linked: { path: string; in: number } | null = null;
		for (const path of cluster.paths) {
			const page = pageOf(path);
			if (!page) continue;
			roles[page.role] = (roles[page.role] ?? 0) + 1;
			if (page.role === 'unclear') unclear += 1;
			if ((page.role === 'page' || page.role === 'unclear') && page.type)
				types[page.type] = (types[page.type] ?? 0) + 1;
			sized.push({ path, chars: page.chars });
			if ((page.inLinks ?? 0) > (linked?.in ?? 0)) linked = { path, in: page.inLinks! };
		}
		sized.sort((a, b) => a.chars - b.chars || (a.path < b.path ? -1 : 1));
		const samples = [
			...new Set(
				[sized[0], sized[Math.floor(sized.length / 2)], sized.at(-1)].flatMap((s) =>
					s ? [s.path] : []
				)
			)
		].slice(0, SAMPLES_KEPT);
		return {
			id: cluster.id,
			members: cluster.members.slice(0, MEMBERS_KEPT),
			top: cluster.seed.top,
			keys: cluster.seed.keys,
			headings: cluster.seed.headings,
			stem: cluster.seed.stem,
			size: cluster.seed.size,
			files: cluster.paths.length,
			samples,
			...(linked && !samples.includes(linked.path) ? { linked: linked.path } : {}),
			roles,
			types,
			unclear
		};
	});
	return { clusters: kept, truncated: Math.max(0, clusters.length - kept.length) };
}
