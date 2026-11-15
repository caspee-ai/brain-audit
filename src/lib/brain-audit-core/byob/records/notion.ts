import { withoutNotionId } from '../names';
import { notionIdOf, notionRelations } from '../notion';
import type { ColumnRole, MappingProposal } from './mapping';
import type { RecordFileProfile } from '$lib/shared/platform-types';

const MARKDOWN = /\.(md|markdown)$/i;
const CSV = /\.csv$/i;
const ALL_CSV = /_all\.csv$/i;

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

export const NOTION_ROWS_MAX = 1000;

export type NotionDatabaseProfile = {
	id: string;
	name: string;
	rows: Record<string, string>;
	ambiguous?: number;
	pastCap?: number;
};

type PageLike = { sourcePath: string; title: string; kind: string };

export function notionDatabasesOf(pages: readonly PageLike[]): Map<string, NotionDatabaseProfile> {
	const rowsByFolder = new Map<string, PageLike[]>();
	for (const page of pages) {
		if (!MARKDOWN.test(page.sourcePath) || notionIdOf(page.sourcePath) === null) continue;
		const folder = dirOf(page.sourcePath).toLowerCase();
		const held = rowsByFolder.get(folder);
		if (held) held.push(page);
		else rowsByFolder.set(folder, [page]);
	}
	const out = new Map<string, NotionDatabaseProfile>();
	for (const page of pages) {
		const path = page.sourcePath;
		if (!CSV.test(path)) continue;
		const stem = nameOf(path).replace(/(?:_all)?\.csv$/i, '');
		const { name, id } = withoutNotionId(stem);
		if (!id || name === '') continue;
		const rowPages = rowsByFolder.get(`${dirOf(path)}${name}/`.toLowerCase());
		if (!rowPages || rowPages.length === 0) continue;
		const byTitle = new Map<string, string[]>();
		for (const row of rowPages) {
			const title = notionCell(row.title.trim()).toLowerCase();
			const rowId = notionIdOf(row.sourcePath);
			if (title === '' || !rowId) continue;
			const held = byTitle.get(title);
			if (held) held.push(rowId);
			else byTitle.set(title, [rowId]);
		}
		const rows: Record<string, string> = {};
		let joined = 0;
		let ambiguous = 0;
		let pastCap = 0;
		for (const [title, ids] of byTitle) {
			if (ids.length > 1) ambiguous += ids.length;
			else if (joined >= NOTION_ROWS_MAX) pastCap += 1;
			else {
				rows[title] = ids[0]!;
				joined += 1;
			}
		}
		out.set(path, {
			id,
			name,
			rows,
			...(ambiguous > 0 ? { ambiguous } : {}),
			...(pastCap > 0 ? { pastCap } : {})
		});
	}
	return out;
}

export function isNotionTwinCsv(path: string, paths: ReadonlySet<string>): boolean {
	return CSV.test(path) && !ALL_CSV.test(path) && paths.has(path.replace(/\.csv$/i, '_all.csv'));
}

const MONTHS = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december'
];
const NOTION_DATE =
	/^([A-Za-z]+) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2})(?: ?([AaPp][Mm]))?(?: \([^)]*\))?)?$/;

export function notionDateOf(value: string): string | null {
	const match = NOTION_DATE.exec(value.trim());
	if (!match) return null;
	const month = MONTHS.indexOf(match[1]!.toLowerCase()) + 1;
	const day = Number(match[2]);
	if (month === 0 || day < 1 || day > 31) return null;
	const pad = (n: number) => String(n).padStart(2, '0');
	const date = `${match[3]}-${pad(month)}-${pad(day)}`;
	if (Number.isNaN(Date.parse(date)) || new Date(date).getUTCDate() !== day) return null;
	if (match[4] === undefined) return date;
	let hour = Number(match[4]);
	const half = match[6]?.toLowerCase();
	if (half === 'pm' && hour < 12) hour += 12;
	if (half === 'am' && hour === 12) hour = 0;
	if (hour > 23 || Number(match[5]) > 59) return date;
	return `${date}T${pad(hour)}:${match[5]}`;
}

export function notionCell(value: string): string {
	const relations = notionRelations(value);
	if (relations) return relations.map((relation) => relation.title).join(', ');
	return notionDateOf(value) ?? value;
}

export function notionRowKey(
	cells: readonly string[],
	database: Pick<NotionDatabaseProfile, 'rows'>
): string | null {
	const title = (cells[0] ?? '').trim().toLowerCase();
	const id = title === '' ? undefined : database.rows[title];
	return id ? `notion:${id}` : null;
}

type NotionKind =
	{ rowType: 'person'; team: true } | { rowType: 'organization'; relationship: string | null };

const KIND_NAMES: readonly [RegExp, NotionKind][] = [
	[
		/^(team|teams|people|employees|staff|members|directory|zesp[oó]ł|pracownicy|ludzie)$/,
		{ rowType: 'person', team: true }
	],
	[/^(clients|customers|accounts|klienci)$/, { rowType: 'organization', relationship: 'client' }],
	[/^(vendors|suppliers|providers|dostawcy)$/, { rowType: 'organization', relationship: 'vendor' }],
	[/^(partners|resellers|partnerzy)$/, { rowType: 'organization', relationship: 'partner' }],
	[/^(investors|inwestorzy)$/, { rowType: 'organization', relationship: 'investor' }],
	[/^(leads|prospects)$/, { rowType: 'organization', relationship: 'prospect' }],
	[/^(companies|organi[sz]ations|firmy)$/, { rowType: 'organization', relationship: null }]
];

function kindOfName(name: string): NotionKind | null {
	const word = name.trim().toLowerCase();
	return KIND_NAMES.find(([pattern]) => pattern.test(word))?.[1] ?? null;
}

const PERSON_ROLES: ReadonlySet<ColumnRole> = new Set([
	'email',
	'first_name',
	'last_name',
	'role_title',
	'phone'
]);

export function notionMappingProposal(
	profile: Pick<RecordFileProfile, 'columns' | 'notion'>,
	base: MappingProposal
): MappingProposal {
	const database = profile.notion;
	const titleColumn = profile.columns[0]?.name;
	if (!database || !titleColumn) return base;
	const columns = { ...base.mapping.columns };
	for (const column of profile.columns)
		if (columns[column.name] === 'keep' && / owner$/i.test(column.name.trim()))
			columns[column.name] = 'owner_ref';
	const kind = kindOfName(database.name);
	const free = (role: ColumnRole) => {
		for (const [column, held] of Object.entries(columns))
			if (held === role && column !== titleColumn) columns[column] = 'keep';
		columns[titleColumn] = role;
	};
	if (kind?.rowType === 'person') {
		free('name');
		const email = Object.entries(columns).find(([, role]) => role === 'email')?.[0] ?? null;
		return {
			mapping: { rowType: 'person', key: email, columns, mode: 'rows', team: true },
			unsure: false,
			unread: base.unread.filter((column) => column !== titleColumn)
		};
	}
	if (kind?.rowType === 'organization') {
		for (const [column, role] of Object.entries(columns))
			if (PERSON_ROLES.has(role) || role === 'name' || role === 'organization')
				columns[column] = 'keep';
		columns[titleColumn] = 'name';
		return {
			mapping: {
				rowType: 'organization',
				key: titleColumn,
				columns,
				mode: 'rows',
				...(kind.relationship ? { relationship: kind.relationship } : {})
			},
			unsure: false,
			unread: base.unread.filter((column) => column !== titleColumn)
		};
	}
	if (base.mapping.rowType !== 'records') {
		return { ...base, mapping: { ...base.mapping, columns } };
	}
	return {
		mapping: { ...base.mapping, columns, mode: 'none' },
		unsure: false,
		unread: base.unread
	};
}
