export type MarkdownLine = { readonly text: string; readonly code: boolean };

const FENCE = /^\s*(```|~~~)/;
const INDENTED = /^(?: {4}|\t)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
const CODE_SPAN = /(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g;

export function markdownLines(markdown: string): MarkdownLine[] {
	let fenced = false;
	let indented = false;
	let blankBefore = true;
	let inList = false;
	return markdown.split('\n').map((text) => {
		if (fenced) {
			if (FENCE.test(text)) fenced = false;
			return { text, code: true };
		}
		if (text.trim() === '') {
			blankBefore = true;
			return { text, code: indented };
		}
		indented = INDENTED.test(text) && (indented || (blankBefore && !inList));
		if (!indented && FENCE.test(text)) fenced = true;
		const code = indented || fenced;
		if (!code) inList = LIST_ITEM.test(text) || (inList && (!blankBefore || /^\s/.test(text)));
		blankBefore = false;
		return { text, code };
	});
}

export function withoutCodeSpans(line: string): string {
	return line.replace(CODE_SPAN, ' ');
}

export function outsideCodeSpans(line: string, edit: (prose: string) => string): string {
	let out = '';
	let at = 0;
	for (const span of line.matchAll(CODE_SPAN)) {
		out += edit(line.slice(at, span.index)) + span[0];
		at = span.index + span[0].length;
	}
	return out + edit(line.slice(at));
}

export const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function bodyOf(markdown: string): string {
	return markdown.replace(FRONTMATTER, '');
}

export function editFrontmatter(
	markdown: string,
	edit: (fields: string) => string | null
): string | null {
	const match = FRONTMATTER.exec(markdown);
	if (!match) return null;
	const fields = match[1]!;
	const edited = edit(fields);
	if (edited === null) return null;
	const open = match[0].slice(0, match[0].indexOf('\n') + 1);
	const close = match[0].slice(open.length + fields.length);
	return open + edited + close + markdown.slice(match[0].length);
}

export const TEMPLATE_TOKEN = /<%[^%\n]*%>|\{\{[^}\n]+\}\}|\{%[^%\n]*%\}|<<[^<>\n]+>>/;
