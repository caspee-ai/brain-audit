import { bodyOf } from '../markdown';
import type { ByobRole } from '../vocabulary/byob';
import { headerValuesOf } from '../byob/access';
import { writtenLinksOf, type FileLink } from '../byob/citations';
import type { Method } from '../method/types';
import { headingOutline, headingSyntaxOf } from '../byob/completeness';
import { isByobMarkdown, isByobNavigationFile, isByobText } from '../byob/dialect';
import { headerAliases } from '../byob/links';
import { normalizeBroughtText } from '../byob/normalize';
import { normalizeHeading } from '../byob/signature';
import { statedDateOf } from './dates';
import { tagCountsOf } from './tags';

export const AUDIT_CHECKED_ROLES: readonly ByobRole[] = ['page', 'unclear'];

export function isAuditChecked(role: ByobRole): boolean {
	return AUDIT_CHECKED_ROLES.includes(role);
}

export type AuditFileInput = {
	path: string;
	body: string | null;
	role: ByobRole;
	type: string | null;
	type_decided?: boolean;
	area: string | null;
	owner_hint: string | null;
	cluster_id: string | null;
	root?: string | null;
	navigation?: boolean;
	citations_out?: number;
};

export type AuditLens = {
	placeholders: readonly string[];
	date_keys: readonly string[];
};

export type AuditHeading = { level: number; text: string };

export type AuditFileFacts = {
	path: string;
	unread: false;
	role: ByobRole;
	type: string | null;
	type_decided: boolean;
	area: string | null;
	owner_hint: string | null;
	cluster_id: string | null;
	navigation: boolean;
	title: string;
	chars: number;
	words: number;
	depth: number;
	headings: AuditHeading[] | null;
	keys: string[] | null;
	keys_filled: string[] | null;
	empty_sections: number | null;
	tags: string[] | null;
	tag_uses: Record<string, number> | null;
	stated_date: string | null;
	citations_out: number | null;
	links: FileLink[];
	link_names: { title: string | null; aliases: string[] };
};

export type AuditUnreadFile = { path: string; unread: true };

export type AuditFileRow = AuditFileFacts | AuditUnreadFile;

const WORDS = new Intl.Segmenter('en', { granularity: 'word' });
const EMPTY_VALUES = new Set(['', '~', 'null', '[]', '{}', '""', "''"]);

export function wordCount(text: string): number {
	let n = 0;
	for (const segment of WORDS.segment(text)) if (segment.isWordLike) n += 1;
	return n;
}

export function isFilledValue(value: string, placeholders: ReadonlySet<string>): boolean {
	const v = value
		.trim()
		.replace(/^(['"])(.*)\1$/, '$2')
		.trim();
	if (EMPTY_VALUES.has(v)) return false;
	const folded = v.toLowerCase();
	return !placeholders.has(folded) && !placeholders.has(`[${folded}]`);
}

export function placeholderSet(tokens: readonly string[]): Set<string> {
	const out = new Set<string>();
	for (const token of tokens) {
		const folded = token.trim().toLowerCase();
		if (!folded) continue;
		out.add(folded);
		const bare = /^\[(.*)\]$/.exec(folded)?.[1]?.trim();
		if (bare) out.add(bare);
	}
	return out;
}

function writtenTitleOf(header: ReadonlyMap<string, readonly string[]>, body: string) {
	const title = header.get('title')?.[0]?.trim();
	if (title) return title;
	return /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1]?.trim() || null;
}

const stemOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

function depthOf(path: string, root: string | null | undefined): number {
	const rel = root && path.startsWith(root) ? path.slice(root.length) : path;
	return rel.split('/').filter((segment) => segment !== '').length - 1;
}

export function extractFileFacts(
	method: Method,
	file: AuditFileInput,
	lens: AuditLens,
	placeholders: ReadonlySet<string> = placeholderSet(lens.placeholders)
): AuditFileRow {
	if (file.body === null) return { path: file.path, unread: true };
	const text = isByobText(file.path) ? normalizeBroughtText(file.path, file.body) : file.body;
	const header = isByobText(file.path) ? headerValuesOf(text) : new Map<string, string[]>();
	const rest = isByobText(file.path) ? bodyOf(text) : text;
	const checked = isAuditChecked(file.role) && isByobText(file.path);
	const syntax = headingSyntaxOf(file.path);
	const outline = checked && syntax ? headingOutline(rest, syntax) : null;
	const keys = checked ? [...header.keys()].sort() : null;
	const written = isByobText(file.path) ? writtenTitleOf(header, rest) : null;
	const tagUses = checked
		? tagCountsOf(header, file.body, { inline: isByobMarkdown(file.path) })
		: null;
	return {
		path: file.path,
		unread: false,
		role: file.role,
		type: file.type,
		type_decided: file.type_decided ?? false,
		area: file.area,
		owner_hint: file.owner_hint,
		cluster_id: file.cluster_id,
		navigation: file.navigation ?? isByobNavigationFile(file.path),
		title: written ?? stemOf(file.path),
		chars: file.body.length,
		words: wordCount(rest),
		depth: depthOf(file.path, file.root),
		headings: outline
			? outline
					.map((h) => ({ level: h.level, text: normalizeHeading(h.text) }))
					.filter((h) => h.text !== '')
			: null,
		keys,
		keys_filled: keys
			? keys.filter((key) => (header.get(key) ?? []).some((v) => isFilledValue(v, placeholders)))
			: null,
		empty_sections: outline ? outline.filter((h) => !h.content).length : null,
		tags: tagUses ? Object.keys(tagUses) : null,
		tag_uses: tagUses,
		stated_date: checked ? statedDateOf(header, lens.date_keys) : null,
		citations_out: checked ? (file.citations_out ?? 0) : null,
		links: isByobText(file.path) ? writtenLinksOf(method, file.path, file.body) : [],
		link_names: {
			title: written,
			aliases: isByobText(file.path) ? headerAliases(header) : []
		}
	};
}

export function citationsOutByFile(
	edges: readonly { from: string; to: string; proof: boolean }[],
	roleOf: (path: string) => ByobRole | undefined
): Map<string, number> {
	const targets = new Map<string, Set<string>>();
	for (const edge of edges) {
		if (!edge.proof || edge.from === edge.to || roleOf(edge.to) !== 'evidence') continue;
		const set = targets.get(edge.from) ?? new Set<string>();
		set.add(edge.to);
		targets.set(edge.from, set);
	}
	return new Map([...targets].map(([from, set]) => [from, set.size]));
}
