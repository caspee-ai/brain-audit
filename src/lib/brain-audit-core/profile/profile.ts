import { dataExtensions } from '../byob/data';
import { namesAdminsGroupReader } from '../vocabulary/owners-group';
import type { Method } from '../method/types';
import { rulesOf } from '../method/rules';
import {
	accessMarkerId,
	exceptionPathKey,
	type AccessMarkerException,
	type AccessMatch,
	type ProfileAccessMarker
} from '../byob/access';
import { globToRegExp } from '../byob/glob';
import { sourceValueKey } from '../byob/roles';
import { readRecordMapping, type RecordMapping } from '../byob/records/mapping';
import { emptyScope, type ByobScope, type MirrorDecision } from '../byob/scope';
import {
	DATA_CATEGORIES,
	DATA_CHOICES,
	isFloorCategory,
	parseDataPolicy,
	RETIRED_DATA_CATEGORIES,
	type DataCategory,
	type DataPolicy
} from '../vocabulary/data-policy';

export type ByobProfileOrigin = 'inferred' | 'declared' | 'owner';

export const FILE_ROLES = [
	'page',
	'evidence',
	'procedure',
	'history',
	'note',
	'setting',
	'noise'
] as const;
export type FileRole = (typeof FILE_ROLES)[number];

export type ProfileMatch = { path?: string; stem?: string; key?: string; value?: string };

export const OWNER_PAGE_SHAPES = ['glossary', 'navigation'] as const;
export type OwnerPageShape = (typeof OWNER_PAGE_SHAPES)[number];

export type OwnerRole = {
	path?: string;
	group?: string;
	cluster?: string;
	source?: string;
	declared?: true;
	role: FileRole;
	as?: OwnerPageShape;
	type?: string;
	why: string;
	via?: ProfileVia;
};

export type ProfileVia = 'model';
const viaOf = (value: unknown): { via?: ProfileVia } => (value === 'model' ? { via: 'model' } : {});

export function isOwnerPageShape(value: unknown): value is OwnerPageShape {
	return typeof value === 'string' && (OWNER_PAGE_SHAPES as readonly string[]).includes(value);
}

export type ByobProfile = {
	version: 1;
	origin: Record<string, ByobProfileOrigin>;
	scope: ByobScope;
	mirrors: MirrorDecision[];
	role_hints: { match: ProfileMatch; role: FileRole; why: string; via?: ProfileVia }[];
	kinds: {
		map: Record<
			string,
			{ type: string; fields?: Record<string, string>; role?: KindRole; via?: ProfileVia }
		>;
		ignore: string[];
	};
	keys: {
		owner: string[];
		event_date: string[];
		content_date: string[];
		as_of: { keys: string; date_key: string }[];
		source: { app: string | null; id: string | null; thread: string | null };
		relations: Record<string, { field: string | null; target_type: string | null }>;
		drop: string[];
	};
	access: { markers: ProfileAccessMarker[] };
	people: {
		team_domains: string[];
		team_when: ProfileMatch[];
		agents: string[];
		self?: ByobSelfDecision;
		hints?: ByobHintDecision[];
		candidates?: ByobCandidateDecision[];
	};
	citations: { pattern: string; why: string }[];
	owner_roles: OwnerRole[];
	company: { name?: string; description?: string; domains?: string[] } | null;
	folders: Record<string, { type: string; via?: ProfileVia }>;
	areas: Record<string, { title?: string; purpose?: string; readers?: string[]; owner?: string }>;
	data: { include: string[]; exclude: string[] };
	data_policy?: DataPolicy;
	records?: { files: Record<string, RecordMapping> };
	removed?: RemovalDecision[];
};

export type ByobDecisionOrigin = { connection: string; repo: string };

export type ByobSelfDecision = {
	origin: ByobDecisionOrigin;
	path: string;
	pageId: string | null;
	by: string;
	at: string;
	declined?: true;
};

export const OWNER_HINT_DECISIONS = ['outside', 'agent', 'not_owner'] as const;
export type OwnerHintDecision = (typeof OWNER_HINT_DECISIONS)[number];

export type ByobHintDecision = {
	hint: string;
	decision: OwnerHintDecision;
	target?: string;
	origin: ByobDecisionOrigin;
	by: string;
	at: string;
};

export const CANDIDATE_DECISIONS = ['outside', 'organization', 'ignore'] as const;
export type CandidateDecision = (typeof CANDIDATE_DECISIONS)[number];

export type ByobCandidateDecision = {
	key: string;
	name: string;
	decision: CandidateDecision;
	path: string;
	quote: string;
	email?: string;
	handle?: string;
	domain?: string;
	origin: ByobDecisionOrigin;
	by: string;
	at: string;
};

export const REMOVAL_ACTIONS = ['retire', 'history', 'keep'] as const;
export type RemovalAction = (typeof REMOVAL_ACTIONS)[number];
export const DEFAULT_REMOVAL_ACTION: RemovalAction = 'retire';
export const REMOVAL_ALL = '*';

export type RemovalDecision = {
	origin: { connection: string; repo: string };
	path_or_prefix: string;
	action: RemovalAction;
	by: string;
	at: string;
	against_commit: string | null;
};

export function isRemovalAction(value: unknown): value is RemovalAction {
	return typeof value === 'string' && (REMOVAL_ACTIONS as readonly string[]).includes(value);
}

export function removalDecisionKey(
	decision: Pick<RemovalDecision, 'origin' | 'path_or_prefix'>
): string {
	return `${decision.origin.connection.toLowerCase()}|${decision.origin.repo.toLowerCase()}|${decision.path_or_prefix}`;
}

export function removalPathKey(path: string): string {
	const trimmed = path.trim();
	if (trimmed === REMOVAL_ALL) return REMOVAL_ALL;
	const key = trimmed.replace(/^\.?\/+/, '').replace(/\/{2,}$/, '/');
	return key.includes('..') ? '' : key;
}

export function removalDecisionFor(
	profile: Pick<ByobProfile, 'removed'> | null | undefined,
	origin: { connection: string; repo: string },
	path: string
): RemovalDecision | null {
	const connection = origin.connection.toLowerCase();
	const repo = origin.repo.toLowerCase();
	let best: RemovalDecision | null = null;
	let rank = -1;
	for (const decision of profile?.removed ?? []) {
		if (
			decision.origin.connection.toLowerCase() !== connection ||
			decision.origin.repo.toLowerCase() !== repo
		)
			continue;
		const key = decision.path_or_prefix;
		const score =
			key === path
				? Number.MAX_SAFE_INTEGER
				: key === REMOVAL_ALL
					? 0
					: key.endsWith('/') && path.startsWith(key)
						? key.length
						: -1;
		if (score > rank || (score === rank && best !== null && decision.at > best.at)) {
			best = decision;
			rank = score;
		}
	}
	return rank >= 0 ? best : null;
}

export const KIND_ROLES = ['page', 'evidence', 'note', 'procedure', 'noise'] as const;
export type KindRole = (typeof KIND_ROLES)[number];

export function emptyByobProfile(): ByobProfile {
	return {
		version: 1,
		origin: {},
		scope: emptyScope(),
		mirrors: [],
		role_hints: [],
		kinds: { map: {}, ignore: [] },
		keys: {
			owner: [],
			event_date: [],
			content_date: [],
			as_of: [],
			source: { app: null, id: null, thread: null },
			relations: {},
			drop: []
		},
		access: { markers: [] },
		people: { team_domains: [], team_when: [], agents: [] },
		citations: [],
		owner_roles: [],
		company: null,
		folders: {},
		areas: {},
		data: { include: [], exclude: [] }
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const strings = (value: unknown): string[] =>
	Array.isArray(value) ? [...new Set(value.flatMap((v) => (text(v) ? [text(v)!] : [])))] : [];

function matchOf(raw: unknown): ProfileMatch | null {
	if (!isRecord(raw)) return null;
	const match: ProfileMatch = {};
	for (const key of ['path', 'stem', 'key', 'value'] as const) {
		const value = text(raw[key]);
		if (value) match[key] = key === 'key' || key === 'value' ? value.toLowerCase() : value;
	}
	return match.path || match.stem || match.key ? match : null;
}

function decisionOriginOf(raw: unknown): ByobDecisionOrigin | null {
	if (!isRecord(raw)) return null;
	const connection = text(raw.connection);
	const repo = text(raw.repo);
	return connection && repo ? { connection, repo } : null;
}

function selfDecisionOf(raw: unknown): ByobSelfDecision | null {
	if (!isRecord(raw)) return null;
	const origin = decisionOriginOf(raw.origin);
	const path = text(raw.path);
	if (!origin || !path) return null;
	return {
		origin,
		path,
		pageId: text(raw.pageId) ?? null,
		by: text(raw.by) ?? '',
		at: text(raw.at) ?? '',
		...(raw.declined === true ? { declined: true as const } : {})
	};
}

function hintDecisionOf(raw: unknown): ByobHintDecision | null {
	if (!isRecord(raw)) return null;
	const origin = decisionOriginOf(raw.origin);
	const hint = text(raw.hint);
	const decision = (OWNER_HINT_DECISIONS as readonly unknown[]).includes(raw.decision)
		? (raw.decision as OwnerHintDecision)
		: null;
	if (!origin || !hint || !decision) return null;
	const target = text(raw.target);
	return {
		hint: hint.slice(0, 200),
		decision,
		...(target ? { target } : {}),
		origin,
		by: text(raw.by) ?? '',
		at: text(raw.at) ?? ''
	};
}

function candidateDecisionOf(raw: unknown): ByobCandidateDecision | null {
	if (!isRecord(raw)) return null;
	const origin = decisionOriginOf(raw.origin);
	const key = text(raw.key);
	const name = text(raw.name);
	const path = text(raw.path);
	const decision = (CANDIDATE_DECISIONS as readonly unknown[]).includes(raw.decision)
		? (raw.decision as CandidateDecision)
		: null;
	if (!origin || !key || !name || !path || !decision) return null;
	const optional = (field: 'email' | 'handle' | 'domain') => {
		const value = text(raw[field]);
		return value ? { [field]: value.slice(0, 200) } : {};
	};
	return {
		key: key.slice(0, 300),
		name: name.slice(0, 200),
		decision,
		path,
		quote: (text(raw.quote) ?? '').slice(0, 300),
		...optional('email'),
		...optional('handle'),
		...optional('domain'),
		origin,
		by: text(raw.by) ?? '',
		at: text(raw.at) ?? ''
	};
}

const candidateDecisionKey = (key: string, origin: ByobDecisionOrigin) =>
	`${origin.connection}\0${origin.repo.toLowerCase()}\0${key.toLowerCase()}`;

export function candidateDecisionFor(
	profile: Pick<ByobProfile, 'people'> | null | undefined,
	key: string,
	origin: ByobDecisionOrigin
): ByobCandidateDecision | null {
	const wanted = candidateDecisionKey(key, origin);
	return (
		(profile?.people.candidates ?? []).find(
			(c) => candidateDecisionKey(c.key, c.origin) === wanted
		) ?? null
	);
}

export function candidateDecisionsFor(
	profile: Pick<ByobProfile, 'people'> | null | undefined,
	origin: ByobDecisionOrigin
): ByobCandidateDecision[] {
	return (profile?.people.candidates ?? []).filter((c) => sameOrigin(c.origin, origin));
}

export function withCandidateDecisions(
	profile: ByobProfile | null,
	decided: readonly ByobCandidateDecision[],
	cleared: readonly { key: string; origin: ByobDecisionOrigin }[] = []
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const all = new Map(
		(base.people.candidates ?? []).map((c) => [candidateDecisionKey(c.key, c.origin), c] as const)
	);
	for (const gone of cleared) all.delete(candidateDecisionKey(gone.key, gone.origin));
	for (const c of decided) all.set(candidateDecisionKey(c.key, c.origin), c);
	const origin = { ...base.origin };
	const people = { ...base.people };
	if (all.size > 0) {
		origin['people.candidates'] = 'owner';
		people.candidates = [...all.values()];
	} else {
		delete origin['people.candidates'];
		delete people.candidates;
	}
	return { ...base, origin, people };
}

export function hintDecisionKey(hint: string, origin: ByobDecisionOrigin): string {
	const bare = hint
		.replace(/^\[\[(.+?)(?:\|.*)?\]\]$/, '$1')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
	return `${origin.connection}\0${origin.repo.toLowerCase()}\0${bare}`;
}

const sameOrigin = (a: ByobDecisionOrigin, b: ByobDecisionOrigin) =>
	a.connection === b.connection && a.repo.toLowerCase() === b.repo.toLowerCase();

export function selfDecisionFor(
	profile: Pick<ByobProfile, 'people'> | null | undefined,
	origin: ByobDecisionOrigin
): ByobSelfDecision | null {
	const self = profile?.people.self;
	return self && sameOrigin(self.origin, origin) ? self : null;
}

export function hintDecisionFor(
	profile: Pick<ByobProfile, 'people'> | null | undefined,
	hint: string,
	origin: ByobDecisionOrigin
): ByobHintDecision | null {
	const key = hintDecisionKey(hint, origin);
	return (
		(profile?.people.hints ?? []).find((h) => hintDecisionKey(h.hint, h.origin) === key) ?? null
	);
}

export function withSelfDecision(
	profile: ByobProfile | null,
	decision: ByobSelfDecision
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	return {
		...base,
		origin: { ...base.origin, 'people.self': 'owner' },
		people: { ...base.people, self: decision }
	};
}

export function withHintDecisions(
	profile: ByobProfile | null,
	decided: readonly ByobHintDecision[],
	cleared: readonly { hint: string; origin: ByobDecisionOrigin }[] = []
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const hints = new Map(
		(base.people.hints ?? []).map((h) => [hintDecisionKey(h.hint, h.origin), h] as const)
	);
	for (const gone of cleared) hints.delete(hintDecisionKey(gone.hint, gone.origin));
	for (const hint of decided) hints.set(hintDecisionKey(hint.hint, hint.origin), hint);
	const origin = { ...base.origin };
	const people = { ...base.people };
	if (hints.size > 0) {
		origin['people.hints'] = 'owner';
		people.hints = [...hints.values()];
	} else {
		delete origin['people.hints'];
		delete people.hints;
	}
	return { ...base, origin, people };
}

function markerOf(raw: unknown): ProfileAccessMarker | null {
	if (!isRecord(raw)) return null;
	const match = matchOf(raw.match) as AccessMatch | null;
	if (!match || !(match.path || match.key)) return null;
	const off = isRecord(raw.off)
		? { reason: text(raw.off.reason) ?? '', by: text(raw.off.by) ?? '', at: text(raw.off.at) ?? '' }
		: null;
	const except = exceptionsOf(raw.except);
	return {
		id: accessMarkerId(match),
		match,
		readers: strings(raw.readers),
		why: text(raw.why) ?? '',
		off: off && off.reason !== '' ? off : null,
		...(except.length > 0 ? { except } : {})
	};
}

function exceptionsOf(raw: unknown): AccessMarkerException[] {
	if (!Array.isArray(raw)) return [];
	const out = new Map<string, AccessMarkerException>();
	for (const item of raw) {
		if (!isRecord(item)) continue;
		const path = exceptionPathKey(text(item.path_or_prefix) ?? '');
		const reason = text(item.reason) ?? '';
		if (!path || !reason) continue;
		out.set(path, {
			path_or_prefix: path,
			reason,
			by: text(item.by) ?? '',
			at: text(item.at) ?? ''
		});
	}
	return [...out.values()];
}

export function withAccessException(
	marker: ProfileAccessMarker,
	exception: AccessMarkerException
): ProfileAccessMarker {
	const key = exceptionPathKey(exception.path_or_prefix);
	if (!key) return marker;
	return {
		...marker,
		except: [
			...(marker.except ?? []).filter((e) => e.path_or_prefix !== key),
			{ ...exception, path_or_prefix: key }
		]
	};
}

export function withoutAccessException(
	marker: ProfileAccessMarker,
	pathOrPrefix: string
): ProfileAccessMarker {
	const key = exceptionPathKey(pathOrPrefix);
	const except = (marker.except ?? []).filter((e) => e.path_or_prefix !== key);
	const { except: _drop, ...rest } = marker;
	void _drop;
	return except.length > 0 ? { ...rest, except } : rest;
}

const isRole = (value: unknown): value is FileRole =>
	typeof value === 'string' && (FILE_ROLES as readonly string[]).includes(value);

const PROFILE_KEYS = new Set([
	'version',
	'origin',
	'scope',
	'mirrors',
	'role_hints',
	'kinds',
	'keys',
	'access',
	'people',
	'citations',
	'owner_roles',
	'company',
	'folders',
	'areas',
	'data',
	'data_policy',
	'records',
	'removed'
]);
const NESTED = new Set(['kinds', 'keys', 'people']);

export function readByobProfile(method: Method, raw: unknown): ByobProfile | null {
	if (!isRecord(raw)) return null;
	const { atomTypes } = rulesOf(method);
	const out = emptyByobProfile();
	if (isRecord(raw.origin))
		for (const [key, value] of Object.entries(raw.origin))
			if (value === 'inferred' || value === 'declared' || value === 'owner')
				out.origin[key] = value;
	if (isRecord(raw.scope))
		out.scope = {
			include: strings(raw.scope.include),
			exclude: strings(raw.scope.exclude),
			strip: strings(raw.scope.strip)
		};
	if (Array.isArray(raw.mirrors)) {
		const mirrors = new Map<string, MirrorDecision>();
		for (const item of raw.mirrors) {
			if (!isRecord(item) || !text(item.kept)) continue;
			const id = text(item.id) ?? '';
			mirrors.set(id || `kept:${text(item.kept)}`, {
				id,
				kept: text(item.kept)!,
				by: text(item.by) ?? '',
				at: text(item.at) ?? ''
			});
		}
		out.mirrors = [...mirrors.values()];
	}
	for (const item of Array.isArray(raw.role_hints) ? raw.role_hints : []) {
		const match = isRecord(item) ? matchOf(item.match) : null;
		if (match && isRecord(item) && isRole(item.role))
			out.role_hints.push({
				match,
				role: item.role,
				why: text(item.why) ?? '',
				...viaOf(item.via)
			});
	}
	if (isRecord(raw.kinds)) {
		if (isRecord(raw.kinds.map))
			for (const [kind, value] of Object.entries(raw.kinds.map)) {
				const role =
					isRecord(value) && (KIND_ROLES as readonly unknown[]).includes(value.role)
						? (value.role as KindRole)
						: undefined;
				const target =
					(isRecord(value) ? text(value.type) : text(value)) ??
					(role && role !== 'page' ? 'topic' : undefined);
				if (!target) continue;
				const fields: Record<string, string> = {};
				if (isRecord(value) && isRecord(value.fields))
					for (const [field, fixed] of Object.entries(value.fields))
						if (text(fixed)) fields[field] = text(fixed)!;
				out.kinds.map[kind.toLowerCase()] = {
					type: target,
					...(Object.keys(fields).length > 0 ? { fields } : {}),
					...(role && role !== 'page' ? { role } : {}),
					...(isRecord(value) ? viaOf(value.via) : {})
				};
			}
		out.kinds.ignore = strings(raw.kinds.ignore).map((k) => k.toLowerCase());
	}
	if (isRecord(raw.keys)) {
		const k = raw.keys;
		out.keys.owner = strings(k.owner);
		out.keys.event_date = strings(k.event_date);
		out.keys.content_date = strings(k.content_date);
		out.keys.drop = strings(k.drop);
		for (const item of Array.isArray(k.as_of) ? k.as_of : [])
			if (isRecord(item) && text(item.keys) && text(item.date_key))
				out.keys.as_of.push({ keys: text(item.keys)!, date_key: text(item.date_key)! });
		if (isRecord(k.source))
			out.keys.source = {
				app: text(k.source.app) ?? null,
				id: text(k.source.id) ?? null,
				thread: text(k.source.thread) ?? null
			};
		if (isRecord(k.relations))
			for (const [key, value] of Object.entries(k.relations)) {
				const field = isRecord(value) ? (text(value.field) ?? null) : null;
				const targetType = isRecord(value) ? (text(value.target_type) ?? null) : null;
				out.keys.relations[key.toLowerCase()] = { field, target_type: targetType };
			}
	}
	const access = isRecord(raw.access) ? raw.access : {};
	const seen = new Set<string>();
	for (const item of Array.isArray(access.markers) ? access.markers : []) {
		const marker = markerOf(item);
		if (!marker || seen.has(marker.id)) continue;
		seen.add(marker.id);
		out.access.markers.push(marker);
	}
	if (isRecord(raw.people)) {
		out.people.team_domains = strings(raw.people.team_domains).map((d) => d.toLowerCase());
		out.people.agents = strings(raw.people.agents);
		for (const item of Array.isArray(raw.people.team_when) ? raw.people.team_when : []) {
			const match = matchOf(item);
			if (match) out.people.team_when.push(match);
		}
		const self = selfDecisionOf(raw.people.self);
		if (self) out.people.self = self;
		const hints = new Map<string, ByobHintDecision>();
		for (const item of Array.isArray(raw.people.hints) ? raw.people.hints : []) {
			const hint = hintDecisionOf(item);
			if (hint) hints.set(hintDecisionKey(hint.hint, hint.origin), hint);
		}
		if (hints.size > 0) out.people.hints = [...hints.values()];
		const candidates = new Map<string, ByobCandidateDecision>();
		for (const item of Array.isArray(raw.people.candidates) ? raw.people.candidates : []) {
			const c = candidateDecisionOf(item);
			if (c) candidates.set(candidateDecisionKey(c.key, c.origin), c);
		}
		if (candidates.size > 0) out.people.candidates = [...candidates.values()];
	}
	for (const item of Array.isArray(raw.citations) ? raw.citations : [])
		if (isRecord(item) && text(item.pattern))
			out.citations.push({ pattern: text(item.pattern)!, why: text(item.why) ?? '' });
	for (const item of Array.isArray(raw.owner_roles) ? raw.owner_roles : []) {
		if (!isRecord(item) || !isRole(item.role)) continue;
		const path = text(item.path);
		const group = text(item.group);
		const cluster = text(item.cluster);
		const source = text(item.source);
		if (!path && !group && !cluster && !source) continue;
		const type = text(item.type);
		out.owner_roles.push({
			...(path ? { path } : {}),
			...(group ? { group } : {}),
			...(cluster ? { cluster } : {}),
			...(source && !path && !group && !cluster ? { source: sourceValueKey(source) } : {}),
			...(source && !path && !group && !cluster && item.declared === true
				? { declared: true as const }
				: {}),
			role: item.role,
			...(item.role === 'page' && isOwnerPageShape(item.as) ? { as: item.as } : {}),
			...(item.role === 'page' && cluster && type && atomTypes.has(type) ? { type } : {}),
			why: text(item.why) ?? '',
			...viaOf(item.via)
		});
	}
	if (isRecord(raw.company)) {
		const name = text(raw.company.name);
		const description = raw.company.description === '' ? '' : text(raw.company.description);
		const domains = strings(raw.company.domains).map((d) => d.toLowerCase());
		if (name || description !== undefined || domains.length > 0)
			out.company = {
				...(name ? { name } : {}),
				...(description !== undefined ? { description } : {}),
				...(domains.length > 0 ? { domains } : {})
			};
	}
	if (isRecord(raw.folders))
		for (const [folder, value] of Object.entries(raw.folders)) {
			const key = folderPathKey(folder);
			const type = isRecord(value) ? text(value.type) : text(value);
			if (key && type) out.folders[key] = { type, ...(isRecord(value) ? viaOf(value.via) : {}) };
		}
	if (isRecord(raw.areas))
		for (const [folder, value] of Object.entries(raw.areas)) {
			if (!isRecord(value) || !folder.trim()) continue;
			const key = folder.trim().replace(/^\/+/, '').replace(/\/?$/, '/');
			const title = text(value.title);
			const purpose = text(value.purpose);
			const readers = strings(value.readers);
			const owner = text(value.owner);
			out.areas[key] = {
				...(title ? { title } : {}),
				...(purpose ? { purpose } : {}),
				...(readers.length > 0 ? { readers } : {}),
				...(owner ? { owner } : {})
			};
		}
	if (isRecord(raw.data)) {
		const ext = (value: unknown) =>
			strings(value)
				.map((e) => e.trim().replace(/^\./, '').toLowerCase())
				.filter(Boolean);
		out.data = { include: ext(raw.data.include), exclude: ext(raw.data.exclude) };
	}
	const dataPolicy = parseDataPolicy(raw.data_policy ?? null);
	if (dataPolicy) out.data_policy = dataPolicy;
	if (isRecord(raw.records)) {
		const listed = isRecord(raw.records.files) ? raw.records.files : raw.records;
		const files: Record<string, RecordMapping> = {};
		for (const [key, value] of Object.entries(listed)) {
			const mapping = readRecordMapping(method, value);
			if (key.trim() !== '' && mapping) files[key.trim().replace(/^\.?\//, '')] = mapping;
		}
		if (Object.keys(files).length > 0) out.records = { files };
	}
	const removed = removalDecisionsOf(raw.removed);
	if (removed.length > 0) out.removed = removed;
	return out;
}

function removalDecisionsOf(raw: unknown): RemovalDecision[] {
	if (!Array.isArray(raw)) return [];
	const out = new Map<string, RemovalDecision>();
	for (const item of raw) {
		if (!isRecord(item) || !isRecord(item.origin) || !isRemovalAction(item.action)) continue;
		const connection = text(item.origin.connection);
		const repo = text(item.origin.repo);
		const path = removalPathKey(text(item.path_or_prefix) ?? '');
		if (!connection || !repo || !path) continue;
		const decision: RemovalDecision = {
			origin: { connection, repo },
			path_or_prefix: path,
			action: item.action,
			by: text(item.by) ?? '',
			at: text(item.at) ?? '',
			against_commit: text(item.against_commit) ?? null
		};
		out.set(removalDecisionKey(decision), decision);
	}
	return [...out.values()];
}

export type ProfileProblem = { field: string; message: string };

export function atomFieldsOf(method: Method, type: string): readonly string[] {
	const { pageShapes, coreRequired } = rulesOf(method);
	const shape = Object.hasOwn(pageShapes, type) ? pageShapes[type] : undefined;
	return [...coreRequired, ...(shape?.required ?? [])];
}

export function parseByobProfile(
	method: Method,
	raw: unknown,
	options: {
		readers?: readonly string[];
		unknownReaders?: 'error' | 'warning';
		ownerLayer?: boolean;
		declared?: boolean;
	} = {}
):
	| { ok: true; profile: ByobProfile; warnings: string[] }
	| { ok: false; errors: ProfileProblem[]; warnings: string[] } {
	if (!isRecord(raw))
		return { ok: false, errors: [{ field: '', message: 'a profile is a mapping' }], warnings: [] };
	const warnings = Object.keys(raw)
		.filter((key) => !PROFILE_KEYS.has(key))
		.map((key) => `${key}: not a key of the profile; ignored`);
	const profile = readByobProfile(method, raw)!;
	const { atomTypes, entityPageTypes } = rulesOf(method);
	profile.access.markers.forEach((marker, i) => {
		if (!marker.except || options.ownerLayer) return;
		warnings.push(
			`access.markers[${i}].except: an exception is the owner's decision on Readiness; ignored`
		);
		delete marker.except;
	});
	for (const field of ['self', 'hints', 'candidates'] as const)
		if (options.declared && isRecord(raw.people) && raw.people[field] !== undefined) {
			delete profile.people[field];
			warnings.push(`people.${field}: the owner answers this on Readiness; ignored`);
		}
	const errors: ProfileProblem[] = [];
	const glob = (field: string, value: string | undefined) => {
		if (value !== undefined && globToRegExp(value) === null)
			errors.push({ field, message: `${JSON.stringify(value)} is not a glob` });
	};
	profile.scope.include.forEach((g, i) => glob(`scope.include[${i}]`, g));
	profile.scope.exclude.forEach((g, i) => glob(`scope.exclude[${i}]`, g));
	profile.role_hints.forEach((h, i) => glob(`role_hints[${i}].match.path`, h.match.path));
	profile.owner_roles.forEach((r, i) => glob(`owner_roles[${i}].path`, r.path));
	for (const [kind, target] of Object.entries(profile.kinds.map)) {
		if (!atomTypes.has(target.type)) {
			errors.push({
				field: `kinds.map.${kind}.type`,
				message: `${target.type} is not an atom type`
			});
			continue;
		}
		for (const field of Object.keys(target.fields ?? {}))
			if (!atomFieldsOf(method, target.type).includes(field))
				errors.push({
					field: `kinds.map.${kind}.fields.${field}`,
					message: `${target.type} has no field ${field}`
				});
	}
	for (const [folder, entry] of Object.entries(profile.folders))
		if (!atomTypes.has(entry.type))
			errors.push({
				field: `folders.${folder}.type`,
				message: `${entry.type} is not an atom type`
			});
	for (const [key, relation] of Object.entries(profile.keys.relations))
		if (relation.target_type && !entityPageTypes.has(relation.target_type))
			errors.push({
				field: `keys.relations.${key}.target_type`,
				message: `${relation.target_type} is not an entity type`
			});
	if (options.readers) {
		const known = new Set(options.readers.map((r) => r.toLowerCase()));
		profile.access.markers.forEach((marker, i) =>
			marker.readers.forEach((reader) => {
				if (known.has(reader.toLowerCase()) || namesAdminsGroupReader(reader)) return;
				if (options.unknownReaders === 'warning')
					warnings.push(
						`access.markers[${i}].readers: ${reader} names no group of this brain; its files stay with the Admins until you answer on Readiness`
					);
				else
					errors.push({
						field: `access.markers[${i}].readers`,
						message: `${reader} names no group`
					});
			})
		);
	}
	warnings.push(...dataPolicyWarnings(raw.data_policy));
	const readable = dataExtensions({ include: profile.data.include, exclude: [] });
	for (const ext of profile.data.include)
		if (!readable.has(ext))
			warnings.push(`data.include: ${ext} is not a type the brain reads as data; ignored`);
	return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, profile, warnings };
}

function dataPolicyWarnings(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (!isRecord(value)) return ['data_policy: not a mapping; ignored'];
	const out: string[] = [];
	if (value.version !== undefined && value.version !== 1 && value.version !== 2)
		return [`data_policy.version: ${String(value.version)} is not 1 or 2; ignored`];
	for (const key of Object.keys(value))
		if (key !== 'version' && key !== 'categories')
			out.push(
				key === 'custom'
					? 'data_policy.custom: free-text rules are not part of the policy; ignored'
					: `data_policy.${key}: not a key of the policy; ignored`
			);
	const categories = value.categories;
	if (categories !== undefined && !isRecord(categories))
		out.push('data_policy.categories: not a mapping; ignored');
	if (isRecord(categories))
		for (const [key, choice] of Object.entries(categories)) {
			if ((RETIRED_DATA_CATEGORIES as readonly string[]).includes(key))
				out.push(`data_policy.categories.${key}: retired; ignored`);
			else if (!(DATA_CATEGORIES as readonly string[]).includes(key))
				out.push(`data_policy.categories.${key}: not a category; ignored`);
			else if (!(DATA_CHOICES as readonly unknown[]).includes(choice))
				out.push(`data_policy.categories.${key}: ${String(choice)} is not a choice; ignored`);
			else if (isFloorCategory(key as DataCategory) && choice !== 'out')
				out.push(`data_policy.categories.${key}: always out; ${String(choice)} ignored`);
		}
	return out;
}

export function statedFields(raw: unknown): string[] {
	if (!isRecord(raw)) return [];
	const out: string[] = [];
	for (const key of Object.keys(raw)) {
		if (key === 'origin' || key === 'version' || !PROFILE_KEYS.has(key)) continue;
		const value = raw[key];
		if (isRecord(value) && NESTED.has(key))
			for (const sub of Object.keys(value)) out.push(`${key}.${sub}`);
		else out.push(key);
	}
	return out;
}

function getField(profile: ByobProfile, field: string): unknown {
	const [head, sub] = field.split('.') as [keyof ByobProfile, string | undefined];
	const value = profile[head] as unknown;
	return sub && isRecord(value) ? value[sub] : value;
}

function setField(profile: ByobProfile, field: string, value: unknown): void {
	const [head, sub] = field.split('.') as [keyof ByobProfile, string | undefined];
	if (sub) (profile[head] as unknown as Record<string, unknown>)[sub] = value;
	else (profile as unknown as Record<string, unknown>)[head] = value;
}

export function layerProfile(
	base: ByobProfile,
	over: ByobProfile,
	origin: ByobProfileOrigin,
	stated?: readonly string[]
): ByobProfile {
	const out: ByobProfile = structuredClone(base);
	const empty = emptyByobProfile();
	const fields =
		stated ??
		statedFields(over).filter(
			(field) => JSON.stringify(getField(over, field)) !== JSON.stringify(getField(empty, field))
		);
	for (const field of fields) {
		const value = structuredClone(getField(over, field));
		if (field === 'access') {
			const markers = new Map(out.access.markers.map((m) => [m.id, m]));
			for (const marker of over.access.markers) markers.set(marker.id, marker);
			out.access = { markers: [...markers.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) };
		} else if (field === 'kinds.map') {
			out.kinds.map = { ...out.kinds.map, ...over.kinds.map };
			for (const kind of Object.keys(over.kinds.map))
				out.origin[`kinds.map.${kind}`] = over.origin[`kinds.map.${kind}`] ?? origin;
			if (out.origin['kinds.map']) continue;
		} else if (field === 'company') {
			out.company = over.company ? { ...(out.company ?? {}), ...over.company } : out.company;
			if (over.company?.name === undefined && over.company?.description === undefined) continue;
		} else if (field === 'mirrors') {
			const mirrors = new Map(out.mirrors.map((m) => [m.id, m]));
			for (const mirror of over.mirrors) mirrors.set(mirror.id, mirror);
			out.mirrors = [...mirrors.values()];
		} else if (field === 'records') {
			const files = over.records?.files ?? {};
			out.records = { files: { ...(out.records?.files ?? {}), ...files } };
			for (const key of Object.keys(files))
				out.origin[`records.files.${key}`] = over.origin[`records.files.${key}`] ?? origin;
		} else if (field === 'removed') {
			const decisions = new Map((out.removed ?? []).map((d) => [removalDecisionKey(d), d]));
			for (const decision of over.removed ?? [])
				decisions.set(removalDecisionKey(decision), decision);
			out.removed = [...decisions.values()];
		} else if (field === 'folders') {
			out.folders = { ...out.folders, ...over.folders };
		} else if (field === 'owner_roles') {
			out.owner_roles = [
				...out.owner_roles.filter((e) => !over.owner_roles.some((o) => sameOwnerKey(o, e))),
				...over.owner_roles
			];
		} else if (field === 'people.agents') {
			const names = new Map(out.people.agents.map((a) => [a.toLowerCase(), a]));
			for (const name of over.people.agents) names.set(name.toLowerCase(), name);
			out.people.agents = [...names.values()];
		} else if (field === 'people.team_when') {
			const rules = new Map(out.people.team_when.map((m) => [JSON.stringify(m), m]));
			for (const rule of over.people.team_when) rules.set(JSON.stringify(rule), rule);
			out.people.team_when = [...rules.values()];
		} else setField(out, field, value);
		out.origin[field] = origin;
	}
	for (const [key, value] of Object.entries(over.origin))
		if (!fields.includes(key) && !(key in out.origin && value !== 'owner')) out.origin[key] = value;
	return out;
}

export function withMirrorDecision(
	profile: ByobProfile | null,
	decision: MirrorDecision
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	return {
		...base,
		origin: { ...base.origin, [`mirrors.${decision.id}`]: 'owner' },
		mirrors: [...base.mirrors.filter((m) => m.id !== decision.id), decision]
	};
}

export function withoutMirrorDecision(profile: ByobProfile | null, id: string): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const origin = { ...base.origin };
	delete origin[`mirrors.${id}`];
	return { ...base, origin, mirrors: base.mirrors.filter((m) => m.id !== id) };
}

export function withAccessDecision(
	profile: ByobProfile | null,
	marker: ProfileAccessMarker
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	return {
		...base,
		origin: { ...base.origin, [`access.markers.${marker.id}`]: 'owner' },
		access: {
			markers: [...base.access.markers.filter((m) => m.id !== marker.id), marker].sort((a, b) =>
				a.id < b.id ? -1 : 1
			)
		}
	};
}

export function withoutAccessDecision(profile: ByobProfile | null, id: string): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const origin = { ...base.origin };
	delete origin[`access.markers.${id}`];
	return {
		...base,
		origin,
		access: { markers: base.access.markers.filter((m) => m.id !== id) }
	};
}

function sameOwnerKey(
	a: Pick<OwnerRole, 'path' | 'group' | 'cluster' | 'source'>,
	b: Pick<OwnerRole, 'path' | 'group' | 'cluster' | 'source'>
): boolean {
	return (
		(a.path !== undefined && b.path === a.path) ||
		(a.group !== undefined && b.group === a.group) ||
		(a.cluster !== undefined && b.cluster === a.cluster) ||
		(a.source !== undefined &&
			b.source !== undefined &&
			sourceValueKey(b.source) === sourceValueKey(a.source))
	);
}

export function withoutOwnerRole(
	profile: ByobProfile | null,
	key: { path?: string; group?: string; cluster?: string; source?: string }
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const owner_roles = base.owner_roles.filter((e) => !sameOwnerKey(key, e));
	const origin = { ...base.origin };
	if (owner_roles.length === 0) delete origin.owner_roles;
	return { ...base, origin, owner_roles };
}

export function withOwnerRole(profile: ByobProfile | null, entry: OwnerRole): ByobProfile {
	const base = profile ?? emptyByobProfile();
	return {
		...base,
		origin: { ...base.origin, owner_roles: 'owner' },
		owner_roles: [...base.owner_roles.filter((e) => !sameOwnerKey(entry, e)), entry]
	};
}

export function withTeamMember(profile: ByobProfile | null, path: string): ByobProfile {
	const base = profile ?? emptyByobProfile();
	if (base.people.team_when.some((m) => m.path === path && !m.key && !m.stem)) return base;
	return {
		...base,
		origin: { ...base.origin, 'people.team_when': 'owner' },
		people: { ...base.people, team_when: [...base.people.team_when, { path }] }
	};
}

export function withKindDecision(
	profile: ByobProfile | null,
	kind: string,
	answer: { role: KindRole; type?: string },
	via?: ProfileVia
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const value = kind.toLowerCase();
	return {
		...base,
		origin: {
			...base.origin,
			[`kinds.map.${value}`]: 'owner'
		},
		kinds: {
			...base.kinds,
			map: {
				...base.kinds.map,
				[value]: {
					...(answer.role === 'page'
						? { type: answer.type ?? 'topic' }
						: { type: 'topic', role: answer.role }),
					...(via ? { via } : {})
				}
			}
		}
	};
}

export function withoutKindDecision(profile: ByobProfile | null, kind: string): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const value = kind.toLowerCase();
	const map = { ...base.kinds.map };
	delete map[value];
	const origin = { ...base.origin };
	delete origin[`kinds.map.${value}`];
	if (Object.keys(map).length === 0) delete origin['kinds.map'];
	return { ...base, origin, kinds: { ...base.kinds, map } };
}

export function withCompany(
	profile: ByobProfile | null,
	company: { name?: string; description?: string } | null
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const origin = { ...base.origin };
	if (company) origin.company = 'owner';
	else delete origin.company;
	const domains = base.company?.domains;
	const next = company
		? { ...company, ...(domains ? { domains } : {}) }
		: domains
			? { domains }
			: null;
	return { ...base, origin, company: next };
}

export function withCompanyDomains(
	profile: ByobProfile | null,
	domains: readonly string[] | null
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const origin = { ...base.origin };
	const { domains: _dropped, ...rest } = base.company ?? {};
	void _dropped;
	let company: ByobProfile['company'];
	if (domains) {
		origin['company.domains'] = 'owner';
		company = { ...rest, domains: [...domains] };
	} else {
		delete origin['company.domains'];
		company = Object.keys(rest).length > 0 ? rest : null;
	}
	return { ...base, origin, company };
}

export function withAgent(profile: ByobProfile | null, name: string, agent: boolean): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const key = name.trim();
	const agents = base.people.agents.filter((a) => a.toLowerCase() !== key.toLowerCase());
	if (agent) agents.push(key);
	const origin = { ...base.origin };
	if (agents.length > 0) origin['people.agents'] = 'owner';
	else delete origin['people.agents'];
	return { ...base, origin, people: { ...base.people, agents } };
}

export function folderPathKey(path: string): string {
	const key = path
		.trim()
		.replace(/^\.?\/+/, '')
		.replace(/\*+$/, '')
		.replace(/\/*$/, '/');
	return key === '/' || key.includes('..') ? '' : key;
}

export function withFolderType(
	profile: ByobProfile | null,
	folder: string,
	type: string,
	via?: ProfileVia
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const key = folderPathKey(folder);
	return {
		...base,
		origin: { ...base.origin, [`folders.${key}`]: 'owner' },
		folders: { ...base.folders, [key]: { type, ...(via ? { via } : {}) } }
	};
}

export function withRecordMapping(
	profile: ByobProfile | null,
	key: string,
	mapping: RecordMapping
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	return {
		...base,
		origin: { ...base.origin, [`records.files.${key}`]: 'owner' },
		records: { files: { ...(base.records?.files ?? {}), [key]: mapping } }
	};
}

export function withoutRecordMapping(profile: ByobProfile | null, key: string): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const origin = { ...base.origin };
	delete origin[`records.files.${key}`];
	const files = { ...(base.records?.files ?? {}) };
	delete files[key];
	const { records: _records, ...rest } = base;
	void _records;
	if (Object.keys(files).length === 0) {
		delete origin.records;
		return { ...rest, origin };
	}
	return { ...rest, origin, records: { files } };
}

export function byobDecisionOrigin(binding: {
	connectionId: string;
	origin_connection_id: string | null;
	repo: string;
}): ByobDecisionOrigin {
	return { connection: binding.origin_connection_id ?? binding.connectionId, repo: binding.repo };
}

export function withRemovalDecision(
	profile: ByobProfile | null,
	decision: RemovalDecision
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const key = removalDecisionKey(decision);
	return {
		...base,
		origin: { ...base.origin, removed: 'owner' },
		removed: [...(base.removed ?? []).filter((d) => removalDecisionKey(d) !== key), decision]
	};
}

export function withoutRemovalDecision(
	profile: ByobProfile | null,
	key: Pick<RemovalDecision, 'origin' | 'path_or_prefix'>
): ByobProfile {
	const base = profile ?? emptyByobProfile();
	const removed = (base.removed ?? []).filter(
		(d) => removalDecisionKey(d) !== removalDecisionKey(key)
	);
	const origin = { ...base.origin };
	const { removed: _removed, ...rest } = base;
	void _removed;
	if (removed.length === 0) {
		delete origin.removed;
		return { ...rest, origin };
	}
	return { ...rest, origin, removed };
}
