import { ownershipOf } from './codeowners';
import { isEvidenceFolderPath } from './tool';
import { cleanAliases, pageEmbedsAsLinks, resolveBlockRefs } from './links';
import { areaPathOf } from './names';
import {
	brainFolderPath,
	brainSlug,
	decodedName,
	displayName,
	hasNotionId,
	journalDate,
	namedPath,
	shortHash,
	withoutNotionId
} from './names';
import { duplicateGroups, strippedPath } from './scope';
import { notionFolderPages, notionPathTitle } from './notion';
import { MIRROR_COPY_REASON, mirrorCopies, mirrorRank, type MirrorSides } from './mirrors';
import { headerValuesOf } from './access';
import type { ByobProfile } from '../profile/profile';
import { coercePageType } from '$lib/shared/type-coercion';
import type { Method } from '../method/types';
import { rulesOf, type MethodRules } from '../method/rules';
import { bodyOf, FRONTMATTER } from '../markdown';
import { splitFrontmatter, YamlParseError } from '$lib/shared/frontmatter';
import {
	citationGraph,
	citationReport,
	claimMapPageOf,
	withExtraProof,
	type Citation,
	type InlineClaim,
	type LinkReport
} from './citations';
import { isByobPlainText, isByobText } from './dialect';
import { skillFolderOf, skillFolders } from './manifest';
import { kindTypeOf, SELF_FIELD } from './kinds';
import { splitPersonHeading, unwrapWikiTag } from './person-keys';
import {
	decideRoles,
	declaredKinds,
	hasWrappedKind,
	isDeclaredPageType,
	isRecordDecision,
	OWNER_GROUP_DETAIL,
	unclearGroupOf,
	type RoleDecision
} from './roles';
import type { ByobDialect, ByobFile, ByobPage, OwnerHintSource, ReadinessByType } from './types';

const ROOT_README = /^readme\.(md|markdown|mdx)$/i;
export const BYOB_NOTES_CHARS_BUDGET = 60_000;
const ADR_STEM = /^\d{3,4}-/;
export const BYOB_CLAIMS_PER_PAGE = 5;
const CLAIM_SENTENCE_MAX = 300;

const FENCE = /^\s*(```|~~~)/;
const H1 = /^#\s+(.+?)\s*#*\s*$/;

type Draft = {
	file: ByobFile;
	kind: ByobPage['kind'];
	skipReason?: string;
	sourceDir: string;
	areaDir: string;
	stem: string;
	frontmatter: Record<string, unknown>;
	text: string;
	targetPath: string;
	type: string;
	set?: Record<string, string>;
	moved?: string[];
	skillDir?: string;
	decision: RoleDecision;
	tool?: string | null;
	ownsFolder?: true;
};

export type ByobClassification = {
	pages: ByobPage[];
	warnings: string[];
	notes: { path: string; text: string }[];
	notesListed: string[];
	citations: Citation[];
	links: LinkReport;
	inlineClaims: InlineClaim[];
	syntax: ToolSyntax;
};

export function classifyByobPages(
	files: readonly ByobFile[],
	options: {
		method: Method;
		dialect: ByobDialect;
		teamEmails?: readonly string[];
		strip?: readonly string[];
		profile?: ByobProfile | null;
		tool?: string | null;
		mirrors?: readonly MirrorSides[];
		root?: string | null;
	}
): ByobClassification {
	const root = options.root ?? null;
	const method = options.method;
	const r = rulesOf(method);
	const warnings: string[] = [];
	const all = resolveBlockRefs(files).sort((a, b) =>
		a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0
	);
	const ladder = ladderOptionsOf(options.profile ?? null);
	const sides = options.mirrors ?? [];
	const copies = copiesOf(method, all, options.dialect, { ...ladder, root }, sides);
	const stale = new Map([...mirrorCopies(all, sides)].filter(([path]) => !copies.has(path)));
	for (const [path, kept] of stale) copies.set(path, copies.get(kept) ?? kept);
	for (const [path, kept] of copies) {
		let target = kept;
		for (let hops = 0; copies.has(target) && hops < 8; hops += 1) target = copies.get(target)!;
		if (target !== kept) copies.set(path, target);
	}
	const sorted = copies.size > 0 ? all.filter((file) => !copies.has(file.sourcePath)) : all;
	const folders = skillFolders(sorted.map((file) => file.sourcePath));
	const strip = options.strip ?? [];
	const report = citationReport(sorted, {
		method,
		aliases: copies,
		strip,
		tool: options.tool ?? null
	});
	const roles = decideRoles(sorted, {
		method,
		dialect: options.dialect,
		skillDirs: folders,
		citations: report.edges,
		...ladder,
		root
	});
	const citations = withExtraProof(report.edges, (to, from) => {
		const target = roles.get(to);
		return target !== undefined && isRecordDecision(target) && roles.get(from)?.role === 'page';
	});
	const kinds: KindOptions = {
		map: options.profile?.kinds.map ?? {},
		...(options.profile?.kinds.ignore.length ? { ignore: options.profile.kinds.ignore } : {}),
		...(Object.keys(options.profile?.folders ?? {}).length > 0
			? { folders: options.profile!.folders }
			: {})
	};
	const tool = options.tool ?? null;
	const owners =
		tool === 'notion'
			? notionFolderPages(sorted.map((file) => file.sourcePath))
			: new Map<string, string>();
	const drafts = sorted.map((file) => {
		const owned = owners.get(file.sourcePath);
		const stripped =
			owned !== undefined && strip.some((s) => s.toLowerCase() === owned.toLowerCase());
		return {
			...draftOf(
				r,
				file,
				roles.get(file.sourcePath)!,
				options.dialect,
				folders,
				warnings,
				strip,
				kinds,
				tool
			),
			...(owned !== undefined && !stripped ? { ownsFolder: true as const } : {})
		};
	});
	assignTargetPaths(r, drafts, options.dialect, warnings, options.teamEmails ?? []);

	const linkIndex = buildLinkIndex(drafts);
	const kept = drafts.map((draft) => {
		const page = finishPage(r, draft, options.dialect, linkIndex);
		const detail = draft.decision.detail;
		if (detail?.startsWith(OWNER_GROUP_DETAIL))
			page.unclearGroup = detail.slice(OWNER_GROUP_DETAIL.length);
		return page;
	});
	const ownedBy = ownershipOf(sorted);
	for (const page of kept) {
		if (page.kind !== 'page' && page.kind !== 'skill' && page.kind !== 'unclear') continue;
		const owned = ownedBy(page.sourcePath);
		if (!owned) continue;
		page.reviewers = owned.reviewers;
		if (page.ownerHint !== null && page.ownerHintSource !== 'author') continue;
		if (page.ownerHint !== null) page.authorHint = page.ownerHint;
		page.ownerHint = owned.hint;
		page.ownerHintSource = 'codeowners';
	}
	markCitedEvidence(kept, citations);
	const keptByPath = new Map(kept.map((page) => [page.sourcePath, page]));
	const pages = [
		...kept,
		...all
			.filter((file) => copies.has(file.sourcePath))
			.map((file) =>
				duplicatePage(
					file,
					keptByPath.get(copies.get(file.sourcePath)!)!,
					stale.has(file.sourcePath) ? MIRROR_COPY_REASON : DUPLICATE_REASON
				)
			)
	].sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0));
	const { notes, notesListed } = notesOf(drafts, root);
	for (const page of pages)
		if (page.kind === 'skill' && page.skillDir)
			page.skillAssets = sorted
				.map((file) => file.sourcePath)
				.filter((path) => path.startsWith(page.skillDir!) && path !== page.sourcePath);
	const syntax = toolSyntaxOf(method, drafts, warnings);
	return {
		pages,
		warnings: collapsedTypeWarnings(warnings),
		notes,
		notesListed,
		citations,
		links: report.links,
		inlineClaims: report.claims,
		syntax
	};
}

export type ToolSyntax = {
	namespaces: number;
	properties: number;
	kindsUnwrapped: number;
	namesDecoded: number;
};

const SYNTAX_KINDS = new Set<Draft['kind']>(['page', 'unclear', 'skill', 'navigation']);

function toolSyntaxOf(method: Method, drafts: readonly Draft[], warnings: string[]): ToolSyntax {
	const out: ToolSyntax = { namespaces: 0, properties: 0, kindsUnwrapped: 0, namesDecoded: 0 };
	for (const draft of drafts) {
		if (!SYNTAX_KINDS.has(draft.kind)) continue;
		const name =
			draft.tool === 'notion' || hasNotionId(draft.stem)
				? withoutNotionId(draft.stem).name
				: draft.stem;
		const decoded = decodedName(name);
		if (decoded.decoded) out.namesDecoded += 1;
		if (decoded.rejected)
			warnings.push(
				`${draft.file.sourcePath}: its name decodes to ${decoded.rejected}; read as written`
			);
		if (namedPath(draft.stem, draft.tool ?? null).folders.length > 0) out.namespaces += 1;
		if (Object.keys(draft.frontmatter).length > 0) out.properties += 1;
		if (hasWrappedKind(method, headerValuesOf(draft.file.body))) out.kindsUnwrapped += 1;
	}
	return out;
}

export function toolSyntaxLine(syntax: ToolSyntax | undefined, tool: string | null): string | null {
	if (!syntax || syntax.namespaces + syntax.kindsUnwrapped + syntax.namesDecoded === 0) return null;
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const parts = [
		syntax.namespaces > 0
			? `${plural(syntax.namespaces, 'namespaced name', 'namespaced names')} split into folders`
			: '',
		syntax.properties > 0
			? `${plural(syntax.properties, 'page’s properties', 'pages’ properties')} read as its header`
			: '',
		syntax.kindsUnwrapped > 0
			? `${plural(syntax.kindsUnwrapped, 'kind', 'kinds')} read from a link or a tag`
			: '',
		syntax.namesDecoded > 0
			? `${plural(syntax.namesDecoded, 'name', 'names')} with escapes (%3F) read back`
			: ''
	].filter(Boolean);
	return `What ${tool ?? 'the tool'}’s syntax became: ${parts.join('; ')}.`;
}

const UNKNOWN_TYPE = /^(.+): type "(.+)" is not a page type; read as a topic$/;

function collapsedTypeWarnings(warnings: readonly string[]): string[] {
	const byType = new Map<string, string[]>();
	const out: string[] = [];
	for (const warning of warnings) {
		const hit = UNKNOWN_TYPE.exec(warning);
		if (!hit) {
			out.push(warning);
			continue;
		}
		const paths = byType.get(hit[2]!) ?? [];
		if (paths.length === 0) byType.set(hit[2]!, paths);
		paths.push(hit[1]!);
	}
	for (const [type, paths] of byType)
		out.push(
			paths.length === 1
				? `${paths[0]}: type "${type}" is not a page type; read as a topic`
				: `type "${type}" is not a page type on ${paths.length} files (e.g. ${paths[0]}); read as topics`
		);
	return out;
}

export function ladderOptionsOf(
	profile: ByobProfile | null
): Pick<Parameters<typeof decideRoles>[1], 'declared' | 'hints' | 'ownerRoles' | 'procedureNames'> {
	if (!profile) return {};
	const hintBasis = profile.origin.role_hints === 'inferred' ? 'dialect' : 'profile';
	const kindMap = Object.fromEntries(
		Object.entries(profile.kinds.map).map(([kind, entry]) => [
			kind,
			{
				role: entry.role ?? ('page' as const),
				detail: `kinds.map.${kind} (${profile.origin[`kinds.map.${kind}`] ?? profile.origin['kinds.map'] ?? 'inferred'})`
			}
		])
	);
	return {
		declared: {
			...(profile.kinds.ignore.length > 0 ? { kindIgnore: profile.kinds.ignore } : {}),
			...(profile.keys.event_date.length > 0 ? { eventDateKeys: profile.keys.event_date } : {}),
			...(profile.keys.event_date.includes('date') &&
			(profile.origin['keys.event_date'] === 'declared' ||
				profile.origin['keys.event_date'] === 'owner')
				? { dateIsEvent: true }
				: {}),
			...(Object.keys(kindMap).length > 0 ? { kindMap } : {})
		},
		...(profile.origin.role_hints === 'declared' && profile.role_hints.length === 0
			? { procedureNames: false }
			: {}),
		hints: profile.role_hints.map((h) => ({
			match: h.match,
			role: h.role,
			basis: hintBasis,
			why: h.why
		})),
		ownerRoles: profile.owner_roles.map((r) => ({
			...(r.path ? { path: r.path } : {}),
			...(r.group ? { group: r.group } : {}),
			...(r.cluster ? { cluster: r.cluster } : {}),
			...(r.source ? { source: r.source } : {}),
			...(r.source && r.declared ? { basis: 'profile' as const } : {}),
			role: r.role,
			...(r.as ? { as: r.as } : {}),
			...(r.type ? { type: r.type } : {}),
			...(r.via ? { via: r.via } : {})
		}))
	};
}

function copiesOf(
	method: Method,
	files: readonly ByobFile[],
	dialect: ByobDialect,
	ladder: ReturnType<typeof ladderOptionsOf> & { root?: string | null } = {},
	sides: readonly MirrorSides[] = []
): Map<string, string> {
	const out = new Map<string, string>();
	const keys = new Map(
		files.map((file) => [
			file.sourcePath,
			`${file.blob}\u0000${file.body.length}\u0000${shortHash(file.body)}`
		])
	);
	const keyOf = (file: ByobFile) => keys.get(file.sourcePath)!;
	const blobs = new Map<string, number>();
	for (const file of files) blobs.set(keyOf(file), (blobs.get(keyOf(file)) ?? 0) + 1);
	if (![...blobs.values()].some((n) => n > 1)) return out;
	const roles = decideRoles(files, {
		method,
		dialect,
		skillDirs: skillFolders(files.map((file) => file.sourcePath)),
		citations: citationGraph(files, { method }),
		...ladder
	});
	const grouped = files.map((file) => ({ sourcePath: file.sourcePath, blob: keyOf(file) }));
	for (const [kept, others] of duplicateGroups(
		grouped,
		(path) => roles.get(path)?.role ?? 'noise',
		(path) => mirrorRank(path, sides)
	))
		for (const copy of others) out.set(copy, kept);
	return out;
}

function duplicatePage(file: ByobFile, kept: ByobPage, reason = DUPLICATE_REASON): ByobPage {
	return {
		sourcePath: file.sourcePath,
		targetPath: '',
		kind: 'skip',
		skipReason: reason,
		duplicateOf: kept.sourcePath,
		role: kept.role,
		roleBasis: kept.roleBasis,
		type: kept.type,
		title: kept.title,
		ownerHint: null,
		frontmatter: {},
		body: '',
		links: [],
		claimsHint: [],
		aliases: [],
		blob: file.blob
	};
}

export const DUPLICATE_REASON = 'duplicate';

function citesForEvidence(page: Pick<ByobPage, 'role'>): boolean {
	return (
		page.role === 'page' ||
		page.role === 'procedure' ||
		page.role === 'history' ||
		page.role === 'setting'
	);
}

function markCitedEvidence(pages: ByobPage[], citations: readonly Citation[]): void {
	const bySource = new Map(pages.map((p) => [p.sourcePath, p]));
	const cited = new Set<string>();
	for (const edge of citations) {
		if (!edge.proof) continue;
		const from = bySource.get(edge.from);
		if (!from) continue;
		const citer =
			from.kind === 'evidence' && from.claimMapOf ? bySource.get(from.claimMapOf) : from;
		if (citer && citer.kind !== 'evidence' && citesForEvidence(citer)) cited.add(edge.to);
	}
	for (const page of pages) {
		if (page.kind !== 'evidence') continue;
		const mapped = page.claimMapOf ? bySource.get(page.claimMapOf) : undefined;
		page.cited = page.claimMapOf
			? mapped !== undefined && citesForEvidence(mapped)
			: cited.has(page.sourcePath);
	}
}

function noteRank(draft: Draft, root: string | null): number {
	const path = insideRoot(draft.file.sourcePath, root);
	if (ROOT_README.test(path)) return 0;
	if (/^(claude|agents)\.md$/i.test(path) || draft.decision.convention) return 1;
	if (!path.includes('/')) return /annex/i.test(path) ? 3 : 2;
	return /annex/i.test(path) ? 3 : 4;
}

function insideRoot(path: string, root: string | null): string {
	return root && path.startsWith(root) ? path.slice(root.length) : path;
}

function notesOf(
	drafts: readonly Draft[],
	root: string | null
): Pick<ByobClassification, 'notes' | 'notesListed'> {
	const ranked = drafts
		.filter(
			(draft) =>
				draft.kind === 'notes' ||
				(draft.kind === 'navigation' && ROOT_README.test(insideRoot(draft.file.sourcePath, root)))
		)
		.sort(
			(a, b) =>
				noteRank(a, root) - noteRank(b, root) || (a.file.sourcePath < b.file.sourcePath ? -1 : 1)
		);
	const notes: ByobClassification['notes'] = [];
	const notesListed: string[] = [];
	const listed = ({ file }: Draft) =>
		file.captureId ? `cap:${file.captureId} (${file.sourcePath})` : file.sourcePath;
	let left = BYOB_NOTES_CHARS_BUDGET;
	for (const draft of ranked) {
		const text = draft.file.body.replace(/^\uFEFF/, '');
		if (left > 0) {
			notes.push({ path: draft.file.sourcePath, text: text.slice(0, left) });
			left -= Math.min(text.length, left);
			if (text.length > notes.at(-1)!.text.length) notesListed.push(listed(draft));
		} else notesListed.push(listed(draft));
	}
	return { notes, notesListed };
}

function kindOf(decision: RoleDecision, sourceDir: string): ByobPage['kind'] {
	switch (decision.shape) {
		case 'page':
			return sourceDir.toLowerCase().split('/').includes('glossary') ? 'glossary' : 'page';
		case 'navigation':
			return 'navigation';
		case 'glossary':
			return 'glossary';
		case 'skill':
		case 'recipe':
			return 'skill';
		case 'claim_map':
		case 'capture':
			return 'evidence';
		case 'history':
			return 'history';
		case 'setting':
			return 'setting';
		case 'note':
			return 'notes';
		case 'unclear':
			return 'unclear';
		default:
			return 'skip';
	}
}

function draftOf(
	r: MethodRules,
	file: ByobFile,
	decision: RoleDecision,
	dialect: ByobDialect,
	skillDirs: readonly string[],
	warnings: string[],
	strip: readonly string[] = [],
	kinds: KindOptions = { map: {} },
	tool: string | null = null
): Draft {
	const path = file.sourcePath;
	const slash = path.lastIndexOf('/');
	const sourceDir = slash >= 0 ? path.slice(0, slash + 1) : '';
	const areaDir = strippedPath(sourceDir, strip);
	const name = path.slice(slash + 1);
	const stem = name.replace(/\.[^.]+$/, '');
	const kind = kindOf(decision, sourceDir);
	const base: Draft = {
		file,
		kind,
		sourceDir,
		areaDir,
		stem,
		frontmatter: {},
		text: '',
		targetPath: '',
		type: 'topic',
		decision,
		tool,
		...(kind === 'skip' ? { skipReason: decision.reason ?? 'not knowledge' } : {})
	};
	if (kind === 'skip' || r.claimMap.test(path) || !isByobText(path)) return base;
	const unread: string[] = [];
	const { frontmatter, text } = readFrontmatter(file, unread);
	const draft: Draft = { ...base, frontmatter, text };
	if (kind !== 'page' && kind !== 'skill' && kind !== 'navigation' && kind !== 'unclear')
		return draft;
	warnings.push(...unread);
	if (kind === 'skill') {
		draft.type = 'skill';
		draft.skillDir = skillFolderOf(path, skillDirs) ?? '';
	} else if (kind === 'page' || kind === 'unclear') {
		const warn = (message: string) => warnings.push(message);
		const typed = decision.pageType
			? { type: decision.pageType, set: undefined, moved: undefined }
			: dialect === 'kit'
				? kitType(r, draft, frontmatter, warn)
				: genericType(r, draft, frontmatter, firstH1(text), kinds, warn);
		draft.type = typed.type;
		if (typed.set) draft.set = typed.set;
		if (typed.moved) draft.moved = typed.moved;
	}
	return draft;
}

function readFrontmatter(
	file: ByobFile,
	warnings: string[]
): { frontmatter: Record<string, unknown>; text: string } {
	const raw = file.body.replace(/^\uFEFF/, '');
	if (!FRONTMATTER.test(raw)) return { frontmatter: {}, text: raw };
	try {
		const { frontmatter, body } = splitFrontmatter(raw);
		return { frontmatter, text: body };
	} catch (error) {
		if (!(error instanceof YamlParseError)) throw error;
		const lenient: Record<string, unknown> = {};
		for (const [key, values] of headerValuesOf(raw))
			if (values.length > 0) lenient[key] = values.length === 1 ? values[0] : values;
		warnings.push(
			`${file.sourcePath}: frontmatter could not be read strictly (${error.message}); read line by line`
		);
		return { frontmatter: lenient, text: bodyOf(raw) };
	}
}

function slugSegment(segment: string): string {
	return brainSlug(segment);
}

function asPagePath(path: string): string {
	return isByobPlainText(path) ? path.replace(/\.[^./]+$/, '.md') : path;
}

function namedOf(draft: Pick<Draft, 'stem' | 'tool' | 'ownsFolder'>): {
	folders: string[];
	name: string;
} {
	const named = namedPath(draft.stem, draft.tool ?? null);
	return {
		folders: draft.ownsFolder ? [...named.folders, named.name] : named.folders,
		name: journalDate(named.name) ?? named.name
	};
}

export function isTeamPersonDraft(
	method: Method,
	draft: Pick<Draft, 'sourceDir' | 'frontmatter'>,
	teamEmails: readonly string[]
): boolean {
	const { teamFolders, teamRelationships } = rulesOf(method);
	const folder = draft.sourceDir.split('/').filter(Boolean).at(-1)?.toLowerCase() ?? '';
	if (teamFolders.has(folder)) return true;
	const relationship = draft.frontmatter.relationship;
	if (typeof relationship === 'string' && teamRelationships.has(relationship.trim().toLowerCase()))
		return true;
	if (teamEmails.length === 0) return false;
	const team = new Set(teamEmails.map((e) => e.trim().toLowerCase()));
	const identities = draft.frontmatter.identities;
	const values = [
		draft.frontmatter.email,
		draft.frontmatter.emails,
		identities && typeof identities === 'object'
			? (identities as Record<string, unknown>).email
			: null
	].flatMap((v) => (Array.isArray(v) ? v : [v]));
	return values.some((v) => typeof v === 'string' && team.has(v.trim().toLowerCase()));
}

function assignTargetPaths(
	r: MethodRules,
	drafts: Draft[],
	dialect: ByobDialect,
	warnings: string[],
	teamEmails: readonly string[]
): void {
	const taken = new Map<string, string>();
	const claim = (draft: Draft, wanted: string) => {
		let target = wanted;
		for (let n = 2; taken.has(target.toLowerCase()); n += 1) {
			target = wanted.replace(/(\.[^./]+)?$/, (ext) => `-${n}${ext}`);
		}
		if (target !== wanted) {
			warnings.push(
				`${draft.file.sourcePath} and ${taken.get(wanted.toLowerCase())} both become ${wanted}; ${draft.file.sourcePath} is ${target}`
			);
		}
		taken.set(target.toLowerCase(), draft.file.sourcePath);
		draft.targetPath = target;
	};
	for (const draft of drafts) {
		if (draft.kind !== 'navigation') continue;
		const target = `${brainFolderPath(draft.areaDir)}README.md`;
		if (taken.has(target.toLowerCase())) {
			warnings.push(
				`${draft.file.sourcePath}: ${taken.get(target.toLowerCase())} is already the folder's navigation page; read as a page`
			);
			draft.kind = 'page';
			continue;
		}
		claim(draft, target);
	}
	for (const draft of drafts) {
		if (draft.kind === 'skill') {
			claim(draft, skillTargetPath(r, draft));
			continue;
		}
		if (draft.kind !== 'page' && draft.kind !== 'unclear') continue;
		const named = namedOf(draft);
		const pathName =
			draft.tool === 'notion' ? notionPathTitle(named.name, firstH1(draft.text)) : named.name;
		const slug = slugSegment(pathName) || 'page';
		if (draft.type === 'person') {
			claim(
				draft,
				isTeamPersonDraft(r.method, draft, teamEmails)
					? `people/team/${slug}.md`
					: `people/${slug}.md`
			);
			continue;
		}
		let wanted =
			dialect === 'kit' && draft.areaDir !== ''
				?
					asPagePath(
						`${draft.areaDir}${draft.file.sourcePath.slice(draft.sourceDir.length)}`
							.normalize('NFC')
							.toLowerCase()
					)
				:
					`${brainFolderPath(draft.areaDir + named.folders.map((f) => `${f}/`).join('')) || 'company/'}${slug}.md`;
		const reserved = r.reservedHomes.find(
			(home) => wanted.startsWith(home.prefix) && home.type !== draft.type
		);
		if (reserved) {
			warnings.push(
				`${draft.file.sourcePath}: ${reserved.prefix} holds ${reserved.type} pages only; this ${draft.type} page is under brought/`
			);
			wanted = `brought/${wanted}`;
		}
		claim(draft, wanted);
	}
}

function skillTargetPath(r: MethodRules, draft: Draft): string {
	const dir = draft.skillDir ? draft.areaDir + draft.skillDir.slice(draft.sourceDir.length) : '';
	const segments = (dir || draft.areaDir).split('/').filter(Boolean);
	const first = segments[0] ?? '';
	const area =
		!first || first.startsWith('.') || r.procedureHomeFolders.has(first.toLowerCase())
			? 'work/'
			: brainFolderPath(first);
	const name = dir ? (segments[segments.length - 1] ?? draft.stem) : draft.stem;
	return `${area}skills/${slugSegment(name) || 'skill'}.md`;
}

type LinkIndex = {
	byStem: Map<string, Set<string>>;
	bySource: Map<string, string>;
};

function buildLinkIndex(drafts: readonly Draft[]): LinkIndex {
	const byStem = new Map<string, Set<string>>();
	const bySource = new Map<string, string>();
	const add = (key: string, target: string) => {
		if (!key) return;
		const set = byStem.get(key) ?? new Set<string>();
		set.add(target);
		byStem.set(key, set);
	};
	for (const draft of drafts) {
		if (!draft.targetPath) continue;
		bySource.set(draft.file.sourcePath.toLowerCase(), draft.targetPath);
		if (draft.kind !== 'page' && draft.kind !== 'skill') continue;
		add(draft.stem.toLowerCase(), draft.targetPath);
		add(slugSegment(draft.stem), draft.targetPath);
		const named = namedPath(draft.stem, draft.tool ?? null);
		const full = [...named.folders, named.name].join('/');
		for (const key of [named.name, full]) {
			add(key.toLowerCase(), draft.targetPath);
			add(slugSegment(key), draft.targetPath);
		}
	}
	return { byStem, bySource };
}

function finishPage(
	r: MethodRules,
	draft: Draft,
	dialect: ByobDialect,
	index: LinkIndex
): ByobPage {
	const { file } = draft;
	const role = {
		role: draft.decision.role,
		roleBasis: draft.decision.basis,
		...(draft.decision.detail ? { roleBasisDetail: draft.decision.detail } : {}),
		...(draft.decision.declaredType ? { declaredType: draft.decision.declaredType } : {}),
		...(draft.decision.conflict ? { roleConflict: true } : {}),
		...(draft.decision.eventSource !== undefined ? { eventSource: draft.decision.eventSource } : {})
	};
	if (
		draft.kind === 'skip' ||
		draft.kind === 'notes' ||
		draft.kind === 'glossary' ||
		draft.kind === 'evidence' ||
		draft.kind === 'history' ||
		draft.kind === 'setting'
	) {
		const fm = draft.frontmatter;
		return {
			sourcePath: file.sourcePath,
			targetPath: '',
			kind: draft.kind,
			...role,
			...(draft.kind === 'evidence' && r.claimMap.test(file.sourcePath)
				? { claimMapOf: claimMapPageOf(r.method, file.sourcePath, file.body) }
				: {}),
			...(draft.skipReason ? { skipReason: draft.skipReason } : {}),
			...(file.data ? { data: true as const } : {}),
			...(file.data && file.body.trim() === '' ? { deferred: true as const } : {}),
			type: 'topic',
			title: stringOf(fm.title) ?? firstH1(draft.text) ?? stemTitle(draft),
			ownerHint: null,
			frontmatter: draft.kind === 'skip' || draft.kind === 'notes' ? {} : fm,
			body: draft.kind === 'glossary' || draft.kind === 'history' ? draft.text : '',
			links: [],
			claimsHint: [],
			aliases: [],
			blob: file.blob
		};
	}
	const links: ByobPage['links'] = [];
	const fm =
		draft.tool === 'notion'
			? headerLinks(draft.frontmatter, draft.sourceDir, index, links)
			: draft.frontmatter;
	const h1 = firstH1(draft.text);
	const fmTitle = stringOf(fm.title) ?? (draft.kind === 'skill' ? stringOf(fm.name) : null);
	const body = rewriteLinks(draft.text, draft.sourceDir, index, links);

	const kept: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fm)) {
		if (!r.platformKeys.has(key) && !draft.moved?.includes(key)) kept[key] = value;
	}
	const self = draft.set?.[SELF_FIELD] === 'true';
	for (const [key, value] of Object.entries(draft.set ?? {})) {
		if (key !== SELF_FIELD && !(key in kept)) kept[key] = value;
	}
	const type = draft.kind === 'navigation' ? 'topic' : draft.type;

	const title =
		(type === 'person' &&
			((h1 && splitPersonHeading(h1).name) ||
				(draft.tool === 'logseq' ? fmTitle : null) ||
				stemTitle(draft))) ||
		fmTitle ||
		h1 ||
		(draft.kind === 'navigation' ? folderName(draft.sourceDir) : null) ||
		(draft.kind === 'skill' && draft.skillDir ? folderName(draft.skillDir) : null) ||
		stemTitle(draft);
	const language = stringOf(fm.language) ?? stringOf(fm.lang);

	return {
		sourcePath: file.sourcePath,
		targetPath: draft.targetPath,
		kind: draft.kind,
		...role,
		...(draft.kind === 'navigation' && draft.decision.fileList ? { regenerate: true } : {}),
		...(draft.kind === 'unclear'
			? { unclearGroup: unclearGroupOf(file.sourcePath, headerValuesOf(file.body).keys()) }
			: {}),
		type,
		title,
		...ownerHintFields(ownerHintOf(r, fm, dialect, file.sourcePath)),
		...(self && type === 'person' ? { self: true as const } : {}),
		frontmatter: kept,
		body,
		links,
		claimsHint:
			draft.kind === 'page' || draft.kind === 'unclear' ? byobClaimSentences(draft.text) : [],
		aliases: aliasesOf(fm, draft.text),
		blob: file.blob,
		...(draft.kind === 'skill' ? { skillDir: draft.skillDir ?? '', skillAssets: [] } : {}),
		...(language ? { language } : {})
	};
}

type TypeOf = { type: string; set?: Record<string, string>; moved?: string[] };

function kitType(
	r: MethodRules,
	draft: Draft,
	fm: Record<string, unknown>,
	warn: (message: string) => void
): TypeOf {
	const written = stringOf(fm.type);
	const declared = written ? unwrapWikiTag(written).toLowerCase() : undefined;
	const decision = decisionArea(r, draft, declared, fm, warn);
	if (decision) return decision;
	if (declared && r.kitOrganizationTypes.has(declared)) return kindTypeOf(r.method, [declared])!;
	return { type: declared && isDeclaredPageType(r.method, declared) ? declared : 'topic' };
}

function decisionArea(
	r: MethodRules,
	draft: Draft,
	declared: string | undefined,
	fm: Record<string, unknown>,
	warn: (message: string) => void
): TypeOf | null {
	if (declared !== 'decision' || r.decisionKinds.has(stringOf(fm.kind) ?? '')) return null;
	warn(
		`${draft.file.sourcePath}: a decision without a decision kind (${[...r.decisionKinds].join(', ')}); read as a topic about a decision`
	);
	const status = stringOf(fm.status);
	const kind = stringOf(fm.kind);
	return {
		type: 'topic',
		set: {
			kind: 'decision-area',
			...(status ? { decision_status: status } : {}),
			...(kind ? { decision_kind: kind } : {})
		},
		...(kind ? { moved: ['kind'] } : {})
	};
}

type KindOptions = {
	map: Readonly<Record<string, { type: string; fields?: Record<string, string> }>>;
	ignore?: readonly string[];
	folders?: Readonly<Record<string, { type: string }>>;
};

function genericType(
	r: MethodRules,
	draft: Draft,
	fm: Record<string, unknown>,
	h1: string | null,
	kinds: KindOptions,
	warn: (message: string) => void
): TypeOf {
	const written = stringOf(fm.type);
	const declared = written ? unwrapWikiTag(written).toLowerCase() : undefined;
	if (!declared || !r.atomTypes.has(declared)) {
		const mapped = new Set(Object.keys(kinds.map).map((k) => k.toLowerCase()));
		const named = declaredKinds(r.method, headerValuesOf(draft.file.body), {
			...(kinds.ignore ? { kindIgnore: kinds.ignore } : {})
		}).filter(
			(kind) =>
				!r.groupKinds.has(kind) ||
				mapped.has(kind) ||
				looksLikePerson(r, h1 ?? stemTitle(draft), fm)
		);
		const byKind = kindTypeOf(r.method, named, kinds.map);
		if (byKind) return byKind;
	}
	const decision = decisionArea(r, draft, declared, fm, warn);
	if (decision) return decision;
	if (declared) {
		if (r.atomTypes.has(declared)) return { type: declared };
		const coercion = coercePageType(declared);
		if (coercion) return { type: coercion.to, set: coercion.set };
		warn(`${draft.file.sourcePath}: type "${declared}" is not a page type; read as a topic`);
		return { type: 'topic' };
	}
	const owned = Object.entries(kinds.folders ?? {})
		.filter(([folder]) => draft.sourceDir.startsWith(folder))
		.sort((a, b) => b[0].length - a[0].length)[0];
	if (owned) return { type: owned[1].type };
	const folders = areaPathOf(
		draft.sourceDir +
			namedPath(draft.stem, draft.tool ?? null)
				.folders.map((folder) => `${folder}/`)
				.join('')
	)
		.split('/')
		.filter(Boolean);
	const under = (names: ReadonlySet<string>) => folders.some((folder) => names.has(folder));
	const stem = slugSegment(draft.stem);
	const inMe = folders.at(-1) === r.meFolder;
	if (r.selfStemsAnywhere.has(stem) || (inMe && r.selfStems.has(stem)))
		return { type: 'person', set: { [SELF_FIELD]: 'true' } };
	if (inMe && r.goalStems.has(stem)) return { type: 'goal' };
	if (under(r.personFolders) && looksLikePerson(r, h1 ?? stemTitle(draft), fm))
		return { type: 'person' };
	if (under(r.systemFolders)) return { type: 'system' };
	if (
		under(r.organizationFolders) ||
		folders.some((folder, i) => r.organizationParents.has(folder) && i < folders.length - 1)
	)
		return { type: 'organization' };
	if (under(r.decisionFolders) || ADR_STEM.test(stem))
		return { type: 'topic', set: { kind: 'decision-area' } };
	return { type: 'topic' };
}

function looksLikePerson(r: MethodRules, h1: string | null, fm: Record<string, unknown>): boolean {
	if (!h1) return false;
	const words = splitPersonHeading(h1).name.split(/\s+/);
	if (words.length > 4) return false;
	const named = (word: string, i: number) =>
		/^\p{Lu}[\p{L}'’.-]*$/u.test(word) ||
		(i > 0 && i < words.length - 1 && r.nameParticles.has(word));
	if (!words.every(named)) return false;
	return words.length >= 2 || r.personKeys.some((key) => stringOf(fm[key]) != null);
}

function ownerHintFields(
	found: { hint: string; source: OwnerHintSource } | null
): Pick<ByobPage, 'ownerHint' | 'ownerHintSource'> {
	return found ? { ownerHint: found.hint, ownerHintSource: found.source } : { ownerHint: null };
}

function ownerHintOf(
	r: MethodRules,
	fm: Record<string, unknown>,
	dialect: ByobDialect,
	sourcePath = ''
): { hint: string; source: OwnerHintSource } | null {
	const copied =
		isEvidenceFolderPath(sourcePath) ||
		stringOf(fm.source) != null ||
		stringList(fm.source).length > 0 ||
		r.urlSourceKeys.some((key) => /^https?:\/\//i.test(stringOf(fm[key]) ?? '')) ||
		r.mailHeaderKeys.some((key) => stringOf(fm[key]) != null || stringList(fm[key]).length > 0);
	const keys =
		dialect === 'kit' ? ['owner'] : r.ownerKeys.filter((key) => key !== 'author' || !copied);
	for (const key of keys) {
		const value = fm[key];
		const hint = stringOf(value) ?? stringList(value)[0] ?? null;
		if (hint) return { hint, source: key === 'author' ? 'author' : 'header' };
	}
	return null;
}

const BY_TYPE_MAX = 12;

export function pagesByType(method: Method, pages: readonly ByobPage[]): ReadinessByType {
	const { typeFolders } = rulesOf(method);
	const counts = new Map<string, number>();
	const folders = new Set<string>();
	for (const page of pages) {
		const segments = page.sourcePath.split('/').slice(0, -1);
		segments.forEach((_, i) => folders.add(`${segments.slice(0, i + 1).join('/')}/`));
		if (page.kind !== 'page' || page.duplicateOf) continue;
		counts.set(page.type, (counts.get(page.type) ?? 0) + 1);
	}
	const sorted = [...folders].sort();
	const fixed = typeFolders.map(([type, names]) => ({
		type,
		pages: counts.get(type) ?? 0,
		folder:
			sorted.find((folder) => names.has(folder.slice(0, -1).split('/').pop()!.toLowerCase())) ??
			null
	}));
	const rest = [...counts]
		.filter(([type]) => !typeFolders.some(([fixedType]) => fixedType === type))
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
		.map(([type, count]) => ({ type, pages: count, folder: null }));
	return [...fixed, ...rest].slice(0, BY_TYPE_MAX);
}

const WIKI_LINK = /(?<!!)\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;
const MD_LINK = /(?<!!)\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\)/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function rewriteLinks(
	text: string,
	sourceDir: string,
	index: LinkIndex,
	links: ByobPage['links']
): string {
	let inFence = false;
	return text
		.split('\n')
		.map((line) => {
			if (FENCE.test(line)) {
				inFence = !inFence;
				return line;
			}
			if (inFence) return line;
			return pageEmbedsAsLinks(line)
				.replace(MD_LINK, (match, label: string, angled?: string, bare?: string) => {
					const href = (angled ?? bare ?? '').trim();
					const resolved = resolveRelativeLink(href, sourceDir, index);
					if (resolved === undefined) return match;
					links.push({ text: label, targetPath: resolved });
					return resolved ? `[${label}](${resolved})` : match;
				})
				.replace(WIKI_LINK, (_match, rawName: string, rawLabel?: string) => {
					const label = (rawLabel ?? rawName).trim();
					const target = resolveWikiLink(rawName, index);
					links.push({ text: label, targetPath: target });
					return target ? `[${label}](${target})` : label;
				});
		})
		.join('\n');
}

const HEADER_LINK = /^\[([^\]\n]*)\]\(([^)\s]+)\)$/;

function headerLinks(
	fm: Record<string, unknown>,
	sourceDir: string,
	index: LinkIndex,
	links: ByobPage['links']
): Record<string, unknown> {
	const read = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(read);
		const match = typeof value === 'string' ? HEADER_LINK.exec(value) : null;
		if (!match) return value;
		const [, label, href] = match;
		const resolved = resolveRelativeLink(href!, sourceDir, index);
		if (resolved === undefined) return value;
		links.push({ text: label!, targetPath: resolved });
		return resolved ? `[${label}](${resolved})` : label;
	};
	return Object.fromEntries(Object.entries(fm).map(([key, value]) => [key, read(value)]));
}

function resolveWikiLink(rawName: string, index: LinkIndex): string | null {
	const written = rawName
		.split('#')[0]!
		.trim()
		.replace(/\.(md|markdown|mdx)$/i, '');
	const name = written.replace(/^.*\//, '');
	if (!name) return null;
	const lookup = (key: string) => [
		...(index.byStem.get(key.toLowerCase()) ?? []),
		...(index.byStem.get(slugSegment(key)) ?? [])
	];
	const candidates = new Set<string>(lookup(name));
	if (candidates.size === 1) return [...candidates][0]!;
	if (written.includes('/')) {
		const full = new Set<string>(lookup(written));
		if (full.size === 1) return [...full][0]!;
	}
	return candidates.size === 1 ? [...candidates][0]! : null;
}

function resolveRelativeLink(
	href: string,
	sourceDir: string,
	index: LinkIndex
): string | null | undefined {
	if (!href || href.startsWith('#') || URL_SCHEME.test(href)) return undefined;
	const hash = href.indexOf('#');
	const pathPart = hash >= 0 ? href.slice(0, hash) : href;
	const anchor = hash >= 0 ? href.slice(hash) : '';
	if (!isByobText(pathPart)) return undefined;
	let decoded = pathPart;
	try {
		decoded = decodeURIComponent(pathPart);
	} catch {
	}
	const segments = (decoded.startsWith('/') ? decoded : `${sourceDir}${decoded}`).split('/');
	const out: string[] = [];
	for (const segment of segments) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			if (out.length === 0) return null;
			out.pop();
			continue;
		}
		out.push(segment);
	}
	const target = index.bySource.get(out.join('/').toLowerCase());
	return target ? `${target}${anchor}` : null;
}

const CURRENCY = /[€$£]\s?\d|\d\s?(?:[€$£]|zł)|\b(?:USD|EUR|GBP|PLN)\b/g;
const PERCENT = /\d(?:[.,]\d+)?\s?%|\b\d+(?:[.,]\d+)?\s?per\s?cent\b/gi;
const UNIT_NUMBER =
	/\b\d{2,}(?:[.,]\d+)*\s?(?:k|m|bn|kg|t|km|ms|min|h|hours?|days?|weeks?|months?|years?|users?|customers?|clients?|people|employees|staff|seats|deals|leads|calls|tickets|orders|units?|projects?|requests?|gb|tb|mb|kwh|kw|mw)\b/gi;
const MONTH =
	'(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE = new RegExp(
	[
		'\\b\\d{4}-\\d{2}-\\d{2}\\b',
		`\\b(?:\\d{1,2}\\s+)?${MONTH}\\.?\\s+(?:\\d{1,2},?\\s+)?\\d{4}\\b`,
		'\\b[QH][1-4]\\s?(?:20)?\\d{2}\\b',
		'\\bFY\\s?(?:20)?\\d{2}\\b'
	].join('|'),
	'gi'
);

const count = (re: RegExp, text: string) => text.match(re)?.length ?? 0;

export function byobClaimSpecificity(sentence: string): number {
	return (
		3 * count(CURRENCY, sentence) +
		2 * count(PERCENT, sentence) +
		2 * count(DATE, sentence) +
		count(UNIT_NUMBER, sentence)
	);
}

export function byobClaimSentences(text: string): string[] {
	const found: string[] = [];
	for (const block of proseBlocks(text)) {
		for (const sentence of block.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"„(€$£])/u)) {
			const clean = sentence.trim();
			if (clean.length < 8 || found.includes(clean)) continue;
			if (byobClaimSpecificity(clean) === 0) continue;
			found.push(clip(clean, CLAIM_SENTENCE_MAX));
			if (found.length >= BYOB_CLAIMS_PER_PAGE) return found;
		}
	}
	return found;
}

function proseBlocks(text: string): string[] {
	const blocks: string[] = [];
	let current: string[] = [];
	let inFence = false;
	const flush = () => {
		if (current.length > 0) blocks.push(current.join(' '));
		current = [];
	};
	for (const rawLine of text.split(/\r?\n/)) {
		if (FENCE.test(rawLine)) {
			flush();
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#') || /^\|?\s*:?-{3,}/.test(line)) {
			flush();
			continue;
		}
		const item = /^(?:[-*+]|\d+[.)])\s+/.test(line) || line.startsWith('|');
		if (item) flush();
		const plain = line
			.replace(/^>\s*/, '')
			.replace(/^(?:[-*+]|\d+[.)])\s+/, '')
			.replace(/^\||\|$/g, '')
			.replace(/\s*\|\s*/g, ' | ')
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
			.replace(/(\*\*|__|`)/g, '')
			.trim();
		if (plain) current.push(plain);
		if (item) flush();
	}
	flush();
	return blocks;
}

export function firstH1(text: string): string | null {
	let inFence = false;
	for (const line of text.split(/\r?\n/)) {
		if (FENCE.test(line)) inFence = !inFence;
		if (inFence) continue;
		const match = H1.exec(line);
		if (match) return match[1]!.trim() || null;
	}
	return null;
}

function stringOf(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function stringList(value: unknown): string[] {
	if (typeof value === 'string') return stringOf(value) ? [value.trim()] : [];
	if (!Array.isArray(value)) return [];
	return value.map(stringOf).filter((v): v is string => v != null);
}

const ALSO_KNOWN_AS = /^(?:Also known as|Also|AKA):\s*(.+)$/im;
const BODY_ALIASES_MAX = 8;
const BODY_ALIAS_CHARS = 60;

export function aliasesOf(fm: Record<string, unknown>, text = ''): string[] {
	return cleanAliases([...stringList(fm.aliases), ...stringList(fm.alias), ...bodyAliases(text)]);
}

function bodyAliases(text: string): string[] {
	const lines = text.split(/\r?\n/);
	const h1 = lines.findIndex((line) => H1.test(line));
	const next = lines.slice(h1 + 1).find((line) => line.trim() !== '');
	const match = next ? ALSO_KNOWN_AS.exec(next.trim()) : null;
	if (h1 < 0 || !match) return [];
	return match[1]!
		.split(/[,;]/)
		.map((name) =>
			name
				.trim()
				.replace(/[.*_]+$/g, '')
				.replace(/^[*_]+/, '')
		)
		.filter((name) => name !== '' && name.length <= BODY_ALIAS_CHARS)
		.slice(0, BODY_ALIASES_MAX);
}

function folderName(sourceDir: string): string | null {
	const segments = sourceDir.split('/').filter(Boolean);
	return segments.length > 0 ? segments[segments.length - 1]! : null;
}

function stemTitle(draft: Pick<Draft, 'stem' | 'tool'>): string {
	const name = displayName(draft.stem, draft.tool ?? null);
	return journalDate(name) ? name : humanize(name);
}

function humanize(stem: string): string {
	const words = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : stem;
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
