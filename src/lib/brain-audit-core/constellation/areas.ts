import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { degreeOf, LOOSE_AREA, type ConstellationLink, type ConstellationNode } from './model';

export const MIN_AREA_SIZE = 3;
const LOUVAIN_SEED = 20260930;

export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function findAreas(
	nodes: readonly Pick<ConstellationNode, 'path'>[],
	links: readonly Pick<ConstellationLink, 'source' | 'target'>[]
): number[] {
	if (nodes.length === 0) return [];
	const graph = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });
	nodes.forEach((_, i) => graph.addNode(String(i)));
	for (const link of links) {
		if (link.source !== link.target) graph.mergeEdge(String(link.source), String(link.target));
	}
	const community =
		graph.size > 0
			? louvain(graph, { rng: seededRandom(LOUVAIN_SEED), resolution: 1 })
			: ({} as Record<string, number>);
	const members = new Map<number, number[]>();
	nodes.forEach((_, i) => {
		const c = graph.size > 0 ? Number(community[String(i)]) : i;
		const list = members.get(c) ?? [];
		list.push(i);
		members.set(c, list);
	});
	const ranked = [...members.values()]
		.filter((list) => list.length >= MIN_AREA_SIZE)
		.sort((a, b) => b.length - a.length || nodes[a[0]].path.localeCompare(nodes[b[0]].path));
	const area = nodes.map(() => LOOSE_AREA);
	ranked.forEach((list, index) => {
		for (const i of list) area[i] = index;
	});
	return area;
}

function topicOf(path: string): string | null {
	const parts = path.split('/');
	if (parts.length < 2) return null;
	const folder = parts[0] === 'topics' && parts.length > 2 ? parts[1] : parts[0];
	return folder.replace(/[-_]+/g, ' ');
}

export function fallbackAreaName(members: readonly ConstellationNode[]): string {
	if (members.length === 0) return 'Area';
	const counts = new Map<string, number>();
	for (const node of members) {
		const topic = topicOf(node.path);
		if (topic) counts.set(topic, (counts.get(topic) ?? 0) + 1);
	}
	const topic = [...counts.entries()].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
	)[0]?.[0];
	const hub = [...members].sort(
		(a, b) => degreeOf(b) - degreeOf(a) || a.path.localeCompare(b.path)
	)[0];
	const head = topic ? topic.charAt(0).toUpperCase() + topic.slice(1) : null;
	if (!head) return hub.label;
	return topic && hub.label.toLowerCase().includes(topic.toLowerCase())
		? head
		: `${head} · ${hub.label}`;
}

export async function areaSignature(pageIds: readonly string[]): Promise<string> {
	const text = [...pageIds].sort().join('\n');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
