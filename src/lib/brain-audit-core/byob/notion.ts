import { withoutNotionId } from './names';

const MARKDOWN = /\.(md|markdown)$/i;
const HTML = /\.html?$/i;
const CSV = /\.csv$/i;

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const stemOf = (path: string) => nameOf(path).replace(/(?:_all)?\.[^.]+$/i, '');

export function notionIdOf(path: string): string | null {
	return withoutNotionId(stemOf(path)).id;
}

function mostlyNotion(paths: readonly string[], kind: RegExp): boolean {
	const files = paths.filter((path) => kind.test(path));
	if (files.length === 0) return false;
	return files.filter((path) => notionIdOf(path) !== null).length / files.length >= 0.5;
}

export function isNotionHtmlExport(paths: readonly string[]): boolean {
	const html = paths.filter((path) => HTML.test(path)).length;
	const markdown = paths.filter((path) => MARKDOWN.test(path)).length;
	return html > markdown && mostlyNotion(paths, HTML);
}

export function notionFolderPages(paths: readonly string[]): Map<string, string> {
	const folders = new Set<string>();
	for (const path of paths) {
		if (!MARKDOWN.test(path)) continue;
		const parts = path.split('/');
		for (let i = 1; i < parts.length; i += 1)
			folders.add(`${parts.slice(0, i).join('/')}/`.toLowerCase());
	}
	const out = new Map<string, string>();
	for (const path of paths) {
		if (!MARKDOWN.test(path)) continue;
		const { name, id } = withoutNotionId(stemOf(path));
		if (!id || name === '') continue;
		const folder = `${dirOf(path)}${name}/`;
		if (folders.has(folder.toLowerCase())) out.set(path, folder);
	}
	return out;
}

const RELATION = /(.+?) \((\S+?\.(?:md|csv))\)(?:,\s*|$)/gy;

export function notionRelations(value: string): { title: string; href: string }[] | null {
	const text = value.trim();
	if (!/\.(?:md|csv)\)$/.test(text)) return null;
	const out: { title: string; href: string }[] = [];
	RELATION.lastIndex = 0;
	let at = 0;
	for (let match = RELATION.exec(text); match; match = RELATION.exec(text)) {
		out.push({ title: match[1]!.trim(), href: match[2]! });
		at = RELATION.lastIndex;
	}
	return out.length > 0 && at === text.length ? out : null;
}

const PEOPLE_KEYS = new Set([
	'owner',
	'owners',
	'deciders',
	'decision_makers',
	'approvers',
	'attendees',
	'participants',
	'assignee',
	'assignees',
	'assigned_to',
	'reviewers',
	'members',
	'people',
	'author',
	'authors',
	'created_by',
	'last_edited_by',
	'dri'
]);

export function isNotionPeopleKey(key: string): boolean {
	return PEOPLE_KEYS.has(key) || key.endsWith('_owner');
}

export const NOTION_KEY_ALIASES: Readonly<Record<string, string>> = { e_mail: 'email' };

export function notionPathTitle(name: string, title: string | null): string {
	if (!title) return name;
	const fold = (text: string) =>
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim();
	const cut = fold(name);
	const whole = fold(title);
	return cut.length > 0 && whole.length > cut.length && whole.startsWith(cut) ? title : name;
}

export type NotionInventory = {
	pages: number;
	databases: number;
	rows: number;
	databasesWithoutRows: number;
	unnamed: number;
};

export function notionInventoryOf(paths: readonly string[]): NotionInventory | null {
	if (!mostlyNotion(paths, MARKDOWN)) return null;
	const folders = new Set(paths.map((path) => dirOf(path).toLowerCase()));
	const databases = new Map<string, boolean>();
	let unnamed = 0;
	for (const path of paths) {
		if (!CSV.test(path) && !MARKDOWN.test(path)) continue;
		const { name, id } = withoutNotionId(stemOf(path));
		if (!id) {
			unnamed += 1;
			continue;
		}
		if (!CSV.test(path)) continue;
		const folder = `${dirOf(path)}${name}/`.toLowerCase();
		databases.set(folder, folders.has(folder));
	}
	let pages = 0;
	let rows = 0;
	for (const path of paths) {
		if (!MARKDOWN.test(path) || notionIdOf(path) === null) continue;
		pages += 1;
		if (databases.get(dirOf(path).toLowerCase())) rows += 1;
	}
	return {
		pages,
		databases: databases.size,
		rows,
		databasesWithoutRows: [...databases.values()].filter((has) => !has).length,
		unnamed
	};
}

export function notionHomePage(paths: readonly string[]): string | null {
	const markdown = paths.filter((path) => MARKDOWN.test(path));
	const roots = markdown.filter((path) => !path.includes('/'));
	if (roots.length !== 1) return null;
	const home = roots[0]!;
	const { name, id } = withoutNotionId(stemOf(home));
	if (!id || name === '') return null;
	const folder = `${name}/`.toLowerCase();
	const rest = markdown.filter((path) => path !== home);
	return rest.length > 0 && rest.every((path) => path.toLowerCase().startsWith(folder))
		? home
		: null;
}
