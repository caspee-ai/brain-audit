const HEADING_SPLIT = /^(.+?)(?:\s*[—–]\s*|\s+-\s+)(.+)$/;

export function splitPersonHeading(h1: string): { name: string; role: string | null } {
	const text = h1.trim();
	const match = HEADING_SPLIT.exec(text);
	if (!match) return { name: text, role: null };
	return { name: match[1]!.trim(), role: match[2]!.trim() || null };
}

const WIKI_NAME = /^\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|[^[\]]*)?\]\]$/;
const TAG = /^#([^\s#[\]]+)$/;

export function unwrapWikiTag(value: string): string {
	const text = value.trim();
	const wiki = WIKI_NAME.exec(text.startsWith('#[[') ? text.slice(1) : text);
	if (wiki) return wiki[1]!.trim();
	const tag = TAG.exec(text);
	return tag ? tag[1]! : text;
}

export function bareOwnerHint(hint: string): string {
	let value = hint
		.trim()
		.replace(/^PROPOSE-/i, '')
		.replace(/\?+$/, '')
		.trim();
	const angled = /<\s*(?:mailto:)?([^<>\s@]+@[^<>\s@]+)\s*>/i.exec(value);
	if (angled) return angled[1]!;
	const link = /^\[([^[\]]*)\]\(\s*([^()\s]+)\s*\)$/.exec(value);
	if (link)
		value = /^mailto:/i.test(link[2]!)
			? link[2]!
			: /^[a-z][a-z0-9+.-]*:/i.test(link[2]!)
				? link[1]!
				: decodeURIComponentSafe(link[2]!);
	const wiki = WIKI_NAME.exec(value);
	if (wiki) value = wiki[1]!;
	return value
		.replace(/^mailto:/i, '')
		.replace(/\s*\([^()]*\)$/, '')
		.trim();
}

function decodeURIComponentSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

const PLAIN_LETTERS: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe' };

export function personSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[łøđßæœ]/g, (c) => PLAIN_LETTERS[c]!)
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function ownerHintSlug(hint: string): string {
	const bare = bareOwnerHint(hint)
		.replace(/^.*\//, '')
		.replace(/\.(md|markdown|mdx)$/i, '');
	return personSlug(bare);
}

const FROM_COMPANY = /^(.+?)\s+(?:from|at|@)\s+\S.*$/i;

export function identifierLikeTitle(
	title: string
): { kind: 'email' | 'sender' | 'login'; token: string } | null {
	const text = title.trim();
	if (/^[^\s@]+@[^\s@]+$/.test(text))
		return { kind: 'email', token: text.split('@')[0]!.toLowerCase() };
	const sender = FROM_COMPANY.exec(text);
	if (sender && !/\s/.test(sender[1]!.trim()))
		return { kind: 'sender', token: sender[1]!.trim().toLowerCase() };
	if (/\s/.test(text)) return null;
	if (text === text.toLowerCase() || /[\d._-]/.test(text))
		return { kind: 'login', token: text.toLowerCase() };
	return null;
}

export function firstNameKey(name: string): string {
	return personSlug(name.trim().split(/\s+/)[0] ?? '');
}
