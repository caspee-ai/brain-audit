import type { ByobProfile } from '../profile/profile';
import type { Method } from '../method/types';
import { declaredKinds } from '../byob/roles';
import { kindTypeOf } from '../byob/kinds';
import { headerValuesOf } from '../byob/access';
import { isByobText } from '../byob/dialect';
import { brainFolderPath } from '../byob/names';
import { strippedPath } from '../byob/scope';
import type { ByobPage } from '../byob/types';
import { statedDateKeys } from './dates';
import { profileHashOf } from './profile-hash';
import {
	broughtAudit,
	type BroughtAudit,
	type BroughtAuditEntry,
	type BroughtAuditSource
} from './summary';

export type BroughtAuditInput = {
	method: Method;
	profile: ByobProfile;
	files: readonly { sourcePath: string; body: string }[];
	pages: readonly ByobPage[];
	citations: BroughtAuditSource['citations'];
	clusterOf: ReadonlyMap<string, string>;
	root: string | null;
	strip: readonly string[];
	outOfScopePaths: readonly string[];
	placeholders: readonly string[];
	unreadPaths: readonly string[];
	unreadUnlisted: number;
};

export function auditAreaOf(
	page: Pick<ByobPage, 'sourcePath' | 'targetPath'>,
	strip: readonly string[]
): string {
	const folder = page.targetPath
		? page.targetPath.slice(0, page.targetPath.lastIndexOf('/') + 1)
		: brainFolderPath(
				strippedPath(page.sourcePath, strip).slice(
					0,
					strippedPath(page.sourcePath, strip).lastIndexOf('/') + 1
				)
			);
	const top = folder.split('/')[0];
	return top ? `${top}/` : 'company/';
}

export function typeDecidedOf(
	method: Method,
	page: ByobPage,
	body: string | null,
	profile: Pick<ByobProfile, 'kinds' | 'folders'>
): boolean {
	if (page.roleBasis === 'owner') return true;
	if (page.roleBasisDetail?.startsWith('kinds.map.')) return true;
	if (Object.keys(profile.folders ?? {}).some((folder) => page.sourcePath.startsWith(folder)))
		return true;
	if (body === null || !isByobText(page.sourcePath)) return false;
	const kinds = declaredKinds(method, headerValuesOf(body), {
		...(profile.kinds.ignore.length > 0 ? { kindIgnore: profile.kinds.ignore } : {})
	});
	return kinds.length > 0 && kindTypeOf(method, kinds, profile.kinds.map) !== null;
}

export function inputsHashOf(
	input: Pick<BroughtAuditInput, 'root' | 'unreadPaths' | 'unreadUnlisted'>
): Promise<string> {
	const unread = [...new Set(input.unreadPaths)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	return profileHashOf({
		folder: input.root ?? null,
		unread,
		unread_unlisted: input.unreadUnlisted
	});
}

export function broughtAuditEntries(input: BroughtAuditInput): BroughtAuditEntry[] {
	const bodyOf = new Map(input.files.map((file) => [file.sourcePath, file.body]));
	const pageOf = new Map(input.pages.map((page) => [page.sourcePath, page]));
	const entries: BroughtAuditEntry[] = [];
	for (const page of input.pages) {
		const body = bodyOf.get(page.sourcePath) ?? null;
		const kept = page.duplicateOf ? (pageOf.get(page.duplicateOf) ?? page) : page;
		entries.push({
			path: page.sourcePath,
			body,
			role: page.role,
			type: page.type ?? null,
			type_decided: typeDecidedOf(
				input.method,
				kept,
				bodyOf.get(kept.sourcePath) ?? null,
				input.profile
			),
			area: auditAreaOf(kept, input.strip),
			owner_hint: page.ownerHint,
			cluster_id: input.clusterOf.get(page.sourcePath) ?? null,
			navigation: page.kind === 'navigation',
			copy_of: page.duplicateOf ?? null
		});
	}
	for (const path of new Set(input.unreadPaths))
		if (!pageOf.has(path))
			entries.push({
				path,
				body: null,
				role: 'noise',
				type: null,
				type_decided: false,
				area: null,
				owner_hint: null,
				cluster_id: null,
				navigation: false,
				copy_of: null
			});
	return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function broughtAuditSourceOf(input: BroughtAuditInput): BroughtAuditSource {
	return {
		method: input.method,
		entries: broughtAuditEntries(input),
		citations: input.citations,
		root: input.root,
		strip: input.strip,
		outOfScopePaths: input.outOfScopePaths,
		lens: {
			placeholders: input.placeholders,
			date_keys: statedDateKeys(input.profile.keys)
		},
		unreadUnlisted: input.unreadUnlisted
	};
}

export function auditBrought(input: BroughtAuditInput, measuredAt: string): BroughtAudit {
	return broughtAudit(broughtAuditSourceOf(input), measuredAt);
}
