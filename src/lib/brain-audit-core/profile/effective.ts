import { parseYaml } from '$lib/shared/frontmatter';
import type { ByobBinding } from '$lib/shared/platform-types';
import type { Method } from '../method/types';
import {
	emptyByobProfile,
	layerProfile,
	parseByobProfile,
	readByobProfile,
	statedFields,
	type ByobProfile,
	type ProfileProblem
} from './profile';

export const BYOB_PROFILE_FILE = 'byob.yml';

export type DeclaredProfile = {
	profile: ByobProfile | null;
	fields: string[];
	errors: ProfileProblem[];
	warnings: string[];
};

export function readDeclaredProfile(
	method: Method,
	text: string,
	readers?: readonly string[]
): DeclaredProfile {
	let raw: unknown;
	try {
		raw = parseYaml(text);
	} catch (error) {
		return {
			profile: null,
			fields: [],
			errors: [{ field: '', message: error instanceof Error ? error.message : String(error) }],
			warnings: []
		};
	}
	const parsed = parseByobProfile(method, raw, {
		declared: true,
		...(readers ? { readers, unknownReaders: 'warning' as const } : {})
	});
	if (!parsed.ok)
		return { profile: null, fields: [], errors: parsed.errors, warnings: parsed.warnings };
	const sourceRoles = parsed.profile.owner_roles
		.filter((role) => role.source)
		.map((role) => ({ ...role, declared: true as const }));
	const profile = { ...parsed.profile, owner_roles: sourceRoles };
	return {
		profile,
		fields: statedFields(raw).filter((field) => field !== 'owner_roles' || sourceRoles.length > 0),
		errors: [],
		warnings: parsed.warnings
	};
}

export function effectiveByobProfile(
	method: Method,
	binding: Pick<ByobBinding, 'intake' | 'profile'> | null
): ByobProfile {
	const base = readByobProfile(method, binding?.intake?.profile) ?? emptyByobProfile();
	return binding?.profile ? layerProfile(base, binding.profile, 'owner') : base;
}
