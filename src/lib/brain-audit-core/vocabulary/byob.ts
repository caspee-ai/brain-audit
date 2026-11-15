export const BYOB_ROLES = [
	'page',
	'evidence',
	'procedure',
	'history',
	'note',
	'setting',
	'noise',
	'unclear'
] as const;
export type ByobRole = (typeof BYOB_ROLES)[number];

export const BYOB_ROLE_BASES = [
	'hard_fact',
	'declared',
	'file_name',
	'cited',
	'dialect',
	'triage',
	'owner',
	'profile'
] as const;
export type ByobRoleBasis = (typeof BYOB_ROLE_BASES)[number];

export const BYOB_AUDIT_SUBJECTS = ['brought', 'built'] as const;
export type ByobAuditSubject = (typeof BYOB_AUDIT_SUBJECTS)[number];

export const BYOB_DATA_SOURCE_PARAM = 'source=byob_data';

export const BYOB_AUDIT_FRESHNESS = ['fresh', 'ageing', 'stale', 'none'] as const;
export type ByobAuditFreshness = (typeof BYOB_AUDIT_FRESHNESS)[number];
