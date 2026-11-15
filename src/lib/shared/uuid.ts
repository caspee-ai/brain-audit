export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const UUID = new RegExp(`^${UUID_PATTERN}$`, 'i');

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value);
}

export function readUuid(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return UUID.test(trimmed) ? trimmed.toLowerCase() : null;
}
