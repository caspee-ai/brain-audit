import { FRONTMATTER, markdownLines, withoutCodeSpans } from '../markdown';
import { MD_LINK, WIKI_LINK } from '../byob/citations';

const TAGS_PROPERTY = /^\s*(?:[-*]\s+)?tags::\s?(.*)$/i;
const INLINE_TAG = /(?<![^\s(,;])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

export function tagLevels(raw: string): string[] {
	const tag = raw
		.normalize('NFC')
		.trim()
		.replace(/^#+/, '')
		.replace(/^\[\[(.*)\]\]$/, '$1')
		.replace(/[/-]+$/, '')
		.toLowerCase();
	if (tag === '' || /^[\p{N}/_-]+$/u.test(tag)) return [];
	const parts = tag.split('/').filter((part) => part !== '');
	return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

function valueTags(value: string): string[] {
	return value
		.replace(/\[\[([^\]]*)\]\]/g, (_m, name: string) => name.replace(/\s+/g, '-'))
		.split(/[,\s]+/)
		.flatMap(tagLevels);
}

export function tagCountsOf(
	header: ReadonlyMap<string, readonly string[]>,
	body: string,
	options: { inline: boolean }
): Record<string, number> {
	const out = new Map<string, number>();
	const add = (tag: string) => out.set(tag, (out.get(tag) ?? 0) + 1);
	for (const value of header.get('tags') ?? []) for (const tag of valueTags(value)) add(tag);
	const text = body.replace(FRONTMATTER, '');
	for (const line of markdownLines(text)) {
		if (line.code) continue;
		const property = TAGS_PROPERTY.exec(line.text);
		if (property) {
			for (const tag of valueTags(property[1]!)) add(tag);
			continue;
		}
		if (!options.inline || !line.text.includes('#')) continue;
		const prose = withoutCodeSpans(line.text)
			.replace(MD_LINK, ' ')
			.replace(WIKI_LINK, ' ')
			.replace(URL, ' ');
		for (const m of prose.matchAll(INLINE_TAG)) for (const tag of tagLevels(m[1]!)) add(tag);
	}
	return Object.fromEntries([...out.keys()].sort().map((tag) => [tag, out.get(tag)!]));
}

export function tagsOf(
	header: ReadonlyMap<string, readonly string[]>,
	body: string,
	options: { inline: boolean }
): string[] {
	return Object.keys(tagCountsOf(header, body, options));
}
