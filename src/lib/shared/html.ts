const NAMED_ENTITIES: Record<string, string> = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
};

function decodeEntity(entity: string): string {
	if (entity.startsWith('#x') || entity.startsWith('#X')) {
		const code = Number.parseInt(entity.slice(2), 16);
		return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
	}
	if (entity.startsWith('#')) {
		const code = Number.parseInt(entity.slice(1), 10);
		return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
	}
	return NAMED_ENTITIES[entity.toLowerCase()] ?? `&${entity};`;
}

export function htmlToText(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre|table)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => decodeEntity(entity))
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
