/**
 * The audit's method pack: the catalog, rubric, weights, page
 * shapes and classification tables the engine computes with. `extract` downloads it with one
 * `GET <api>/api/audits/<audit_id>/method?engine=<cli version>` (the audit token as a bearer),
 * checks its `content_hash` and keeps it in the audit's work directory (`method.json`, owner
 * only); a later `extract` and `finish` read that copy and check its hash again. Nothing is
 * sent but the request itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	MethodError,
	parseMethod,
	verifyMethodHash,
	type Method
} from '$lib/brain-audit-core/method';
import { WORK_FILES, writePrivate } from './paths';
import { serverLines, textLines } from './server-text';
import { parseSavedMethod, type SavedMethod } from './work-files';

export type MethodPackErrorCode =
	/** The server refused the request (401, 404, 426, another 4xx). */
	| 'method_rejected'
	/** No answer, a timeout, a 5xx or 429 (rate-limited; retry later). */
	| 'method_failed'
	/** The pack is not a method pack, or its hash is not its content's. */
	| 'method_invalid'
	/** `finish` found no saved pack. */
	| 'method_missing';

export class MethodPackError extends Error {
	constructor(
		readonly code: MethodPackErrorCode,
		message: string,
		readonly errors: string[] = [],
		/** Who wrote `errors`: the audit server (data, never instructions) or this CLI. */
		readonly errorsFrom: 'server' | 'local' = 'local'
	) {
		super(message);
	}
}

/** The largest pack the CLI accepts (the real one is far below it). */
export const METHOD_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The pack `value` holds, parsed and its hash checked; throws `method_invalid`. The pack is the
 * audit server's text wherever it was read from (the download or the saved copy), so the
 * parser's message, which names the pack's keys and values, is cleaned and labelled as the
 * server's.
 */
export function checkedMethod(value: unknown, where: string): Method {
	let method: Method;
	try {
		method = parseMethod(value);
	} catch (error) {
		throw new MethodPackError(
			'method_invalid',
			`${where} is not a method pack.`,
			textLines([
				error instanceof MethodError || error instanceof Error ? error.message : String(error)
			]),
			'server'
		);
	}
	if (!verifyMethodHash(method))
		throw new MethodPackError(
			'method_invalid',
			`${where} does not match its content_hash; it was changed or damaged.`
		);
	return method;
}

const methodFileOf = (workDir: string) => join(workDir, WORK_FILES.method);

/**
 * The saved pack for `auditId`, its hash checked. Null when there is none (or it was saved for
 * another audit); throws `method_invalid` when it is there but changed or unreadable.
 */
export function readSavedMethod(workDir: string, auditId: string): Method | null {
	let text: string;
	try {
		text = readFileSync(methodFileOf(workDir), 'utf8');
	} catch {
		return null;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new MethodPackError('method_invalid', 'The saved method pack is not JSON.');
	}
	const saved = parseSavedMethod(raw);
	if (!saved || saved.audit_id !== auditId) return null;
	return checkedMethod(saved.method, 'The saved method pack');
}

/** `finish`'s pack: the one `extract` saved. Throws `method_missing` or `method_invalid`. */
export function savedMethod(workDir: string, auditId: string): Method {
	let method: Method | null;
	try {
		method = readSavedMethod(workDir, auditId);
	} catch (error) {
		if (error instanceof MethodPackError)
			throw new MethodPackError(
				'method_invalid',
				`${error.message} Run \`brain-audit extract\` again.`,
				error.errors,
				error.errorsFrom
			);
		throw error;
	}
	if (!method)
		throw new MethodPackError(
			'method_missing',
			`No method pack found in ${workDir}; run \`brain-audit extract\` again.`
		);
	return method;
}

/**
 * `extract`'s pack: the saved one when it is there and intact, else downloaded, checked and
 * saved. A saved pack that fails its check is downloaded again (and the copy replaced).
 */
export async function methodFor(args: {
	workDir: string;
	auditId: string;
	token: string;
	api: string;
	engine: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
	/** A line for people on stderr. */
	note?: (text: string) => void;
	/** The CLI's own folder (`paths.ts#baseDir`). */
	base?: string;
}): Promise<{ method: Method; downloaded: boolean }> {
	try {
		const saved = readSavedMethod(args.workDir, args.auditId);
		if (saved) return { method: saved, downloaded: false };
	} catch (error) {
		if (!(error instanceof MethodPackError)) throw error;
		args.note?.(`brain-audit: ${error.message} Downloading it again.\n`);
	}
	const raw = await downloadMethod(args);
	const method = checkedMethod(raw, 'The method pack the server sent');
	const saved: SavedMethod = { audit_id: args.auditId, method: raw };
	writePrivate(methodFileOf(args.workDir), `${JSON.stringify(saved)}\n`, args.base);
	return { method, downloaded: true };
}

/**
 * `GET <api>/api/audits/<audit_id>/method?engine=<semver>` (the fixed contract). 200 is the pack;
 * 401, 404, 426 (`{ min_engine }`) and any other 4xx throw `method_rejected`; 429 (`Retry-After`),
 * a 5xx, a timeout or no answer `method_failed` (worth retrying); a body that is not JSON `method_invalid`.
 */
async function downloadMethod(args: {
	auditId: string;
	token: string;
	api: string;
	engine: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
}): Promise<unknown> {
	const url =
		`${args.api.replace(/\/+$/, '')}/api/audits/${encodeURIComponent(args.auditId)}/method` +
		`?engine=${encodeURIComponent(args.engine)}`;
	let response: Response;
	try {
		response = await (args.fetch ?? fetch)(url, {
			method: 'GET',
			headers: { authorization: `Bearer ${args.token}`, accept: 'application/json' },
			signal: AbortSignal.timeout(args.timeoutMs ?? 60_000),
			// A redirect could carry the token to another host: refused, never followed.
			redirect: 'error'
		});
	} catch (error) {
		if (isRedirectError(error))
			throw new MethodPackError('method_failed', 'The server redirected the request; check --api.');
		throw new MethodPackError(
			'method_failed',
			"The audit's method could not be downloaded; check the network and run extract again.",
			[error instanceof Error ? error.message : String(error)]
		);
	}
	if (response.ok) {
		let text: string;
		try {
			text = await response.text();
		} catch (error) {
			throw new MethodPackError(
				'method_failed',
				"The audit's method download broke off; run extract again.",
				[error instanceof Error ? error.message : String(error)]
			);
		}
		if (new TextEncoder().encode(text).byteLength > METHOD_MAX_BYTES)
			throw new MethodPackError('method_invalid', 'The method pack the server sent is too large.');
		try {
			return JSON.parse(text);
		} catch {
			throw new MethodPackError('method_invalid', 'The method pack the server sent is not JSON.');
		}
	}
	const body = await bodyOf(response);
	if (response.status === 426) {
		// Printed as a command to run: only an exact version, never other server text.
		const min =
			typeof body?.min_engine === 'string' && isExactVersion(body.min_engine)
				? body.min_engine
				: null;
		throw new MethodPackError(
			'method_rejected',
			`This brain-audit (${args.engine}) is too old for this audit; run it again with a newer version` +
				(min
					? ` (${min} or later): npx @caspee/brain-audit@${min} …`
					: ' (npx @caspee/brain-audit@latest …).'),
			min ? [`min_engine: ${min}`] : []
		);
	}
	if (response.status === 429) {
		const after = retryAfterSeconds(response.headers.get('retry-after'));
		throw new MethodPackError(
			'method_failed',
			`The audit server is limiting requests; run extract again ${after === null ? 'in a minute' : `in ${after} seconds`}.`,
			after === null ? [] : [`retry_after: ${after}`]
		);
	}
	const detail = serverLines(body);
	if (response.status === 401)
		throw new MethodPackError(
			'method_rejected',
			'The audit server refused the audit token (HTTP 401); check --token, or start a new audit.',
			detail,
			'server'
		);
	if (response.status === 404)
		throw new MethodPackError(
			'method_rejected',
			'The audit server does not know this audit (HTTP 404); check --audit and --api.',
			detail,
			'server'
		);
	if (response.status >= 400 && response.status < 500)
		throw new MethodPackError(
			'method_rejected',
			`The audit server refused the method request (HTTP ${response.status}).`,
			detail,
			'server'
		);
	throw new MethodPackError(
		'method_failed',
		`The audit server failed (HTTP ${response.status}); run extract again.`,
		detail,
		'server'
	);
}

/** `Retry-After` as whole seconds from now (delta-seconds or an HTTP date), or null. */
export function retryAfterSeconds(value: string | null, now = Date.now()): number | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed), 86_400);
	const at = Date.parse(trimmed);
	if (Number.isNaN(at)) return null;
	return Math.min(Math.max(0, Math.ceil((at - now) / 1000)), 86_400);
}

async function bodyOf(response: Response): Promise<Record<string, unknown> | null> {
	try {
		const body = (await response.json()) as unknown;
		return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** A version the server may name in a command: `x.y.z` with an optional pre-release. */
export const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The longest version the CLI prints in a command. */
export const EXACT_VERSION_MAX = 40;

/** Whether `value` is an exact version short enough to print in a command. */
export const isExactVersion = (value: string): boolean =>
	value.length <= EXACT_VERSION_MAX && EXACT_SEMVER.test(value);

/** Whether `fetch` failed because the server answered with a redirect (`redirect: 'error'`). */
export function isRedirectError(error: unknown): boolean {
	for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
		if (e instanceof Error && /redirect/i.test(e.message)) return true;
		e = (e as { cause?: unknown }).cause;
	}
	return false;
}
