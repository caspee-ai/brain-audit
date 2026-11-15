/**
 * The link graph's edges for the sealed pack: which file links which, and which files link
 * each missing target. The structural audit's `linkGraph` resolves every link but keeps only
 * counts; the report needs the edges themselves. This walks the same files with the same
 * resolver, in the same order and with the same rules (copies collapse to their kept file, a
 * self-link reaches nothing, a link that only a file outside the scope has is "outside", a
 * missing name is counted from checked pages only), and records what `linkGraph` counts.
 * Tests hold it to the audit's own counts. Pure.
 */
import { broughtAuditSourceOf, type BroughtAuditInput } from '$lib/brain-audit-core';
import {
	citationsOutByFile,
	extractFileFacts,
	isAuditChecked,
	placeholderSet,
	type AuditFileFacts
} from '$lib/brain-audit-core/audit/extract';
import {
	linkResolver,
	missingNameOf,
	outsideTargets,
	wikiStem
} from '$lib/brain-audit-core/byob/links';

/** `[from path, to path, code]`: 0 resolved, 1 ambiguous (to its first candidate), 2 proof citation. */
export type PathEdge = [string, string, 0 | 1 | 2];

export type LinkEdges = {
	edges: PathEdge[];
	/** Missing target name → how often checked pages link it, and which pages do. */
	missing: { name: string; count: number; from: string[] }[];
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function linkEdgesOf(input: BroughtAuditInput): LinkEdges {
	const source = broughtAuditSourceOf(input);
	const entries = [...source.entries].sort((a, b) => byText(a.path, b.path));
	const roleOf = new Map(entries.map((entry) => [entry.path, entry.role]));
	const copies = new Map(
		entries.flatMap((entry) => (entry.copy_of ? [[entry.path, entry.copy_of] as const] : []))
	);
	const placeholders = placeholderSet(source.lens.placeholders);
	const citations = citationsOutByFile(source.citations, (path) => roleOf.get(path));
	const kept = entries
		.filter((entry) => !copies.has(entry.path))
		.map((entry) =>
			extractFileFacts(
				source.method,
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
		{ aliases: copies, strip: source.strip }
	);
	const outside = outsideTargets(source.outOfScopePaths);

	const seen = new Set<string>();
	const edges: PathEdge[] = [];
	const add = (edge: PathEdge) => {
		const key = edge.join('\u0000');
		if (seen.has(key)) return;
		seen.add(key);
		edges.push(edge);
	};
	const missing = new Map<string, { count: number; from: Set<string> }>();
	for (const row of kept) {
		if (row.unread) continue;
		const facts = row as AuditFileFacts;
		const checked = isAuditChecked(facts.role);
		const ownStem = wikiStem(facts.path);
		for (const { written, link } of facts.links) {
			const result = resolver.resolve(facts.path, link);
			const self =
				result.status === 'resolved'
					? result.to === facts.path
					: !link.path && link.stem === ownStem;
			if (self) continue;
			if (result.status === 'resolved') add([facts.path, result.to, 0]);
			else if (result.status === 'ambiguous') {
				const to = result.candidates[0];
				if (to) add([facts.path, to, 1]);
			} else if (!outside.find(facts.path, link) && checked) {
				const name = missingNameOf(link, written);
				const entry = missing.get(name) ?? { count: 0, from: new Set<string>() };
				entry.count += 1;
				entry.from.add(facts.path);
				missing.set(name, entry);
			}
		}
	}
	const known = new Set(entries.map((entry) => entry.path));
	for (const citation of source.citations)
		if (
			citation.proof &&
			citation.from !== citation.to &&
			known.has(citation.from) &&
			known.has(citation.to)
		)
			add([citation.from, citation.to, 2]);

	edges.sort((a, b) => byText(a[0], b[0]) || byText(a[1], b[1]) || a[2] - b[2]);
	return {
		edges,
		missing: [...missing]
			.map(([name, entry]) => ({ name, count: entry.count, from: [...entry.from].sort(byText) }))
			.sort((a, b) => b.count - a.count || byText(a.name, b.name))
	};
}
