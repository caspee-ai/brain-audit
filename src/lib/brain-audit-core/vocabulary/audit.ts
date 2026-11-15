export const AUDIT_FRESHNESS_BANDS = ['fresh', 'ageing', 'stale', 'none'] as const;
export type AuditFreshnessBand = (typeof AUDIT_FRESHNESS_BANDS)[number];

export const AUDIT_FILE_FLAGS = [
	'pages',
	'checked',
	'copy',
	'orphan',
	'dead_end',
	'hub',
	'resolved_links',
	'ambiguous_links',
	'missing_links',
	'outside_links',
	'cites_evidence',
	'cited_evidence',
	'uncited_evidence',
	'undated',
	'dated',
	'unread',
	'missing_expected',
	'order_off',
	'empty_sections',
	'keys_unfilled',
	'no_owner',
	'untagged'
] as const;
export type AuditFileFlag = (typeof AUDIT_FILE_FLAGS)[number];

export function isAuditFileFlag(value: unknown): value is AuditFileFlag {
	return typeof value === 'string' && (AUDIT_FILE_FLAGS as readonly string[]).includes(value);
}
