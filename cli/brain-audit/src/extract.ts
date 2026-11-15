/**
 * `brain-audit extract`: the platform's intake and structural audit over a local folder, then
 * the metadata pack for merit grading. The order and the limits are the intake's: the folder
 * walk is the tree; a root `byob.yml` gives the scope and data types; the manifest decides
 * which files are read; those are decoded as the platform decodes them; then `classifyBrought` and `auditBrought`. The structural score is
 * therefore the platform's for the same files (a parity test holds them equal).
 *
 * Differences from a pinned repository, all of which make a file unread rather than different:
 * an HTML export is not converted (the platform's HTML stage is not in the core), and a mirror
 * pair tied on dates is broken by folder name (no `git log`).
 */
import { readFileSync } from 'node:fs';
import {
	auditBrought,
	AUDIT_VERSION,
	buildByobManifest,
	buildMeritPack,
	BYOB_PROFILE_FILE,
	classifyBrought,
	dataExtensions,
	inScope,
	readDeclaredProfile,
	treeMirrorPairs,
	type BroughtAudit,
	type BroughtAuditInput,
	type BroughtClassified,
	type ByobFile,
	type DeclaredProfile,
	type MeritMetadataPack,
	type ScoreInputs
} from '$lib/brain-audit-core';
import { broughtDataText } from '$lib/brain-audit-core/byob/data';
import { effectiveScope, type ByobScope } from '$lib/brain-audit-core/byob/scope';
import {
	engineVersionOf,
	isBrainFormat,
	PACK_VERSION,
	type CompanyType
} from '$lib/brain-audit-core/pack';
import { decodeUtf8 } from '$lib/brain-audit-core/byob/decode';
import type { Method } from '$lib/brain-audit-core/method';
import { linkEdgesOf } from './edges';
import { packBaseOf, plainMeasuresOf, type PackBase, type StructuralSummary } from './pack';
import { walkFolder, type WalkedEntry } from './walk';

/** The platform's default limits: files read, and bytes per file. */
export const LIMITS = { maxFiles: 50_000, maxFileBytes: 1_048_576 } as const;

export class ExtractError extends Error {
	constructor(
		readonly code: 'not_a_folder' | 'manifest' | 'walk',
		message: string
	) {
		super(message);
	}
}

/** What `extract` read: the classification and audit, plus why each unread file was not read. */
export type LocalAudit = {
	treePaths: string[];
	classified: BroughtClassified;
	input: BroughtAuditInput;
	audit: BroughtAudit;
	/** Files kept but not read, with the reason (over_size, credentials, not_utf8, html). */
	unread: { path: string; why: string }[];
};

const nonEmptyScope = (s: ByobScope | undefined) =>
	s && (s.include.length > 0 || s.exclude.length > 0 || s.strip.length > 0) ? s : null;

/**
 * The folder's audit with the audit's method pack, measured at `measuredAt` (ISO). Reads files;
 * sends nothing.
 */
export async function auditFolder(
	method: Method,
	root: string,
	measuredAt: string,
	/** Absolute folders the walk never enters: the CLI's own work directories. */
	skip: readonly string[] = []
): Promise<LocalAudit> {
	let entries: WalkedEntry[];
	try {
		entries = walkFolder(root, skip);
	} catch (error) {
		throw new ExtractError('walk', error instanceof Error ? error.message : String(error));
	}
	const byPath = new Map(entries.map((entry) => [entry.path, entry]));
	const treePaths = entries.map((entry) => entry.path);

	const declaredEntry = byPath.get(BYOB_PROFILE_FILE);
	const declared: DeclaredProfile | null = declaredEntry
		? readDeclaredProfile(method, decodeUtf8(readFileSync(declaredEntry.abs)) ?? '')
		: null;
	const scope = effectiveScope(nonEmptyScope(declared?.profile?.scope));
	const tree = {
		truncated: false,
		entries: entries.map(({ path, sha, size }) => ({ path, sha, size }))
	};
	const mirrors = treeMirrorPairs(
		method,
		tree.entries.filter((entry) => inScope(entry.path, scope)),
		null
	);
	const dataScope = declared?.profile?.data;
	const data = dataExtensions(
		dataScope && (dataScope.include.length > 0 || dataScope.exclude.length > 0) ? dataScope : null
	);
	const built = buildByobManifest(method, tree, LIMITS, scope, data, null);
	if (!built.ok) throw new ExtractError('manifest', built.message);
	const manifest = built.manifest;

	const unread = [...manifest.skipped];
	for (const html of manifest.html) unread.push({ path: html.path, why: 'html' });
	const files: ByobFile[] = [];
	for (const file of manifest.files) {
		if (file.deferred) {
			files.push({ sourcePath: file.path, body: '', blob: file.sha, data: true, binary: true });
			continue;
		}
		const decoded = decodeUtf8(readFileSync(byPath.get(file.path)!.abs));
		const text =
			decoded !== null && file.kind === 'data' ? broughtDataText(file.path, decoded) : decoded;
		if (text === null) {
			unread.push({ path: file.path, why: 'not_utf8' });
			continue;
		}
		files.push({
			sourcePath: file.path,
			body: text,
			blob: file.sha,
			...(file.kind === 'data' ? { data: true as const } : {})
		});
	}

	const classified = await classifyBrought({
		method,
		files,
		folder: null,
		scope,
		treePaths,
		mirrors,
		declared,
		owner: null
	});
	const input: BroughtAuditInput = {
		method,
		profile: classified.effective,
		files,
		pages: classified.classified.pages,
		citations: classified.classified.citations,
		clusterOf: new Map(
			classified.signatureClusters.flatMap((cluster) =>
				cluster.paths.map((path) => [path, cluster.id] as const)
			)
		),
		root: null,
		strip: classified.strip,
		outOfScopePaths: manifest.outOfScopePaths,
		placeholders: classified.dialectBase.placeholders,
		unreadPaths: unread.map((item) => item.path),
		unreadUnlisted: 0
	};
	return {
		treePaths,
		classified,
		input,
		audit: auditBrought(input, measuredAt),
		unread: unread.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
	};
}

/** The work directory's `state.json`: what `finish` needs, names included. Local only. */
export type WorkState = {
	state_version: 3;
	cli_version: string;
	audit_id: string;
	measured_at: string;
	brain_dir: string;
	read_limit: number;
	/** The method pack extract computed with (`method.json`): `finish` must score with the same. */
	method_version: string;
	method_hash: string;
	/** Every path of the walked folder: the grades' read paths are checked against it. */
	tree_paths: string[];
	/** The merit pack's `content_hash`; null when no company type was given. */
	merit_pack_hash: string | null;
	/** The structural score's inputs: `finish` projects the scores after a fix from them. */
	score_inputs: ScoreInputs;
	structural: Omit<StructuralSummary, 'company_type'> & { company_type: CompanyType | null };
	pack: PackBase;
};

export type ExtractOutput = {
	state: WorkState;
	meritPack: MeritMetadataPack | null;
	local: LocalAudit;
};

/** The engine version: this CLI's, the audit's, the method pack's rubric's and the pack's. */
export function engineVersion(cli: string, method: Method): string {
	return engineVersionOf({
		cli,
		audit: AUDIT_VERSION,
		rubric: method.rubric.rubric_version,
		pack: PACK_VERSION
	});
}

export async function extract(args: {
	/** The audit's method pack, downloaded and checked (`method.ts#methodFor`). */
	method: Method;
	brainDir: string;
	auditId: string;
	companyType: CompanyType | null;
	readLimit: number;
	cliVersion: string;
	measuredAt?: string;
	/** Folders inside the brain the walk leaves out (the work directory, `~/.caspee`). */
	skip?: readonly string[];
}): Promise<ExtractOutput> {
	const measuredAt = args.measuredAt ?? new Date().toISOString();
	const local = await auditFolder(args.method, args.brainDir, measuredAt, args.skip ?? []);
	const links = linkEdgesOf(local.input);
	const pack = await packBaseOf({
		auditId: args.auditId,
		measuredAt,
		audit: local.audit,
		links
	});
	const tool = local.classified.tool.tool;
	const meritPack = args.companyType
		? await buildMeritPack({
				rows: local.audit.rows,
				clusters: local.classified.signatureClusters,
				companyType: args.companyType,
				measuredAt,
				readLimit: args.readLimit,
				method: args.method
			})
		: null;
	const state: WorkState = {
		state_version: 3,
		cli_version: args.cliVersion,
		audit_id: args.auditId,
		measured_at: measuredAt,
		brain_dir: args.brainDir,
		read_limit: args.readLimit,
		method_version: args.method.method_version,
		method_hash: args.method.content_hash,
		tree_paths: local.treePaths,
		merit_pack_hash: meritPack?.content_hash ?? null,
		score_inputs: local.audit.inputs,
		structural: {
			company_type: args.companyType,
			brain_format: isBrainFormat(tool) ? tool : 'generic',
			structural_score: local.audit.score.score,
			measures: plainMeasuresOf(local.audit.summary, local.audit.score, pack.findings)
		},
		pack
	};
	return { state, meritPack, local };
}
