/**
 * Text the audit server sent, made safe to print. The agent that runs this CLI reads its
 * output, and a terminal renders it: what the server says is data, never instructions or
 * terminal control. Every server line the CLI prints goes through here.
 */

/** The longest line kept, in characters. */
export const SERVER_LINE_MAX = 300;
/** The most lines kept from one answer. */
export const SERVER_LINES_MAX = 50;

/** ANSI escapes: CSI (ESC [ or 0x9B), OSC / DCS / PM / APC strings (to BEL or ST), any other ESC pair. */
const ANSI =
	// eslint-disable-next-line no-control-regex
	/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|(?:\u001b[\]PX^_]|[\u0090\u0098\u009d-\u009f])[\s\S]*?(?:\u0007|\u001b\\|\u009c|$)|\u001b[ -~]?/g;
/** C0 and C1 control characters and DEL. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Unicode bidirectional controls (embeddings, overrides, isolates, marks). */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
/**
 * Characters a terminal does not show but a model reads: Unicode tag characters, zero-width
 * spaces and joiners, the word joiner, the byte-order mark and the soft hyphen.
 */
const INVISIBLE = /[\u{E0000}-\u{E007F}\u200B-\u200D\u2060\uFEFF\u00AD]/gu;
/** The Unicode line and paragraph separators: a line break to some readers. */
const SEPARATORS = /[\u2028\u2029]+/g;

/**
 * One value as a printable line: a string, stripped of control, bidirectional and invisible
 * characters, at most 300 characters.
 */
export function serverText(value: unknown): string {
	const text =
		typeof value === 'string' ? value : value === undefined ? '' : (JSON.stringify(value) ?? '');
	const clean = text
		.replace(ANSI, '')
		.replace(/[\t\r\n\v\f]+/g, ' ')
		.replace(SEPARATORS, ' ')
		.replace(CONTROL, '')
		.replace(BIDI, '')
		.replace(INVISIBLE, '')
		.trim();
	const chars = Array.from(clean);
	return chars.length > SERVER_LINE_MAX ? chars.slice(0, SERVER_LINE_MAX).join('') : clean;
}

/**
 * The lines of a server's error body: its `errors` list, else its `error` or `message`. Each
 * line cleaned by {@link serverText}, empty ones dropped, at most 50.
 */
export function serverLines(body: unknown): string[] {
	if (!body || typeof body !== 'object') return [];
	const record = body as { errors?: unknown; error?: unknown; message?: unknown };
	const list: unknown[] = Array.isArray(record.errors)
		? record.errors
		: [record.error ?? record.message].filter((value) => value !== undefined);
	return textLines(list);
}

/** Each item cleaned by {@link serverText}, empty ones dropped, at most 50. */
export function textLines(items: readonly unknown[]): string[] {
	const lines: string[] = [];
	for (const item of items) {
		if (lines.length >= SERVER_LINES_MAX) break;
		const line = serverText(item);
		if (line) lines.push(line);
	}
	return lines;
}
