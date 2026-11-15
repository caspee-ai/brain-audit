import { globSource } from './glob';

export const OWNERSHIP_FILE_RE = /^(?:(?:\.github|docs)\/)?CODEOWNERS$|(^|\/)catalog-info\.ya?ml$/;

export type OwnershipRule = { pattern: RegExp; owners: string[]; line: string };

export function codeownersPattern(raw: string): RegExp | null {
	let glob = raw.trim();
	if (glob === '' || glob.startsWith('!')) return null;
	const anchored = glob.startsWith('/') || glob.replace(/\/$/, '').includes('/');
	const directory = glob.endsWith('/');
	glob = glob.replace(/^\//, '').replace(/\/$/, '');
	const source = globSource(glob, 'any');
	const head = anchored ? '^' : '(^|.*/)';
	const tail = directory ? '/.*$' : '(/.*)?$';
	return new RegExp(`${head}${source}${tail}`);
}

export function parseCodeowners(text: string): OwnershipRule[] {
	const rules: OwnershipRule[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/(^|\s)#.*$/, '').trim();
		if (line === '' || /^\^?\[[^\]]+\]/.test(line)) continue;
		const [glob, ...owners] = line.split(/\s+/);
		const pattern = codeownersPattern(glob!);
		if (pattern) rules.push({ pattern, owners, line });
	}
	return rules;
}

export function individualOwner(owner: string): string | null {
	const value = owner.trim();
	if (/^@[A-Za-z0-9][\w-]*$/.test(value)) return value;
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
	if (/^user:(?:default\/)?([\w.-]+)$/i.test(value))
		return value.replace(/^user:(?:default\/)?/i, '');
	return null;
}

export function catalogOwner(text: string): string | null {
	let inSpec = false;
	for (const line of text.split(/\r?\n/)) {
		if (/^spec:\s*$/.test(line)) {
			inSpec = true;
			continue;
		}
		if (inSpec && /^\S/.test(line)) inSpec = false;
		const owner = inSpec ? /^\s+owner:\s*["']?([^"'#\s]+)["']?/.exec(line) : null;
		if (owner) return owner[1]!;
	}
	return null;
}

export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

export function codeownersFileOf<F extends { sourcePath: string }>(files: readonly F[]): F | null {
	return (
		CODEOWNERS_PATHS.map((path) => files.find((file) => file.sourcePath === path)).find(
			(file): file is F => file !== undefined
		) ?? null
	);
}

export type PathOwnership = {
	hint: string;
	reviewers: string[];
};

export function ownershipOf(
	files: readonly { sourcePath: string; body: string }[]
): (path: string) => PathOwnership | null {
	const codeowners = codeownersFileOf(files);
	const rules = codeowners ? parseCodeowners(codeowners.body) : [];
	const catalogs = files
		.filter((file) => /(^|\/)catalog-info\.ya?ml$/.test(file.sourcePath))
		.map((file) => ({
			dir: file.sourcePath.slice(0, file.sourcePath.lastIndexOf('/') + 1),
			owner: catalogOwner(file.body)
		}))
		.filter((c): c is { dir: string; owner: string } => c.owner !== null)
		.sort((a, b) => b.dir.length - a.dir.length);
	if (rules.length === 0 && catalogs.length === 0) return () => null;
	return (path) => {
		for (let i = rules.length - 1; i >= 0; i -= 1)
			if (rules[i]!.pattern.test(path)) {
				const people = [
					...new Set(rules[i]!.owners.flatMap((owner) => individualOwner(owner) ?? []))
				];
				return people.length > 0 ? { hint: people[0]!, reviewers: people } : null;
			}
		const catalog = catalogs.find((c) => path.startsWith(c.dir));
		const person = catalog ? individualOwner(catalog.owner) : null;
		return person ? { hint: person, reviewers: [person] } : null;
	};
}

export function ownershipResolver(
	files: readonly { sourcePath: string; body: string }[]
): (path: string) => string | null {
	const of = ownershipOf(files);
	return (path) => of(path)?.hint ?? null;
}
