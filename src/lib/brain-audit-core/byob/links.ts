import { namedPath, shortHash, transliterate, withoutNotionId } from './names';
import { personSlug } from './person-keys';
import { strippedPath } from './scope';
import { UUID_PATTERN } from '$lib/shared/uuid';

export type LinkFile = {
	sourcePath: string;
	title?: string | null;
	aliases?: readonly string[];
	type?: string | null;
};

export type WrittenLink = {
	path: string | null;
	stem: string | null;
	anchor: string | null;
	name?: string | null;
};

export type LinkResolution =
	| { status: 'resolved'; to: string; anchor: string | null; rule: 1 | 2 | 3 | 4 | 5 }
	| { status: 'ambiguous'; candidates: string[] }
	| { status: 'missing' };

const MARKDOWN = /\.(md|markdown|mdx)$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function resolveRepoPath(sourcePath: string, href: string): string | null {
	const slash = sourcePath.lastIndexOf('/');
	const dir = slash >= 0 ? sourcePath.slice(0, slash + 1) : '';
	let decoded = href;
	try {
		decoded = decodeURIComponent(href);
	} catch {
	}
	const out: string[] = [];
	for (const segment of (decoded.startsWith('/') ? decoded : `${dir}${decoded}`).split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			if (out.length === 0) return null;
			out.pop();
			continue;
		}
		out.push(segment);
	}
	return out.length > 0 ? out.join('/') : null;
}

export function wikiStem(name: string): string {
	const base = withoutNotionId(
		name.split('#')[0]!.trim().replace(/^.*\//, '').replace(MARKDOWN, '')
	).name;
	const slug = personSlug(transliterate(base));
	if (slug !== '' || base.trim() === '') return slug;
	return `u-${shortHash(base.normalize('NFC').trim().toLowerCase())}`;
}

const stemOfPath = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(MARKDOWN, '');

function namespaceKey(path: string): string {
	return path
		.replace(MARKDOWN, '')
		.split('/')
		.map((segment) => wikiStem(segment))
		.filter(Boolean)
		.join('/');
}

export function anchorSlug(anchor: string | null | undefined): string | null {
	const slug = (anchor ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '');
	return slug === '' ? null : slug;
}

export function writtenPath(href: string): WrittenLink | null {
	const clean = href.trim();
	if (clean === '' || clean.startsWith('#') || URL_SCHEME.test(clean)) return null;
	const hash = clean.indexOf('#');
	return {
		path: hash >= 0 ? clean.slice(0, hash) : clean,
		stem: null,
		anchor: hash >= 0 ? clean.slice(hash + 1) : null
	};
}

const ORG_FILE_LINK = /\[\[file:([^\]\n]+?)(?:::[^\]\n]*)?\](?:\[([^\]\n]*)\])?\]/g;
const RST_LINK = /`([^`<\n]*?)\s*<([^`<>\n]+)>`__?/g;
const ADOC_LINK = /(?<![\w:/])(?:xref|link):([^\s[\]]+)\[([^\]\n]*)\]/g;

export function plainTextLinksOf(
	sourcePath: string,
	body: string
): { text: string; href: string }[] {
	const pattern = /\.org$/i.test(sourcePath)
		? ORG_FILE_LINK
		: /\.rst$/i.test(sourcePath)
			? RST_LINK
			: /\.(adoc|asciidoc)$/i.test(sourcePath)
				? ADOC_LINK
				: null;
	if (!pattern) return [];
	const out: { text: string; href: string }[] = [];
	for (const m of body.matchAll(pattern)) {
		const [href, label] = pattern === RST_LINK ? [m[2]!, m[1]!] : [m[1]!, m[2] ?? ''];
		const clean = href.trim();
		if (!writtenPath(clean)) continue;
		out.push({ text: label.trim() || clean, href: clean });
	}
	return out;
}

export const WIKI_LINK_OR_EMBED = /!?\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;
const NON_PAGE_FILE = /\.(?!md$|markdown$|mdx$)[a-z0-9]{1,5}$/i;

export function isFileEmbed(match: string, name: string): boolean {
	return match.startsWith('!') && NON_PAGE_FILE.test(name.split(/[#|]/)[0]!.trim());
}

export function writtenWiki(name: string): WrittenLink | null {
	const hash = name.indexOf('#');
	const base = (hash >= 0 ? name.slice(0, hash) : name).trim();
	if (base === '') return null;
	return {
		path: base.includes('/') ? base : null,
		stem: wikiStem(base) || null,
		anchor: hash >= 0 && !name.slice(hash + 1).startsWith('^') ? name.slice(hash + 1) : null,
		name: base.replace(/^.*\//, '').replace(MARKDOWN, '')
	};
}

const fold = (text: string) =>
	text
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

export type LinkResolver = {
	resolve(from: string, link: WrittenLink, targetType?: string | null): LinkResolution;
	has(path: string): string | null;
};

export function linkResolver(
	files: readonly LinkFile[],
	options: {
		aliases?: ReadonlyMap<string, string>;
		strip?: readonly string[];
		tool?: string | null;
	} = {}
): LinkResolver {
	const strip = options.strip ?? [];
	const byLower = new Map<string, string>();
	const byStem = new Map<string, string[]>();
	const byNamespace = new Map<string, string[]>();
	const byTitle = new Map<string, string[]>();
	const typeOf = new Map<string, string | null>();
	const add = <K>(map: Map<K, string[]>, key: K, path: string) => {
		const hits = map.get(key) ?? [];
		if (!hits.includes(path)) map.set(key, [...hits, path]);
	};
	for (const file of files) {
		byLower.set(file.sourcePath.toLowerCase(), file.sourcePath);
		typeOf.set(file.sourcePath, file.type ?? null);
		if (!MARKDOWN.test(file.sourcePath)) continue;
		const stem = wikiStem(file.sourcePath);
		if (stem) add(byStem, stem, file.sourcePath);
		const named = namedPath(stemOfPath(file.sourcePath), options.tool ?? null);
		const nameStem = wikiStem(named.name);
		if (nameStem && nameStem !== stem) add(byStem, nameStem, file.sourcePath);
		if (named.folders.length > 0)
			add(byNamespace, namespaceKey([...named.folders, named.name].join('/')), file.sourcePath);
		for (const name of [file.title ?? '', ...(file.aliases ?? [])]) {
			const key = fold(name);
			if (key) add(byTitle, key, file.sourcePath);
		}
	}
	for (const [copy, kept] of options.aliases ?? new Map<string, string>()) {
		if (!byLower.has(kept.toLowerCase())) continue;
		byLower.set(copy.toLowerCase(), kept);
		const stem = MARKDOWN.test(copy) ? wikiStem(copy) : '';
		if (stem) add(byStem, stem, kept);
	}
	const known = (candidate: string | null) =>
		candidate ? (byLower.get(candidate.toLowerCase()) ?? null) : null;
	const byPath = (from: string, path: string): string | null => {
		const tries = MARKDOWN.test(path) || /\.[a-z0-9]+$/i.test(path) ? [path] : [path, `${path}.md`];
		for (const written of tries) {
			const relative = known(resolveRepoPath(from, written));
			if (relative) return relative;
			if (!written.startsWith('.')) {
				const rooted = known(resolveRepoPath('', written));
				if (rooted) return rooted;
			}
		}
		return null;
	};
	const topOf = (path: string) => {
		const rest = strippedPath(path, strip);
		const slash = rest.indexOf('/');
		return slash >= 0 ? rest.slice(0, slash + 1) : '';
	};
	return {
		has: (path) => known(path),
		resolve(from, link, targetType) {
			const anchor = anchorSlug(link.anchor);
			if (link.path) {
				const to = byPath(from, link.path);
				if (to) return { status: 'resolved', to, anchor, rule: 1 };
				const named = (byNamespace.get(namespaceKey(link.path)) ?? []).filter(
					(path) => path !== from
				);
				if (named.length === 1) return { status: 'resolved', to: named[0]!, anchor, rule: 1 };
			}
			if (!link.stem) return { status: 'missing' };
			let candidates = (byStem.get(link.stem) ?? []).filter((path) => path !== from);
			if (candidates.length === 1)
				return { status: 'resolved', to: candidates[0]!, anchor, rule: 2 };
			if (candidates.length > 1) {
				const root = topOf(from);
				const sameRoot = candidates.filter((path) => topOf(path) === root);
				if (sameRoot.length === 1) return { status: 'resolved', to: sameRoot[0]!, anchor, rule: 3 };
				if (sameRoot.length > 1) candidates = sameRoot;
				if (targetType) {
					const typed = candidates.filter((path) => typeOf.get(path) === targetType);
					if (typed.length === 1) return { status: 'resolved', to: typed[0]!, anchor, rule: 4 };
					if (typed.length > 1) candidates = typed;
				}
				return { status: 'ambiguous', candidates: [...candidates].sort() };
			}
			const titled = (byTitle.get(fold(link.name ?? link.stem.replace(/-/g, ' '))) ?? []).filter(
				(path) => path !== from
			);
			if (titled.length === 1) return { status: 'resolved', to: titled[0]!, anchor, rule: 5 };
			if (titled.length > 1) return { status: 'ambiguous', candidates: [...titled].sort() };
			return { status: 'missing' };
		}
	};
}

export type OutsideFolder = { folder: string; files: number; targets: number; links: number };

export type LinkSummary = {
	resolved: number;
	ambiguous: number;
	missing: number;
	outside: number;
	ambiguousSample: { from: string; written: string; candidates: string[] }[];
	outsideFolders: OutsideFolder[];
	missingNames: { name: string; count: number }[];
};

export const LINK_SAMPLE_MAX = 50;
export const OUTSIDE_OFFER_TARGETS_MIN = 10;

export function outsideTargets(outOfScopePaths: readonly string[]): {
	find(from: string, link: WrittenLink | null): string | undefined;
} {
	const byLower = new Map(outOfScopePaths.map((path) => [path.toLowerCase(), path]));
	const byStem = new Map<string, string[]>();
	for (const path of outOfScopePaths) {
		if (!MARKDOWN.test(path)) continue;
		const stem = wikiStem(path);
		if (stem) byStem.set(stem, [...(byStem.get(stem) ?? []), path]);
	}
	return {
		find(from, link) {
			let found: string | undefined;
			if (link?.path)
				for (const written of MARKDOWN.test(link.path)
					? [link.path]
					: [link.path, `${link.path}.md`]) {
					found =
						byLower.get((resolveRepoPath(from, written) ?? '').toLowerCase()) ??
						byLower.get((resolveRepoPath('', written) ?? '').toLowerCase());
					if (found) break;
				}
			if (!found && link?.stem) found = byStem.get(link.stem)?.[0];
			return found;
		}
	};
}

export function writtenLinkOf(written: string): WrittenLink | null {
	const wiki = /^\[\[(.*)\]\]$/.exec(written);
	return wiki ? writtenWiki(wiki[1]!) : writtenPath(written);
}

export function missingNameOf(link: WrittenLink | null, written: string): string {
	return link?.stem ?? link?.path ?? written;
}

export function summarizeLinks(
	report: {
		resolved: number;
		ambiguous: { from: string; written: string; candidates: string[] }[];
		missing: { from: string; written: string }[];
	},
	outOfScopePaths: readonly string[]
): LinkSummary {
	const targets = outsideTargets(outOfScopePaths);
	const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
	const outside = new Map<string, { targets: Set<string>; links: number }>();
	const names = new Map<string, number>();
	let outsideCount = 0;
	for (const miss of report.missing) {
		const link = writtenLinkOf(miss.written);
		const found = targets.find(miss.from, link);
		if (found) {
			outsideCount += 1;
			const entry = outside.get(folderOf(found)) ?? { targets: new Set<string>(), links: 0 };
			entry.targets.add(found);
			entry.links += 1;
			outside.set(folderOf(found), entry);
			continue;
		}
		const name = missingNameOf(link, miss.written);
		names.set(name, (names.get(name) ?? 0) + 1);
	}
	return {
		resolved: report.resolved,
		ambiguous: report.ambiguous.length,
		missing: report.missing.length - outsideCount,
		outside: outsideCount,
		ambiguousSample: report.ambiguous.slice(0, LINK_SAMPLE_MAX),
		outsideFolders: [...outside]
			.map(([folder, entry]) => ({
				folder,
				files: outOfScopePaths.filter((path) => path.startsWith(folder)).length,
				targets: entry.targets.size,
				links: entry.links
			}))
			.sort((a, b) => b.targets - a.targets || (a.folder < b.folder ? -1 : 1)),
		missingNames: [...names]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
			.slice(0, LINK_SAMPLE_MAX)
	};
}

const BLOCK_ID_LINE = new RegExp(String.raw`^\s*(?:[-*]\s+)?id::\s*(${UUID_PATTERN})\s*$`, 'gim');
const BLOCK_REF = new RegExp(String.raw`\(\((${UUID_PATTERN})\)\)`, 'gi');

export function resolveBlockRefs<F extends { sourcePath: string; body: string }>(
	files: readonly F[]
): F[] {
	const holder = new Map<string, string>();
	for (const file of files)
		for (const match of file.body.matchAll(BLOCK_ID_LINE))
			holder.set(match[1]!.toLowerCase(), file.sourcePath);
	if (holder.size === 0) return [...files];
	return files.map((file) => {
		if (!BLOCK_REF.test(file.body)) return file;
		BLOCK_REF.lastIndex = 0;
		const body = file.body.replace(BLOCK_REF, (match, id: string) => {
			const path = holder.get(id.toLowerCase());
			if (!path || path === file.sourcePath) return match;
			const stem = path.slice(path.lastIndexOf('/') + 1).replace(MARKDOWN, '');
			return `[[${path.includes('/') ? path.replace(MARKDOWN, '') : stem}]]`;
		});
		return { ...file, body };
	});
}

export function pageEmbedsAsLinks(line: string): string {
	if (!line.includes('![[')) return line;
	return line.replace(WIKI_LINK_OR_EMBED, (match, name: string) =>
		match.startsWith('!') && !isFileEmbed(match, name) ? match.slice(1) : match
	);
}

export function headerAliases(header: ReadonlyMap<string, readonly string[]>): string[] {
	return cleanAliases([...(header.get('aliases') ?? []), ...(header.get('alias') ?? [])]);
}

export function cleanAliases(values: readonly string[]): string[] {
	const out: string[] = [];
	for (const raw of values) {
		const name = raw
			.trim()
			.replace(/^\[\[(.*)\]\]$/, '$1')
			.trim();
		if (!name || name.startsWith('/') || name.includes('://') || /\.(html?|mdx?)$/i.test(name))
			continue;
		if (!out.includes(name)) out.push(name);
	}
	return out;
}
