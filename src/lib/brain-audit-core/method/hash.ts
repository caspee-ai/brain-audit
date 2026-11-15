import { canonicalJson } from '../audit/profile-hash';
import { sha256Hex } from '../sha256';
import type { Method } from './types';

export const METHOD_HASH_PREFIX = 'sha256:';

export function methodHash(method: Omit<Method, 'content_hash'> | Method): string {
	const rest: Record<string, unknown> = { ...method };
	delete rest.content_hash;
	return `${METHOD_HASH_PREFIX}${sha256Hex(canonicalJson(rest))}`;
}

export function verifyMethodHash(method: Method): boolean {
	return methodHash(method) === method.content_hash;
}
