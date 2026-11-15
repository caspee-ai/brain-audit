import type { ByobAuditFreshness, ByobAuditSubject, ByobRole } from '../vocabulary/byob';

export type { ByobAuditFreshness, ByobAuditSubject };

export type AuditSize = { files: number; chars: number; words: number };

export type AuditLinkTotals = {
	resolved: number;
	ambiguous: number;
	missing: number;
	outside: number;
	orphans: number;
	dead_ends: number;
	citations: number;
};

export type AuditThresholds = { expected_share: number; min_peers: number };

export type AuditStructureGroup = {
	id: string;
	basis: 'cluster' | 'type';
	files: number;
	too_few_peers: boolean;
	expected_headings: string[];
	expected_keys: string[];
	files_missing_expected: number;
	files_with_empty_sections: number;
	files_order_off: number;
	files_keys_unfilled: number;
} & AuditThresholds;

export const AUDIT_RANKED_CAP = 100;

export type AuditMissingTarget = { name: string; count: number };

export type AuditHub = { path: string; links_in: number };

export type AuditSummaryLinks = AuditLinkTotals & {
	missing_targets: AuditMissingTarget[];
	hubs: Record<string, AuditHub[]>;
	links_in_nav: number;
	density: { all: AuditDensity; by_area: Record<string, AuditDensity> };
};

export type AuditDensity = { links: number; pages: number };

export type AuditFreshnessCounts = Record<ByobAuditFreshness, number>;

export type AuditSummary = {
	totals: AuditSize & {
		pages: number;
		unread: number;
		copies: number;
	};
	by_role: Record<string, AuditSize>;
	by_type: Record<string, AuditSize>;
	by_area: Record<string, AuditSize>;
	depth: Record<string, number>;
	links: AuditSummaryLinks;
	tags: {
		frequency: Record<string, number>;
		pages: Record<string, number>;
		pages_without: number;
	};
	freshness: AuditFreshnessCounts & { measured_at: string };
	structure: { groups: AuditStructureGroup[] };
	thresholds: AuditThresholds;
};

export const SUBSCORE_KEYS = ['links', 'structure', 'metadata', 'dating'] as const;
export type SubscoreKey = (typeof SUBSCORE_KEYS)[number];

export type AuditSubscore = { score: number | null; weight: number };
export type AuditSubscores = Record<SubscoreKey, AuditSubscore>;

export type AuditShare = { numerator: number; denominator: number };

export type ScoreInputs = {
	pages: number;
	links: { resolved: AuditShare; not_orphan: AuditShare };
	structure: { expected_headings: AuditShare; no_empty_section: AuditShare };
	metadata: { expected_keys_filled: AuditShare; with_owner: AuditShare };
	dating: { dated: AuditShare; current: AuditShare };
};

export type ScoreResult = {
	score: number | null;
	subscores: AuditSubscores;
	left_out: SubscoreKey[];
};

export type AuditFileWrite = {
	path: string;
	title?: string | null;
	role: ByobRole;
	type?: string | null;
	area?: string | null;
	ownerHint?: string | null;
	clusterId?: string | null;
	chars?: number;
	words?: number;
	depth?: number;
	linksIn?: number;
	linksOut?: number;
	expectedMissing?: string[];
	keysUnfilled?: string[];
	emptySections?: number;
	tags?: string[];
	keys?: string[];
	citationsOut?: number;
	statedDate?: string | null;
	linksResolved?: number;
	linksAmbiguous?: number;
	linksMissing?: number;
	linksOutside?: number;
	headings?: string[];
	headingOrderOk?: boolean | null;
	isOrphan?: boolean;
	isDeadEnd?: boolean;
	freshness?: ByobAuditFreshness | null;
	unread?: boolean;
	peerGroup?: string | null;
	linksInNav?: number;
	cited?: boolean;
};
