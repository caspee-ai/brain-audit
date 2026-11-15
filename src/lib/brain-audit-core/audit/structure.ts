import { isAuditChecked, type AuditFileFacts, type AuditFileRow } from './extract';
import type { MethodWeights } from '../method/types';

export type StructuralThresholds = Pick<
	MethodWeights['structural'],
	'expected_share' | 'min_peers'
>;

export function peerGroupOf(
	file: Pick<AuditFileFacts, 'type' | 'type_decided' | 'cluster_id'>
): string | null {
	if (file.type_decided && file.type) return `type:${file.type}`;
	return file.cluster_id ? `cluster:${file.cluster_id}` : null;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function peerGroups(
	rows: readonly AuditFileRow[],
	options: { copies?: ReadonlyMap<string, string> } = {}
): Map<string, AuditFileFacts[]> {
	const out = new Map<string, AuditFileFacts[]>();
	for (const row of rows) {
		if (row.unread || !isAuditChecked(row.role) || options.copies?.has(row.path)) continue;
		const group = peerGroupOf(row);
		if (!group) continue;
		out.set(group, [...(out.get(group) ?? []), row]);
	}
	return new Map(
		[...out.keys()]
			.sort(byText)
			.map((key) => [key, [...out.get(key)!].sort((a, b) => byText(a.path, b.path))])
	);
}

export type ExpectedItem = { name: string; files: number; share: number };

export type ExpectedStructure = {
	files: number;
	too_few_peers: boolean;
	heading_files: number;
	headings: ExpectedItem[];
	key_files: number;
	keys: ExpectedItem[];
	expected_share: number;
	min_peers: number;
};

function firstOccurrences(headings: readonly { text: string }[]): string[] {
	return [...new Set(headings.map((h) => h.text))];
}

function expectedOf(counts: Map<string, number>, measured: number, share: number): ExpectedItem[] {
	return [...counts]
		.filter(([, files]) => files / measured >= share)
		.map(([name, files]) => ({ name, files, share: files / measured }))
		.sort((a, b) => byText(a.name, b.name));
}

export function expectedStructure(
	group: readonly AuditFileFacts[],
	thresholds: StructuralThresholds
): ExpectedStructure {
	const { expected_share: share, min_peers: minPeers } = thresholds;
	const headed = group.filter((file) => file.headings !== null);
	const keyed = group.filter((file) => file.keys !== null);
	const tooFew = group.length < minPeers;
	const base = {
		files: group.length,
		too_few_peers: tooFew,
		heading_files: headed.length,
		key_files: keyed.length,
		expected_share: share,
		min_peers: minPeers
	};
	if (tooFew) return { ...base, headings: [], keys: [] };
	const headingCounts = new Map<string, number>();
	for (const file of headed)
		for (const text of firstOccurrences(file.headings!))
			headingCounts.set(text, (headingCounts.get(text) ?? 0) + 1);
	const keyCounts = new Map<string, number>();
	for (const file of keyed)
		for (const key of new Set(file.keys!)) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
	const expectedHeadings =
		headed.length >= minPeers ? expectedOf(headingCounts, headed.length, share) : [];
	const names = new Set(expectedHeadings.map((h) => h.name));
	const rank = new Map<string, { sum: number; n: number }>();
	for (const file of headed) {
		const order = firstOccurrences(file.headings!).filter((text) => names.has(text));
		order.forEach((text, i) => {
			const entry = rank.get(text) ?? { sum: 0, n: 0 };
			entry.sum += i;
			entry.n += 1;
			rank.set(text, entry);
		});
	}
	const mean = (name: string) => {
		const entry = rank.get(name)!;
		return entry.sum / entry.n;
	};
	expectedHeadings.sort((a, b) => mean(a.name) - mean(b.name) || byText(a.name, b.name));
	return {
		...base,
		headings: expectedHeadings,
		keys: keyed.length >= minPeers ? expectedOf(keyCounts, keyed.length, share) : []
	};
}

export type FileConformance = {
	path: string;
	peer_group: string | null;
	expected_missing: string[] | null;
	heading_order_ok: boolean | null;
	keys_unfilled: string[] | null;
	expected_headings: number | null;
	expected_keys: number | null;
};

export type PeerGroupFacts = {
	group: string;
	expected: ExpectedStructure;
	headings_expected: number;
	headings_present: number;
	keys_expected: number;
	keys_filled: number;
	section_files: number;
	no_empty_section: number;
	order_ok: number;
};

export type StructureFacts = { groups: PeerGroupFacts[]; files: FileConformance[] };

const none = (path: string, group: string | null): FileConformance => ({
	path,
	peer_group: group,
	expected_missing: null,
	heading_order_ok: null,
	keys_unfilled: null,
	expected_headings: null,
	expected_keys: null
});

export function conformanceOf(
	file: AuditFileFacts,
	group: string,
	expected: ExpectedStructure
): FileConformance {
	if (expected.too_few_peers) return none(file.path, group);
	const headingsMeasured = file.headings !== null && expected.heading_files >= expected.min_peers;
	const keysMeasured = file.keys !== null && expected.key_files >= expected.min_peers;
	const present = file.headings ? firstOccurrences(file.headings) : [];
	const has = new Set(present);
	const order = expected.headings.map((h) => h.name);
	const own = present.filter((text) => order.includes(text));
	const filled = new Set(file.keys_filled ?? []);
	return {
		path: file.path,
		peer_group: group,
		expected_missing: headingsMeasured ? order.filter((name) => !has.has(name)) : null,
		heading_order_ok: headingsMeasured
			? own.every((text, i) => text === order.filter((name) => has.has(name))[i])
			: null,
		keys_unfilled: keysMeasured
			? expected.keys.map((k) => k.name).filter((name) => !filled.has(name))
			: null,
		expected_headings: headingsMeasured ? order.length : null,
		expected_keys: keysMeasured ? expected.keys.length : null
	};
}

export function structureOf(
	rows: readonly AuditFileRow[],
	thresholds: StructuralThresholds,
	options: { copies?: ReadonlyMap<string, string> } = {}
): StructureFacts {
	const groups: PeerGroupFacts[] = [];
	const byPath = new Map<string, FileConformance>();
	for (const [group, files] of peerGroups(rows, options)) {
		const expected = expectedStructure(files, thresholds);
		const facts: PeerGroupFacts = {
			group,
			expected,
			headings_expected: 0,
			headings_present: 0,
			keys_expected: 0,
			keys_filled: 0,
			section_files: 0,
			no_empty_section: 0,
			order_ok: 0
		};
		for (const file of files) {
			const c = conformanceOf(file, group, expected);
			byPath.set(file.path, c);
			if (expected.too_few_peers) continue;
			if (c.expected_headings !== null) {
				facts.headings_expected += c.expected_headings;
				facts.headings_present += c.expected_headings - c.expected_missing!.length;
				if (c.heading_order_ok) facts.order_ok += 1;
			}
			if (c.expected_keys !== null) {
				facts.keys_expected += c.expected_keys;
				facts.keys_filled += c.expected_keys - c.keys_unfilled!.length;
			}
			if (file.empty_sections !== null) {
				facts.section_files += 1;
				if (file.empty_sections === 0) facts.no_empty_section += 1;
			}
		}
		groups.push(facts);
	}
	const files = [...rows]
		.sort((a, b) => byText(a.path, b.path))
		.map(
			(row) =>
				byPath.get(row.path) ??
				none(row.path, row.unread || !isAuditChecked(row.role) ? null : peerGroupOf(row))
		);
	return { groups, files };
}
