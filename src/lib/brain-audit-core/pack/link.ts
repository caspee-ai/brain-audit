import { decodeKey } from './crypto';

export const AUDIT_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function isAuditId(value: unknown): value is string {
	return typeof value === 'string' && AUDIT_ID.test(value);
}

export function reportPath(base: string, auditId: string): string {
	if (!isAuditId(auditId)) throw new Error('reportPath: not an audit id');
	const url = new URL(base);
	if (url.protocol !== 'https:' && url.protocol !== 'http:')
		throw new Error('reportPath: base is not http(s)');
	url.pathname = `${url.pathname.replace(/\/+$/, '')}/r/${auditId}`;
	url.search = '';
	url.hash = '';
	return url.toString();
}

export function reportLink(base: string, auditId: string, key: string): string {
	if (!decodeKey(key)) throw new Error('reportLink: not a 256-bit base64url key');
	return `${reportPath(base, auditId)}#k=${key}`;
}

export function keyFromFragment(hash: string): string | null {
	const text = hash.startsWith('#') ? hash.slice(1) : hash;
	for (const part of text.split('&')) {
		if (!part.startsWith('k=')) continue;
		const key = part.slice(2);
		return decodeKey(key) ? key : null;
	}
	return null;
}

export function parseReportLink(link: string): { auditId: string; key: string } | null {
	let url: URL;
	try {
		url = new URL(link);
	} catch {
		return null;
	}
	const match = /\/r\/([^/]+)\/?$/.exec(url.pathname);
	if (!match || !isAuditId(match[1])) return null;
	const key = keyFromFragment(url.hash);
	return key ? { auditId: match[1], key } : null;
}
