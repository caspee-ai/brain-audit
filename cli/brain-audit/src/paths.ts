/**
 * Where the CLI keeps its local files: `~/.caspee/brain-audit/<audit_id>/` for an audit's work
 * directory (the audit's method pack, facts, merit pack, the sealed upload kept for a retry) and
 * `~/.caspee/brain-audit/<audit_id>.url` for the report link with its key. Nothing here is
 * sent anywhere.
 *
 * Files are written owner-only (0600) every time: to a fresh temporary file beside the target,
 * then renamed over it, so a symlink planted at the target is replaced rather than followed and
 * an older file's wider mode does not survive. Directories under `~/.caspee/` are kept 0700; a
 * directory the person chose with `--work` keeps its own mode. On Windows modes do nothing and
 * the files rely on the user profile's access rules.
 */
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	rmdirSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

const WINDOWS = process.platform === 'win32';

/** `~/.caspee/brain-audit`, or the same under `home`. */
export function baseDir(home: string = homedir()): string {
	return join(home, '.caspee', 'brain-audit');
}

export function defaultWorkDir(auditId: string, base: string = baseDir()): string {
	return join(base, auditId);
}

export function linkFileOf(auditId: string, base: string = baseDir()): string {
	return join(base, `${auditId}.url`);
}

/** The local work directory's files. */
export const WORK_FILES = {
	/** The audit's method pack as the server sent it, for this audit id. Local only. */
	method: 'method.json',
	/** Everything `finish` needs that names something: tree, graph, findings. Local only. */
	state: 'state.json',
	/** The metadata pack the agent grades from. Local only. */
	meritPack: 'merit-pack.json',
	/**
	 * The sealed upload and its key, kept so a retried `finish` sends the same bytes; after a
	 * confirmed upload only the key, the report's address and the scores stay in it.
	 */
	upload: 'upload.json'
} as const;

/** A temporary file `writePrivate` left behind (`<name>.<random>.tmp`). */
const TEMP_FILE = /^(?:method|state|merit-pack|upload)\.json\.[0-9a-f]{12}\.tmp$/;

const inside = (root: string, path: string) => {
	const rel = relative(root, path);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** `dir` created if missing; it and its parents up to `base` set 0700 when under `~/.caspee`. */
function privateDir(dir: string, base: string): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	if (WINDOWS || !inside(dirname(base), dir)) return;
	// Only the CLI's own folders: from `~/.caspee/brain-audit` (or the folder under `~/.caspee`
	// the path sits in) down to `dir`.
	const root = inside(base, dir) ? base : dirname(base);
	let current = root;
	if (current !== dirname(base)) chmodSync(current, 0o700);
	for (const part of relative(root, dir).split(sep).filter(Boolean)) {
		current = join(current, part);
		chmodSync(current, 0o700);
	}
}

/**
 * `text` written to `path`, owner-only, through a temporary file renamed over it. `base` is
 * the CLI's folder (`~/.caspee/brain-audit`): only folders under `~/.caspee` get their mode set.
 */
export function writePrivate(path: string, text: string, base: string = baseDir()): void {
	const dir = dirname(path);
	privateDir(dir, base);
	const temp = join(dir, `${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
	try {
		writeFileSync(temp, text, { flag: 'wx', mode: 0o600 });
		renameSync(temp, path);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
}

/** What {@link workDirRisks} reads of a directory's status. */
export type DirStat = { mode: number; uid: number; isDirectory(): boolean };

/**
 * Why a directory the person named is not private to them: group- or world-writable, or owned
 * by another user. `uid` is this process's user id (null where there is none, as on Windows).
 */
export function workDirRisks(
	stat: DirStat | null,
	uid: number | null
): { openToOthers: boolean; ownedByOther: boolean } {
	if (!stat || !stat.isDirectory()) return { openToOthers: false, ownedByOther: false };
	return {
		openToOthers: (stat.mode & 0o022) !== 0,
		ownedByOther: uid !== null && stat.uid !== uid
	};
}

/** `dir`'s status with links followed (the directory a link points to), or null. */
function statOf(dir: string): DirStat | null {
	try {
		return statSync(realpathSync(dir));
	} catch {
		return null;
	}
}

const processUid = (): number | null =>
	WINDOWS || typeof process.getuid !== 'function' ? null : process.getuid();

/**
 * Whether `dir` (one the person named, or the directory it links to) can be written by others:
 * group- or world-writable. Always false on Windows and for a directory that does not exist.
 */
export function openToOthers(dir: string): boolean {
	if (WINDOWS) return false;
	return workDirRisks(statOf(dir), processUid()).openToOthers;
}

/** Whether `dir` (or the directory it links to) is owned by another user. Never on Windows. */
export function ownedByOther(dir: string): boolean {
	if (WINDOWS) return false;
	return workDirRisks(statOf(dir), processUid()).ownedByOther;
}

/** The work files that name the audit they were written for (`audit_id`). */
const NAMED_FILES = [WORK_FILES.state, WORK_FILES.method, WORK_FILES.upload] as const;

/** Whether `path` is a regular file (not a link, a folder or anything else). */
function isRegularFile(path: string): boolean {
	try {
		return lstatSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * Whether `dir` is `auditId`'s work directory: one of the work files that name their audit
 * (`state.json`, `method.json`, `upload.json`) is a regular file whose JSON names this audit.
 * A file of that name written by anything else is no proof.
 */
export function isWorkDirOf(dir: string, auditId: string): boolean {
	for (const name of NAMED_FILES) {
		const path = join(dir, name);
		if (!isRegularFile(path)) continue;
		try {
			const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
			if (
				typeof value === 'object' &&
				value !== null &&
				(value as { audit_id?: unknown }).audit_id === auditId
			)
				return true;
		} catch {
			// Not JSON: no proof.
		}
	}
	return false;
}

/**
 * A work directory the person chose: only the work files (and their temporary files) that are
 * regular files go, then the directory itself when nothing else is left in it. Nothing is
 * followed or recursed into: an entry of a work file's name that is not a regular file (a
 * folder, a link) is left and listed in `left`.
 */
export function removeWorkFiles(dir: string): { removed: string[]; left: string[] } {
	const removed: string[] = [];
	const left: string[] = [];
	const known = new Set<string>(Object.values(WORK_FILES));
	for (const name of readdirSync(dir)) {
		if (!known.has(name) && !TEMP_FILE.test(name)) continue;
		const path = join(dir, name);
		if (!isRegularFile(path)) {
			left.push(path);
			continue;
		}
		rmSync(path, { force: true });
		removed.push(path);
	}
	// A link to a directory is not removed: only the directory itself, when it is one.
	if (readdirSync(dir).length === 0 && lstatSync(dir).isDirectory()) {
		rmdirSync(dir);
		removed.push(dir);
	}
	return { removed, left };
}

/** The temporary files a write of `auditId`'s link left in `base` (`<id>.url.<random>.tmp`). */
export function strayLinkTemps(auditId: string, base: string = baseDir()): string[] {
	let names: string[];
	try {
		names = readdirSync(base);
	} catch {
		return [];
	}
	const prefix = `${auditId}.url.`;
	return names
		.filter(
			(name) => name.startsWith(prefix) && /^[0-9a-f]{12}\.tmp$/.test(name.slice(prefix.length))
		)
		.map((name) => join(base, name))
		.filter(isRegularFile);
}

/** `path` removed (a folder with what is in it, a link itself, never its target), if there. */
export function removePath(path: string): string[] {
	if (!existsSync(path) && !isLink(path)) return [];
	rmSync(path, { recursive: true, force: true });
	return [path];
}

function isLink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}
