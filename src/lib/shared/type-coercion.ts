export type TypeCoercion = {
	from: string;
	to: string;
	set?: Record<string, string>;
	note?: string;
};

const COERCIONS: Record<string, Omit<TypeCoercion, 'from'>> = {
	navigation: { to: 'topic', set: { kind: 'other' } },
	index: { to: 'topic', set: { kind: 'other' } },
	readme: { to: 'topic', set: { kind: 'other' } },
	directory: { to: 'topic', set: { kind: 'other' } },
	list: { to: 'topic', set: { kind: 'other' } },
	fact: { to: 'claim' },
	term: {
		to: 'topic',
		set: { kind: 'other' },
		note: 'a term the company uses is also a registry row: register_entity with type term and its meaning as description'
	}
};

export function coercePageType(type: unknown): TypeCoercion | null {
	if (typeof type !== 'string') return null;
	const key = type.trim().toLowerCase();
	const found = COERCIONS[key];
	return found ? { from: key, ...found } : null;
}

export function coercionMessage(coercion: TypeCoercion): string {
	const set = Object.entries(coercion.set ?? {})
		.map(([key, value]) => `${key}: ${value}`)
		.join(', ');
	return `type_coerced: ${coercion.from} → ${coercion.to}${set ? ` (${set})` : ''}; ${coercion.from} is not a page type, so the page was written as a ${coercion.to}${coercion.note ? `; ${coercion.note}` : ''}`;
}
