function canonicalize(value: unknown): unknown {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('non-finite');
		return value;
	}
	if (typeof value !== 'object') throw new Error('not json');
	const proto = Object.getPrototypeOf(value);
	if (Array.isArray(value)) {
		if (proto !== Array.prototype) throw new Error('not json');
		return value.map((item) => canonicalize(item));
	}
	if (proto !== Object.prototype && proto !== null) throw new Error('not json');
	if (typeof (value as { toJSON?: unknown }).toJSON === 'function') throw new Error('not json');
	const record = value as Record<string, unknown>;
	const out = Object.create(null) as Record<string, unknown>;
	for (const key of Object.keys(record).sort()) out[key] = canonicalize(record[key]);
	return out;
}

export function canonicalJson(value: unknown): string | null {
	try {
		return JSON.stringify(canonicalize(value));
	} catch {
		return null;
	}
}

export function plainRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

export function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}
