import { parseYaml } from '$lib/shared/frontmatter';

export type RegistryPerson = {
	name: string;
	emails: string[];
	accounts: Record<string, string[]>;
	aliases: string[];
	page: string | null;
	path: string;
};

const REGISTRY_NAME_RE =
	/(^|\/)(_?registry|_?people|_?team|roster|directory|org[-_ ]?chart)\.(md|markdown|ya?ml|csv)$/i;

export function isPeopleRegistryPath(path: string, declared: readonly string[] = []): boolean {
	if (declared.length > 0) return declared.some((d) => d.toLowerCase() === path.toLowerCase());
	return REGISTRY_NAME_RE.test(path);
}

export const EMAIL_KEYS: ReadonlySet<string> = new Set([
	'email',
	'emails',
	'e-mail',
	'mail',
	'gmail',
	'address'
]);
export const NAME_KEYS: ReadonlySet<string> = new Set([
	'name',
	'canonical_name',
	'full_name',
	'full name',
	'person'
]);
const ALIAS_KEYS = new Set(['aliases', 'alias', 'also', 'other names', 'aka']);

export const SYSTEM_KEYS: Readonly<Record<string, string>> = {
	git: 'github',
	github: 'github',
	gh: 'github',
	gitlab: 'gitlab',
	slack: 'slack',
	slack_id: 'slack',
	linear: 'linear',
	notion: 'notion',
	hubspot: 'hubspot',
	attio: 'attio',
	jira: 'jira',
	asana: 'asana',
	clickup: 'clickup',
	figma: 'figma',
	discord: 'discord',
	teams: 'teams',
	tldv: 'tldv'
};

function texts(value: unknown): string[] {
	const list = Array.isArray(value) ? value : value == null ? [] : [value];
	return list
		.map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''))
		.map((v) => v.replace(/^`|`$/g, '').replace(/^"|"$/g, ''))
		.filter((v) => v !== '' && v !== '-' && v.toLowerCase() !== 'null');
}

const unique = (values: readonly string[]) => [...new Set(values)];

function personOf(
	fields: Record<string, unknown>,
	path: string,
	fallbackName?: string
): RegistryPerson | null {
	const emails: string[] = [];
	const aliases: string[] = [];
	const accounts: Record<string, string[]> = {};
	let name: string | null = null;
	let page: string | null = null;
	const read = (key: string, value: unknown) => {
		const k = key.toLowerCase().trim();
		if (NAME_KEYS.has(k)) name ??= texts(value)[0] ?? null;
		else if (EMAIL_KEYS.has(k)) emails.push(...texts(value));
		else if (ALIAS_KEYS.has(k)) aliases.push(...texts(value).flatMap((a) => a.split(/\s*[,;]\s*/)));
		else if (k === 'page') page = texts(value)[0] ?? null;
		else if (SYSTEM_KEYS[k]) {
			const ids = texts(value);
			if (ids.length > 0)
				accounts[SYSTEM_KEYS[k]!] = unique([...(accounts[SYSTEM_KEYS[k]!] ?? []), ...ids]);
		}
	};
	for (const [key, value] of Object.entries(fields)) {
		const k = key.toLowerCase();
		if (
			(k === 'cross_system_ids' || k === 'handles' || k === 'accounts') &&
			value &&
			typeof value === 'object'
		)
			for (const [inner, v] of Object.entries(value as Record<string, unknown>)) read(inner, v);
		else read(key, value);
	}
	name ??= fallbackName ?? null;
	const valid = unique(
		emails.map((e) => e.toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
	);
	if (!name || (!valid.length && !Object.keys(accounts).length && !aliases.length)) return null;
	return { name, emails: valid, accounts, aliases: unique(aliases), page, path };
}

function peopleOfYaml(doc: unknown, path: string): RegistryPerson[] | null {
	if (!doc || typeof doc !== 'object') return null;
	const root = doc as Record<string, unknown>;
	const records = Array.isArray(doc) ? null : root.records;
	if (records && typeof records === 'object' && !Array.isArray(records)) {
		const out: RegistryPerson[] = [];
		for (const [slug, raw] of Object.entries(records as Record<string, unknown>)) {
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
			const r = raw as Record<string, unknown>;
			if (String(r.type ?? 'person').toLowerCase() !== 'person') continue;
			const person = personOf(r, path, slug);
			if (person) out.push(person);
		}
		return out;
	}
	const list = Array.isArray(doc) ? doc : (root.people ?? root.team ?? root.members);
	if (!Array.isArray(list)) return null;
	const out = list.flatMap((item) =>
		item && typeof item === 'object' && !Array.isArray(item)
			? (personOf(item as Record<string, unknown>, path) ?? [])
			: []
	);
	return out.length > 0 ? out : null;
}

function cellsOf(line: string, separator: '|' | ','): string[] {
	if (separator === '|')
		return line
			.trim()
			.replace(/^\||\|$/g, '')
			.split('|')
			.map((c) => c.trim());
	const cells: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]!;
		if (ch === '"' && line[i + 1] === '"' && quoted) {
			cell += '"';
			i++;
		} else if (ch === '"') quoted = !quoted;
		else if (ch === ',' && !quoted) {
			cells.push(cell.trim());
			cell = '';
		} else cell += ch;
	}
	cells.push(cell.trim());
	return cells;
}

function isPeopleHeader(header: readonly string[]): boolean {
	const keys = header.map((h) => h.toLowerCase().replace(/[*_`]/g, '').trim());
	return (
		keys.some((k) => NAME_KEYS.has(k)) && keys.some((k) => EMAIL_KEYS.has(k) || !!SYSTEM_KEYS[k])
	);
}

function peopleOfRows(header: readonly string[], rows: readonly string[][], path: string) {
	const keys = header.map((h) => h.toLowerCase().replace(/[*_`]/g, '').trim());
	return rows.flatMap((cells) => {
		const fields = Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? '']));
		return personOf(fields, path) ?? [];
	});
}

function peopleOfMarkdownTables(body: string, path: string): RegistryPerson[] {
	const lines = body.split(/\r?\n/);
	const out: RegistryPerson[] = [];
	for (let i = 0; i + 1 < lines.length; i++) {
		if (!/^\s*\|/.test(lines[i]!) || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1]!)) continue;
		const header = cellsOf(lines[i]!, '|');
		const rows: string[][] = [];
		let j = i + 2;
		for (; j < lines.length && /^\s*\|/.test(lines[j]!); j++) rows.push(cellsOf(lines[j]!, '|'));
		if (isPeopleHeader(header)) out.push(...peopleOfRows(header, rows, path));
		i = j - 1;
	}
	return out;
}

const FENCED_YAML = /```ya?ml[^\n]*\n([\s\S]*?)```/g;

export function parsePeopleRegistry(path: string, body: string): RegistryPerson[] | null {
	const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
	const safeYaml = (text: string) => {
		try {
			return peopleOfYaml(parseYaml(text), path);
		} catch {
			return null;
		}
	};
	if (ext === 'yml' || ext === 'yaml') return safeYaml(body);
	if (ext === 'csv') {
		const lines = body.split(/\r?\n/).filter((l) => l.trim() !== '');
		if (lines.length < 2) return null;
		const header = cellsOf(lines[0]!, ',');
		if (!isPeopleHeader(header)) return null;
		return peopleOfRows(
			header,
			lines.slice(1).map((l) => cellsOf(l, ',')),
			path
		);
	}
	const out: RegistryPerson[] = [];
	let found = false;
	for (const match of body.matchAll(FENCED_YAML)) {
		const people = safeYaml(match[1]!);
		if (people) {
			found = true;
			out.push(...people);
		}
	}
	const tables = peopleOfMarkdownTables(body, path);
	if (tables.length > 0) found = true;
	out.push(...tables);
	return found ? out : null;
}
