import { headerValuesOf } from './access';
import type { ByobProfile } from '../profile/profile';
import type { Method } from '../method/types';
import { rulesOf } from '../method/rules';
import { MIRROR_DIFFERING_MAX, type MirrorDecision, type MirrorPair } from './scope';

export const MIRROR_COMMIT_PATHS_MAX = 50;

export const MIRROR_COPY_REASON = 'mirror_copy';

const DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function headerDateOf(value: string | undefined): string | null {
	const match = value ? DATE.exec(value.trim().replace(/^['"]|['"]$/g, '')) : null;
	return match ? value!.trim().replace(/^['"]|['"]$/g, '') : null;
}

export function contentDateOf(body: string, keys: readonly string[]): string | null {
	const header = headerValuesOf(body);
	for (const key of keys) {
		const date = headerDateOf(header.get(key)?.[0]);
		if (date) return date;
	}
	for (const values of header.values()) {
		const date = headerDateOf(values[0]);
		if (date) return date;
	}
	return null;
}

type File = { sourcePath: string; body: string; blob: string };

const folderPath = (folder: string) => folder.replace(/\/$/, '');

function under(folder: string, files: readonly File[]): Map<string, File> {
	const out = new Map<string, File>();
	for (const file of files)
		if (file.sourcePath.startsWith(folder)) out.set(file.sourcePath.slice(folder.length), file);
	return out;
}

export function proposeMirrorSides(
	pairs: readonly MirrorPair[],
	files: readonly File[],
	options: {
		method: Method;
		contentKeys?: readonly string[];
		commitDates?: ReadonlyMap<string, string>;
	}
): { pairs: MirrorPair[]; commitPaths: string[] } {
	const keys = options.contentKeys?.length
		? options.contentKeys
		: rulesOf(options.method).contentDateKeys;
	const commitPaths: string[] = [];
	const out = pairs.map((pair) => {
		const a = under(pair.kept, files);
		const b = under(pair.mirror, files);
		const differing = [...a.keys()]
			.filter((rel) => b.has(rel) && b.get(rel)!.blob !== a.get(rel)!.blob)
			.sort();
		const oneSided = [
			...[...a.keys()].filter((rel) => !b.has(rel)).map((rel) => pair.kept + rel),
			...[...b.keys()].filter((rel) => !a.has(rel)).map((rel) => pair.mirror + rel)
		].sort();
		const dated = differing.map((rel) => ({
			path: rel,
			kept: contentDateOf(a.get(rel)!.body, keys),
			mirror: contentDateOf(b.get(rel)!.body, keys)
		}));
		const count = (rows: { kept: string | null; mirror: string | null }[]) => {
			let keptNewer = 0;
			let mirrorNewer = 0;
			let undated = 0;
			for (const row of rows) {
				if (!row.kept || !row.mirror) undated += 1;
				else if (row.kept > row.mirror) keptNewer += 1;
				else if (row.mirror > row.kept) mirrorNewer += 1;
			}
			return { keptNewer, mirrorNewer, undated };
		};
		const byDates = count(dated);
		const differingAsked = differing.slice(0, Math.floor(MIRROR_COMMIT_PATHS_MAX / 2));
		const oneSidedAsked = oneSided.slice(
			0,
			MIRROR_COMMIT_PATHS_MAX - 2 - differingAsked.length * 2
		);
		const commits = options.commitDates;
		const byCommits = commits
			? count(
					differingAsked.map((rel) => ({
						kept: commits.get(pair.kept + rel) ?? null,
						mirror: commits.get(pair.mirror + rel) ?? null
					}))
				)
			: null;
		const newest = (dates: (string | null)[]) =>
			dates.reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null);
		const sideFiles = (side: string, map: Map<string, File>) =>
			[...map].map(([rel, file]) => ({ path: side + rel, body: file.body }));
		const keptFiles = sideFiles(pair.kept, a);
		const mirrorFiles = sideFiles(pair.mirror, b);
		const oneSidedSet = new Set(oneSided);
		const lone = (
			dateOf: (path: string, body: string) => string | null,
			whole: (side: string, files: { path: string; body: string }[]) => string | null
		) => {
			const only = (files: { path: string; body: string }[]) =>
				newest(files.filter((f) => oneSidedSet.has(f.path)).map((f) => dateOf(f.path, f.body)));
			const keptOnly = only(keptFiles);
			const mirrorOnly = only(mirrorFiles);
			const mirrorWins = mirrorOnly !== null && mirrorOnly > (whole(pair.kept, keptFiles) ?? '');
			const keptWins = keptOnly !== null && keptOnly > (whole(pair.mirror, mirrorFiles) ?? '');
			return mirrorWins === keptWins ? null : mirrorWins ? 'mirror' : 'kept';
		};
		const loneByDates = lone(
			(_path, body) => contentDateOf(body, keys),
			(_side, sideOf) => newest(sideOf.map((f) => contentDateOf(f.body, keys)))
		);
		let basis: NonNullable<MirrorPair['proposal_basis']> = 'name';
		let swap = false;
		let tally = byDates;
		let why: string | null = null;
		const decide = (b: typeof basis, mirrorWins: boolean) => {
			basis = b;
			swap = mirrorWins;
		};
		if (byDates.keptNewer !== byDates.mirrorNewer)
			decide('dates', byDates.mirrorNewer > byDates.keptNewer);
		else if (byCommits && byCommits.keptNewer !== byCommits.mirrorNewer) {
			decide('commits', byCommits.mirrorNewer > byCommits.keptNewer);
			tally = byCommits;
		} else if (loneByDates) {
			decide('dates', loneByDates === 'mirror');
			why = 'holds the newest of the files only one side has';
		} else {
			if (!commits && (differingAsked.length > 0 || oneSidedAsked.length > 0))
				commitPaths.push(
					...differingAsked.flatMap((rel) => [pair.kept + rel, pair.mirror + rel]),
					...oneSidedAsked,
					folderPath(pair.kept),
					folderPath(pair.mirror)
				);
			const loneByCommits = commits
				? lone(
						(path) => commits.get(path) ?? null,
						(side) => commits.get(folderPath(side)) ?? null
					)
				: null;
			if (loneByCommits) {
				decide('commits', loneByCommits === 'mirror');
				why = 'holds the files only one side has, committed last';
			}
		}
		const [kept, mirror] = swap ? [pair.mirror, pair.kept] : [pair.kept, pair.mirror];
		const newer = swap ? tally.mirrorNewer : tally.keptNewer;
		const reason =
			basis === 'name'
				? pair.why
				: why
					? `${kept} ${why}`
					: `${kept} is newer in ${newer} of ${differing.length} differing file${differing.length === 1 ? '' : 's'}${basis === 'commits' ? ' (by the last commit touching each)' : ''}`;
		return {
			...pair,
			kept,
			mirror,
			why: reason,
			freshness: {
				kept_newer: newer,
				mirror_newer: swap ? tally.keptNewer : tally.mirrorNewer,
				undated: tally.undated
			},
			proposal_basis: basis,
			dated: dated
				.slice(0, MIRROR_DIFFERING_MAX)
				.map((row) => (swap ? { path: row.path, kept: row.mirror, mirror: row.kept } : row)),
			one_sided: oneSided.slice(0, MIRROR_DIFFERING_MAX),
			one_sided_count: oneSided.length
		} satisfies MirrorPair;
	});
	return { pairs: out, commitPaths: [...new Set(commitPaths)] };
}

export type MirrorSides = { id: string; kept: string; mirror: string };

export function mirrorSides(
	pairs: readonly MirrorPair[],
	decisions: readonly MirrorDecision[]
): MirrorSides[] {
	const byId = new Map(decisions.map((d) => [d.id, d.kept]));
	return pairs.map((pair) => {
		const kept = byId.get(pair.id);
		return kept === pair.mirror
			? { id: pair.id, kept: pair.mirror, mirror: pair.kept }
			: { id: pair.id, kept: pair.kept, mirror: pair.mirror };
	});
}

export function mirrorCopies(
	paths: readonly { sourcePath: string; blob: string }[],
	sides: readonly MirrorSides[]
): Map<string, string> {
	const blobOf = new Map(paths.map((p) => [p.sourcePath, p.blob]));
	const out = new Map<string, string>();
	for (const side of sides)
		for (const [path, blob] of blobOf) {
			if (!path.startsWith(side.mirror)) continue;
			const counterpart = side.kept + path.slice(side.mirror.length);
			const kept = blobOf.get(counterpart);
			if (kept !== undefined && kept !== blob) out.set(path, counterpart);
		}
	const direct = new Map(out);
	for (const [path, first] of direct) {
		let target = first;
		const seen = new Set([path]);
		while (direct.has(target) && !seen.has(target)) {
			seen.add(target);
			target = direct.get(target)!;
		}
		if (seen.has(target)) out.delete(path);
		else out.set(path, target);
	}
	return out;
}

export function mirrorRank(path: string, sides: readonly MirrorSides[]): number {
	if (sides.some((s) => path.startsWith(s.kept))) return 0;
	if (sides.some((s) => path.startsWith(s.mirror))) return 2;
	return 1;
}

export function resolveDeclaredMirrors(
	pairs: readonly MirrorPair[],
	declared: readonly MirrorDecision[]
): MirrorDecision[] {
	const out = new Map<string, MirrorDecision>();
	const norm = (folder: string) => (folder.endsWith('/') ? folder : `${folder}/`);
	for (const entry of declared) {
		const kept = norm(entry.kept);
		const pair = pairs.find(
			(p) => (entry.id === '' || entry.id === p.id) && (p.kept === kept || p.mirror === kept)
		);
		if (pair) out.set(pair.id, { id: pair.id, kept, by: entry.by, at: entry.at });
	}
	return [...out.values()];
}

export function withDeclaredMirrors(
	profile: ByobProfile,
	pairs: readonly MirrorPair[]
): ByobProfile {
	const mirrors = resolveDeclaredMirrors(pairs, profile.mirrors);
	const origin = { ...profile.origin };
	for (const decision of mirrors) origin[`mirrors.${decision.id}`] = 'declared';
	return { ...profile, origin, mirrors };
}
