import { FRONTMATTER } from '$lib/brain-audit-core/markdown';

export class YamlParseError extends Error {
	readonly line: number;
	constructor(message: string, line: number) {
		super(`YAML: ${message} (line ${line})`);
		this.name = 'YamlParseError';
		this.line = line;
	}
}

export type ParsedMarkdown = {
	frontmatter: Record<string, unknown>;
	body: string;
};

export function splitFrontmatter(text: string): ParsedMarkdown {
	const match = FRONTMATTER.exec(text);
	if (!match) {
		throw new YamlParseError('canonical page is missing a closing --- frontmatter block', 1);
	}
	const raw = match[1] ?? '';
	const parsed = parseYaml(raw);
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new YamlParseError('frontmatter must be a mapping', 1);
	}
	return { frontmatter: parsed as Record<string, unknown>, body: text.slice(match[0].length) };
}

export function parseYaml(text: string): unknown {
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i]!.includes('\t')) {
			throw new YamlParseError('tabs are not allowed; indent with spaces', i + 1);
		}
	}
	const parser = new BlockParser(lines);
	const value = parser.parseBlock(0);
	parser.skipBlankAndComments();
	if (parser.index < lines.length) {
		throw new YamlParseError('unexpected trailing content', parser.index + 1);
	}
	return value;
}

class BlockParser {
	index = 0;
	constructor(readonly lines: string[]) {}

	skipBlankAndComments(): void {
		while (this.index < this.lines.length) {
			const trimmed = this.lines[this.index]!.trim();
			if (trimmed === '' || trimmed.startsWith('#')) {
				this.index += 1;
				continue;
			}
			break;
		}
	}

	parseBlock(minIndent: number): unknown {
		this.skipBlankAndComments();
		if (this.index >= this.lines.length) return {};
		const line = this.lines[this.index]!;
		const indent = leadingSpaces(line);
		if (indent < minIndent) return {};
		const trimmed = line.trim();
		if (isListItem(trimmed)) return this.parseList(indent);
		return this.parseMap(indent);
	}

	parseMap(indent: number): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		while (this.index < this.lines.length) {
			this.skipBlankAndComments();
			if (this.index >= this.lines.length) break;
			const line = this.lines[this.index]!;
			const lineIndent = leadingSpaces(line);
			if (lineIndent < indent) break;
			if (lineIndent > indent) {
				throw new YamlParseError('unexpected indentation', this.index + 1);
			}
			const trimmed = line.trim();
			if (isListItem(trimmed)) {
				throw new YamlParseError('list item where a mapping key was expected', this.index + 1);
			}
			const colon = splitKeyValue(trimmed);
			if (!colon) {
				throw new YamlParseError(
					`expected "key:" and got ${JSON.stringify(trimmed)}`,
					this.index + 1
				);
			}
			const { key, rest } = colon;
			if (Object.hasOwn(out, key)) {
				throw new YamlParseError(`duplicate key ${JSON.stringify(key)}`, this.index + 1);
			}
			refuseExoticKey(key, this.index + 1);
			this.index += 1;
			if (rest === '') {
				this.skipBlankAndComments();
				if (this.index >= this.lines.length) {
					out[key] = null;
					continue;
				}
				const next = this.lines[this.index]!;
				const nextIndent = leadingSpaces(next);
				if (nextIndent === indent && isListItem(next.trim())) {
					out[key] = this.parseList(indent, true);
					continue;
				}
				if (nextIndent <= indent) {
					out[key] = null;
					continue;
				}
				out[key] = this.parseBlock(nextIndent);
			} else {
				out[key] = parseInline(rest, this.index);
			}
		}
		return out;
	}

	parseList(indent: number, compact = false): unknown[] {
		const out: unknown[] = [];
		while (this.index < this.lines.length) {
			this.skipBlankAndComments();
			if (this.index >= this.lines.length) break;
			const line = this.lines[this.index]!;
			const lineIndent = leadingSpaces(line);
			if (lineIndent < indent) break;
			if (lineIndent > indent) {
				throw new YamlParseError('unexpected indentation in list', this.index + 1);
			}
			const trimmed = line.trim();
			if (!isListItem(trimmed)) {
				if (compact) break;
				throw new YamlParseError('expected a list item starting with "- "', this.index + 1);
			}
			const rest = trimmed.slice(2);
			this.index += 1;
			if (rest === '') {
				this.skipBlankAndComments();
				if (this.index >= this.lines.length) {
					out.push(null);
					continue;
				}
				const nextIndent = leadingSpaces(this.lines[this.index]!);
				if (nextIndent <= indent) {
					out.push(null);
					continue;
				}
				out.push(this.parseBlock(nextIndent));
				continue;
			}
			const kv = splitKeyValue(rest);
			if (kv && !looksLikeInline(rest)) {
				const nested: Record<string, unknown> = {};
				refuseExoticKey(kv.key, this.index);
				nested[kv.key] = kv.rest === '' ? null : parseInline(kv.rest, this.index);
				this.skipBlankAndComments();
				const keyColumn = lineIndent + 2;
				if (kv.rest === '' && this.index < this.lines.length) {
					const valueIndent = leadingSpaces(this.lines[this.index]!);
					if (valueIndent > keyColumn) {
						nested[kv.key] = this.parseBlock(valueIndent);
						this.skipBlankAndComments();
					} else if (valueIndent === keyColumn && isListItem(this.lines[this.index]!.trim())) {
						nested[kv.key] = this.parseList(keyColumn, true);
						this.skipBlankAndComments();
					}
				}
				if (this.index < this.lines.length) {
					const childIndent = leadingSpaces(this.lines[this.index]!);
					if (childIndent > indent) {
						const extra = this.parseMap(childIndent);
						for (const extraKey of Object.keys(extra)) {
							if (Object.hasOwn(nested, extraKey)) {
								throw new YamlParseError(
									`duplicate key ${JSON.stringify(extraKey)}`,
									this.index + 1
								);
							}
							nested[extraKey] = extra[extraKey];
						}
					}
				}
				out.push(nested);
			} else {
				out.push(parseInline(rest, this.index));
			}
		}
		return out;
	}
}

function isListItem(trimmed: string): boolean {
	return trimmed.startsWith('- ') || trimmed === '-';
}

function leadingSpaces(line: string): number {
	const match = /^( *)/.exec(line);
	return match ? match[1]!.length : 0;
}

function refuseExoticKey(key: string, line: number): void {
	if (key === '<<') {
		throw new YamlParseError('merge keys are not allowed', line);
	}
	if (key.startsWith('!') || key.startsWith('&') || key.startsWith('*')) {
		throw new YamlParseError('YAML tags and aliases are not allowed', line);
	}
}

function splitKeyValue(trimmed: string): { key: string; rest: string } | null {
	if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
		const key = readQuoted(trimmed, 0);
		if (key.end >= trimmed.length) return null;
		const after = trimmed.slice(key.end).trim();
		if (!after.startsWith(':')) return null;
		return { key: String(key.value), rest: after.slice(1).trim() };
	}
	const colon = trimmed.search(/:(?=\s|$)/);
	if (colon <= 0) return null;
	const key = trimmed.slice(0, colon).trim();
	if (key.length === 0) return null;
	return { key, rest: trimmed.slice(colon + 1).trim() };
}

function looksLikeInline(rest: string): boolean {
	return (
		rest.startsWith('[') || rest.startsWith('{') || rest.startsWith('"') || rest.startsWith("'")
	);
}

function parseInline(raw: string, line: number): unknown {
	const trimmed = stripInlineComment(raw).trim();
	if (trimmed === '') return null;
	if (trimmed === '|' || trimmed === '>' || trimmed.startsWith('|') || trimmed.startsWith('>')) {
		throw new YamlParseError('multiline | and > blocks are not allowed', line);
	}
	if (trimmed.startsWith('&') || trimmed.startsWith('*') || trimmed.startsWith('!')) {
		throw new YamlParseError('YAML tags and aliases are not allowed', line);
	}
	const first = trimmed[0];
	if (first !== '"' && first !== "'" && first !== '[' && first !== '{')
		return parsePlainScalar(trimmed, line);
	return parseValue(trimmed, line).value;
}

function stripInlineComment(raw: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i]!;
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === '#' && !inSingle && !inDouble && (i === 0 || raw[i - 1] === ' ')) {
			return raw.slice(0, i);
		}
	}
	return raw;
}

function parseValue(text: string, line: number): { value: unknown; end: number } {
	const first = text[0];
	if (first === '"' || first === "'") {
		const quoted = readQuoted(text, 0);
		return { value: quoted.value, end: quoted.end };
	}
	if (first === '[') return readFlowList(text, line);
	if (first === '{') return readFlowMap(text, line);
	const tokenEnd = scanPlain(text);
	const token = text.slice(0, tokenEnd).trim();
	return { value: parsePlainScalar(token, line), end: tokenEnd };
}

function scanPlain(text: string): number {
	let depth = 0;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i]!;
		if (ch === '[' || ch === '{') depth += 1;
		else if (ch === ']' || ch === '}') {
			if (depth === 0) return i;
			depth -= 1;
		} else if (ch === ',' && depth === 0) return i;
		else if (ch === ':' && depth === 0 && /^(?:[\s,[\]{}]|$)/.test(text.slice(i + 1, i + 2)))
			return i;
	}
	return text.length;
}

function parsePlainScalar(token: string, line: number): unknown {
	if (token === '~' || token === 'null') return null;
	if (token === 'true') return true;
	if (token === 'false') return false;
	if (token === 'yes' || token === 'no' || token === 'on' || token === 'off') {
		throw new YamlParseError(
			`${JSON.stringify(token)} is ambiguous; use true/false or quote the string`,
			line
		);
	}
	if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(token)) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
		return Number(token);
	}
	if (token.startsWith('&') || token.startsWith('*') || token.startsWith('!')) {
		throw new YamlParseError('YAML tags and aliases are not allowed', line);
	}
	return token;
}

function readQuoted(text: string, start: number): { value: string; end: number } {
	const quote = text[start]!;
	let i = start + 1;
	let out = '';
	while (i < text.length) {
		const ch = text[i]!;
		if (quote === "'" && ch === "'") {
			if (text[i + 1] === "'") {
				out += "'";
				i += 2;
				continue;
			}
			return { value: out, end: i + 1 };
		}
		if (quote === '"' && ch === '"') return { value: out, end: i + 1 };
		if (quote === '"' && ch === '\\') {
			const next = text[i + 1];
			if (next === undefined) break;
			const escaped =
				next === 'n'
					? '\n'
					: next === 't'
						? '\t'
						: next === '"'
							? '"'
							: next === '\\'
								? '\\'
								: next;
			out += escaped;
			i += 2;
			continue;
		}
		out += ch;
		i += 1;
	}
	throw new YamlParseError('unterminated quoted string', 1);
}

function skipSpace(text: string, i: number): number {
	while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
	return i;
}

function readFlowList(text: string, line: number): { value: unknown[]; end: number } {
	const out: unknown[] = [];
	let i = 1;
	i = skipSpace(text, i);
	if (text[i] === ']') return { value: out, end: i + 1 };
	while (i < text.length) {
		i = skipSpace(text, i);
		const parsed = parseValue(text.slice(i), line);
		out.push(parsed.value);
		i += parsed.end;
		i = skipSpace(text, i);
		const ch = text[i];
		if (ch === ']') return { value: out, end: i + 1 };
		if (ch !== ',') throw new YamlParseError('expected "," or "]" in flow list', line);
		i += 1;
	}
	throw new YamlParseError('unterminated flow list', line);
}

function readFlowMap(text: string, line: number): { value: Record<string, unknown>; end: number } {
	const out: Record<string, unknown> = {};
	let i = 1;
	i = skipSpace(text, i);
	if (text[i] === '}') return { value: out, end: i + 1 };
	while (i < text.length) {
		i = skipSpace(text, i);
		const keyParsed = parseValue(text.slice(i), line);
		if (typeof keyParsed.value !== 'string') {
			throw new YamlParseError('flow mapping keys must be strings', line);
		}
		i += keyParsed.end;
		i = skipSpace(text, i);
		if (text[i] !== ':') throw new YamlParseError('expected ":" in flow mapping', line);
		i += 1;
		i = skipSpace(text, i);
		const valueParsed = parseValue(text.slice(i), line);
		if (Object.hasOwn(out, keyParsed.value)) {
			throw new YamlParseError(`duplicate key ${JSON.stringify(keyParsed.value)}`, line);
		}
		out[keyParsed.value] = valueParsed.value;
		i += valueParsed.end;
		i = skipSpace(text, i);
		const ch = text[i];
		if (ch === '}') return { value: out, end: i + 1 };
		if (ch !== ',') throw new YamlParseError('expected "," or "}" in flow mapping', line);
		i += 1;
	}
	throw new YamlParseError('unterminated flow mapping', line);
}
