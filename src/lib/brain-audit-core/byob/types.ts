import type { ByobRole, ByobRoleBasis } from '../vocabulary/byob';

export { BYOB_ROLE_BASES, BYOB_ROLES, type ByobRole, type ByobRoleBasis } from '../vocabulary/byob';

export const BYOB_DIALECTS = ['kit', 'generic'] as const;
export type ByobDialect = (typeof BYOB_DIALECTS)[number];

export type ByobFile = {
	sourcePath: string;
	body: string;
	blob: string;
	sourceDocumentId?: string;
	captureId?: string;
	data?: true;
	binary?: true;
};

export type KindGroup = {
	value: string;
	files: number;
	folders: string[];
	samples: string[];
	proposed: ByobRole;
	roles: Partial<Record<ByobRole, number>>;
};

export type SourceGroup = {
	value: string;
	files: number;
	of: number;
	folders: string[];
	samples: string[];
};

export type OwnerHintSource = 'header' | 'codeowners' | 'author';

export type ReadinessByType = { type: string; pages: number; folder: string | null }[];

export type ByobPage = {
	sourcePath: string;
	data?: true;
	deferred?: true;
	targetPath: string;
	kind:
		| 'page'
		| 'navigation'
		| 'skill'
		| 'glossary'
		| 'notes'
		| 'evidence'
		| 'history'
		| 'setting'
		| 'unclear'
		| 'skip';
	skipReason?: string;
	role: ByobRole;
	roleBasis: ByobRoleBasis;
	roleBasisDetail?: string;
	declaredType?: string;
	roleConflict?: boolean;
	eventSource?: string;
	cited?: boolean;
	unclearGroup?: string;
	regenerate?: boolean;
	duplicateOf?: string;
	claimMapOf?: string;
	skillDir?: string;
	skillAssets?: string[];
	type: string;
	title: string;
	ownerHint: string | null;
	ownerHintSource?: OwnerHintSource;
	authorHint?: string;
	reviewers?: string[];
	self?: true;
	frontmatter: Record<string, unknown>;
	body: string;
	links: { text: string; targetPath: string | null }[];
	claimsHint: string[];
	aliases: string[];
	blob: string;
	language?: string;
};
