import { bodyOf, FRONTMATTER } from '../markdown';
import { isEvidenceFolderPath } from './tool';
import { headerValuesOf } from './access';
import { isByobPlainText, isByobText } from './dialect';
import type { Method } from '../method/types';
import { rulesOf } from '../method/rules';
import {
	headerAliases,
	linkResolver,
	pageEmbedsAsLinks,
	plainTextLinksOf,
	writtenPath,
	writtenWiki,
	type LinkResolution,
	type WrittenLink
} from './links';

export type CitationKind = 'link' | 'wiki' | 'path' | 'header' | 'claim';

export type CitationClaim = { claim_id: string | null; section: string | null; text: string };

export type Citation = {
	from: string;
	to: string;
	kind: CitationKind;
	proof: boolean;
	claim?: CitationClaim;
	note?: string;
};

export type InlineClaim = {
	from: string;
	text: string;
	cites: ({ path: string } | { url: string } | { note: string })[];
};

export type LinkReport = {
	resolved: number;
	ambiguous: { from: string; written: string; candidates: string[] }[];
	missing: { from: string; written: string }[];
};

export const PROOF_KEYS = new Set([
	'source',
	'source_file',
	'sources',
	'evidence',
	'provenance',
	'basis',
	'authority',
	'ruling',
	'capture',
	'citations'
]);

export const MD_LINK = /(?<!!)\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\)/g;
export const WIKI_LINK = /(?<!!)\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const FENCE = /^\s*(```|~~~)/;
const CODED_LINK = /`[^`\n]*(?:\[\[|\]\(|\(source:)[^`\n]*`/gi;

export function withoutCodedLinks(line: string): string {
	return line.replace(CODED_LINK, (code) => ' '.repeat(code.length));
}
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const PROOF_HEADING = /^(sources?|provenance|evidence|references?|citations?|bibliography)\b/i;
const BARE_PATH =
	/(?<![\w/.:@~-])((?:\.\.?\/)*(?:[\w.@-]+\/)*[\w.@-]+\.(?:md|markdown|mdx|ya?ml|json|csv|tsv|txt|text|org|rst|adoc|asciidoc|toml|xml))(?![\w/-])/gi;
const YAML_FILE = /\.ya?ml$/i;

export type CitationFile = { sourcePath: string; body: string };

type Resolver = {
	path(from: string, written: string): string | null;
	wiki(from: string, name: string): string | null;
	bare(from: string, written: string): string | null;
};

type Seen = (from: string, written: string, result: LinkResolution) => void;

function titleOf(body: string): string | null {
	const header = headerValuesOf(body);
	const title = header.get('title')?.[0];
	if (title) return title;
	const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(bodyOf(body));
	return h1 ? h1[1]!.trim() : null;
}

function resolverOf(
	files: readonly CitationFile[],
	aliases: ReadonlyMap<string, string> = new Map(),
	seen: Seen = () => {},
	strip: readonly string[] = [],
	tool: string | null = null
): Resolver {
	const links = linkResolver(
		files.map((file) => ({
			sourcePath: file.sourcePath,
			title: isByobText(file.sourcePath) ? titleOf(file.body) : null,
			aliases: isByobText(file.sourcePath) ? headerAliases(headerValuesOf(file.body)) : []
		})),
		{ aliases, strip, tool }
	);
	const to = (from: string, written: string, result: LinkResolution) => {
		seen(from, written, result);
		return result.status === 'resolved' ? result.to : null;
	};
	return {
		path(from, written) {
			const link = writtenPath(written);
			return link ? to(from, written, links.resolve(from, link)) : null;
		},
		wiki(from, name) {
			const link = writtenWiki(name);
			return link ? to(from, `[[${name}]]`, links.resolve(from, link)) : null;
		},
		bare(from, written) {
			const link = writtenPath(written);
			const result = link ? links.resolve(from, { ...link, stem: null }) : null;
			return result?.status === 'resolved' ? result.to : null;
		}
	};
}

function barePaths(from: string, text: string, resolve: Resolver): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(BARE_PATH)) {
		const to = resolve.bare(from, m[1]!);
		if (to && to !== from) out.push(to);
	}
	return out;
}

function yamlCitations(
	from: string,
	text: string,
	resolve: Resolver,
	comments: boolean
): { to: string; kind: CitationKind }[] {
	const out: { to: string; kind: CitationKind }[] = [];
	let block: { indent: number } | null = null;
	for (const line of text.split(/\r?\n/)) {
		if (line.trim() === '') continue;
		const indent = line.length - line.trimStart().length;
		const hash = commentStart(line);
		const content = hash >= 0 ? line.slice(0, hash) : line;
		if (hash >= 0 && comments)
			for (const to of barePaths(from, line.slice(hash + 1), resolve))
				out.push({ to, kind: 'path' });
		if (content.trim() === '') continue;
		if (block && indent > block.indent) {
			for (const to of barePaths(from, content, resolve)) out.push({ to, kind: 'header' });
			continue;
		}
		block = null;
		const keyed = [...content.matchAll(/(?:^|[\s{,-])([A-Za-z_][\w-]*):(?:\s+|$)/g)];
		for (const [i, m] of keyed.entries()) {
			if (!PROOF_KEYS.has(m[1]!.toLowerCase())) continue;
			const start = m.index! + m[0].length;
			const end = keyed[i + 1]?.index ?? content.length;
			const value = content.slice(start, end);
			if (value.trim() === '' && i === keyed.length - 1) block = { indent };
			for (const to of barePaths(from, value, resolve)) out.push({ to, kind: 'header' });
		}
	}
	return out;
}

function commentStart(line: string): number {
	let quote: string | null = null;
	for (let i = 0; i < line.length; i += 1) {
		const c = line[i]!;
		if (quote) {
			if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'") quote = c;
		else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return i;
	}
	return -1;
}

const CITE_PAREN = /\(\s*sources?\s*:\s*((?:[^()]|\([^()]*\))*)\)/gi;
const CITE_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?sources?(?:\*\*|__)?\s*:\s*(.+)$/i;
const FOOTNOTE_DEF = /^\s*\[\^([^\]\s]+)\]:\s*(.+)$/;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\](?!:)/g;
const URL = /\bhttps?:\/\/[^\s)>\]]+/gi;
export const CLAIM_TEXT_MAX = 200;

function plainLine(line: string): string {
	return line
		.replace(MD_LINK, (_m, label: string) => label)
		.replace(WIKI_LINK, (_m, name: string, label?: string) => label ?? name)
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
		.replace(/[*_`]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function bodyCitations(
	from: string,
	text: string,
	resolve: Resolver,
	claims: InlineClaim[]
): Citation[] {
	const out: Citation[] = [];
	const lines = text.split('\n');
	const footnoteClaims = new Map<string, string>();
	let inFence = false;
	for (const line of lines) {
		if (FENCE.test(line)) inFence = !inFence;
		if (inFence || FOOTNOTE_DEF.test(line)) continue;
		for (const m of line.matchAll(FOOTNOTE_REF))
			if (!footnoteClaims.has(m[1]!))
				footnoteClaims.set(m[1]!, plainLine(line.replace(FOOTNOTE_REF, '')));
	}
	const cite = (citation: string, claimText: string, section: string | null) => {
		const cites: InlineClaim['cites'] = [];
		const claim: CitationClaim = {
			claim_id: null,
			section,
			text: claimText.slice(0, CLAIM_TEXT_MAX)
		};
		const edge = (to: string | null, kind: CitationKind) => {
			if (!to || to === from) return;
			out.push({ from, to, kind, proof: true, claim });
			cites.push({ path: to });
		};
		let rest = citation
			.replace(MD_LINK, (_m, _label: string, angled?: string, bare?: string) => {
				const href = (angled ?? bare ?? '').trim();
				if (URL_SCHEME.test(href)) cites.push({ url: href });
				else edge(resolve.path(from, href), 'link');
				return ' ';
			})
			.replace(WIKI_LINK, (_m, name: string) => {
				edge(resolve.wiki(from, name), 'wiki');
				return ' ';
			})
			.replace(URL, (url) => {
				cites.push({ url });
				return ' ';
			});
		for (const m of rest.matchAll(BARE_PATH)) edge(resolve.bare(from, m[1]!), 'path');
		rest = rest.replace(BARE_PATH, ' ');
		const note = rest
			.replace(/\s+/g, ' ')
			.replace(/^[\s,;.:—–-]+|[\s,;.:—–-]+$/g, '')
			.trim();
		if (note !== '') {
			cites.push({ note });
			for (const c of out) if (c.claim === claim) c.note = note;
		}
		if (cites.length > 0) claims.push({ from, text: claim.text, cites });
	};
	inFence = false;
	let proofLevel: number | null = null;
	let section: string | null = null;
	let previous = '';
	for (const raw of lines) {
		if (FENCE.test(raw)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const line = pageEmbedsAsLinks(withoutCodedLinks(raw));
		const heading = HEADING.exec(line);
		if (heading) {
			const level = heading[1]!.length;
			if (proofLevel !== null && level <= proofLevel) proofLevel = null;
			const title = heading[2]!.replace(/[*_`]/g, '').trim();
			if (PROOF_HEADING.test(title)) proofLevel = level;
			section = title;
		}
		const proofSection = proofLevel !== null;
		let body = line;
		const footnote = FOOTNOTE_DEF.exec(line);
		const citeLine = CITE_LINE.exec(line);
		if (footnote) {
			cite(footnote[2]!, footnoteClaims.get(footnote[1]!) ?? '', section);
			body = '';
		} else if (citeLine && !proofSection) {
			cite(citeLine[1]!, previous, section);
			body = '';
		} else {
			const parens = [...line.matchAll(CITE_PAREN)];
			if (parens.length > 0) {
				const claimText = plainLine(line.replace(CITE_PAREN, ''));
				for (const m of parens) cite(m[1]!, claimText, section);
				body = line.replace(CITE_PAREN, ' ');
			}
		}
		if (line.trim() !== '' && !heading) previous = plainLine(line.replace(CITE_PAREN, ''));
		const rest = body
			.replace(MD_LINK, (_match, label: string, angled?: string, bare?: string) => {
				const href = (angled ?? bare ?? '').trim();
				if (href && !href.startsWith('#') && !URL_SCHEME.test(href)) {
					const to = resolve.path(from, href);
					if (to && to !== from) out.push({ from, to, kind: 'link', proof: proofSection });
				}
				return ` ${label} `;
			})
			.replace(WIKI_LINK, (_match, name: string, label?: string) => {
				const to = resolve.wiki(from, name);
				if (to && to !== from) out.push({ from, to, kind: 'wiki', proof: proofSection });
				return ` ${label ?? ''} `;
			});
		for (const to of barePaths(from, rest, resolve))
			out.push({ from, to, kind: 'path', proof: true });
	}
	return out;
}

function headerLinks(from: string, header: string, resolve: Resolver): Citation[] {
	const out: Citation[] = [];
	for (const line of header.split(/\r?\n/)) {
		const key = /^\s*-?\s*([A-Za-z_][\w-]*)\s*:/.exec(line)?.[1]?.toLowerCase();
		if (key && PROOF_KEYS.has(key)) continue;
		for (const m of line.matchAll(WIKI_LINK)) {
			const to = resolve.wiki(from, m[1]!);
			if (to && to !== from) out.push({ from, to, kind: 'header', proof: false });
		}
		for (const m of line.matchAll(MD_LINK)) {
			const href = (m[2] ?? m[3] ?? '').trim();
			if (!href || URL_SCHEME.test(href)) continue;
			const to = resolve.path(from, href);
			if (to && to !== from) out.push({ from, to, kind: 'header', proof: false });
		}
	}
	return out;
}

export type FileLink = { written: string; link: WrittenLink };

export function writtenLinksOf(method: Method, sourcePath: string, body: string): FileLink[] {
	if (!isByobText(sourcePath) || rulesOf(method).claimMap.test(sourcePath)) return [];
	const text = body.replace(/^\uFEFF/, '');
	const out: FileLink[] = [];
	const push = (written: string, link: WrittenLink | null) => {
		if (link) out.push({ written, link });
	};
	const scan = (line: string) => {
		for (const m of line.matchAll(MD_LINK)) {
			const href = (m[2] ?? m[3] ?? '').trim();
			if (!href || URL_SCHEME.test(href)) continue;
			push(href, writtenPath(href));
		}
		for (const m of line.matchAll(WIKI_LINK)) push(`[[${m[1]!}]]`, writtenWiki(m[1]!));
	};
	const header = FRONTMATTER.exec(text);
	if (header)
		for (const line of header[1]!.split(/\r?\n/)) {
			const key = /^\s*-?\s*([A-Za-z_][\w-]*)\s*:/.exec(line)?.[1]?.toLowerCase();
			if (key && PROOF_KEYS.has(key)) continue;
			scan(line);
		}
	const rest = header ? text.slice(header[0].length) : text;
	if (isByobPlainText(sourcePath)) {
		for (const link of plainTextLinksOf(sourcePath, rest)) push(link.href, writtenPath(link.href));
		return out;
	}
	let inFence = false;
	for (const raw of rest.split('\n')) {
		if (FENCE.test(raw)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		scan(pageEmbedsAsLinks(withoutCodedLinks(raw)));
	}
	return out;
}

function stringOf(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function claimMapOf(
	text: string
): { page: string | null; claims: (CitationClaim & { evidence: string[] })[] } | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	const claims = Array.isArray(record.claims) ? record.claims : [];
	return {
		page: stringOf(record.page),
		claims: claims.flatMap((value) => {
			if (!value || typeof value !== 'object') return [];
			const c = value as Record<string, unknown>;
			const evidence = [
				...(Array.isArray(c.evidence) ? c.evidence : [c.evidence]),
				...(Array.isArray(c.ruling) ? c.ruling : [c.ruling])
			].flatMap((e) => (stringOf(e) ? [stringOf(e)!] : []));
			return [
				{
					claim_id: stringOf(c.claim_id),
					section: stringOf(c.section),
					text: stringOf(c.text) ?? '',
					evidence
				}
			];
		})
	};
}

export function claimMapPageOf(method: Method, sourcePath: string, text: string): string {
	return claimMapOf(text)?.page ?? sourcePath.replace(rulesOf(method).claimMap, '');
}

function fileCitations(
	file: CitationFile,
	resolve: Resolver,
	claims: InlineClaim[],
	claimMap: RegExp
): Citation[] {
	const from = file.sourcePath;
	const text = file.body.replace(/^\uFEFF/, '');
	if (claimMap.test(from)) {
		const map = claimMapOf(text);
		if (!map) return [];
		return map.claims.flatMap((claim) =>
			claim.evidence.flatMap((written) => {
				const to = resolve.bare(from, written.split('#')[0]!.trim());
				const rest: CitationClaim = {
					claim_id: claim.claim_id,
					section: claim.section,
					text: claim.text
				};
				return to && to !== from
					? [{ from, to, kind: 'claim' as const, proof: true, claim: rest }]
					: [];
			})
		);
	}
	if (YAML_FILE.test(from))
		return yamlCitations(from, text, resolve, true).map((c) => ({ from, ...c, proof: true }));
	if (!isByobText(from)) return [];
	const header = FRONTMATTER.exec(text);
	const out: Citation[] = header
		? [
				...yamlCitations(from, header[1]!, resolve, false).map((c) => ({
					from,
					...c,
					proof: true
				})),
				...headerLinks(from, header[1]!, resolve)
			]
		: [];
	const body = header ? text.slice(header[0].length) : text;
	if (isByobPlainText(from)) {
		for (const link of plainTextLinksOf(from, body)) {
			const to = resolve.path(from, link.href);
			if (to && to !== from) out.push({ from, to, kind: 'link', proof: false });
		}
		return out;
	}
	out.push(...bodyCitations(from, body, resolve, claims));
	return out;
}

export function citationGraph(
	files: readonly CitationFile[],
	options: {
		method: Method;
		aliases?: ReadonlyMap<string, string>;
		strip?: readonly string[];
		tool?: string | null;
	}
): Citation[] {
	return citationReport(files, options).edges;
}

export function citationReport(
	files: readonly CitationFile[],
	options: {
		method: Method;
		aliases?: ReadonlyMap<string, string>;
		strip?: readonly string[];
		tool?: string | null;
		extraProof?: (to: string, from: string) => boolean;
	}
): { edges: Citation[]; claims: InlineClaim[]; links: LinkReport } {
	const links: LinkReport = { resolved: 0, ambiguous: [], missing: [] };
	const resolve = resolverOf(
		files,
		options.aliases,
		(from, written, result) => {
			if (result.status === 'resolved') links.resolved += 1;
			else if (result.status === 'ambiguous')
				links.ambiguous.push({ from, written, candidates: result.candidates });
			else links.missing.push({ from, written });
		},
		options.strip,
		options.tool ?? null
	);
	const claims: InlineClaim[] = [];
	const kept = new Map<string, Citation>();
	const claimMap = rulesOf(options.method).claimMap;
	for (const file of files)
		for (const edge of fileCitations(file, resolve, claims, claimMap)) {
			const key = `${edge.from}\u0000${edge.to}\u0000${edge.claim?.claim_id ?? edge.claim?.text ?? ''}`;
			const before = kept.get(key);
			if (!before || (!before.proof && edge.proof)) kept.set(key, edge);
		}
	for (const [key, edge] of kept)
		if (
			!edge.proof &&
			(edge.kind === 'link' || edge.kind === 'wiki') &&
			isEvidenceFolderPath(edge.to) &&
			!isEvidenceFolderPath(edge.from)
		)
			kept.set(key, { ...edge, proof: true });
	const edges = [...kept.values()];
	return {
		edges: options.extraProof ? withExtraProof(edges, options.extraProof) : edges,
		claims,
		links
	};
}

export function withExtraProof(
	edges: readonly Citation[],
	extraProof: (to: string, from: string) => boolean
): Citation[] {
	return edges.map((edge) =>
		!edge.proof && (edge.kind === 'link' || edge.kind === 'wiki') && extraProof(edge.to, edge.from)
			? { ...edge, proof: true }
			: edge
	);
}

export function proofCitersByTarget(edges: readonly Citation[]): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const edge of edges) {
		if (!edge.proof) continue;
		const set = out.get(edge.to) ?? new Set<string>();
		set.add(edge.from);
		out.set(edge.to, set);
	}
	return out;
}
