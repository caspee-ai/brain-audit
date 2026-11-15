import type { FileLink } from '../byob/citations';
import { linkResolver, missingNameOf, outsideTargets, wikiStem } from '../byob/links';
import { isAuditChecked, type AuditFileRow } from './extract';

export const LINK_STATUSES = ['resolved', 'ambiguous', 'missing', 'outside'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];
export type LinkStatusCounts = Record<LinkStatus, number>;

export type FileLinkFacts = {
	path: string;
	copy_of: string | null;
	links_out: number;
	links_in: number;
	links_in_nav: number;
	links_in_other: number;
	link_status: LinkStatusCounts;
	cited: boolean;
	is_orphan: boolean | null;
	is_dead_end: boolean | null;
};

export type AreaDensity = { links: number; pages: number };

export type LinkGraph = {
	files: FileLinkFacts[];
	totals: LinkStatusCounts;
	hubs: Record<string, { path: string; links_in: number }[]>;
	missing_targets: { name: string; count: number }[];
	density: { all: AreaDensity; by_area: Record<string, AreaDensity> };
};

export type LinkGraphOptions = {
	copies?: ReadonlyMap<string, string>;
	outOfScopePaths?: readonly string[];
	strip?: readonly string[];
	cited?: ReadonlySet<string>;
};

const zero = (): LinkStatusCounts => ({ resolved: 0, ambiguous: 0, missing: 0, outside: 0 });
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function linkGraph(
	rows: readonly AuditFileRow[],
	options: LinkGraphOptions = {}
): LinkGraph {
	const copies = options.copies ?? new Map<string, string>();
	const sorted = [...rows].sort((a, b) => byPath(a.path, b.path));
	const kept = sorted.filter((row) => !copies.has(row.path));
	const resolver = linkResolver(
		kept.map((row) =>
			row.unread
				? { sourcePath: row.path }
				: {
						sourcePath: row.path,
						title: row.link_names.title,
						aliases: row.link_names.aliases,
						type: row.type
					}
		),
		{ aliases: copies, strip: options.strip }
	);
	const outside = outsideTargets(options.outOfScopePaths ?? []);
	const cited = options.cited ?? new Set<string>();

	type Into = { pages: Set<string>; nav: Set<string>; other: Set<string> };
	const into = new Map<string, Into>();
	const intoOf = (path: string) => {
		let entry = into.get(path);
		if (!entry) {
			entry = { pages: new Set(), nav: new Set(), other: new Set() };
			into.set(path, entry);
		}
		return entry;
	};
	const status = new Map<string, LinkStatusCounts>();
	const reaches = new Set<string>();
	const missingNames = new Map<string, number>();
	const totals = zero();

	for (const row of kept) {
		if (row.unread) continue;
		const counts = zero();
		const checked = isAuditChecked(row.role);
		const add = (s: LinkStatus) => {
			counts[s] += 1;
			if (checked) totals[s] += 1;
		};
		const ownStem = wikiStem(row.path);
		for (const { written, link } of row.links as readonly FileLink[]) {
			const result = resolver.resolve(row.path, link);
			const self =
				result.status === 'resolved' ? result.to === row.path : !link.path && link.stem === ownStem;
			if (self) {
				add('resolved');
				continue;
			}
			if (result.status === 'resolved') {
				add('resolved');
				reaches.add(row.path);
				const entry = intoOf(result.to);
				(row.navigation ? entry.nav : checked ? entry.pages : entry.other).add(row.path);
			} else if (result.status === 'ambiguous') add('ambiguous');
			else if (outside.find(row.path, link)) add('outside');
			else {
				add('missing');
				if (checked) {
					const name = missingNameOf(link, written);
					missingNames.set(name, (missingNames.get(name) ?? 0) + 1);
				}
			}
		}
		status.set(row.path, counts);
	}

	const files: FileLinkFacts[] = sorted.map((row) => {
		const copyOf = copies.get(row.path) ?? null;
		const entry = into.get(row.path);
		const linksIn = copyOf ? 0 : (entry?.pages.size ?? 0);
		const isCited = !copyOf && cited.has(row.path);
		const role = row.unread ? null : row.role;
		const checked = !copyOf && role !== null && isAuditChecked(role);
		return {
			path: row.path,
			copy_of: copyOf,
			links_out: copyOf || row.unread ? 0 : row.links.length,
			links_in: linksIn,
			links_in_nav: copyOf ? 0 : (entry?.nav.size ?? 0),
			links_in_other: copyOf ? 0 : (entry?.other.size ?? 0),
			link_status: status.get(row.path) ?? zero(),
			cited: isCited,
			is_orphan: checked
				? linksIn === 0 && !isCited
				: !copyOf && role === 'evidence'
					? linksIn === 0 && !isCited
					: null,
			is_dead_end: checked ? !reaches.has(row.path) : null
		};
	});

	const hubs: LinkGraph['hubs'] = {};
	const byArea: Record<string, AreaDensity> = {};
	const all: AreaDensity = { links: 0, pages: 0 };
	const rowByPath = new Map(sorted.map((row) => [row.path, row]));
	for (const facts of files) {
		const row = rowByPath.get(facts.path)!;
		if (row.unread || facts.copy_of || !isAuditChecked(row.role)) continue;
		const area = row.area ?? '';
		const density = (byArea[area] ??= { links: 0, pages: 0 });
		density.links += facts.links_out;
		density.pages += 1;
		all.links += facts.links_out;
		all.pages += 1;
		if (facts.links_in > 0)
			(hubs[area] ??= []).push({ path: facts.path, links_in: facts.links_in });
	}
	for (const list of Object.values(hubs))
		list.sort((a, b) => b.links_in - a.links_in || byPath(a.path, b.path));

	return {
		files,
		totals,
		hubs: sortedRecord(hubs),
		missing_targets: [...missingNames]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count || byPath(a.name, b.name)),
		density: { all, by_area: sortedRecord(byArea) }
	};
}

export function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
	return Object.fromEntries(
		Object.keys(record)
			.sort(byPath)
			.map((key) => [key, record[key]!])
	);
}
