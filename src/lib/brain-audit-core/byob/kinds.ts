import type { Method } from '../method/types';
import { rulesOf, type MethodRules } from '../method/rules';
import { declaredKinds, isKnownKind, UNCLEAR_GROUP_MIN } from './roles';
import { headerValuesOf } from './access';
import type { ByobRole, KindGroup } from './types';

export type KindType = { type: string; set?: Record<string, string> };

export const SELF_FIELD = 'self';

function singularsOf(kind: string): string[] {
	const k = kind.trim().toLowerCase();
	const out = [k];
	if (k.endsWith('ies')) out.push(`${k.slice(0, -3)}y`);
	if (k.endsWith('es')) out.push(k.slice(0, -2));
	if (k.endsWith('s')) out.push(k.slice(0, -1));
	return out;
}

function lookup(
	r: MethodRules,
	kind: string,
	map: Readonly<Record<string, { type: string; fields?: Record<string, string> }>>
): KindType | null {
	const declared = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
	for (const candidate of singularsOf(kind)) {
		const own = declared.get(candidate);
		if (own) return own.fields ? { type: own.type, set: { ...own.fields } } : { type: own.type };
		const fixed = r.byKind.get(candidate);
		if (fixed) return fixed;
		if (r.asWritten.has(candidate) && r.atomTypes.has(candidate)) return { type: candidate };
	}
	return null;
}

export function kindTypeOf(
	method: Method,
	kinds: readonly string[],
	map: Readonly<Record<string, { type: string; fields?: Record<string, string> }>> = {}
): KindType | null {
	const r = rulesOf(method);
	let type: string | null = null;
	const set: Record<string, string> = {};
	for (const kind of kinds) {
		const hit = lookup(r, kind, map);
		if (!hit) continue;
		type ??= hit.type;
		for (const [key, value] of Object.entries(hit.set ?? {})) set[key] ??= value;
	}
	if (!type) return null;
	return Object.keys(set).length > 0 ? { type, set } : { type };
}

export function relationshipOf(
	method: Method,
	set: Readonly<Record<string, string>> | undefined
): string | null {
	const value = set?.relationship;
	return value && rulesOf(method).entityRelationships.includes(value) ? value : null;
}

export function kitRegistryTypeOf(method: Method, type: string): KindType | null {
	const r = rulesOf(method);
	const written = type.trim().toLowerCase();
	const typed = r.entityTypes.has(written)
		? { type: written }
		: (r.kitRegistryTypes[written] ?? kindTypeOf(method, [written]));
	return typed && r.entityTypes.has(typed.type) ? typed : null;
}

export function writtenTypeFits(method: Method, rowType: string, written: string | null): boolean {
	const r = rulesOf(method);
	if (!written) return true;
	const row = rowType.trim().toLowerCase();
	const page = written.trim().toLowerCase();
	if (page === row || (r.rowTypeCoercions[row] ?? []).includes(page)) return true;
	return !r.atomTypes.has(row);
}

export type KindSummary = {
	kinds: string[];
	type: string;
	relationship: string | null;
	files: number;
	example: string;
};

export function kindsSummary(
	method: Method,
	pages: readonly {
		sourcePath: string;
		kind: string;
		header: ReadonlyMap<string, readonly string[]>;
	}[],
	options: {
		map?: Readonly<Record<string, { type: string; fields?: Record<string, string> }>>;
		ignore?: readonly string[];
	}
): KindSummary[] {
	const groups = new Map<string, KindSummary>();
	for (const page of pages) {
		if (page.kind !== 'page') continue;
		const kinds = declaredKinds(
			method,
			page.header,
			options.ignore ? { kindIgnore: options.ignore } : {}
		);
		const typed = kinds.length > 0 ? kindTypeOf(method, kinds, options.map ?? {}) : null;
		if (!typed) continue;
		const key = kinds.join(',');
		const group = groups.get(key) ?? {
			kinds,
			type: typed.type,
			relationship: typed.set?.relationship ?? null,
			files: 0,
			example: page.sourcePath
		};
		group.files += 1;
		groups.set(key, group);
	}
	return [...groups.values()].sort(
		(a, b) => b.files - a.files || (a.kinds.join() < b.kinds.join() ? -1 : 1)
	);
}

export function kindGroupsOf(
	method: Method,
	pages: readonly { sourcePath: string; role: ByobRole; duplicateOf?: string }[],
	bodyOf: ReadonlyMap<string, string>,
	options: { map?: Record<string, unknown>; ignore?: readonly string[] } = {}
): KindGroup[] {
	const mapped = new Set(Object.keys(options.map ?? {}).map((k) => k.toLowerCase()));
	const byValue = new Map<string, { path: string; role: ByobRole }[]>();
	for (const page of pages) {
		if (page.duplicateOf) continue;
		const body = bodyOf.get(page.sourcePath);
		if (!body) continue;
		const kinds = declaredKinds(method, headerValuesOf(body), {
			...(options.ignore ? { kindIgnore: options.ignore } : {})
		});
		if (kinds.some((kind) => mapped.has(kind) || isKnownKind(method, kind))) continue;
		for (const kind of kinds) {
			byValue.set(kind, [...(byValue.get(kind) ?? []), { path: page.sourcePath, role: page.role }]);
		}
	}
	const groups: KindGroup[] = [];
	for (const [value, files] of byValue) {
		if (files.length < UNCLEAR_GROUP_MIN) continue;
		const roles: Partial<Record<ByobRole, number>> = {};
		for (const file of files) roles[file.role] = (roles[file.role] ?? 0) + 1;
		const folders = new Map<string, number>();
		for (const file of files) {
			const folder = file.path.slice(0, file.path.lastIndexOf('/') + 1) || '(root)';
			folders.set(folder, (folders.get(folder) ?? 0) + 1);
		}
		groups.push({
			value,
			files: files.length,
			folders: [...folders]
				.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
				.slice(0, 3)
				.map(([f]) => f),
			samples: files
				.map((f) => f.path)
				.sort()
				.slice(0, 3),
			proposed: (Object.entries(roles) as [ByobRole, number][]).sort(
				(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)
			)[0]![0],
			roles
		});
	}
	return groups.sort((a, b) => b.files - a.files || (a.value < b.value ? -1 : 1));
}

export function kindGroupLine(
	group: KindGroup,
	decided: { role: string; type?: string } | null
): string {
	const where = group.folders.join(', ');
	return decided
		? `kind "${group.value}" on ${group.files} files (${where}): ${decided.role === 'page' ? `pages of type ${decided.type ?? 'topic'}` : decided.role}, as the owner decided`
		: `kind "${group.value}" on ${group.files} files (${where}): no rule knows it; read as ${group.proposed} by the other rungs until the owner answers on Bring your own brain`;
}
