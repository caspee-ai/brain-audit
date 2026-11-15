export const BRAIN_EXCLUDED_RE =
	/(^|\/)(\.git|node_modules|_buildlog|_rejects|\.github|\.ci|\.githooks)\//i;

export const SKILL_FILE_RE = /(^|\/)skill\.md$/i;

export function skillFolders(paths: readonly string[]): string[] {
	const out = new Set<string>();
	for (const path of paths)
		if (SKILL_FILE_RE.test(path) && path.includes('/'))
			out.add(path.slice(0, path.lastIndexOf('/') + 1));
	return [...out].sort();
}

export function skillFolderOf(path: string, folders: readonly string[]): string | null {
	let best: string | null = null;
	for (const folder of folders)
		if (path.startsWith(folder) && (best === null || folder.length > best.length)) best = folder;
	return best;
}
