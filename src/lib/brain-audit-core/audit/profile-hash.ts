export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value))
		return value.map((item) => (item === undefined ? null : sortKeys(item)));
	if (value !== null && typeof value === 'object') {
		const source = value as Record<string, unknown>;
		if (typeof (source as { toJSON?: unknown }).toJSON === 'function')
			return sortKeys((source as { toJSON: () => unknown }).toJSON());
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(source).sort()) {
			if (source[key] === undefined) continue;
			sorted[key] = sortKeys(source[key]);
		}
		return sorted;
	}
	return value;
}

export async function profileHashOf(profile: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalJson(profile));
	const digest = await crypto.subtle.digest('SHA-1', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
