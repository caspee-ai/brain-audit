import { bodyOf, markdownLines } from '../markdown';
import { normalizeBroughtText } from './normalize';

export type Completeness = {
	headings_total: number;
	headings_kept: number;
	length_ratio: number;
	blocks_total: number;
	blocks_kept: number;
	missing: string[];
	verdict: 'full' | 'partial' | 'unmeasured';
	declared?: string;
};

export const COMPLETENESS_HEADINGS_FULL = 0.9;
export const COMPLETENESS_LENGTH_FULL = 0.6;
export const COMPLETENESS_MISSING_MAX = 12;

export type CompletenessOptions = {
	sourcePath?: string;
	suppliedHeadings?: readonly string[];
};

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;

export function normalizeHeading(text: string): string {
	return text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`~]/g, '')
		.replace(/^\s*(?:\d+[.)]|\d+(?:\.\d+)+|[ivx]+\.)\s+/i, '')
		.replace(/[:.]\s*$/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

export type OutlineHeading = { level: number; text: string; content: boolean };

const ORG_HEADING = /^(\*{1,6})\s+(.*?)\s*$/;
const ADOC_HEADING = /^(={1,6})\s+(.*?)\s*=*\s*$/;

export function headingSyntaxOf(path: string): 'markdown' | 'org' | 'asciidoc' | null {
	if (/\.(md|markdown|mdx)$/i.test(path)) return 'markdown';
	if (/\.org$/i.test(path)) return 'org';
	if (/\.(adoc|asciidoc)$/i.test(path)) return 'asciidoc';
	return null;
}

export function headingOutline(
	body: string,
	syntax: 'markdown' | 'org' | 'asciidoc' = 'markdown'
): OutlineHeading[] {
	const pattern = syntax === 'org' ? ORG_HEADING : syntax === 'asciidoc' ? ADOC_HEADING : HEADING;
	const out: OutlineHeading[] = [];
	const open: OutlineHeading[] = [];
	const lines =
		syntax === 'markdown'
			? markdownLines(body)
			: body.split('\n').map((text) => ({ text, code: false }));
	for (const line of lines) {
		const heading = line.code ? null : pattern.exec(line.text);
		if (heading) {
			const level = heading[1]!.length;
			while (open.length > 0 && open.at(-1)!.level >= level) open.pop();
			const entry: OutlineHeading = { level, text: heading[2]!.trim(), content: false };
			out.push(entry);
			open.push(entry);
			continue;
		}
		if (line.text.trim() === '') continue;
		for (const entry of open) entry.content = true;
	}
	return out;
}

type Read = { headings: { level: number; text: string }[]; prose: number; blocks: number };

function readText(markdown: string): Read {
	const headings: Read['headings'] = [];
	let prose = 0;
	let blocks = 0;
	let block: 'table' | 'list' | null = null;
	let inSources = false;
	for (const line of markdownLines(bodyOf(markdown))) {
		if (line.code) {
			block = null;
			continue;
		}
		const heading = HEADING.exec(line.text);
		if (heading) {
			block = null;
			const level = heading[1]!.length;
			const text = heading[2]!.trim();
			if (level <= 2) inSources = level === 2 && /^(sources|evidence)$/i.test(text);
			if (!inSources) headings.push({ level, text });
			continue;
		}
		if (inSources) continue;
		const kind = TABLE_ROW.test(line.text) ? 'table' : LIST_ITEM.test(line.text) ? 'list' : null;
		if (line.text.trim() !== '') {
			if (kind && kind !== block) blocks += 1;
			block = kind;
		}
		prose += line.text.replace(/\s+/g, '').length;
	}
	return { headings, prose, blocks };
}

export function completenessOf(
	source: string | null | undefined,
	page: string,
	options: CompletenessOptions = {}
): Completeness {
	if (source === null || source === undefined)
		return {
			headings_total: 0,
			headings_kept: 0,
			length_ratio: 0,
			blocks_total: 0,
			blocks_kept: 0,
			missing: [],
			verdict: 'unmeasured'
		};
	const from = readText(
		options.sourcePath ? normalizeBroughtText(options.sourcePath, source) : source
	);
	const to = readText(page);
	const pageHeadings = to.headings.map((h) => normalizeHeading(h.text)).filter(Boolean);
	const supplied = new Set((options.suppliedHeadings ?? []).map(normalizeHeading));
	const wanted = [
		...new Map(
			from.headings
				.filter((h) => h.level === 2 || h.level === 3)
				.map((h) => [normalizeHeading(h.text), h.text] as const)
				.filter(([key]) => key !== '' && !supplied.has(key))
		)
	];
	const missing: string[] = [];
	let kept = 0;
	for (const [key, text] of wanted) {
		if (pageHeadings.some((h) => h === key || h.includes(key))) kept += 1;
		else missing.push(text);
	}
	const ratio = from.prose === 0 ? 1 : to.prose / from.prose;
	const length_ratio = Math.round(ratio * 1_000) / 1_000;
	const headingsShare = wanted.length === 0 ? 1 : kept / wanted.length;
	return {
		headings_total: wanted.length,
		headings_kept: kept,
		length_ratio,
		blocks_total: from.blocks,
		blocks_kept: Math.min(from.blocks, to.blocks),
		missing: missing.slice(0, COMPLETENESS_MISSING_MAX),
		verdict:
			headingsShare >= COMPLETENESS_HEADINGS_FULL && length_ratio >= COMPLETENESS_LENGTH_FULL
				? 'full'
				: 'partial'
	};
}
