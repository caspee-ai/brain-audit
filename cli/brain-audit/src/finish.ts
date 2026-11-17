/**
 * `brain-audit finish`: the agent's grades checked and scored, the sealed pack and the plain
 * summary assembled and validated, the pack sealed under a fresh key, both uploaded with one
 * `PUT <api>/api/audits/<audit_id>`, and the report link (with `#k=<key>`) printed and saved.
 *
 * The key is made here and leaves the machine only inside the link the person opens: the
 * request carries the summary and the ciphertext, never the key. A retried `finish` with the
 * same grades sends the very same bytes (`upload.json`), so a lost response does not strand a
 * report behind a key nobody kept. Once a request has gone out, a retry sends those bytes even
 * when the grades were edited since: the server may hold them, and only that key
 * opens them.
 *
 * Once the server has confirmed the upload, the work files that name the brain's contents go
 * (`state.json`, `merit-pack.json`, `method.json`) and `upload.json` keeps only the key, the
 * report's address and the scores: a re-run prints the same link from it alone.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
	meritPackHashOf,
	meritScoreOfAgentGrades,
	parseAgentGrades,
	scoreProjectionOf,
	sha256Hex,
	toPackMerit,
	type AgentGrades,
	type MeritMetadataPack,
	type Method
} from '$lib/brain-audit-core';
import {
	base64urlEncode,
	parsePlainSummary,
	parseSealedPack,
	reportLink,
	reportPath,
	sealPack,
	type PlainSummary,
	type SealedPack
} from '$lib/brain-audit-core/pack';
import { reportOriginOf, type Api } from './api';
import { engineVersion, type WorkState } from './extract';
import { MethodPackError, isRedirectError, savedMethod } from './method';
import { plainSummaryOf, sealedPackOf } from './pack';
import { WORK_FILES, baseDir, linkFileOf, writePrivate } from './paths';
import { serverLines, serverText } from './server-text';
import {
	isConfirmed,
	parseMeritPack,
	parseSavedUpload,
	parseWorkState,
	stateVersionOf,
	type ConfirmedUpload,
	type PendingUpload,
	type UploadBody
} from './work-files';

export type { UploadBody } from './work-files';

export type FinishErrorCode =
	| 'no_extract'
	| 'no_company_type'
	| 'pack_changed'
	| 'grades_invalid'
	| 'internal'
	| 'upload_rejected'
	| 'upload_failed'
	| 'method_changed';

export class FinishError extends Error {
	constructor(
		readonly code: FinishErrorCode,
		message: string,
		readonly errors: string[] = [],
		/** Who wrote `errors`: the audit server (data, never instructions) or this CLI. */
		readonly errorsFrom: 'server' | 'local' = 'local'
	) {
		super(message);
	}
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** The saved upload of an earlier `finish`, or null when there is none (or it is unreadable). */
function readSavedUpload(path: string): PendingUpload | ConfirmedUpload | null {
	try {
		return parseSavedUpload(readJson(path));
	} catch {
		return null;
	}
}

function readState(workDir: string): { state: WorkState; pack: MeritMetadataPack } {
	let raw: unknown;
	try {
		raw = readJson(join(workDir, WORK_FILES.state));
	} catch {
		throw new FinishError(
			'no_extract',
			`No extract found in ${workDir}; run \`brain-audit extract\` for this audit first.`
		);
	}
	const version = stateVersionOf(raw);
	if (version !== undefined && version !== 3)
		throw new FinishError(
			'no_extract',
			'The extract was written by another CLI version; run extract again.'
		);
	const state = parseWorkState(raw);
	if (!state)
		throw new FinishError(
			'no_extract',
			`The extract in ${workDir} cannot be read; run \`brain-audit extract\` for this audit again.`
		);
	if (!state.structural.company_type || !state.merit_pack_hash)
		throw new FinishError(
			'no_company_type',
			'The extract has no merit pack; run `brain-audit extract` again with --company-type.'
		);
	let pack: MeritMetadataPack | null;
	try {
		pack = parseMeritPack(readJson(join(workDir, WORK_FILES.meritPack)));
	} catch {
		pack = null;
	}
	if (!pack)
		throw new FinishError(
			'pack_changed',
			'The merit pack is missing or not a merit pack; run extract again.'
		);
	return { state, pack };
}

/**
 * After the server confirmed the upload: `upload.json` keeps the key, the report's address and
 * the scores (the sealed envelope goes), then the files that name the brain's contents go.
 */
function settle(
	workDir: string,
	auditId: string,
	saved: PendingUpload | ConfirmedUpload,
	summary: PlainSummary,
	base: string
): void {
	const kept: ConfirmedUpload = {
		confirmed: true,
		audit_id: auditId,
		grades_hash: saved.grades_hash,
		key: saved.key,
		sent: true,
		...(saved.report_url ? { report_url: saved.report_url } : {}),
		summary
	};
	writePrivate(join(workDir, WORK_FILES.upload), JSON.stringify(kept), base);
	for (const file of [WORK_FILES.state, WORK_FILES.meritPack, WORK_FILES.method])
		rmSync(join(workDir, file), { force: true });
}

/** Said when the extract's work files cannot make a summary or a report pack. */
const extractAgain = (workDir: string, what: string, errors: string[] = []) =>
	new FinishError(
		'no_extract',
		`The extract in ${workDir} does not make a valid ${what}; nothing was sent. Run \`brain-audit extract\` for this audit again.`,
		errors.map(serverText)
	);

/**
 * The plain summary and the sealed pack from the checked grades and the extract's state, each
 * through its own check. The state is a local file read back: it was checked for the fields
 * read here, and anything it still holds that does not fit (a failed check, or a value of the
 * wrong type deeper down) means run extract again, never a crash.
 */
function assembled(args: {
	workDir: string;
	auditId: string;
	cliVersion: string;
	method: Method;
	state: WorkState;
	pack: MeritMetadataPack;
	grades: AgentGrades;
}): { summary: PlainSummary; sealedPack: SealedPack } {
	const { method, state, pack } = args;
	let summary: PlainSummary;
	let sealedPack: SealedPack;
	try {
		const scored = meritScoreOfAgentGrades(method, args.grades, pack);
		const indexOf = new Map(state.pack.tree.files.map((file, i) => [file.path, i]));
		const merit = toPackMerit(scored, pack, (path) => indexOf.get(path));
		summary = plainSummaryOf({
			engineVersion: engineVersion(args.cliVersion, method),
			method: { version: method.method_version, hash: method.content_hash },
			totalWeights: method.weights.total,
			structural: { ...state.structural, company_type: state.structural.company_type! },
			merit: {
				score: scored.score,
				absent: scored.findings.merit_absent,
				thin: scored.findings.merit_thin
			}
		});
		const checked = parsePlainSummary(summary, method.weights.total);
		if (!checked.ok) throw extractAgain(args.workDir, 'summary', checked.errors);
		const projection = scoreProjectionOf({
			inputs: state.score_inputs,
			measures: summary.measures,
			merit: { rows: scored.rows },
			weights: method.weights,
			top5: summary.top5.map((entry) => entry.category)
		});
		sealedPack = sealedPackOf(state.pack, summary, merit, projection);
		const packCheck = parseSealedPack(JSON.parse(JSON.stringify(sealedPack)), args.auditId);
		if (!packCheck.ok) throw extractAgain(args.workDir, 'report pack', packCheck.errors);
	} catch (error) {
		if (error instanceof FinishError) throw error;
		if (error instanceof TypeError || error instanceof RangeError)
			throw extractAgain(args.workDir, 'report');
		throw error;
	}
	return { summary, sealedPack };
}

export type FinishResult = {
	reportLink: string;
	linkFile: string;
	summary: PlainSummary;
	/** The server already held this upload (a retry after a lost response). */
	alreadyUploaded: boolean;
	/** The grades file changed after a send that may have arrived: the first send went again. */
	gradesNotSent?: boolean;
};

export async function finish(args: {
	auditId: string;
	workDir: string;
	gradesFile: string;
	token: string;
	api: Api;
	cliVersion: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
	/** A line for people on stderr. */
	note?: (text: string) => void;
	/** The CLI's own folder (`paths.ts#baseDir`), where the link file goes. */
	base?: string;
}): Promise<FinishResult> {
	const base = args.base ?? baseDir();
	const uploadFile = join(args.workDir, WORK_FILES.upload);
	const linkFile = linkFileOf(args.auditId, base);
	const previous = readSavedUpload(uploadFile);
	// The server already took this audit's report (write-once): a re-run must not reseal with
	// a new key, or the saved link would stop opening the report. Keep the first send, and
	// print and save its link again, from what was kept of it.
	if (isConfirmed(previous) && previous.audit_id === args.auditId) {
		const origin = reportOriginOf(previous.report_url ?? null, args.api, args.note);
		const link = reportLink(origin, args.auditId, previous.key);
		writePrivate(linkFile, `${link}\n`, base);
		settle(args.workDir, args.auditId, previous, previous.summary, base);
		return { reportLink: link, linkFile, summary: previous.summary, alreadyUploaded: true };
	}
	const { state, pack } = readState(args.workDir);
	if (state.audit_id !== args.auditId)
		throw new FinishError('no_extract', 'The work directory belongs to another audit.');
	// A sealed upload kept for a retry, unless it says it was sealed for another audit.
	const pending =
		previous &&
		!isConfirmed(previous) &&
		(previous.audit_id === undefined || previous.audit_id === args.auditId)
			? previous
			: null;
	// The same from a sealed upload the server took and gave its URL for, kept whole.
	if (pending?.sent && pending.report_url) {
		const origin = reportOriginOf(pending.report_url, args.api, args.note);
		const link = reportLink(origin, args.auditId, pending.key);
		writePrivate(linkFile, `${link}\n`, base);
		settle(args.workDir, args.auditId, pending, pending.body.summary, base);
		return { reportLink: link, linkFile, summary: pending.body.summary, alreadyUploaded: true };
	}
	// The method extract computed with, from its saved copy (hash checked again): never downloaded.
	const method = savedMethod(args.workDir, args.auditId);
	if (method.content_hash !== state.method_hash)
		throw new MethodPackError(
			'method_invalid',
			'The saved method pack is not the one extract measured with; run `brain-audit extract` again.'
		);
	const hash = await meritPackHashOf(pack);
	if (hash !== pack.content_hash || hash !== state.merit_pack_hash)
		throw new FinishError(
			'pack_changed',
			'The merit pack changed after extract; run `brain-audit extract` again and grade the new pack.'
		);

	let gradesText: string;
	let gradesJson: unknown;
	try {
		gradesText = readFileSync(args.gradesFile, 'utf8');
		gradesJson = JSON.parse(gradesText);
	} catch (error) {
		throw new FinishError('grades_invalid', 'The grades file cannot be read as JSON.', [
			serverText(error instanceof Error ? error.message : String(error))
		]);
	}
	const gradesHash = await sha256Hex(JSON.stringify({ grades: gradesJson, pack: hash }));
	// A request already went out with the saved upload, and its answer was lost: the server may
	// hold that report, sealed under the saved key, and keeps the first one it takes. Resealing
	// would make a key that cannot open it, so the very same bytes go again, whatever the grades
	// file says now; edited grades are named and not sent (another report is another audit).
	let saved: PendingUpload | null = pending?.sent ? pending : null;
	const gradesNotSent = saved !== null && saved.grades_hash !== gradesHash;
	if (gradesNotSent)
		args.note?.(
			'The grades changed after an earlier send that may have reached the server. That first send goes again unchanged, under the same key, and the report keeps its grades; the edited grades are not sent. For a report with other grades, start a new audit.'
		);
	if (!saved) {
		const parsed = parseAgentGrades(method, gradesJson, pack, {
			files: new Set(state.tree_paths)
		});
		if (!parsed.ok)
			throw new FinishError(
				'grades_invalid',
				'The grades do not fit the pack; fix them and run finish again.',
				// They quote the grades file and the method's element ids: cleaned like server text.
				parsed.errors.map(serverText)
			);
		const { summary, sealedPack } = assembled({
			workDir: args.workDir,
			auditId: args.auditId,
			cliVersion: args.cliVersion,
			method,
			state,
			pack,
			grades: parsed.grades
		});
		// Sealed before but never sent: the same grades reuse it, other grades seal afresh.
		saved = pending?.grades_hash === gradesHash ? pending : null;
		if (!saved) {
			const { key, envelope } = await sealPack(sealedPack, args.auditId);
			saved = {
				audit_id: args.auditId,
				grades_hash: gradesHash,
				key,
				body: { summary, envelope: base64urlEncode(envelope) },
				sent: false
			};
			writePrivate(uploadFile, JSON.stringify(saved), base);
		}
	}
	saved.audit_id = args.auditId;
	// Everything the link needs is checked before anything is sent: once the server has answered,
	// nothing may fail before the link is saved.
	reportLink(args.api.origin, args.auditId, saved.key);

	const wasSent = saved.sent;
	saved.sent = true;
	writePrivate(uploadFile, JSON.stringify(saved), base);
	let status: number;
	let reportUrl: unknown;
	try {
		({ status, reportUrl } = await upload({
			api: args.api.base,
			auditId: args.auditId,
			token: args.token,
			body: saved.body,
			fetch: args.fetch ?? fetch,
			timeoutMs: args.timeoutMs ?? 120_000
		}));
	} catch (error) {
		if (error instanceof FinishError && error.code === 'upload_rejected' && isMethodChange(error))
			throw methodChanged(args.workDir, error.errors);
		throw error;
	}
	const alreadyUploaded = status === 409;
	if (alreadyUploaded && !wasSent)
		throw new FinishError(
			'upload_rejected',
			'The server already holds a report for this audit, sent from elsewhere; start a new audit.'
		);
	// Built here, always: on the origin of the server's report URL only when it is the --api
	// origin or a known audit server (its path, query and fragment are never used).
	const origin = reportOriginOf(reportUrl ?? saved.report_url ?? null, args.api, args.note);
	const path = reportPath(origin, args.auditId);
	if (reportUrl !== null && saved.report_url !== path) {
		saved.report_url = path;
		writePrivate(uploadFile, JSON.stringify(saved), base);
	}
	const link = reportLink(origin, args.auditId, saved.key);
	writePrivate(linkFile, `${link}\n`, base);
	// Confirmed (201, or 409 for this machine's own earlier send): only the link's parts stay.
	settle(args.workDir, args.auditId, saved, saved.body.summary, base);
	return {
		reportLink: link,
		linkFile,
		summary: saved.body.summary,
		alreadyUploaded,
		...(gradesNotSent ? { gradesNotSent: true } : {})
	};
}

/**
 * The audit server's refusals of a summary scored with a method it no longer stands behind
 * (its upload check): the method changed between extract and finish.
 */
const METHOD_CHANGE = [
	'the method served for this audit is no longer current',
	'not the method served for this audit'
];

function isMethodChange(error: FinishError): boolean {
	return error.errors.some((line) => METHOD_CHANGE.some((text) => line.includes(text)));
}

/**
 * The work files measured with the old method go (its pack, the extract state, the merit pack
 * graded from it, the sealed upload), so the next `extract` downloads the current method (the
 * server records it again while the audit has no upload) and `finish` cannot resend stale bytes.
 */
function methodChanged(workDir: string, errors: string[]): FinishError {
	for (const file of [WORK_FILES.method, WORK_FILES.state, WORK_FILES.meritPack, WORK_FILES.upload])
		rmSync(join(workDir, file), { force: true });
	return new FinishError(
		'method_changed',
		"The audit's method changed; run extract again, then grade again and run finish.",
		errors,
		'server'
	);
}

/** The audit server's limit on the request body. */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * `PUT <api>/api/audits/<audit_id>`, JSON body, the audit token as a bearer (the audit
 * server's contract). 201 `{ audit_id, report_url }` is success; 409 is "already uploaded"; any other
 * 4xx (401 token, 404 audit, 413 size, 422 `{ errors }`) throws `upload_rejected`, a 5xx, a
 * timeout or no answer `upload_failed`.
 */
async function upload(args: {
	api: string;
	auditId: string;
	token: string;
	body: UploadBody;
	fetch: typeof fetch;
	timeoutMs: number;
}): Promise<{ status: number; reportUrl: unknown }> {
	const text = JSON.stringify(args.body);
	if (new TextEncoder().encode(text).byteLength > UPLOAD_MAX_BYTES)
		throw new FinishError(
			'upload_rejected',
			'The sealed report is larger than the 25 MB the server takes; audit a smaller folder.'
		);
	const url = `${args.api.replace(/\/+$/, '')}/api/audits/${encodeURIComponent(args.auditId)}`;
	let response: Response;
	try {
		response = await args.fetch(url, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${args.token}`,
				'content-type': 'application/json',
				accept: 'application/json'
			},
			body: text,
			signal: AbortSignal.timeout(args.timeoutMs),
			// A redirect could carry the token and the report to another host: refused, never followed.
			redirect: 'error'
		});
	} catch (error) {
		if (isRedirectError(error))
			throw new FinishError('upload_failed', 'The server redirected the request; check --api.');
		throw new FinishError(
			'upload_failed',
			'The upload did not reach the server; run finish again.',
			[error instanceof Error ? error.message : String(error)]
		);
	}
	if (response.status === 409) return { status: 409, reportUrl: null };
	if (response.ok) {
		// Only its origin is ever used, and only once checked (`reportOriginOf`).
		const body = (await response.json().catch(() => null)) as { report_url?: unknown } | null;
		return { status: response.status, reportUrl: body?.report_url ?? null };
	}
	let detail: string[];
	try {
		detail = serverLines(await response.json());
	} catch {
		detail = [];
	}
	if (response.status >= 400 && response.status < 500)
		throw new FinishError(
			'upload_rejected',
			`The server refused the upload (HTTP ${response.status}).`,
			detail,
			'server'
		);
	throw new FinishError(
		'upload_failed',
		`The server failed (HTTP ${response.status}); run finish again.`,
		detail,
		'server'
	);
}
