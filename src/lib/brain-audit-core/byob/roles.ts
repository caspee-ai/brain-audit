import { DATA_SOURCE_REASON, DEFERRED_SOURCE_REASON } from './data';
import { OWNERSHIP_FILE_RE } from './codeowners';
import { accessMatches, headerValuesOf } from './access';
import { globMatches } from './glob';
import { bodyOf, FRONTMATTER, TEMPLATE_TOKEN } from '../markdown';
import { splitFrontmatter } from '$lib/shared/frontmatter';
import type { Method } from '../method/types';
import { rulesOf, type MethodRules } from '../method/rules';
import type { Citation } from './citations';
import { isByobNavigationFile, isByobText } from './dialect';
import { BRAIN_EXCLUDED_RE, skillFolderOf } from './tree-paths';
import { clusterIndexOf } from './signature';
import { isJournalPath } from './tool';
import { notionIdOf } from './notion';
import { unwrapWikiTag } from './person-keys';
import type { ByobDialect, ByobRole, ByobRoleBasis, SourceGroup } from './types';

export type RoleShape =
	| 'page'
	| 'navigation'
	| 'glossary'
	| 'skill'
	| 'recipe'
	| 'claim_map'
	| 'capture'
	| 'history'
	| 'setting'
	| 'note'
	| 'noise'
	| 'unclear';

export type RoleDecision = {
	role: ByobRole;
	basis: ByobRoleBasis;
	shape: RoleShape;
	declaredType: string | null;
	reason?: string;
	conflict?: boolean;
	eventSource?: string;
	convention?: boolean;
	fileList?: boolean;
	detail?: string;
	pageType?: string;
};

export function sourceValueKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, '-');
}

export function sourceValueOf(
	method: Method,
	header: ReadonlyMap<string, readonly string[]>
): string | null {
	for (const key of rulesOf(method).eventSourceKeys) {
		const value = header.get(key)?.[0] ?? '';
		if (value.trim() !== '') return sourceValueKey(value);
	}
	return null;
}

export const CONVENTION_KEYS_MIN = 3;
export const FILE_LIST_SHARE = 0.8;
const LISTED_FILE =
	/^\s*(?:[-*+]|\d+[.)]|\|)?\s*(?:\[\[[^\]\n]+\]\]|\[[^\]\n]*\]\([^)\n]+\)|`?[\w./ -]+\.(?:md|mdx|markdown)`?)\s*\|?\s*$/i;

export function isFileList(body: string): boolean {
	const lines = textAfterHeader(body)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== '' && !/^#/.test(line) && !/^\|?\s*:?-{3,}/.test(line));
	if (lines.length < 3) return false;
	return lines.filter((line) => LISTED_FILE.test(line)).length / lines.length >= FILE_LIST_SHARE;
}

function keysNamed(text: string, keys: ReadonlySet<string>): number {
	let n = 0;
	for (const key of keys) {
		const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (new RegExp(`(^|[^\\w])${escaped}([^\\w]|$)`, 'i').test(text)) n += 1;
	}
	return n;
}

export type DeclaredOptions = {
	kindIgnore?: readonly string[];
	eventDateKeys?: readonly string[];
	dateIsEvent?: boolean;
	kindMap?: Readonly<Record<string, { role: ByobRole; detail: string }>>;
};

export function isKnownKind(method: Method, kind: string): boolean {
	const r = rulesOf(method);
	return (
		r.declared.some((entry) => entry.types.includes(kind)) ||
		r.evidenceKinds.has(kind) ||
		isPageKind(method, kind)
	);
}

export type RoleMatch = { path?: string; stem?: string; key?: string; value?: string };

export type RoleHint = {
	match: RoleMatch;
	role: ByobRole;
	basis: 'dialect' | 'profile';
	why: string;
};

export type OwnerRoleEdit = {
	path?: string;
	group?: string;
	cluster?: string;
	source?: string;
	basis?: 'owner' | 'profile';
	role: ByobRole;
	as?: 'glossary' | 'navigation';
	type?: string;
	via?: 'model';
};

const SHAPE_OF_ROLE: Record<ByobRole, RoleShape> = {
	page: 'page',
	evidence: 'capture',
	procedure: 'recipe',
	history: 'history',
	note: 'note',
	setting: 'setting',
	noise: 'noise',
	unclear: 'unclear'
};

export const UNCLEAR_GROUP_MIN = 10;

export const OWNER_GROUP_DETAIL = 'owner_roles.group ';

export function unclearGroupOf(path: string, headerKeys: Iterable<string>): string {
	const slash = path.indexOf('/');
	const top = slash > 0 ? path.slice(0, slash + 1) : '';
	return `${top}|${[...new Set(headerKeys)].sort().join(',')}`;
}

export function profileMatches(
	match: RoleMatch,
	path: string,
	header: ReadonlyMap<string, readonly string[]>
): boolean {
	if (!match.path && !match.stem && !match.key) return false;
	if (
		match.stem &&
		path
			.slice(path.lastIndexOf('/') + 1)
			.replace(/\.[^.]+$/, '')
			.toLowerCase() !== match.stem.toLowerCase()
	)
		return false;
	if (match.path || match.key)
		return accessMatches({ path: match.path, key: match.key, value: match.value }, path, header);
	return true;
}

export function declaredKinds(
	method: Method,
	header: ReadonlyMap<string, readonly string[]>,
	options: DeclaredOptions = {}
): string[] {
	const r = rulesOf(method);
	const ignore = new Set((options.kindIgnore ?? r.kindIgnore).map((k) => k.toLowerCase()));
	for (const key of r.kindKeys) {
		const values = header.get(key);
		if (!values || values.length === 0) continue;
		const out: string[] = [];
		for (const value of values) {
			const parts = unwrapWikiTag(value).toLowerCase().trim().split('/').filter(Boolean);
			const tries = parts.length > 1 ? [parts.at(-1)!, parts[0]!] : parts;
			for (const kind of tries) if (!ignore.has(kind) && !out.includes(kind)) out.push(kind);
		}
		if (out.length > 0) return out;
	}
	return [];
}

export function hasWrappedKind(
	method: Method,
	header: ReadonlyMap<string, readonly string[]>
): boolean {
	for (const key of rulesOf(method).kindKeys) {
		const values = header.get(key);
		if (!values || values.length === 0) continue;
		return values.some((value) => unwrapWikiTag(value) !== value.trim());
	}
	return false;
}

export function eventHeaderOf(
	method: Method,
	header: ReadonlyMap<string, readonly string[]>,
	options: DeclaredOptions = {}
): { source: string | null } | null {
	const r = rulesOf(method);
	const has = (keys: readonly string[]) => keys.some((key) => (header.get(key)?.[0] ?? '') !== '');
	const source = sourceValueOf(method, header);
	const kind = source ? r.sourceValueRoles[source] : undefined;
	if (source && kind === 'document') return has(r.captureDateKeys) ? { source } : null;
	const declared = (options.eventDateKeys ?? r.eventDateKeys).filter(
		(key) =>
			!r.contentDateKeys.includes(key) &&
			(!r.genericDateKeys.includes(key) || options.dateIsEvent === true)
	);
	const strong = [...new Set([...r.eventDateKeys, ...declared, 'artifact'])];
	if (source && kind === 'record' && has([...strong, ...r.genericDateKeys])) return { source };
	if (source && has(strong)) return { source };
	if (has(r.mailFromKeys) && has(r.mailToKeys) && has(r.mailDateKeys)) return { source };
	return null;
}

export function hasEventHeader(
	method: Method,
	header: ReadonlyMap<string, readonly string[]>,
	options: DeclaredOptions = {}
): boolean {
	return eventHeaderOf(method, header, options) !== null;
}

export function isWebClipHeader(
	method: Method,
	header: ReadonlyMap<string, readonly string[]>
): boolean {
	const r = rulesOf(method);
	return (
		r.clipUrlKeys.some((key) => /^https?:\/\//i.test(header.get(key)?.[0] ?? '')) &&
		r.clipDateKeys.some((key) => (header.get(key)?.[0] ?? '') !== '')
	);
}

export function isPageKind(method: Method, kind: string): boolean {
	return isDeclaredPageType(method, kind) || rulesOf(method).pageKinds.has(kind);
}

const TOOL_NOISE =
	/(^|\/)(\.trash|__macosx|logseq\/bak|logseq\/\.recycle|logseq\/version-files|\.foam|_site|\.docusaurus|\.quartz-cache|_snippets|_partials|partials|_includes)\/|\.excalidraw\.mdx?$|\(conflicted copy[^)]*\)|\.sync-conflict-/i;
const PLACEHOLDER = /\{\{[^}\n]+\}\}|<%[^%\n]*%>/;

export type RoleFile = { sourcePath: string; body: string; data?: true };

export const TEMPLATE_PLACEHOLDER_REASON = 'template_placeholder';

export function isRecordDecision(
	decision: Pick<RoleDecision, 'role' | 'basis' | 'detail'>
): boolean {
	if (decision.role !== 'evidence' && decision.role !== 'history') return false;
	if (decision.detail?.startsWith(OWNER_SOURCE_DETAIL)) return false;
	if (decision.basis === 'owner' || decision.basis === 'triage' || decision.basis === 'profile')
		return true;
	return (
		decision.basis === 'declared' &&
		/^kinds\.map\.\S+ \((declared|owner)\)$/.test(decision.detail ?? '')
	);
}

export function templatePlaceholderOf(body: string): string | null {
	const raw = body.replace(/^\uFEFF/, '');
	const header = FRONTMATTER.exec(raw)?.[1] ?? '';
	for (const line of header.split(/\r?\n/)) {
		const value = line.replace(/^\s*(?:-\s+)?[\w.-]+\s*:/, '');
		const hit = TEMPLATE_TOKEN.exec(value);
		if (hit) return hit[0];
	}
	let fenced = false;
	for (const line of textAfterHeader(raw).split(/\r?\n/)) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		if (fenced) continue;
		const h1 = /^#\s+(.+)$/.exec(line);
		if (h1) return TEMPLATE_TOKEN.exec(h1[1]!)?.[0] ?? null;
	}
	return null;
}

function stringOf(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function headerOf(body: string): Record<string, unknown> {
	if (!FRONTMATTER.test(body)) return {};
	try {
		return splitFrontmatter(body).frontmatter;
	} catch {
		return {};
	}
}

export function textAfterHeader(body: string): string {
	return bodyOf(body).replace(/^\uFEFF/, '');
}

export function isDeclaredPageType(method: Method, type: string): boolean {
	const r = rulesOf(method);
	return r.atomTypes.has(type) || r.kitPageTypes.has(type);
}

type Draft = {
	file: RoleFile;
	rel: string;
	dir: string;
	name: string;
	decided: RoleDecision | null;
	declaredType: string | null;
	kinds: string[];
	event: boolean;
	eventSource: string | null;
	source: string | null;
	clip: boolean;
};

const decide = (
	role: ByobRole,
	basis: ByobRoleBasis,
	shape: RoleShape,
	declaredType: string | null,
	reason?: string
): RoleDecision => ({ role, basis, shape, declaredType, ...(reason ? { reason } : {}) });

export const OWNER_SOURCE_DETAIL = 'owner_roles.source ';

function earlyRungs(
	draft: Draft,
	r: MethodRules,
	dialect: ByobDialect,
	skillDirs: readonly string[],
	repoKeys: ReadonlySet<string> = new Set(),
	kindMap?: DeclaredOptions['kindMap'],
	sourceRoles: ReadonlyMap<string, OwnerRoleEdit> = new Map()
): RoleDecision | null {
	const { sourcePath, body } = draft.file;
	const path = draft.rel;
	const declared = draft.declaredType;
	if (OWNERSHIP_FILE_RE.test(path)) return decide('setting', 'file_name', 'setting', declared);
	if (BRAIN_EXCLUDED_RE.test(path))
		return decide('noise', 'hard_fact', 'noise', declared, 'tooling, not knowledge');
	const skillDir = skillFolderOf(sourcePath, skillDirs);
	if (skillDir !== null && !r.skillFile.test(sourcePath.slice(skillDir.length)))
		return decide('noise', 'hard_fact', 'noise', declared, "a skill's asset; its skill cites it");
	if (/^\.claude\//i.test(path) && skillDir === null)
		return decide('noise', 'hard_fact', 'noise', declared, 'tooling for coding agents, not a page');
	if (dialect === 'kit' && r.kitTooling.test(path))
		return decide(
			'noise',
			'hard_fact',
			'noise',
			declared,
			"the kit's build tooling, not knowledge"
		);
	if (TOOL_NOISE.test(path) || /^excalidraw-plugin\s*:/im.test(body.slice(0, 2_000)))
		return decide('noise', 'hard_fact', 'noise', declared, "the tool's own files, not knowledge");
	if (draft.file.data)
		return decide(
			'evidence',
			'hard_fact',
			'capture',
			declared,
			body.trim() === '' ? DEFERRED_SOURCE_REASON : DATA_SOURCE_REASON
		);
	if (body.trim() === '') return decide('noise', 'hard_fact', 'noise', declared, 'an empty file');
	if (notionIdOf(sourcePath) !== null && /^\s*#\s+[^\n]*\s*$/.test(body))
		return decide('noise', 'hard_fact', 'noise', declared, 'a title and nothing else');
	const placeholder = isByobText(path) && skillDir === null ? templatePlaceholderOf(body) : null;
	if (placeholder)
		return {
			...decide('noise', 'hard_fact', 'noise', declared, 'a template, not a page'),
			detail: `${TEMPLATE_PLACEHOLDER_REASON}: ${placeholder} in its title, H1 or header`
		};
	const readable = isByobText(path);
	const bySource =
		readable && skillDir === null && draft.source ? sourceRoles.get(draft.source) : undefined;
	if (bySource) {
		const basis = bySource.basis ?? 'owner';
		return {
			...decide(
				bySource.role,
				basis,
				bySource.role === 'page' && bySource.as ? bySource.as : SHAPE_OF_ROLE[bySource.role],
				declared
			),
			detail: `${OWNER_SOURCE_DETAIL}${draft.source}${basis === 'profile' ? ' (declared)' : ''}`
		};
	}
	let pageKind: string | null = null;
	let pageDetail: string | undefined;
	if (readable && skillDir === null) {
		for (const kind of draft.kinds) {
			const alias = r.declared.find((entry) => entry.types.includes(kind));
			if (alias) return decide(alias.role as ByobRole, 'declared', alias.shape as RoleShape, kind);
			if (r.evidenceKinds.has(kind)) return decide('evidence', 'declared', 'capture', kind);
			const mapped = kindMap?.[kind];
			if (mapped && mapped.role !== 'page')
				return {
					...decide(mapped.role, 'declared', SHAPE_OF_ROLE[mapped.role], kind),
					detail: mapped.detail
				};
			if (mapped || isPageKind(r.method, kind)) {
				pageKind = kind;
				pageDetail = mapped?.detail;
				break;
			}
		}
		if (!pageKind && draft.event)
			return {
				...decide('evidence', 'declared', 'capture', declared),
				eventSource: draft.eventSource ?? ''
			};
		if (!pageKind && draft.clip) return decide('evidence', 'declared', 'capture', declared);
	}
	if (skillDir !== null) return decide('procedure', 'file_name', 'skill', declared);
	if (r.claimMap.test(path)) return decide('evidence', 'file_name', 'claim_map', declared);
	if (draft.dir === '' && r.rootSettings.test(draft.name))
		return decide('setting', 'file_name', 'setting', declared);
	if (draft.dir === '' && r.rootNotes.test(draft.name))
		return decide('note', 'file_name', 'note', declared);
	if (!readable) return null;
	if (r.ledger.test(path)) return decide('history', 'file_name', 'history', declared);
	if (!pageKind && isJournalPath(path)) return decide('unclear', 'file_name', 'unclear', declared);
	if (isByobNavigationFile(path)) {
		const navigation = decide('page', 'file_name', 'navigation', declared);
		return isFileList(body) ? { ...navigation, fileList: true } : navigation;
	}
	if (
		draft.dir.split('/').filter(Boolean).length <= 1 &&
		r.conventionName.test(draft.name) &&
		keysNamed(textAfterHeader(body), repoKeys) >= CONVENTION_KEYS_MIN
	)
		return { ...decide('note', 'file_name', 'note', declared), convention: true };
	const stem = draft.name.replace(/\.[^.]+$/, '');
	if (declared === 'glossary' || r.glossaryStem.test(stem))
		return decide('page', declared === 'glossary' ? 'declared' : 'file_name', 'glossary', declared);
	if (pageKind) {
		const page = {
			...decide('page', 'declared', 'page', pageKind),
			...(pageDetail ? { detail: pageDetail } : {})
		};
		return draft.event ? { ...page, conflict: true } : page;
	}
	return null;
}

function procedureNameRung(
	draft: Draft,
	r: MethodRules,
	dialect: ByobDialect
): RoleDecision | null {
	if (dialect === 'kit' || !isByobText(draft.file.sourcePath)) return null;
	const stem = draft.name.replace(/\.[^.]+$/, '');
	const folder = draft.dir
		.toLowerCase()
		.split('/')
		.filter(Boolean)
		.find((name) => r.procedureFolders.has(name));
	if (!r.procedureStem.test(stem) && !folder) return null;
	return {
		...decide('procedure', 'file_name', 'recipe', draft.declaredType),
		detail: r.procedureStem.test(stem)
			? `file name: ${r.procedureStem.exec(stem)![0]}`
			: `folder: ${folder}/`
	};
}

function dialectRung(draft: Draft, r: MethodRules, dialect: ByobDialect): RoleDecision | null {
	const path = draft.rel;
	const declared = draft.declaredType;
	const readable = isByobText(path);
	if (dialect === 'kit') {
		if (!readable) return null;
		for (const row of r.kitDialectPaths)
			if (row.path.endsWith('/') ? path.startsWith(row.path) : path === row.path)
				return decide(row.role as ByobRole, 'dialect', row.shape as RoleShape, declared);
		if (r.pageDirs.some((prefix) => path.startsWith(prefix)))
			return decide('page', 'dialect', 'page', declared);
		return null;
	}
	if (!readable) return null;
	const folders = draft.dir.toLowerCase().split('/').filter(Boolean);
	if (folders.some((folder) => r.templateFolders.has(folder)) && PLACEHOLDER.test(draft.file.body))
		return decide('noise', 'dialect', 'noise', declared, 'a template, not knowledge');
	const stem = draft.name.replace(/\.[^.]+$/, '');
	if (/(^|[-_ ])template$/i.test(stem) || folders.includes('archetypes'))
		return decide('noise', 'dialect', 'noise', declared, 'a template, not knowledge');
	if (folders.some((folder) => r.personFolders.has(folder)))
		return decide('page', 'dialect', 'page', declared);
	if (folders.includes('glossary')) return decide('page', 'dialect', 'glossary', declared);
	return null;
}

function hasProse(body: string): boolean {
	return textAfterHeader(body)
		.split(/\r?\n/)
		.some((line) => /[\p{L}\p{N}]/u.test(line.replace(/^[#>*\-+\s|`]+/, '')));
}

export function decideRoles(
	files: readonly RoleFile[],
	options: {
		method: Method;
		dialect: ByobDialect;
		skillDirs: readonly string[];
		citations: readonly Citation[];
		declared?: DeclaredOptions;
		hints?: readonly RoleHint[];
		ownerRoles?: readonly OwnerRoleEdit[];
		procedureNames?: boolean;
		root?: string | null;
	}
): Map<string, RoleDecision> {
	const root = options.root ?? '';
	const method = options.method;
	const r = rulesOf(method);
	const drafts = new Map<string, Draft>();
	for (const file of files) {
		const rel =
			root && file.sourcePath.startsWith(root)
				? file.sourcePath.slice(root.length)
				: file.sourcePath;
		const slash = rel.lastIndexOf('/');
		const readable = isByobText(file.sourcePath);
		const header = readable ? headerValuesOf(file.body) : new Map<string, string[]>();
		const kinds = declaredKinds(method, header, options.declared);
		const strictType = readable ? stringOf(headerOf(file.body).type)?.toLowerCase() : undefined;
		const event = eventHeaderOf(method, header, options.declared);
		const draft: Draft = {
			file,
			rel,
			dir: slash >= 0 ? rel.slice(0, slash + 1) : '',
			name: rel.slice(slash + 1),
			decided: null,
			declaredType: strictType ?? kinds[0] ?? null,
			kinds: strictType ? [strictType] : kinds,
			event: event !== null,
			eventSource: event ? (event.source ?? '') : null,
			source: sourceValueOf(method, header),
			clip: isWebClipHeader(method, header)
		};
		drafts.set(file.sourcePath, draft);
	}
	const repoKeys = new Set<string>();
	for (const file of files)
		if (isByobText(file.sourcePath))
			for (const key of headerValuesOf(file.body).keys()) repoKeys.add(key);
	const ownerPaths = (options.ownerRoles ?? []).filter((edit) => edit.path);
	const sourceRoles = new Map(
		(options.ownerRoles ?? []).flatMap((edit) =>
			edit.source ? [[sourceValueKey(edit.source), edit] as const] : []
		)
	);
	for (const draft of drafts.values()) {
		const edit = ownerPaths.find((e) => globMatches(e.path!, draft.file.sourcePath));
		draft.decided = edit
			? decide(
					edit.role,
					'owner',
					edit.role === 'page' && edit.as ? edit.as : SHAPE_OF_ROLE[edit.role],
					draft.declaredType
				)
			: earlyRungs(
					draft,
					r,
					options.dialect,
					options.skillDirs,
					repoKeys,
					options.declared?.kindMap,
					sourceRoles
				);
	}
	const proofCiters = new Map<string, Set<string>>();
	const seeAlsoCiters = new Map<string, Set<string>>();
	const citesAsProof = new Map<string, Set<string>>();
	const seeAlsoTargets = new Map<string, Set<string>>();
	for (const edge of options.citations) {
		if (!drafts.has(edge.from) || !drafts.has(edge.to)) continue;
		const into = edge.proof ? proofCiters : seeAlsoCiters;
		into.set(edge.to, (into.get(edge.to) ?? new Set()).add(edge.from));
		const out = edge.proof ? citesAsProof : seeAlsoTargets;
		out.set(edge.from, (out.get(edge.from) ?? new Set()).add(edge.to));
	}
	const roleNow = (path: string): ByobRole | null => drafts.get(path)?.decided?.role ?? null;
	const open = (path: string) => {
		const draft = drafts.get(path);
		return draft !== undefined && !draft.decided && isByobText(path) && hasProse(draft.file.body);
	};
	const linked = (path: string) =>
		[...(seeAlsoCiters.get(path) ?? []), ...(seeAlsoTargets.get(path) ?? [])].some(
			(other) =>
				other !== path &&
				(roleNow(other) === 'page' || roleNow(other) === 'unclear' || open(other))
		);
	const pageLike = (path: string) => roleNow(path) === 'page' || (open(path) && linked(path));
	const citesForProof = (path: string) => {
		const role = roleNow(path);
		return pageLike(path) || role === 'setting' || role === 'history' || role === 'procedure';
	};
	for (let changed = true; changed;) {
		changed = false;
		for (const draft of drafts.values()) {
			if (draft.decided || !isByobText(draft.file.sourcePath)) continue;
			const path = draft.file.sourcePath;
			const citesPages = [...(citesAsProof.get(path) ?? [])].some(pageLike);
			if ([...(proofCiters.get(path) ?? [])].some(citesForProof) && !citesPages) {
				draft.decided = decide('evidence', 'cited', 'capture', draft.declaredType);
				changed = true;
			}
		}
		for (const draft of drafts.values()) {
			if (draft.decided || !open(draft.file.sourcePath)) continue;
			if (linked(draft.file.sourcePath)) {
				draft.decided = decide('page', 'cited', 'page', draft.declaredType);
				changed = true;
			}
		}
	}
	const headerOfPath = new Map<string, ReadonlyMap<string, readonly string[]>>();
	const headerFor = (draft: Draft) => {
		let header = headerOfPath.get(draft.file.sourcePath);
		if (!header) {
			header = isByobText(draft.file.sourcePath) ? headerValuesOf(draft.file.body) : new Map();
			headerOfPath.set(draft.file.sourcePath, header);
		}
		return header;
	};
	const ownerGroups = new Map(
		(options.ownerRoles ?? []).flatMap((e) => (e.group ? [[e.group, e.role] as const] : []))
	);
	const ownerClusters = new Map(
		(options.ownerRoles ?? []).flatMap((e) => (e.cluster ? [[e.cluster, e] as const] : []))
	);
	const clusters = ownerClusters.size > 0 ? clusterIndexOf(files, root) : null;
	const groupRole = (draft: Draft): RoleDecision | null => {
		const group = unclearGroupOf(draft.file.sourcePath, headerFor(draft).keys());
		const role = ownerGroups.get(group);
		if (role)
			return {
				...decide(role, 'owner', SHAPE_OF_ROLE[role], draft.declaredType),
				detail: `${OWNER_GROUP_DETAIL}${group}`
			};
		const cluster = clusters?.get(draft.file.sourcePath);
		if (!cluster) return null;
		const edit =
			ownerClusters.get(cluster.id) ??
			cluster.members.map((id) => ownerClusters.get(id)).find((e) => e !== undefined);
		if (!edit) return null;
		return {
			...decide(
				edit.role,
				'owner',
				edit.role === 'page' && edit.as ? edit.as : SHAPE_OF_ROLE[edit.role],
				draft.declaredType
			),
			detail: `owner_roles.cluster ${edit.cluster}${edit.via === 'model' ? ' (via model)' : ''}`,
			...(edit.role === 'page' && edit.type ? { pageType: edit.type } : {})
		};
	};
	const hintFor = (draft: Draft): RoleDecision | null => {
		if (!isByobText(draft.file.sourcePath)) return null;
		const hint = (options.hints ?? []).find((h) =>
			profileMatches(h.match, draft.file.sourcePath, headerFor(draft))
		);
		return hint
			? decide(hint.role, hint.basis, SHAPE_OF_ROLE[hint.role], draft.declaredType)
			: null;
	};
	for (const draft of drafts.values()) {
		if (draft.decided?.role === 'unclear' && draft.decided.basis !== 'owner')
			draft.decided = groupRole(draft) ?? draft.decided;
		if (draft.decided) continue;
		draft.decided =
			dialectRung(draft, r, options.dialect) ??
			hintFor(draft) ??
			((options.procedureNames ?? true) ? procedureNameRung(draft, r, options.dialect) : null) ??
			(isByobText(draft.file.sourcePath)
				? hasProse(draft.file.body)
					? (groupRole(draft) ?? decide('unclear', 'dialect', 'unclear', draft.declaredType))
					: decide('noise', 'hard_fact', 'noise', draft.declaredType, 'no text')
				: decide('noise', 'hard_fact', 'noise', draft.declaredType, 'not a Markdown file'));
	}
	const pageDirs = new Set<string>();
	for (const draft of drafts.values())
		if (
			(draft.decided!.role === 'page' || draft.decided!.role === 'unclear') &&
			draft.decided!.shape !== 'navigation'
		) {
			const parts = draft.dir.split('/').filter(Boolean);
			for (let i = 0; i <= parts.length; i += 1)
				pageDirs.add(
					parts
						.slice(0, i)
						.map((p) => `${p}/`)
						.join('')
				);
		}
	for (const draft of drafts.values())
		if (draft.decided!.shape === 'navigation' && !pageDirs.has(draft.dir))
			draft.decided = decide('note', 'file_name', 'note', draft.declaredType);
	for (const draft of drafts.values()) {
		const decision = draft.decided!;
		if (decision.role !== 'page' || decision.basis !== 'declared') continue;
		if (
			[...(proofCiters.get(draft.file.sourcePath) ?? [])].some((from) => roleNow(from) === 'page')
		)
			decision.conflict = true;
	}
	return new Map([...drafts].map(([path, draft]) => [path, draft.decided!]));
}

export const SOURCE_DOMINANCE_SHARE = 0.5;

export function sourceGroupsOf(
	pages: readonly { sourcePath: string; duplicateOf?: string; eventSource?: string }[]
): SourceGroup[] {
	const admitted = pages.filter((page) => !page.duplicateOf && isByobText(page.sourcePath));
	const evidence = admitted.filter((page) => page.eventSource !== undefined);
	if (admitted.length === 0 || evidence.length < admitted.length * SOURCE_DOMINANCE_SHARE)
		return [];
	const byValue = new Map<string, string[]>();
	for (const page of evidence)
		if (page.eventSource)
			byValue.set(page.eventSource, [...(byValue.get(page.eventSource) ?? []), page.sourcePath]);
	const groups: SourceGroup[] = [];
	for (const [value, paths] of byValue) {
		if (paths.length < UNCLEAR_GROUP_MIN) continue;
		const folders = new Map<string, number>();
		for (const path of paths) {
			const folder = path.slice(0, path.lastIndexOf('/') + 1) || '(root)';
			folders.set(folder, (folders.get(folder) ?? 0) + 1);
		}
		groups.push({
			value,
			files: paths.length,
			of: admitted.length,
			folders: [...folders]
				.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
				.slice(0, 3)
				.map(([f]) => f),
			samples: [...paths].sort().slice(0, 3)
		});
	}
	return groups.sort((a, b) => b.files - a.files || (a.value < b.value ? -1 : 1));
}
