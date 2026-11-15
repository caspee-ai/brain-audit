/**
 * The work files read back: each one's JSON checked for the fields the CLI uses (present, of
 * the right primitive type, arrays where it indexes them) before it is used. A file of another
 * shape (including `null`, an array or a string) reads as "not there", so the command says to
 * run extract again rather than crash. These are not full schemas: the merit pack's own hash
 * and the method pack's parser check the rest.
 */
import type { MeritMetadataPack } from '$lib/brain-audit-core';
import { decodeKey, type PlainSummary } from '$lib/brain-audit-core/pack';
import type { WorkState } from './extract';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every(isString);
const isNumberOrNull = (value: unknown) => value === null || typeof value === 'number';

/** The `state_version` a `state.json` says it has, when it is an object at all. */
export function stateVersionOf(value: unknown): unknown {
	return isRecord(value) ? value.state_version : undefined;
}

const isNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

/** A share `{ numerator, denominator }` of numbers. */
const shareOk = (value: unknown) =>
	isRecord(value) && isNumber(value.numerator) && isNumber(value.denominator);

/** The structural score's inputs, every share the score projection reads. */
function scoreInputsOk(value: unknown): boolean {
	if (!isRecord(value) || !isNumber(value.pages)) return false;
	const groups: Record<string, readonly string[]> = {
		links: ['resolved', 'not_orphan'],
		structure: ['expected_headings', 'no_empty_section'],
		metadata: ['expected_keys_filled', 'with_owner'],
		dating: ['dated', 'current']
	};
	return Object.entries(groups).every(([group, shares]) => {
		const record = value[group];
		return isRecord(record) && shares.every((share) => shareOk(record[share]));
	});
}

/** A record whose values are all numbers. */
const countsOk = (value: unknown) => isRecord(value) && Object.values(value).every(isNumber);

/**
 * The measures `finish` builds the summary from: every group an object, the counts it adds to
 * or reads numbers. The summary's own check then holds them to its exact keys.
 */
function measuresOk(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const totals = value.totals;
	if (!countsOk(totals) || !isNumber((totals as Json).files)) return false;
	for (const group of ['by_role', 'links', 'freshness', 'tags', 'structure', 'findings'])
		if (!countsOk(value[group])) return false;
	if (!isRecord(value.subscores) || !Object.values(value.subscores).every(isNumberOrNull))
		return false;
	return isNumber(value.areas) && isNumber(value.depth_max);
}

/** `state.json`, or null when it is not one this CLI wrote. */
export function parseWorkState(value: unknown): WorkState | null {
	if (!isRecord(value) || value.state_version !== 3) return null;
	if (!isString(value.audit_id) || !isString(value.method_hash)) return null;
	if (!isString(value.method_version) || !isString(value.cli_version)) return null;
	if (!isStringArray(value.tree_paths)) return null;
	if (value.merit_pack_hash !== null && !isString(value.merit_pack_hash)) return null;
	if (!scoreInputsOk(value.score_inputs)) return null;
	const structural = value.structural;
	if (!isRecord(structural) || !measuresOk(structural.measures)) return null;
	if (structural.company_type !== null && !isString(structural.company_type)) return null;
	if (!isString(structural.brain_format) || !isNumberOrNull(structural.structural_score))
		return null;
	const pack = value.pack;
	if (!isRecord(pack) || !isRecord(pack.tree) || !Array.isArray(pack.tree.files)) return null;
	if (!pack.tree.files.every((file) => isRecord(file) && isString(file.path))) return null;
	return value as unknown as WorkState;
}

/** `merit-pack.json`, or null when it is not a merit pack. */
export function parseMeritPack(value: unknown): MeritMetadataPack | null {
	if (!isRecord(value) || !isString(value.content_hash)) return null;
	if (!Array.isArray(value.elements) || !value.elements.every(isRecord)) return null;
	if (!Array.isArray(value.pages) || !value.pages.every(isRecord)) return null;
	if (!Array.isArray(value.clusters) || typeof value.read_limit !== 'number') return null;
	return value as unknown as MeritMetadataPack;
}

/** The upload request body, as the audit server accepts it. */
export type UploadBody = {
	summary: PlainSummary;
	/** The sealed envelope (`sealPack().envelope`), base64url without padding. */
	envelope: string;
};

/** `upload.json` before the server confirmed it: everything a retry sends again. */
export type PendingUpload = {
	/** The audit it was sealed for (absent from files written before it was kept). */
	audit_id?: string;
	grades_hash: string;
	key: string;
	body: UploadBody;
	/** A request was sent at least once: a 409 then most likely means it arrived. */
	sent: boolean;
	/**
	 * The report's address without the key, for a retry that only reads 409: built here on the
	 * accepted origin, and checked again when read back.
	 */
	report_url?: string | null;
};

/**
 * `upload.json` after the server confirmed it: the sealed envelope is gone; the key, the
 * report's address and the scores stay, so a re-run prints the same link and scores.
 */
export type ConfirmedUpload = {
	confirmed: true;
	audit_id: string;
	grades_hash: string;
	key: string;
	sent: true;
	report_url?: string | null;
	summary: PlainSummary;
};

const reportUrlOk = (value: unknown) => value === undefined || value === null || isString(value);

/** The scores a re-run prints, of the right types. */
const summaryOk = (value: unknown): value is PlainSummary =>
	isRecord(value) &&
	isNumberOrNull(value.structural_score) &&
	isNumberOrNull(value.merit_score) &&
	isNumberOrNull(value.total_score);

/** `upload.json` in either form, or null when it is neither (or unreadable). */
export function parseSavedUpload(value: unknown): PendingUpload | ConfirmedUpload | null {
	if (!isRecord(value) || !isString(value.key) || !isString(value.grades_hash)) return null;
	// The key goes into the link: one that is not a key is no saved upload.
	if (!decodeKey(value.key)) return null;
	if (!reportUrlOk(value.report_url)) return null;
	if (value.audit_id !== undefined && !isString(value.audit_id)) return null;
	if (value.confirmed === true) {
		if (!isString(value.audit_id) || value.sent !== true || !summaryOk(value.summary)) return null;
		return value as unknown as ConfirmedUpload;
	}
	if (typeof value.sent !== 'boolean') return null;
	const body = value.body;
	if (!isRecord(body) || !isString(body.envelope) || !summaryOk(body.summary)) return null;
	return value as unknown as PendingUpload;
}

export const isConfirmed = (
	saved: PendingUpload | ConfirmedUpload | null
): saved is ConfirmedUpload => (saved as { confirmed?: unknown } | null)?.confirmed === true;

/** `method.json`: the pack as served, and the audit it was served for. */
export type SavedMethod = { audit_id: string; method: unknown };

/** `method.json`'s wrapper, or null when it is not one (the pack inside is parsed apart). */
export function parseSavedMethod(value: unknown): SavedMethod | null {
	if (!isRecord(value) || !isString(value.audit_id) || !('method' in value)) return null;
	return { audit_id: value.audit_id, method: value.method };
}
