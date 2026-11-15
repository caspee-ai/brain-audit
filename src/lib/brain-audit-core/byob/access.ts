import { FRONTMATTER } from '../markdown';
import { BRAIN_OWNERS_GROUP, namesAdminsGroupReader } from '../vocabulary/owners-group';
import { globMatches } from './glob';
import { rulesOf } from '../method/rules';
import type { Method } from '../method/types';

export type AccessMatch = { path?: string; key?: string; value?: string };

export type InferredAccessMarker = {
	id: string;
	match: AccessMatch;
	why: string;
	files: number;
	sample: string[];
	cooccurs?: { kind: string; files: number; share: number }[];
	category?: { kind: string; why: string };
};

export type DroppedAccessMarker = { id: string; files: number; match?: AccessMatch };

export const COOCCURS_KEPT = 6;

export type AccessMarkerOff = { reason: string; by: string; at: string };

export type ProfileAccessMarker = {
	id: string;
	match: AccessMatch;
	readers: string[];
	why: string;
	off: AccessMarkerOff | null;
	except?: AccessMarkerException[];
};

export type AccessMarkerException = {
	path_or_prefix: string;
	reason: string;
	by: string;
	at: string;
};

export type LiveAccessMarker = {
	id: string;
	match: AccessMatch;
	readers: string[];
	except?: string[];
};

export function exceptionPathKey(path: string): string {
	const key = path
		.trim()
		.replace(/^\.?\/+/, '')
		.replace(/\/{2,}$/, '/');
	return key.includes('..') || key.includes('*') ? '' : key;
}

export function exceptionCovers(pathOrPrefix: string, path: string): boolean {
	if (pathOrPrefix === '') return false;
	return pathOrPrefix === path || (pathOrPrefix.endsWith('/') && path.startsWith(pathOrPrefix));
}

export const RESTRICTED_WORDS = [
	'private',
	'confidential',
	'restricted',
	'secret',
	'sensitive',
	'management',
	'mgmt',
	'founder',
	'founders',
	'leadership',
	'exec',
	'execs',
	'executive',
	'executives',
	'board',
	'hr',
	'personal',
	'privileged',
	'nda',
	'pii',
	'payroll',
	'salary',
	'salaries',
	'compensation'
] as const;
const RESTRICTED_PHRASES = ['need to know', 'do not share', 'eyes only', 'not for distribution'];
const RESTRICTED_WORD_SET = new Set<string>(RESTRICTED_WORDS);
const WORD_SPLIT = /[\s_./:-]+/;

export function isRestrictedValue(value: string): boolean {
	const words = value.toLowerCase().split(WORD_SPLIT).filter(Boolean);
	if (words.some((word) => RESTRICTED_WORD_SET.has(word))) return true;
	const phrase = words.join(' ');
	return RESTRICTED_PHRASES.some((p) => phrase.includes(p));
}

const LABEL_KEYS = ['tag', 'labels', 'label'] as const;
export const ACCESS_KEYS = [
	'visibility',
	'access',
	'sensitivity',
	'classification',
	'confidentiality',
	'security',
	'clearance',
	'private',
	'confidential',
	'restricted',
	'sensitive',
	'secret',
	'audience'
] as const;
const FLAG_KEYS = new Set(['private', 'confidential', 'restricted', 'sensitive', 'secret']);
const YES = /^(true|yes|y|1|on)$/i;

export type AccessWordMap = Readonly<Record<string, 'everyone' | 'members' | 'restricted'>>;

function marksClosed(key: string, value: string, map: AccessWordMap = {}): boolean {
	const meaning = map[value.trim().toLowerCase()];
	if (meaning) return meaning === 'restricted';
	return isRestrictedValue(value) || (FLAG_KEYS.has(key) && YES.test(value.trim()));
}
export const ACCESS_SAMPLE_MAX = 3;
export const ACCESS_MARKERS_MAX = 20;

const MARKDOWN = /\.(md|markdown|mdx)$/i;

function unquote(value: string): string {
	const v = value.trim();
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
		return v.slice(1, -1).trim();
	return v;
}

function valuesOf(raw: string): string[] {
	const v = raw.replace(/\s+#.*$/, '').trim();
	if (v === '') return [];
	if (v.startsWith('[') && v.endsWith(']'))
		return v
			.slice(1, -1)
			.split(',')
			.map(unquote)
			.filter((item) => item !== '');
	return [unquote(v)].filter((item) => item !== '');
}

export function headerValuesOf(text: string): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const block = FRONTMATTER.exec(text)?.[1];
	if (block === undefined) return out;
	let listKey: string | null = null;
	for (const line of block.split(/\r?\n/)) {
		const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
		if (item && listKey) {
			const values = valuesOf(item[1]!);
			out.set(listKey, [...(out.get(listKey) ?? []), ...values]);
			continue;
		}
		const pair = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
		if (!pair) {
			if (!/^\s/.test(line)) listKey = null;
			continue;
		}
		const key = pair[1]!.toLowerCase();
		const values = valuesOf(pair[2]!);
		listKey = values.length === 0 ? key : null;
		out.set(key, values);
	}
	return out;
}

export function accessMarkerId(match: AccessMatch): string {
	const parts: string[] = [];
	if (match.key) parts.push(`${match.key.toLowerCase()}=${(match.value ?? '').toLowerCase()}`);
	if (match.path) parts.push(`path:${match.path}`);
	return parts.join('&');
}

export function accessMatches(
	match: AccessMatch,
	path: string,
	header: ReadonlyMap<string, readonly string[]>
): boolean {
	if (!match.path && !match.key) return false;
	if (match.path && !globMatches(match.path, path)) return false;
	if (match.key) {
		const values = header.get(match.key.toLowerCase());
		if (!values) return false;
		if (match.value !== undefined && match.value !== '') {
			const wanted = match.value.toLowerCase();
			if (!values.some((value) => value.toLowerCase() === wanted)) return false;
		}
	}
	return true;
}

export function inferAccessMarkers(
	method: Method,
	files: readonly { sourcePath: string; body: string }[],
	map: AccessWordMap = {}
): InferredAccessMarker[] {
	return accessMarkersOf(method, files, map).markers;
}

function kindsOf(
	kindKeys: readonly string[],
	header: ReadonlyMap<string, readonly string[]>
): string[] {
	for (const key of kindKeys) {
		const values = header.get(key);
		if (!values || values.length === 0) continue;
		const out = new Set<string>();
		for (const value of values) {
			const parts = value.toLowerCase().trim().split('/').filter(Boolean);
			for (const kind of parts.length > 1 ? [parts.at(-1)!, parts[0]!] : parts)
				if (!isRestrictedValue(kind)) out.add(kind);
		}
		if (out.size > 0) return [...out];
	}
	return [];
}

export function accessMarkersOf(
	method: Method,
	files: readonly { sourcePath: string; body: string }[],
	map: AccessWordMap = {}
): {
	markers: InferredAccessMarker[];
	dropped: DroppedAccessMarker[];
} {
	const kindKeys = rulesOf(method).kindKeys;
	const found = new Map<string, InferredAccessMarker>();
	const kindFiles = new Map<string, number>();
	const markerKinds = new Map<string, Map<string, number>>();
	for (const file of files) {
		if (!MARKDOWN.test(file.sourcePath)) continue;
		const header = headerValuesOf(file.body);
		const kinds = kindsOf(kindKeys, header);
		for (const kind of kinds) kindFiles.set(kind, (kindFiles.get(kind) ?? 0) + 1);
		const seen = new Set<string>();
		for (const key of [...kindKeys, ...LABEL_KEYS, ...ACCESS_KEYS]) {
			for (const value of header.get(key) ?? []) {
				if (!marksClosed(key, value, map)) continue;
				const match = { key, value: value.toLowerCase() };
				const id = accessMarkerId(match);
				if (seen.has(id)) continue;
				seen.add(id);
				const marker: InferredAccessMarker = found.get(id) ?? {
					id,
					match,
					why: `${key}: ${value.toLowerCase()} in the file's header`,
					files: 0,
					sample: []
				};
				marker.files += 1;
				if (marker.sample.length < ACCESS_SAMPLE_MAX) marker.sample.push(file.sourcePath);
				found.set(id, marker);
				const byKind = markerKinds.get(id) ?? new Map<string, number>();
				for (const kind of kinds) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
				markerKinds.set(id, byKind);
			}
		}
	}
	for (const marker of found.values()) {
		const exact = [...(markerKinds.get(marker.id) ?? [])].map(([kind, n]) => ({
			kind,
			files: n,
			of: kindFiles.get(kind) ?? n,
			share: n / (kindFiles.get(kind) ?? n)
		}));
		exact.sort((a, b) => b.files - a.files || (a.kind < b.kind ? -1 : 1));
		if (exact.length === 0) continue;
		marker.cooccurs = exact
			.slice(0, COOCCURS_KEPT)
			.map(({ kind, files, share }) => ({ kind, files, share: Math.round(share * 100) / 100 }));
	}
	const ranked = [...found.values()].sort((a, b) => b.files - a.files || (a.id < b.id ? -1 : 1));
	return {
		markers: ranked.slice(0, ACCESS_MARKERS_MAX),
		dropped: ranked
			.slice(ACCESS_MARKERS_MAX)
			.map((m) => ({ id: m.id, files: m.files, match: m.match }))
	};
}

export function inferredAccessMarkers(
	access: { markers: InferredAccessMarker[]; dropped?: DroppedAccessMarker[] } | undefined
): Pick<InferredAccessMarker, 'id' | 'match'>[] {
	if (!access) return [];
	const dropped = (access.dropped ?? []).flatMap((marker) => {
		if (marker.match) return [{ id: marker.id, match: marker.match }];
		const pair = /^([^=&]+)=([^&]*)$/.exec(marker.id);
		return pair ? [{ id: marker.id, match: { key: pair[1]!, value: pair[2]! } }] : [];
	});
	return [...access.markers, ...dropped];
}

export function liveAccessMarkers(
	inferred: readonly Pick<InferredAccessMarker, 'id' | 'match'>[],
	decided: readonly ProfileAccessMarker[]
): LiveAccessMarker[] {
	const byId = new Map(decided.map((marker) => [marker.id, marker]));
	const out: LiveAccessMarker[] = [];
	const ids = new Set<string>();
	for (const marker of [...inferred, ...decided]) {
		if (ids.has(marker.id)) continue;
		ids.add(marker.id);
		const decision = byId.get(marker.id);
		if (decision?.off) continue;
		const readers = (decision?.readers ?? []).filter((name) => name.trim() !== '');
		const except = (decision?.except ?? [])
			.map((e) => exceptionPathKey(e.path_or_prefix))
			.filter((key) => key !== '');
		out.push({
			id: marker.id,
			match: decision?.match ?? marker.match,
			readers: readers.length > 0 ? readers : [BRAIN_OWNERS_GROUP],
			...(except.length > 0 ? { except } : {})
		});
	}
	return out;
}

export type MatchedAccessMarker = {
	id: string;
	match: AccessMatch;
	files: number;
	sample: string[];
};

export function accessMarkerMatches(
	files: readonly { sourcePath: string; body: string }[],
	markers: readonly Pick<ProfileAccessMarker, 'id' | 'match'>[]
): MatchedAccessMarker[] {
	if (markers.length === 0) return [];
	const out = markers.map((marker) => ({
		id: marker.id,
		match: marker.match,
		files: 0,
		sample: [] as string[]
	}));
	const empty = new Map<string, string[]>();
	for (const file of files) {
		const header = MARKDOWN.test(file.sourcePath) ? headerValuesOf(file.body) : empty;
		for (const marker of out) {
			if (!accessMatches(marker.match, file.sourcePath, header)) continue;
			marker.files += 1;
			if (marker.sample.length < ACCESS_SAMPLE_MAX) marker.sample.push(file.sourcePath);
		}
	}
	return out;
}

export function unknownMarkerReaders(
	readers: readonly string[],
	known: ReadonlySet<string>
): string[] {
	return [
		...new Set(
			readers
				.map((name) => name.trim())
				.filter(
					(name) => name !== '' && !namesAdminsGroupReader(name) && !known.has(name.toLowerCase())
				)
		)
	];
}

export function undecidedAccessMarkers(
	inferred: readonly Pick<InferredAccessMarker, 'id'>[],
	decided: readonly ProfileAccessMarker[]
): string[] {
	const done = new Set(
		decided
			.filter((marker) => marker.off !== null || marker.readers.some((r) => r.trim() !== ''))
			.map((marker) => marker.id)
	);
	return inferred.map((marker) => marker.id).filter((id) => !done.has(id));
}

export function readerLabel(name: string): string {
	return namesAdminsGroupReader(name) ? BRAIN_OWNERS_GROUP : name.trim().toLowerCase();
}

export function markersClosing(
	path: string,
	header: ReadonlyMap<string, readonly string[]>,
	markers: readonly LiveAccessMarker[]
): { hits: LiveAccessMarker[]; excepted: string[] } {
	return closingOf(
		path,
		markers.filter((marker) => accessMatches(marker.match, path, header))
	);
}

function closingOf(
	path: string,
	matching: readonly LiveAccessMarker[]
): { hits: LiveAccessMarker[]; excepted: string[] } {
	const kept = matching.filter(
		(marker) => !(marker.except ?? []).some((key) => exceptionCovers(key, path))
	);
	if (kept.length === 0 || kept.length === matching.length)
		return { hits: [...matching], excepted: [] };
	return { hits: kept, excepted: matching.filter((m) => !kept.includes(m)).map((m) => m.id) };
}

export function intersectReaders(markers: readonly Pick<LiveAccessMarker, 'readers'>[]): string[] {
	if (markers.length === 0) return [];
	const spellings = (marker: Pick<LiveAccessMarker, 'readers'>) => {
		const out = new Map<string, Set<string>>();
		for (const name of marker.readers) {
			if (name.trim() === '') continue;
			const label = readerLabel(name);
			const set = out.get(label) ?? new Set<string>();
			set.add(label === BRAIN_OWNERS_GROUP ? label : name.trim());
			out.set(label, set);
		}
		return out;
	};
	const common = spellings(markers[0]!);
	for (const marker of markers.slice(1)) {
		const named = spellings(marker);
		for (const [label, set] of common) {
			const more = named.get(label);
			if (!more) common.delete(label);
			else for (const spelled of more) set.add(spelled);
		}
	}
	const readers = [...common].map(([label, set]) => (set.size === 1 ? [...set][0]! : label));
	return (readers.length > 0 ? readers : [BRAIN_OWNERS_GROUP]).sort();
}

export type FileRestriction = {
	readers: string[];
	markers: string[];
	excepted?: string[];
	ownerReaders?: string[];
};

export function restrictionOf(
	path: string,
	text: string,
	markers: readonly LiveAccessMarker[]
): FileRestriction | null {
	if (markers.length === 0) return null;
	const header = headerValuesOf(text);
	const matching = markers.filter((marker) => accessMatches(marker.match, path, header));
	if (matching.length === 0) return null;
	const { hits, excepted } = closingOf(path, matching);
	const readers = intersectReaders(hits);
	const ids = hits.map((marker) => marker.id);
	if (excepted.length === 0) return { readers, markers: ids };
	const without = new Set(intersectReaders(matching).map(readerLabel));
	const ownerReaders = readers.filter((name) => !without.has(readerLabel(name)));
	return {
		readers,
		markers: ids,
		excepted,
		...(ownerReaders.length > 0 ? { ownerReaders } : {})
	};
}

export type AccessMarkerOverlap = {
	markers: string[];
	files: number;
	paths: string[];
};

export const ACCESS_OVERLAPS_MAX = 20;
export const ACCESS_OVERLAP_PATHS_MAX = 200;

export function accessMarkerOverlaps(
	files: readonly { sourcePath: string; body: string }[],
	markers: readonly Pick<ProfileAccessMarker, 'id' | 'match'>[]
): AccessMarkerOverlap[] {
	const unique = [...new Map(markers.map((m) => [m.id, m])).values()];
	if (unique.length < 2) return [];
	const groups = new Map<string, AccessMarkerOverlap>();
	const empty = new Map<string, string[]>();
	for (const file of files) {
		const header = MARKDOWN.test(file.sourcePath) ? headerValuesOf(file.body) : empty;
		const ids = unique
			.filter((marker) => accessMatches(marker.match, file.sourcePath, header))
			.map((marker) => marker.id)
			.sort();
		if (ids.length < 2) continue;
		const key = ids.join('+');
		const group = groups.get(key) ?? { markers: ids, files: 0, paths: [] };
		group.files += 1;
		if (group.paths.length < ACCESS_OVERLAP_PATHS_MAX) group.paths.push(file.sourcePath);
		groups.set(key, group);
	}
	return [...groups.values()]
		.map((group) => ({ ...group, paths: [...group.paths].sort() }))
		.sort((a, b) => b.files - a.files || (a.markers.join('+') < b.markers.join('+') ? -1 : 1))
		.slice(0, ACCESS_OVERLAPS_MAX);
}

export type AccessMarkerConflict = {
	id: string;
	markers: { id: string; readers: string[] }[];
	paths: string[];
	files: number;
	readers: string[];
	resolved: string[];
};

export const ACCESS_CONFLICT_PREFIX = 'access_conflict:';

const readersKey = (marker: Pick<LiveAccessMarker, 'readers'>) =>
	[...new Set(marker.readers.map(readerLabel))].sort().join(',');

export function markerConflicts(
	overlaps: readonly AccessMarkerOverlap[],
	live: readonly LiveAccessMarker[]
): AccessMarkerConflict[] {
	const byId = new Map(live.map((marker) => [marker.id, marker]));
	const out = new Map<string, AccessMarkerConflict>();
	const differ = (set: readonly LiveAccessMarker[]) => new Set(set.map(readersKey)).size > 1;
	const entry = (set: readonly LiveAccessMarker[]) => {
		const sorted = [...set].sort((a, b) => (a.id < b.id ? -1 : 1));
		const id = `${ACCESS_CONFLICT_PREFIX}${sorted.map((m) => m.id).join('+')}`;
		const found = out.get(id) ?? {
			id,
			markers: sorted.map((m) => ({
				id: m.id,
				readers: [...new Set(m.readers.map(readerLabel))].sort()
			})),
			paths: [],
			files: 0,
			readers: intersectReaders(sorted),
			resolved: []
		};
		out.set(id, found);
		return found;
	};
	for (const overlap of overlaps) {
		const set = overlap.markers.flatMap((id) => {
			const marker = byId.get(id);
			return marker ? [marker] : [];
		});
		if (set.length < 2) continue;
		const own = differ(set) ? entry(set) : null;
		for (const path of overlap.paths) {
			const { hits } = closingOf(path, set);
			if (hits.length === set.length) {
				if (own) {
					own.paths.push(path);
					own.files += 1;
				}
				continue;
			}
			own?.resolved.push(path);
			if (hits.length >= 2 && differ(hits)) {
				const other = entry(hits);
				other.paths.push(path);
				other.files += 1;
			}
		}
		if (own) own.files += Math.max(0, overlap.files - overlap.paths.length);
	}
	return [...out.values()].sort((a, b) => b.files - a.files || (a.id < b.id ? -1 : 1));
}

export function exceptionPreview(
	conflict: Pick<AccessMarkerConflict, 'paths' | 'markers'>,
	live: readonly LiveAccessMarker[],
	markerId: string,
	pathOrPrefix: string
): { path_or_prefix: string; paths: string[]; before: string[]; after: string[] } {
	const key = exceptionPathKey(pathOrPrefix);
	const ids = new Set(conflict.markers.map((m) => m.id));
	const set = live.filter((m) => ids.has(m.id));
	const paths = conflict.paths.filter((path) => exceptionCovers(key, path));
	const before = intersectReaders(set);
	if (key === '' || paths.length === 0)
		return { path_or_prefix: key, paths, before, after: before };
	const next = set.map((m) =>
		m.id === markerId ? { ...m, except: [...(m.except ?? []), key] } : m
	);
	return {
		path_or_prefix: key,
		paths,
		before,
		after: intersectReaders(closingOf(paths[0]!, next).hits)
	};
}
