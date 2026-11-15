import { editFrontmatter, FRONTMATTER } from '../markdown';
import { isByobText } from './dialect';
import { hasNotionId } from './names';
import { isNotionPeopleKey, NOTION_KEY_ALIASES, notionRelations } from './notion';

const TOML_BLOCK = /^\uFEFF?\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+(?:\r?\n|$)/;
const PROPERTY_LINE = /^\s*(?:[-*]\s+)?([A-Za-z][\w-]*)::\s?(.*)$/;
const NOTION_PROPERTY = /^([\p{L}\p{N}][\p{L}\p{N} _()&/.'-]{0,40}?):\s+(\S.*)$/u;
const MMD_KEYS = new Set([
	'title',
	'author',
	'authors',
	'owner',
	'date',
	'created',
	'updated',
	'modified',
	'tags',
	'keywords',
	'type',
	'status',
	'category',
	'summary',
	'description',
	'aliases',
	'alias'
]);
const ORG_KEYWORD = /^#\+([A-Za-z_]+):\s*(.*)$/;
const ORG_KEYS = new Set(['title', 'author', 'filetags', 'date', 'email', 'category']);

type Header = [key: string, value: string | string[]][];

function quote(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function yamlBlock(header: Header): string {
	const lines = header.map(([key, value]) =>
		Array.isArray(value) ? `${key}: [${value.map(quote).join(', ')}]` : `${key}: ${quote(value)}`
	);
	return `---\n${lines.join('\n')}\n---\n`;
}

export function headerKey(key: string): string | null {
	const out = key
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '_')
		.replace(/^_+|_+$/g, '');
	return /^[a-z_][\w.-]*$/.test(out) ? out : null;
}

function unquote(value: string): string {
	const v = value.trim();
	if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")))
		return v.slice(1, -1);
	return v;
}

function listOf(value: string): string[] {
	const out: string[] = [];
	for (const match of value.matchAll(/\[\[[^\]]+\]\]|#\[\[[^\]]+\]\]|[^,]+/g)) {
		const item = match[0]
			.trim()
			.replace(/^#\[\[(.*)\]\]$/, '$1')
			.replace(/^#/, '');
		if (item) out.push(item);
	}
	return out;
}

const LIST_KEYS = new Set(['tags', 'alias', 'aliases', 'filetags', 'keywords']);

function push(header: Header, rawKey: string, rawValue: string): void {
	const key = headerKey(rawKey);
	if (!key || header.some(([k]) => k === key)) return;
	const value = rawValue.trim();
	if (key === 'filetags') {
		header.push(['tags', value.split(':').filter(Boolean)]);
		return;
	}
	header.push([key, LIST_KEYS.has(key) ? listOf(value) : unquote(value)]);
}

const MARKDOWN_LINK = /\[[^\]\n]*\]\([^)\s]+\)/;

function pushNotion(header: Header, rawKey: string, rawValue: string): void {
	const read = headerKey(rawKey);
	if (!read) return;
	const key = NOTION_KEY_ALIASES[read] ?? read;
	if (header.some(([k]) => k === key)) return;
	const value = rawValue.trim();
	const relations = notionRelations(value);
	if (relations) {
		const links = relations.map(({ title, href }) => `[${title.replace(/[[\]]/g, '')}](${href})`);
		header.push([key, links.length === 1 ? links[0]! : links]);
		return;
	}
	if (isNotionPeopleKey(key) && value.includes(',')) {
		header.push([key, listOf(value)]);
		return;
	}
	push(header, key, value);
}

function tomlHeader(block: string): Header {
	const header: Header = [];
	let table = '';
	for (const raw of block.split(/\r?\n/)) {
		const line = raw.trim();
		if (line === '' || line.startsWith('#')) continue;
		const section = /^\[([^\]]+)\]$/.exec(line);
		if (section) {
			table = `${section[1]!.trim()}_`;
			continue;
		}
		const pair = /^([A-Za-z_][\w.-]*)\s*=\s*(.+)$/.exec(line);
		if (!pair) continue;
		const value = pair[2]!.trim();
		const key = headerKey(`${table}${pair[1]}`);
		if (!key) continue;
		if (value.startsWith('[') && value.endsWith(']'))
			header.push([
				key,
				value
					.slice(1, -1)
					.split(',')
					.map((item) => unquote(item))
					.filter(Boolean)
			]);
		else header.push([key, unquote(value.replace(/\s+#.*$/, ''))]);
	}
	return header;
}

function jsonHeader(text: string): { header: Header; rest: string } | null {
	if (!text.startsWith('{')) return null;
	let depth = 0;
	let inString = false;
	for (let i = 0; i < text.length && i < 20_000; i += 1) {
		const char = text[i];
		if (inString) {
			if (char === '\\') i += 1;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === '{') depth += 1;
		else if (char === '}' && --depth === 0) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(text.slice(0, i + 1));
			} catch {
				return null;
			}
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
			const header: Header = [];
			for (const [rawKey, value] of Object.entries(parsed as Record<string, unknown>)) {
				const key = headerKey(rawKey);
				if (!key) continue;
				if (Array.isArray(value)) header.push([key, value.map(String)]);
				else if (value !== null && typeof value !== 'object') header.push([key, String(value)]);
			}
			return { header, rest: text.slice(i + 1).replace(/^\r?\n/, '') };
		}
	}
	return null;
}

const stemOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

export function normalizeBroughtText(sourcePath: string, text: string): string {
	if (!isByobText(sourcePath)) return text;
	const fields = FRONTMATTER.exec(text)?.[1];
	if (fields !== undefined) {
		if (!fields.includes('\t')) return withOkfFootnotes(fields, text);
		const fixed = fields.replace(/^\t+/gm, (tabs) => '  '.repeat(tabs.length)).replace(/\t/g, ' ');
		return withOkfFootnotes(
			fixed,
			editFrontmatter(text, () => fixed)!
		);
	}
	const bare = text.replace(/^\uFEFF/, '');
	const toml = TOML_BLOCK.exec(bare);
	if (toml) {
		const header = tomlHeader(toml[1]!);
		return header.length > 0 ? yamlBlock(header) + bare.slice(toml[0].length) : text;
	}
	const json = jsonHeader(bare);
	if (json && json.header.length > 0) return yamlBlock(json.header) + json.rest;
	const lines = bare.split(/\r?\n/);
	if (/\.org$/i.test(sourcePath)) return orgText(lines) ?? text;
	if (/\.(adoc|asciidoc)$/i.test(sourcePath)) return titledText(lines, asciidocTitle) ?? text;
	if (/\.rst$/i.test(sourcePath)) return titledText(lines, rstTitle) ?? text;
	let i = 0;
	while (i < lines.length && lines[i]!.trim() === '') i += 1;
	const header: Header = [];
	let j = i;
	for (; j < lines.length; j += 1) {
		const match = PROPERTY_LINE.exec(lines[j]!);
		if (!match) break;
		push(header, match[1]!, match[2]!);
	}
	if (header.length > 0) return yamlBlock(header) + lines.slice(j).join('\n').replace(/^\n+/, '');
	if (hasNotionId(stemOf(sourcePath)) && /^#\s+\S/.test(lines[i] ?? '')) {
		let k = i + 1;
		while (k < lines.length && lines[k]!.trim() === '') k += 1;
		const start = k;
		for (; k < lines.length; k += 1) {
			const match = NOTION_PROPERTY.exec(lines[k]!.trim());
			if (!match || lines[k]!.trim() === '' || MARKDOWN_LINK.test(match[2]!)) break;
			pushNotion(header, match[1]!, match[2]!);
		}
		if (header.length > 0)
			return (
				yamlBlock(header) +
				[...lines.slice(0, start), ...lines.slice(k)].join('\n').replace(/\n{3,}/g, '\n\n')
			);
	}
	for (j = i; j < lines.length && lines[j]!.trim() !== ''; j += 1) {
		const match = /^([A-Za-z][\w -]{0,30}):\s*(.*)$/.exec(lines[j]!);
		if (!match || !MMD_KEYS.has(match[1]!.trim().toLowerCase())) {
			header.length = 0;
			break;
		}
		push(header, match[1]!, match[2]!);
	}
	if (header.length >= 2) return yamlBlock(header) + lines.slice(j).join('\n').replace(/^\n+/, '');
	if (/\.(txt|text)$/i.test(sourcePath)) return titledText(lines, firstLineTitle) ?? text;
	return text;
}

type TitleAt = { title: string; start: number; end: number };

function firstFilled(lines: readonly string[], from = 0): number {
	let i = from;
	while (i < lines.length && lines[i]!.trim() === '') i += 1;
	return i;
}

function asciidocTitle(lines: readonly string[]): TitleAt | null {
	let i = firstFilled(lines);
	while (i < lines.length && lines[i]!.startsWith('//')) i = firstFilled(lines, i + 1);
	const title = /^=\s+(\S.*?)\s*$/.exec(lines[i] ?? '');
	return title ? { title: title[1]!, start: i, end: i + 1 } : null;
}

const RST_ADORNMENT = /^([=\-~^"'`#*+:._])\1{2,}\s*$/;

function rstTitle(lines: readonly string[]): TitleAt | null {
	let i = firstFilled(lines);
	while (i < lines.length && lines[i]!.startsWith('..')) i = firstFilled(lines, i + 1);
	const line = lines[i] ?? '';
	if (RST_ADORNMENT.test(line)) {
		const text = (lines[i + 1] ?? '').trim();
		return text && lines[i + 2]?.trim() === line.trim()
			? { title: text, start: i, end: i + 3 }
			: null;
	}
	const under = lines[i + 1] ?? '';
	return line.trim() && RST_ADORNMENT.test(under) && under.trim().length >= line.trim().length
		? { title: line.trim(), start: i, end: i + 2 }
		: null;
}

export const PLAIN_TEXT_TITLE_MAX = 120;

function firstLineTitle(lines: readonly string[]): TitleAt | null {
	const i = firstFilled(lines);
	const line = (lines[i] ?? '').trim();
	return line && line.length <= PLAIN_TEXT_TITLE_MAX && /[\p{L}\p{N}]/u.test(line)
		? { title: line, start: i, end: i + 1 }
		: null;
}

function titledText(
	lines: readonly string[],
	find: (lines: readonly string[]) => TitleAt | null
): string | null {
	const at = find(lines);
	if (!at) return null;
	const rest = [...lines.slice(0, at.start), ...lines.slice(at.end)].join('\n').replace(/^\n+/, '');
	return `${yamlBlock([['title', at.title]])}# ${at.title}\n\n${rest}`;
}

function orgText(lines: string[]): string | null {
	const header: Header = [];
	const kept: string[] = [];
	let drawer = false;
	let top = true;
	for (const line of lines) {
		const trimmed = line.trim();
		if (top && /^:properties:$/i.test(trimmed)) {
			drawer = true;
			continue;
		}
		if (drawer) {
			if (/^:end:$/i.test(trimmed)) {
				drawer = false;
				continue;
			}
			const prop = /^:([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
			if (prop) push(header, prop[1]!.toLowerCase() === 'id' ? 'org_id' : prop[1]!, prop[2]!);
			continue;
		}
		const keyword = top ? ORG_KEYWORD.exec(trimmed) : null;
		if (keyword && ORG_KEYS.has(keyword[1]!.toLowerCase())) {
			push(header, keyword[1]!, keyword[2]!);
			continue;
		}
		if (trimmed.startsWith('*')) top = false;
		kept.push(line);
	}
	if (header.length === 0) return null;
	const title = header.find(([key]) => key === 'title');
	const body = kept.join('\n').replace(/^\n+/, '');
	return (
		yamlBlock(header) + (title && typeof title[1] === 'string' ? `# ${title[1]}\n\n` : '') + body
	);
}

function withOkfFootnotes(header: string, text: string): string {
	if (!/^sources:\s*$/m.test(header) || !text.includes('[^')) return text;
	const where = new Map<string, string>();
	let id: string | null = null;
	let inSources = false;
	for (const line of header.split(/\r?\n/)) {
		if (/^sources:\s*$/.test(line)) {
			inSources = true;
			continue;
		}
		if (inSources && /^\S/.test(line)) break;
		if (!inSources) continue;
		const idLine = /^\s*-?\s*id:\s*["']?([\w.-]+)["']?\s*$/.exec(line);
		if (idLine) {
			id = idLine[1]!;
			continue;
		}
		const target = /^\s*-?\s*(path|file|uri|url|href):\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
		if (target && id && !where.has(id)) where.set(id, target[2]!);
	}
	if (where.size === 0) return text;
	const defined = new Set([...text.matchAll(/^\[\^([^\]\s]+)\]:/gm)].map((m) => m[1]!));
	const used = new Set([...text.matchAll(/\[\^([^\]\s]+)\](?!:)/g)].map((m) => m[1]!));
	const added = [...used].filter((ref) => !defined.has(ref) && where.has(ref));
	if (added.length === 0) return text;
	return `${text.replace(/\s*$/, '')}\n\n${added.map((ref) => `[^${ref}]: ${where.get(ref)}`).join('\n')}\n`;
}
