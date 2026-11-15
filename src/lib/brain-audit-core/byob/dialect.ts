import { headerValuesOf } from './access';
import { isPeopleRegistryPath, parsePeopleRegistry } from './people-registry';
import type { ByobDialect, ByobFile } from './types';
import { bodyOf } from '../markdown';
import type { Method } from '../method/types';
import { rulesOf } from '../method/rules';

const KIT_DIALECT_MIN_FOLDERS = 3;

const MARKDOWN_EXT = /\.(md|markdown|mdx)$/i;
const PLAIN_TEXT_EXT = /\.(txt|text|org|rst|adoc|asciidoc)$/i;
const NAVIGATION_NAME = /^(readme|index|_index)\.(md|markdown|mdx)$/i;

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

export function detectByobDialect(method: Method, paths: readonly string[]): ByobDialect {
	const rules = rulesOf(method);
	const topFolders = new Set<string>();
	for (const path of paths) {
		const lower = path.toLowerCase();
		if (rules.kitMarkerFiles.has(lower)) return 'kit';
		const slash = lower.indexOf('/');
		if (slash > 0 && MARKDOWN_EXT.test(lower)) topFolders.add(lower.slice(0, slash));
	}
	const kitFolders = rules.kitFolders.filter((folder) => topFolders.has(folder)).length;
	return kitFolders >= KIT_DIALECT_MIN_FOLDERS ? 'kit' : 'generic';
}

export function isByobMarkdown(path: string): boolean {
	return MARKDOWN_EXT.test(path);
}

export function isByobText(path: string): boolean {
	return MARKDOWN_EXT.test(path) || PLAIN_TEXT_EXT.test(path);
}

export function isByobPlainText(path: string): boolean {
	return PLAIN_TEXT_EXT.test(path);
}

export function isByobNavigationFile(path: string): boolean {
	return NAVIGATION_NAME.test(baseName(path));
}

export function isByobSidecar(method: Method, path: string): boolean {
	return rulesOf(method).sidecarName.test(baseName(path));
}

export type DialectStatus = 'draft' | 'current' | 'superseded';
export type DialectAccess = 'everyone' | 'members' | 'restricted';

export type ByobDialectProfile = {
	statuses: Record<string, DialectStatus>;
	placeholders: string[];
	access: Record<string, DialectAccess>;
	registryFiles: string[];
	jargon: Record<string, string>;
};

export type DialectToken = {
	token: string;
	files: number;
	where: { path: string; title: string }[];
	snippets: string[];
};

export type DialectStats = {
	values: Record<string, { value: string; files: number }[]>;
	placeholders: DialectToken[];
	registryFiles: string[];
	stages: DialectToken[];
};

const VALUES_KEPT = 12;
const TOKENS_KEPT = 12;
const BRACKET = /(?<![[!])\[(?![\s^xX ]\])([^[\]\n]{2,60})\](?![([])/g;
const PLACEHOLDER_WORDS =
	/\b(tbd|tbc|todo|to be (?:bound|filled|confirmed|decided|added|written)|placeholder|fill in|pending|xxx|unknown|n\/a)\b/i;
const BARE_PLACEHOLDER = /(?<![\w[])(TBD|TBC|TODO|XXX|\?\?\?)(?![\w\]])/g;
const STAGE = /\b(B\d{1,2}|GATE \d{1,2}|Gate \d{1,2}|Phase \d{1,2})\b/g;

function titleOfFile(file: ByobFile): string {
	return (
		/^#\s+(.+?)\s*#*\s*$/m.exec(file.body)?.[1]?.trim() ??
		file.sourcePath.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
	);
}

function snippetAt(text: string, index: number, length: number): string {
	const start = Math.max(0, index - 60);
	const end = Math.min(text.length, index + length + 60);
	return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

function tokenCounter() {
	const byToken = new Map<string, DialectToken & { seen: Set<string> }>();
	return {
		add(token: string, file: ByobFile, text: string, index: number) {
			const entry =
				byToken.get(token) ??
				({ token, files: 0, where: [], snippets: [], seen: new Set<string>() } as DialectToken & {
					seen: Set<string>;
				});
			byToken.set(token, entry);
			if (entry.seen.has(file.sourcePath)) return;
			entry.seen.add(file.sourcePath);
			entry.files += 1;
			if (entry.where.length < 3)
				entry.where.push({ path: file.sourcePath, title: titleOfFile(file) });
			if (entry.snippets.length < 3) entry.snippets.push(snippetAt(text, index, token.length));
		},
		list(min: number): DialectToken[] {
			return [...byToken.values()]
				.filter((t) => t.files >= min)
				.sort((a, b) => b.files - a.files || (a.token < b.token ? -1 : 1))
				.slice(0, TOKENS_KEPT)
				.map((t) => ({ token: t.token, files: t.files, where: t.where, snippets: t.snippets }));
		}
	};
}

export function dialectStats(method: Method, files: readonly ByobFile[]): DialectStats {
	const { dialectKeys } = rulesOf(method);
	const values = new Map<string, Map<string, number>>();
	const placeholders = tokenCounter();
	const stages = tokenCounter();
	const registryFiles: string[] = [];
	for (const file of files) {
		if (!isByobText(file.sourcePath) && !isPeopleRegistryPath(file.sourcePath)) continue;
		const header = headerValuesOf(file.body);
		for (const key of dialectKeys)
			for (const value of new Set((header.get(key) ?? []).map((v) => v.trim().toLowerCase())))
				if (value && value.length <= 40) {
					const counts = values.get(key) ?? new Map<string, number>();
					counts.set(value, (counts.get(value) ?? 0) + 1);
					values.set(key, counts);
				}
		const people = parsePeopleRegistry(file.sourcePath, file.body) ?? [];
		if (people.length >= 2 || (people.length > 0 && isPeopleRegistryPath(file.sourcePath)))
			registryFiles.push(file.sourcePath);
		if (!isByobText(file.sourcePath)) continue;
		const text = bodyOf(file.body).replace(/```[\s\S]*?```/g, ' ');
		for (const m of text.matchAll(BRACKET)) {
			const inner = m[1]!.trim();
			if (/^\d+$|^n$/i.test(inner)) continue;
			if (PLACEHOLDER_WORDS.test(inner)) placeholders.add(`[${inner}]`, file, text, m.index);
		}
		for (const m of text.matchAll(BARE_PLACEHOLDER)) placeholders.add(m[1]!, file, text, m.index);
		for (const m of text.matchAll(STAGE)) stages.add(m[1]!, file, text, m.index);
	}
	return {
		values: Object.fromEntries(
			[...values].map(([key, counts]) => [
				key,
				[...counts]
					.map(([value, n]) => ({ value, files: n }))
					.sort((a, b) => b.files - a.files || (a.value < b.value ? -1 : 1))
					.slice(0, VALUES_KEPT)
			])
		),
		placeholders: placeholders.list(1),
		registryFiles,
		stages: stages.list(3)
	};
}

export function defaultStatusMeaning(method: Method, value: string): DialectStatus | null {
	const r = rulesOf(method);
	const v = value.trim().toLowerCase();
	if (r.draftWords.test(v)) return 'draft';
	if (r.supersededWords.test(v)) return 'superseded';
	if (r.currentWords.test(v)) return 'current';
	return null;
}

export function defaultAccessMeaning(method: Method, value: string): DialectAccess | null {
	const r = rulesOf(method);
	const v = value.trim().toLowerCase();
	if (r.everyoneWords.test(v)) return 'everyone';
	if (r.membersWords.test(v)) return 'members';
	if (r.restrictedWords.test(v)) return 'restricted';
	return null;
}

export function defaultDialectProfile(method: Method, stats: DialectStats): ByobDialectProfile {
	const statuses: Record<string, DialectStatus> = {};
	for (const key of ['status', 'state'])
		for (const { value } of stats.values[key] ?? []) {
			const meaning = defaultStatusMeaning(method, value);
			if (meaning) statuses[value] = meaning;
		}
	const access: Record<string, DialectAccess> = {};
	for (const key of ['sensitivity', 'access', 'tags'])
		for (const { value } of stats.values[key] ?? []) {
			const meaning = defaultAccessMeaning(method, value);
			if (meaning && (key !== 'tags' || meaning === 'restricted')) access[value] = meaning;
		}
	return {
		statuses,
		placeholders: stats.placeholders.map((t) => t.token),
		access,
		registryFiles: stats.registryFiles,
		jargon: {}
	};
}

export const DIALECT_CATEGORIES = [
	'status',
	'placeholder',
	'access',
	'registry file',
	'jargon'
] as const;

export function dialectExcerpt(
	method: Method,
	stats: DialectStats,
	company: string | null
): string {
	const lines: string[] = ["## The brain's own markers, as the platform counted them"];
	if (company) lines.push(`The company: ${company}`);
	lines.push(`Categories: ${DIALECT_CATEGORIES.join(', ')}.`);
	for (const key of rulesOf(method).dialectKeys) {
		const vals = stats.values[key] ?? [];
		if (vals.length > 0)
			lines.push(`Header \`${key}\`: ${vals.map((v) => `${v.value} (${v.files})`).join(', ')}`);
	}
	const token = (t: DialectToken) =>
		[
			`- \`${t.token}\` in ${t.files} file${t.files === 1 ? '' : 's'}: ${t.where.map((w) => `${w.title} (${w.path})`).join('; ')}`,
			...t.snippets.map((snippet) => `  > ${snippet}`)
		].join('\n');
	if (stats.placeholders.length > 0)
		lines.push('Bracketed or unfinished values:', ...stats.placeholders.map(token));
	if (stats.stages.length > 0) lines.push('Stage-like tokens:', ...stats.stages.map(token));
	if (stats.registryFiles.length > 0)
		lines.push(`Files that list people: ${stats.registryFiles.join(', ')}`);
	return lines.length > 2 ? `${lines.join('\n')}\n\n` : '';
}

function recordOfStrings(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function parseDialectReading(
	value: unknown,
	stats: DialectStats
): Partial<ByobDialectProfile> | null {
	const record = recordOfStrings(value);
	if (!record) return null;
	const headerValues = (keys: readonly string[]) =>
		new Set(keys.flatMap((k) => (stats.values[k] ?? []).map((v) => v.value)));
	const statusValues = headerValues(['status', 'state']);
	const accessValues = headerValues(['sensitivity', 'access', 'tags']);
	const tokens = new Set([...stats.placeholders, ...stats.stages].map((t) => t.token));
	const out: Partial<ByobDialectProfile> = {};
	const statuses = recordOfStrings(record.statuses);
	if (statuses) {
		const kept: Record<string, DialectStatus> = {};
		for (const [k, v] of Object.entries(statuses))
			if (
				statusValues.has(k.toLowerCase()) &&
				(v === 'draft' || v === 'current' || v === 'superseded')
			)
				kept[k.toLowerCase()] = v;
		if (Object.keys(kept).length > 0) out.statuses = kept;
	}
	const access = recordOfStrings(record.access);
	if (access) {
		const kept: Record<string, DialectAccess> = {};
		for (const [k, v] of Object.entries(access))
			if (
				accessValues.has(k.toLowerCase()) &&
				(v === 'everyone' || v === 'members' || v === 'restricted')
			)
				kept[k.toLowerCase()] = v;
		if (Object.keys(kept).length > 0) out.access = kept;
	}
	if (Array.isArray(record.placeholders)) {
		const kept = record.placeholders.filter(
			(t): t is string => typeof t === 'string' && tokens.has(t)
		);
		if (kept.length > 0) out.placeholders = [...new Set(kept)];
	}
	const jargon = recordOfStrings(record.jargon);
	if (jargon) {
		const kept: Record<string, string> = {};
		for (const [k, v] of Object.entries(jargon))
			if (tokens.has(k) && typeof v === 'string' && v.trim() !== '' && v.length <= 120)
				kept[k] = v.trim();
		if (Object.keys(kept).length > 0) out.jargon = kept;
	}
	return Object.keys(out).length > 0 ? out : null;
}

export function mergeDialectProfile(
	base: ByobDialectProfile,
	reading: Partial<ByobDialectProfile> | null
): ByobDialectProfile {
	if (!reading) return base;
	const placeholders = reading.placeholders ?? base.placeholders;
	const jargon = { ...base.jargon, ...(reading.jargon ?? {}) };
	return {
		statuses: { ...base.statuses, ...(reading.statuses ?? {}) },
		placeholders: placeholders.filter((p) => !(p in jargon)),
		access: { ...base.access, ...(reading.access ?? {}) },
		registryFiles: base.registryFiles,
		jargon
	};
}

export function dialectProfileEmpty(profile: ByobDialectProfile): boolean {
	return (
		Object.keys(profile.statuses).length === 0 &&
		profile.placeholders.length === 0 &&
		Object.keys(profile.access).length === 0 &&
		profile.registryFiles.length === 0 &&
		Object.keys(profile.jargon).length === 0
	);
}

export type DialectRow = {
	kind: 'access' | 'status' | 'placeholder' | 'registry' | 'jargon';
	value: string;
	meaning: string;
	example: string | null;
};

export const DIALECT_ROWS_SHOWN = 8;

export function dialectRows(
	profile: ByobDialectProfile,
	stats: DialectStats | null
): { shown: DialectRow[]; more: DialectRow[] } {
	const exampleOf = (token: string) => {
		const t = [...(stats?.placeholders ?? []), ...(stats?.stages ?? [])].find(
			(x) => x.token === token
		);
		return t ? `${t.where[0]?.title ?? ''}: ${t.snippets[0] ?? ''}`.trim() : null;
	};
	const filesWith = (keys: readonly string[], value: string) => {
		const n = keys.reduce(
			(sum, k) => sum + ((stats?.values[k] ?? []).find((v) => v.value === value)?.files ?? 0),
			0
		);
		return n > 0 ? `${n} file${n === 1 ? '' : 's'}` : null;
	};
	const rows: DialectRow[] = [
		...Object.entries(profile.access)
			.filter(([, meaning]) => meaning !== 'members')
			.map(([value, meaning]) => ({
				kind: 'access' as const,
				value,
				meaning:
					meaning === 'restricted' ? 'only the readers you name' : 'everyone, outside the team too',
				example: filesWith(['sensitivity', 'access', 'tags'], value)
			})),
		...Object.entries(profile.statuses)
			.filter(([, meaning]) => meaning !== 'current')
			.map(([value, meaning]) => ({
				kind: 'status' as const,
				value,
				meaning:
					meaning === 'draft' ? 'a draft: you decide whether it is current' : 'no longer current',
				example: filesWith(['status', 'state'], value)
			})),
		...profile.placeholders.map((value) => ({
			kind: 'placeholder' as const,
			value,
			meaning: 'a value nobody filled in: written as not known yet',
			example: exampleOf(value)
		})),
		...profile.registryFiles.map((value) => ({
			kind: 'registry' as const,
			value,
			meaning: 'lists the people and their accounts: read as the team',
			example: null
		})),
		...Object.entries(profile.jargon).map(([value, gloss]) => ({
			kind: 'jargon' as const,
			value,
			meaning: gloss === 'strip' ? 'left out of the pages' : `written as "${gloss}"`,
			example: exampleOf(value)
		}))
	];
	return { shown: rows.slice(0, DIALECT_ROWS_SHOWN), more: rows.slice(DIALECT_ROWS_SHOWN) };
}
