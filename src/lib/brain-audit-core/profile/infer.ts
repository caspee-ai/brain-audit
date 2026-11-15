import { isByobText } from '../byob/dialect';
import { headerValuesOf, inferAccessMarkers } from '../byob/access';
import type { Method } from '../method/types';
import { rulesOf } from '../method/rules';
import type { ByobRole, ByobRoleBasis } from '../byob/types';
import { emptyByobProfile, FILE_ROLES, type ByobProfile, type FileRole } from './profile';

export type KeyStats = {
	folder: string;
	key: string;
	files: number;
	of: number;
	types: Partial<Record<'number' | 'date' | 'list' | 'link' | 'text', number>>;
	values: { value: string; count: number }[];
	distinct: number;
};

export const DISTINCT_KEPT = 30;
export const EVENT_SHARE = 0.8;
export const RELATION_SHARE = 0.6;
export const ROLE_HINT_SHARE = 0.9;
export const FOLDER_FILES_MIN = 3;

const DATE = /^\d{4}-\d{2}-\d{2}/;
const DATE_STEM = /^\d{4}-\d{2}-\d{2}/;
const NUMBER = /^-?\d+(?:[.,]\d+)?%?$/;
const LINK = /^\s*(?:\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]+\))\s*$/;
const MARKDOWN = /\.(md|markdown|mdx)$/i;

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const stemOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

function typeOf(value: string): keyof KeyStats['types'] {
	if (LINK.test(value)) return 'link';
	if (DATE.test(value)) return 'date';
	if (NUMBER.test(value)) return 'number';
	return 'text';
}

export function headerKeyStats(files: readonly { sourcePath: string; body: string }[]): KeyStats[] {
	const perFolder = new Map<string, { files: number; keys: Map<string, string[][]> }>();
	for (const file of files) {
		if (!MARKDOWN.test(file.sourcePath)) continue;
		const folder = folderOf(file.sourcePath);
		const entry = perFolder.get(folder) ?? { files: 0, keys: new Map() };
		entry.files += 1;
		for (const [key, values] of headerValuesOf(file.body))
			entry.keys.set(key, [...(entry.keys.get(key) ?? []), values]);
		perFolder.set(folder, entry);
	}
	const out: KeyStats[] = [];
	for (const [folder, entry] of perFolder)
		for (const [key, perFile] of entry.keys) {
			const types: KeyStats['types'] = {};
			const counts = new Map<string, number>();
			for (const values of perFile) {
				if (values.length > 1) types.list = (types.list ?? 0) + 1;
				for (const value of values) {
					const t = typeOf(value);
					types[t] = (types[t] ?? 0) + 1;
					counts.set(value, (counts.get(value) ?? 0) + 1);
				}
			}
			out.push({
				folder,
				key,
				files: perFile.length,
				of: entry.files,
				types,
				values: [...counts]
					.map(([value, count]) => ({ value, count }))
					.sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1))
					.slice(0, DISTINCT_KEPT),
				distinct: counts.size
			});
		}
	return out.sort((a, b) => (a.folder + a.key < b.folder + b.key ? -1 : 1));
}

export function inferDateKeys(
	method: Method,
	files: readonly { sourcePath: string; body: string }[],
	stats: readonly KeyStats[]
): { event: string[]; content: string[] } {
	const r = rulesOf(method);
	const datedFolders = new Map<string, number>();
	const allFolders = new Map<string, number>();
	for (const file of files) {
		if (!MARKDOWN.test(file.sourcePath)) continue;
		const folder = folderOf(file.sourcePath);
		allFolders.set(folder, (allFolders.get(folder) ?? 0) + 1);
		if (DATE_STEM.test(stemOf(file.sourcePath)))
			datedFolders.set(folder, (datedFolders.get(folder) ?? 0) + 1);
	}
	const event = new Set<string>();
	const content = new Set<string>();
	for (const stat of stats) {
		if ((stat.types.date ?? 0) < stat.files * EVENT_SHARE || stat.of < FOLDER_FILES_MIN) continue;
		const dated =
			(datedFolders.get(stat.folder) ?? 0) >= (allFolders.get(stat.folder) ?? 1) * EVENT_SHARE;
		if (dated && stat.files >= stat.of * EVENT_SHARE && stat.distinct >= stat.files)
			event.add(stat.key);
		else if (!dated) content.add(stat.key);
	}
	const both = [...event].filter((key) => content.has(key));
	for (const key of both) {
		event.delete(key);
		content.delete(key);
	}
	return {
		event: [
			...new Set([
				...r.eventDateKeys,
				...r.genericDateKeys.filter((k) => !content.has(k)),
				...event
			])
		].filter((k) => !r.contentDateKeys.includes(k)),
		content: [...new Set([...r.contentDateKeys, ...content])].filter(
			(k) => !r.eventDateKeys.includes(k)
		)
	};
}

export function inferRelations(
	method: Method,
	stats: readonly KeyStats[]
): ByobProfile['keys']['relations'] {
	const defaults = rulesOf(method).relationFieldDefaults;
	const totals = new Map<string, { links: number; values: number }>();
	for (const stat of stats) {
		const values = Object.entries(stat.types)
			.filter(([type]) => type !== 'list')
			.reduce((n, [, count]) => n + (count ?? 0), 0);
		const entry = totals.get(stat.key) ?? { links: 0, values: 0 };
		entry.links += stat.types.link ?? 0;
		entry.values += values;
		totals.set(stat.key, entry);
	}
	const out: ByobProfile['keys']['relations'] = {};
	for (const [key, entry] of [...totals].sort(([a], [b]) => (a < b ? -1 : 1)))
		if (entry.values > 0 && entry.links / entry.values >= RELATION_SHARE)
			out[key] = { field: defaults[key] ?? null, target_type: null };
	return out;
}

export function inferAsOf(
	method: Method,
	stats: readonly KeyStats[]
): ByobProfile['keys']['as_of'] {
	const { asOfSuffix } = rulesOf(method);
	const keys = new Map<string, KeyStats['types']>();
	for (const stat of stats) {
		const types = keys.get(stat.key) ?? {};
		for (const [type, count] of Object.entries(stat.types))
			types[type as keyof KeyStats['types']] =
				(types[type as keyof KeyStats['types']] ?? 0) + (count ?? 0);
		keys.set(stat.key, types);
	}
	const out: ByobProfile['keys']['as_of'] = [];
	for (const [key, types] of keys) {
		const family = asOfSuffix.exec(key);
		if (!family || !(types.date ?? 0)) continue;
		const prefix = `${family[1]}_`;
		const members = [...keys].filter(
			([other, t]) => other !== key && other.startsWith(prefix) && (t.number ?? 0) > 0
		);
		if (members.length > 0) out.push({ keys: `${prefix}*`, date_key: key });
	}
	return out.sort((a, b) => (a.keys < b.keys ? -1 : 1));
}

export function inferRoleHints(
	roles: ReadonlyMap<string, { role: ByobRole; basis: ByobRoleBasis }>
): ByobProfile['role_hints'] {
	const perFolder = new Map<string, { role: ByobRole; basis: ByobRoleBasis }[]>();
	for (const [path, decision] of roles) {
		if (!MARKDOWN.test(path)) continue;
		perFolder.set(folderOf(path), [...(perFolder.get(folderOf(path)) ?? []), decision]);
	}
	const out: ByobProfile['role_hints'] = [];
	for (const [folder, decisions] of [...perFolder].sort(([a], [b]) => (a < b ? -1 : 1))) {
		if (folder === '' || decisions.length < FOLDER_FILES_MIN) continue;
		const strong = decisions.filter((d) => ['declared', 'file_name', 'cited'].includes(d.basis));
		const left = decisions.length - strong.length;
		if (left === 0) continue;
		const byRole = new Map<ByobRole, number>();
		for (const d of strong) byRole.set(d.role, (byRole.get(d.role) ?? 0) + 1);
		const [role, count] = [...byRole].sort((a, b) => b[1] - a[1])[0] ?? [];
		if (!role || !(FILE_ROLES as readonly string[]).includes(role)) continue;
		if (count! / decisions.length < ROLE_HINT_SHARE) continue;
		out.push({
			match: { path: `${folder}**` },
			role: role as FileRole,
			why: `${count} of ${decisions.length} files in ${folder} say they are ${role}`
		});
	}
	return out;
}

const OBSIDIAN_TEMPLATE_SETTINGS = [
	{ file: /(^|\/)\.obsidian\/templates\.json$/i, key: 'folder' },
	{ file: /(^|\/)\.obsidian\/plugins\/templater-obsidian\/data\.json$/i, key: 'templates_folder' }
];

export function obsidianTemplateHints(
	files: readonly { sourcePath: string; body: string }[]
): ByobProfile['role_hints'] {
	const folders = new Set<string>();
	for (const file of files)
		for (const setting of OBSIDIAN_TEMPLATE_SETTINGS) {
			const at = setting.file.exec(file.sourcePath);
			if (!at) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(file.body);
			} catch {
				continue;
			}
			const named =
				parsed && typeof parsed === 'object'
					? (parsed as Record<string, unknown>)[setting.key]
					: null;
			const folder = typeof named === 'string' ? named.trim().replace(/^\/+|\/+$/g, '') : '';
			if (folder && !folder.includes('..'))
				folders.add(`${file.sourcePath.slice(0, at.index + at[1]!.length)}${folder}/`);
		}
	return [...folders].sort().map((folder) => ({
		match: { path: `${folder}**` },
		role: 'noise' as const,
		why: 'Obsidian templates folder'
	}));
}

function inferSourceKeys(
	method: Method,
	files: readonly { sourcePath: string; body: string }[],
	roles?: ReadonlyMap<string, { role: ByobRole }>
): ByobProfile['keys']['source'] {
	const evidence = files.filter(
		(f) => roles?.get(f.sourcePath)?.role === 'evidence' && isByobText(f.sourcePath)
	);
	if (evidence.length === 0) return { app: null, id: null, thread: null };
	const share = (keys: string[]) =>
		keys.find(
			(key) =>
				evidence.filter((f) => (headerValuesOf(f.body).get(key)?.[0] ?? '') !== '').length >=
				evidence.length / 2
		) ?? null;
	return {
		app: share([...rulesOf(method).eventSourceKeys]),
		id: share(['source_id', 'id', 'message_id', 'external_id']),
		thread: share(['thread', 'thread_id'])
	};
}

export function inferByobProfile(args: {
	method: Method;
	files: readonly { sourcePath: string; body: string }[];
	roles?: ReadonlyMap<string, { role: ByobRole; basis: ByobRoleBasis }>;
}): { profile: ByobProfile; stats: KeyStats[] } {
	const { method } = args;
	const r = rulesOf(method);
	const stats = headerKeyStats(args.files);
	const dates = inferDateKeys(method, args.files, stats);
	const profile = emptyByobProfile();
	profile.kinds.ignore = [...r.kindIgnore];
	profile.keys = {
		owner: [...r.ownerKeysDefault],
		event_date: dates.event,
		content_date: dates.content,
		as_of: inferAsOf(method, stats),
		source: inferSourceKeys(method, args.files, args.roles),
		relations: inferRelations(method, stats),
		drop: []
	};
	profile.access.markers = inferAccessMarkers(method, args.files).map((m) => ({
		id: m.id,
		match: m.match,
		readers: [],
		why: m.why,
		off: null
	}));
	const templates = obsidianTemplateHints(args.files);
	profile.role_hints = [
		...templates,
		...(args.roles ? inferRoleHints(args.roles) : []).filter(
			(hint) => !templates.some((t) => t.match.path === hint.match.path)
		)
	];
	profile.citations = r.citationPatternsDefault.map((pattern) => ({ ...pattern }));
	for (const field of [
		'scope',
		'role_hints',
		'kinds.ignore',
		'keys.owner',
		'keys.event_date',
		'keys.content_date',
		'keys.as_of',
		'keys.source',
		'keys.relations',
		'access',
		'citations'
	])
		profile.origin[field] = 'inferred';
	return { profile, stats };
}
