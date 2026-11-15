const SPECIAL = /[.+^${}()|[\]\\]/g;

export type GlobstarSlash = 'optional-folders' | 'any';

export function globSource(
	glob: string,
	globstarSlash: GlobstarSlash = 'optional-folders'
): string {
	let out = '';
	for (let i = 0; i < glob.length; i += 1) {
		const ch = glob[i]!;
		if (ch === '*' && glob[i + 1] === '*') {
			if (glob[i + 2] === '/') {
				out += globstarSlash === 'optional-folders' ? '(?:.*/)?' : '.*';
				i += 2;
			} else {
				out += '.*';
				i += 1;
			}
		} else if (ch === '*') out += '[^/]*';
		else if (ch === '?') out += '[^/]';
		else out += ch.replace(SPECIAL, '\\$&');
	}
	return out;
}

export function globToRegExp(glob: string): RegExp | null {
	const trimmed = glob.trim().replace(/^\.?\//, '');
	if (trimmed === '') return null;
	let out = globSource(trimmed);
	if (trimmed.endsWith('/')) out += '.*';
	return new RegExp(`^${out}$`, 'i');
}

export function globMatches(glob: string, path: string): boolean {
	return globToRegExp(glob)?.test(path.replace(/^\.?\//, '')) ?? false;
}
