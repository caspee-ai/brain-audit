import { AUDIT_FILE_FLAGS, AUDIT_FRESHNESS_BANDS } from '../vocabulary/audit';

export { AUDIT_FILE_FLAGS, AUDIT_FRESHNESS_BANDS };
export type { AuditFileFlag, AuditFreshnessBand } from '../vocabulary/audit';

export const COMPANY_TYPES = [
	'general',
	'tech',
	'agency',
	'ecommerce',
	'manufacturing',
	'vc-fund',
	'multi-entity',
	'vc-backed',
	'personal'
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const BRAIN_FORMATS = [
	'kit',
	'obsidian',
	'logseq',
	'notion',
	'dendron',
	'foam',
	'hugo',
	'docusaurus',
	'mkdocs',
	'gitbook',
	'jekyll',
	'llm_wiki',
	'basic_memory',
	'generic'
] as const;
export type BrainFormat = (typeof BRAIN_FORMATS)[number];

export const FILE_ROLES = [
	'page',
	'evidence',
	'procedure',
	'history',
	'note',
	'setting',
	'noise',
	'unclear'
] as const;
export type FileRole = (typeof FILE_ROLES)[number];

export const FINDING_CATEGORIES = [
	'missing_links',
	'orphan',
	'dead_end',
	'ambiguous_links',
	'outside_links',
	'uncited_evidence',
	'undated',
	'stale',
	'no_owner',
	'missing_expected',
	'empty_sections',
	'keys_unfilled',
	'order_off',
	'untagged',
	'unread',
	'copy',
	'merit_absent',
	'merit_thin'
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const FINDING_WEIGHTS: Readonly<Record<FindingCategory, number>> = Object.freeze({
	merit_absent: 20,
	merit_thin: 10,
	missing_links: 3,
	orphan: 3,
	no_owner: 3,
	stale: 2,
	undated: 2,
	dead_end: 2,
	ambiguous_links: 2,
	unread: 2,
	missing_expected: 1,
	empty_sections: 1,
	keys_unfilled: 1,
	uncited_evidence: 1,
	outside_links: 1,
	order_off: 1,
	untagged: 1,
	copy: 1
});

export function isCompanyType(value: unknown): value is CompanyType {
	return typeof value === 'string' && (COMPANY_TYPES as readonly string[]).includes(value);
}

export function isBrainFormat(value: unknown): value is BrainFormat {
	return typeof value === 'string' && (BRAIN_FORMATS as readonly string[]).includes(value);
}

export function isFileRole(value: unknown): value is FileRole {
	return typeof value === 'string' && (FILE_ROLES as readonly string[]).includes(value);
}

export function isFindingCategory(value: unknown): value is FindingCategory {
	return typeof value === 'string' && (FINDING_CATEGORIES as readonly string[]).includes(value);
}
