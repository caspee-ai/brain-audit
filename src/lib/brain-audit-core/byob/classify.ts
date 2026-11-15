import { defaultDialectProfile, detectByobDialect, dialectStats, isByobText } from './dialect';
import { mirrorSides, proposeMirrorSides, withDeclaredMirrors } from './mirrors';
import { classifyByobPages, type ByobClassification } from './pages';
import { inFolder, stripFolders, type ByobScope, type MirrorPair } from './scope';
import { clustersOf, signatureOf, type SignatureCluster } from './signature';
import { detectBroughtTool, withToolWrappers } from './tool';
import type { ByobFile } from './types';
import type { DeclaredProfile } from '../profile/effective';
import { inferByobProfile } from '../profile/infer';
import { layerProfile, type ByobProfile } from '../profile/profile';
import type { Method } from '../method/types';

export type BroughtClassifyInput = {
	method: Method;
	files: readonly ByobFile[];
	folder: string | null;
	scope: ByobScope;
	treePaths: readonly string[];
	mirrors: readonly MirrorPair[];
	declared: DeclaredProfile | null;
	owner: ByobProfile | null;
	commitDates?: (paths: readonly string[]) => Promise<Map<string, string>>;
};

export type BroughtClassified = {
	dialect: ReturnType<typeof detectByobDialect>;
	tool: ReturnType<typeof detectBroughtTool>;
	strip: string[];
	read: ByobProfile;
	effective: ByobProfile;
	mirrors: MirrorPair[];
	sides: ReturnType<typeof mirrorSides>;
	classified: ByobClassification;
	signatureClusters: SignatureCluster[];
	markers: ReturnType<typeof dialectStats>;
	dialectBase: ReturnType<typeof defaultDialectProfile>;
};

export async function classifyBrought(input: BroughtClassifyInput): Promise<BroughtClassified> {
	const { files, folder, method } = input;
	const rel = (path: string) => (folder ? path.slice(folder.length) : path);
	const dialect = detectByobDialect(
		method,
		files.map((file) => rel(file.sourcePath))
	);
	const tool = detectBroughtTool(
		input.treePaths.filter((path) => inFolder(path, folder)).map(rel),
		{
			dialect,
			bodies: new Map(files.slice(0, 500).map((file) => [rel(file.sourcePath), file.body]))
		}
	);
	const strip = pinnedStrip(
		input.scope,
		files.map((file) => file.sourcePath),
		folder,
		(inner, paths) => withToolWrappers(inner, tool.tool, paths)
	);
	const plain = classifyByobPages(files, {
		method,
		dialect,
		strip,
		tool: tool.tool,
		root: folder
	});
	const inferred = inferByobProfile({
		method,
		files,
		roles: new Map(plain.pages.map((p) => [p.sourcePath, { role: p.role, basis: p.roleBasis }]))
	}).profile;
	let proposed = proposeMirrorSides(input.mirrors, files, {
		method,
		contentKeys: inferred.keys.content_date
	});
	if (proposed.commitPaths.length > 0 && input.commitDates)
		proposed = proposeMirrorSides(input.mirrors, files, {
			method,
			contentKeys: inferred.keys.content_date,
			commitDates: await input.commitDates(proposed.commitPaths).catch(() => new Map())
		});
	const mirrors = proposed.pairs;
	const declared = input.declared?.profile
		? withDeclaredMirrors(input.declared.profile, mirrors)
		: null;
	const read = declared
		? layerProfile(inferred, declared, 'declared', input.declared!.fields)
		: inferred;
	const effective = input.owner ? layerProfile(read, input.owner, 'owner') : read;
	const sides = mirrorSides(mirrors, effective.mirrors);
	const classified = classifyByobPages(files, {
		method,
		dialect,
		strip,
		profile: effective,
		tool: tool.tool,
		mirrors: sides,
		root: folder
	});
	const signatureClusters = intakeSignatureClusters(files, classified, folder);
	const markers = dialectStats(method, files);
	const dialectBase = defaultDialectProfile(method, markers);
	return {
		dialect,
		tool,
		strip,
		read,
		effective,
		mirrors,
		sides,
		classified,
		signatureClusters,
		markers,
		dialectBase
	};
}

export function pinnedStrip(
	scope: ByobScope,
	paths: readonly string[],
	folder: string | null,
	wrap: (strip: string[], paths: readonly string[]) => string[] = (strip) => strip
): string[] {
	if (!folder) return wrap(stripFolders(scope, paths), paths);
	const inside = (glob: string) => glob.startsWith(folder) && glob !== folder;
	const relative = (glob: string) => glob.slice(folder.length);
	const rel = paths.filter((path) => path.startsWith(folder)).map(relative);
	const inner = wrap(
		stripFolders(
			{
				include: scope.include.filter(inside).map(relative),
				exclude: [],
				strip: scope.strip.filter(inside).map(relative)
			},
			rel
		),
		rel
	);
	return [...inner.map((s) => `${folder}${s}`), folder];
}

export function intakeSignatureClusters(
	files: readonly ByobFile[],
	classified: Pick<ByobClassification, 'pages' | 'citations'>,
	root: string | null
): SignatureCluster[] {
	const pageOf = new Map(classified.pages.map((page) => [page.sourcePath, page]));
	const into = new Map<string, number>();
	const out = new Map<string, number>();
	for (const edge of classified.citations) {
		into.set(edge.to, (into.get(edge.to) ?? 0) + 1);
		out.set(edge.from, (out.get(edge.from) ?? 0) + 1);
	}
	const signatures = files.flatMap((file) => {
		const page = pageOf.get(file.sourcePath);
		if (!page || page.duplicateOf || !isByobText(file.sourcePath)) return [];
		return [
			signatureOf(
				{ path: file.sourcePath, body: file.body },
				{
					root,
					links: { out: out.get(file.sourcePath) ?? 0, in: into.get(file.sourcePath) ?? 0 }
				}
			)
		];
	});
	return clustersOf(signatures);
}
