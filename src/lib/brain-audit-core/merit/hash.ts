import { canonicalJson } from '$lib/shared/canonical';
import type { MeritCallKind } from './types';

export type MeritCallPrompt = { kind: MeritCallKind; system: string; user: string; rows: unknown };

export type MeritCallKey = {
	prompt: MeritCallPrompt;
	rubricVersion: number;
	model: string;
};

export function meritCallKeyJson(key: MeritCallKey): string {
	const json = canonicalJson({
		kind: key.prompt.kind,
		system: key.prompt.system,
		user: key.prompt.user,
		rows: key.prompt.rows,
		rubric_version: key.rubricVersion,
		model: key.model
	});
	if (json === null) throw new Error('merit call input is not JSON');
	return json;
}

export async function sha256Hex(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function meritCallHash(key: MeritCallKey): Promise<string> {
	return sha256Hex(meritCallKeyJson(key));
}

export async function contentHashOf(value: unknown): Promise<string> {
	const json = canonicalJson(value);
	if (json === null) throw new Error('content is not JSON');
	return sha256Hex(json);
}
