export function areaPathOf(folder: string): string {
	const segments = folder
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/ł/g, 'l')
		.split('/')
		.map((s) =>
			s
				.trim()
				.replace(/[^a-z0-9._-]+/g, '-')
				.replace(/^[-._]+|-+$/g, '')
		)
		.filter((s) => s.length > 0);
	return segments.length > 0 ? `${segments.join('/')}/` : '';
}

const CYRILLIC: Record<string, string> = {
	а: 'a',
	б: 'b',
	в: 'v',
	г: 'g',
	ґ: 'g',
	д: 'd',
	ђ: 'dj',
	е: 'e',
	ё: 'e',
	є: 'ye',
	ж: 'zh',
	з: 'z',
	ѕ: 'dz',
	и: 'i',
	і: 'i',
	ї: 'yi',
	й: 'y',
	ј: 'j',
	к: 'k',
	л: 'l',
	љ: 'lj',
	м: 'm',
	н: 'n',
	њ: 'nj',
	о: 'o',
	п: 'p',
	р: 'r',
	с: 's',
	т: 't',
	ћ: 'c',
	ќ: 'kj',
	у: 'u',
	ў: 'u',
	ф: 'f',
	х: 'h',
	ц: 'ts',
	ч: 'ch',
	џ: 'dz',
	ш: 'sh',
	щ: 'shch',
	ъ: '',
	ы: 'y',
	ь: '',
	э: 'e',
	ю: 'yu',
	я: 'ya'
};

const GREEK: Record<string, string> = {
	α: 'a',
	ά: 'a',
	β: 'v',
	γ: 'g',
	δ: 'd',
	ε: 'e',
	έ: 'e',
	ζ: 'z',
	η: 'i',
	ή: 'i',
	θ: 'th',
	ι: 'i',
	ί: 'i',
	ϊ: 'i',
	ΐ: 'i',
	κ: 'k',
	λ: 'l',
	μ: 'm',
	ν: 'n',
	ξ: 'x',
	ο: 'o',
	ό: 'o',
	π: 'p',
	ρ: 'r',
	σ: 's',
	ς: 's',
	τ: 't',
	υ: 'y',
	ύ: 'y',
	ϋ: 'y',
	ΰ: 'y',
	φ: 'f',
	χ: 'ch',
	ψ: 'ps',
	ω: 'o',
	ώ: 'o'
};

const TRANSLITERATED_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

export function transliterate(text: string): string {
	let out = '';
	for (const char of text) {
		const lower = char.toLowerCase();
		const mapped = CYRILLIC[lower] ?? GREEK[lower];
		out += mapped === undefined ? char : mapped;
	}
	return out;
}

export function shortHash(text: string): string {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(text)) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

export function brainSlug(segment: string): string {
	const plain = areaPathOf(segment).replace(/\/$/, '');
	const named = segment.normalize('NFC').trim();
	if (named === '') return plain;
	const slug = TRANSLITERATED_SCRIPT.test(named)
		? areaPathOf(transliterate(named)).replace(/\/$/, '')
		: plain;
	if (/[a-z0-9]/.test(slug)) return slug;
	return `u-${shortHash(named.toLowerCase())}`;
}

export function brainFolderPath(folder: string): string {
	const segments = folder
		.split('/')
		.map((segment) => brainSlug(withoutNotionId(segment).name))
		.filter((segment) => segment.length > 0);
	return segments.length > 0 ? `${segments.join('/')}/` : '';
}

const NOTION_ID = /[ -]([0-9a-f]{32})$/i;

export function withoutNotionId(name: string): { name: string; id: string | null } {
	const match = NOTION_ID.exec(name);
	if (!match || match.index === 0) return { name, id: null };
	return { name: name.slice(0, match.index).trim(), id: match[1]!.toLowerCase() };
}

export function hasNotionId(stem: string): boolean {
	return withoutNotionId(stem).id !== null;
}

export function journalDate(stem: string): string | null {
	const match = /^(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})$/.exec(stem.trim());
	if (!match) return null;
	const [, y, m, d] = match;
	const month = Number(m);
	const day = Number(d);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	return `${y}-${m}-${d}`;
}

export type NameTool = 'logseq' | 'dendron' | 'notion' | string | null;

const ESCAPE = /%[0-9A-Fa-f]{2}/;
const ESCAPE_RUN = /(?:%[0-9A-Fa-f]{2})+/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function decodedName(name: string): {
	name: string;
	decoded: boolean;
	rejected: string | null;
} {
	if (!ESCAPE.test(name)) return { name, decoded: false, rejected: null };
	const out = name.replace(ESCAPE_RUN, (run) => {
		try {
			return decodeURIComponent(run);
		} catch {
			return run.replace(/%[0-9A-Fa-f]{2}/g, (one) => {
				try {
					return decodeURIComponent(one);
				} catch {
					return one;
				}
			});
		}
	});
	if (out === name) return { name, decoded: false, rejected: null };
	const rejected = CONTROL.test(out)
		? 'a control character'
		: out.startsWith('/')
			? 'an absolute path'
			: out.split('/').some((part) => part.trim() === '.' || part.trim() === '..')
				? 'a path that leaves its folder'
				: null;
	return rejected
		? { name, decoded: false, rejected }
		: { name: out, decoded: true, rejected: null };
}

export function namedPath(stem: string, tool: NameTool): { folders: string[]; name: string } {
	let name = stem;
	if (tool === 'notion' || hasNotionId(name)) name = withoutNotionId(name).name;
	name = decodedName(name).name;
	let parts = [name];
	if (name.includes('/') || (tool === 'logseq' && name.includes('___')))
		parts = name
			.replace(/___/g, '/')
			.split('/')
			.map((part) => part.trim())
			.filter((part) => part !== '' && part !== '.' && part !== '..');
	else if (tool === 'dendron' && name.includes('.') && !/^\d/.test(name))
		parts = name
			.split('.')
			.map((part) => part.trim())
			.filter(Boolean);
	if (parts.length === 0) parts = [stem];
	return { folders: parts.slice(0, -1), name: parts[parts.length - 1]! };
}

export function displayName(stem: string, tool: NameTool): string {
	const { name } = namedPath(stem, tool);
	return journalDate(name) ?? name;
}
