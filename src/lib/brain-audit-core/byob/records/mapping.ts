import type { Method } from '../../method/types';
import { rulesOf } from '../../method/rules';
import { EMAIL_KEYS, NAME_KEYS, SYSTEM_KEYS, isPeopleRegistryPath } from '../people-registry';
import { CsvParser, isRecordTable, sniffDelimiter } from './csv';
import { RECORD_HEAD_BYTES } from './encoding';
import type { ByobProfile } from '../../profile/profile';
import type { ByobIntake } from '$lib/shared/platform-types';
import { notionMappingProposal } from './notion';
import type { RecordColumnProfile, RecordFileProfile } from '$lib/shared/platform-types';
import { recordFormatOf } from './format';

export const RECORD_ROW_TYPES = [
	'person',
	'organization',
	'offering',
	'system',
	'records'
] as const;
export type RecordRowType = (typeof RECORD_ROW_TYPES)[number];

export const RECORD_MODES = ['rows', 'aggregate', 'none'] as const;
export type RecordMode = (typeof RECORD_MODES)[number];

export const COLUMN_ROLES = [
	'name',
	'first_name',
	'last_name',
	'email',
	'organization',
	'domain',
	'role_title',
	'phone',
	'relationship',
	'owner_ref',
	'date',
	'keep',
	'drop'
] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number] | `account:${string}`;

const ACCOUNT_ROLE = /^account:[a-z][a-z0-9_-]{0,31}$/;

export function isColumnRole(value: unknown): value is ColumnRole {
	return (
		typeof value === 'string' &&
		((COLUMN_ROLES as readonly string[]).includes(value) || ACCOUNT_ROLE.test(value))
	);
}

export type RecordMapping = {
	rowType: RecordRowType;
	key: string | null;
	columns: Record<string, ColumnRole>;
	mode: RecordMode;
	exceptions?: { column: string; equals: string }[] | string[];
	team?: true;
	relationship?: string;
	via?: 'model';
};

export const RECORD_ROWS_MAX = 400;

export function recordFileKey(profile: Pick<RecordFileProfile, 'path' | 'sheet'>): string {
	return profile.sheet ? `${profile.path}#${profile.sheet}` : profile.path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const nonEmpty = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

export function readRecordMapping(method: Method, raw: unknown): RecordMapping | null {
	if (!isRecord(raw)) return null;
	const rowType = raw.rowType ?? raw.row_type;
	if (!(RECORD_ROW_TYPES as readonly unknown[]).includes(rowType)) return null;
	const mode = (RECORD_MODES as readonly unknown[]).includes(raw.mode)
		? (raw.mode as RecordMode)
		: rowType === 'records'
			? 'aggregate'
			: 'rows';
	const columns: Record<string, ColumnRole> = {};
	if (isRecord(raw.columns))
		for (const [column, role] of Object.entries(raw.columns))
			if (column.trim() !== '' && isColumnRole(role)) columns[column] = role;
	let exceptions: RecordMapping['exceptions'];
	if (Array.isArray(raw.exceptions)) {
		const filters = raw.exceptions.flatMap((item) =>
			isRecord(item) && nonEmpty(item.column) && typeof item.equals === 'string'
				? [{ column: nonEmpty(item.column)!, equals: item.equals }]
				: []
		);
		const names = raw.exceptions.flatMap((item) => (nonEmpty(item) ? [nonEmpty(item)!] : []));
		if (filters.length > 0) exceptions = filters;
		else if (names.length > 0) exceptions = names;
	}
	return {
		rowType: rowType as RecordRowType,
		key: nonEmpty(raw.key),
		columns,
		mode,
		...(exceptions ? { exceptions } : {}),
		...(raw.team === true ? { team: true as const } : {}),
		...(typeof raw.relationship === 'string' &&
		raw.relationship !== 'team' &&
		rulesOf(method).entityRelationships.includes(raw.relationship)
			? { relationship: raw.relationship }
			: {}),
		...(raw.via === 'model' ? { via: 'model' as const } : {})
	};
}

export function fitRecordMapping(
	mapping: RecordMapping,
	profile: Pick<RecordFileProfile, 'columns'>
): RecordMapping {
	const names = new Set(profile.columns.map((column) => column.name));
	const columns: Record<string, ColumnRole> = {};
	for (const column of profile.columns)
		columns[column.name] = mapping.columns[column.name] ?? 'keep';
	const { exceptions: listed, ...rest } = mapping;
	const exceptions = (listed ?? []).filter(
		(item: string | { column: string; equals: string }) =>
			typeof item === 'string' || names.has(item.column)
	) as RecordMapping['exceptions'] & unknown[];
	return {
		...rest,
		key: mapping.key && names.has(mapping.key) ? mapping.key : null,
		columns,
		...(exceptions.length > 0 ? { exceptions } : {})
	};
}

export function headerWords(header: string): string {
	return header
		.replace(/[łŁ]/g, 'l')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

const words = (list: Iterable<string>) => new Set([...list].map(headerWords));

const SYNONYMS: readonly [ColumnRole, ReadonlySet<string>][] = [
	[
		'name',
		words([
			...NAME_KEYS,
			'fullname',
			'contact',
			'contact name',
			'person name',
			'display name',
			'imię i nazwisko',
			'nazwisko i imię',
			'osoba'
		])
	],
	['first_name', words(['first name', 'firstname', 'given name', 'imię'])],
	['last_name', words(['last name', 'lastname', 'surname', 'family name', 'nazwisko'])],
	[
		'email',
		words([
			...[...EMAIL_KEYS].filter((key) => key !== 'address'),
			'email address',
			'work email',
			'primary email',
			'adres e-mail',
			'adres email'
		])
	],
	[
		'organization',
		words([
			'company',
			'company name',
			'organization',
			'organisation',
			'organization name',
			'account',
			'account name',
			'employer',
			'firma',
			'nazwa firmy',
			'organizacja',
			'pracodawca'
		])
	],
	[
		'domain',
		words([
			'website',
			'web site',
			'domain',
			'company domain',
			'company website',
			'www',
			'strona',
			'strona www'
		])
	],
	[
		'role_title',
		words(['title', 'job title', 'position', 'role', 'job', 'stanowisko', 'funkcja', 'rola'])
	],
	[
		'phone',
		words([
			'phone',
			'phone number',
			'mobile',
			'mobile phone',
			'cell',
			'tel',
			'telephone',
			'telefon',
			'komórka',
			'nr telefonu'
		])
	],
	[
		'relationship',
		words([
			'relationship',
			'lifecycle stage',
			'lifecyclestage',
			'contact type',
			'customer type',
			'relacja'
		])
	],
	[
		'owner_ref',
		words([
			'owner',
			'account owner',
			'contact owner',
			'hubspot owner',
			'deal owner',
			'owner email',
			'assigned to',
			'sales rep',
			'opiekun',
			'opiekun klienta'
		])
	]
];

const PREFIXED = /^(person|organization|organisation|contact|company)\s+(.+)$/;

export function roleOfHeader(header: string): ColumnRole | null {
	const key = headerWords(header);
	if (!key) return null;
	const system =
		SYSTEM_KEYS[key] ?? (key === 'linkedin' || key === 'linkedin url' ? 'linkedin' : null);
	if (system) return `account:${system}`;
	for (const [role, synonyms] of SYNONYMS) if (synonyms.has(key)) return role;
	const prefixed = PREFIXED.exec(key);
	if (prefixed) {
		const inner = roleOfHeader(prefixed[2]!);
		if (inner === 'name' && /^(organization|organisation|company)$/.test(prefixed[1]!))
			return 'organization';
		if (inner) return inner;
	}
	return null;
}

const ID_HEADER = /(^| )(id|nr|no|number|numer|sku|code|kod|uuid)$/;

export type MappingProposal = {
	mapping: RecordMapping;
	unsure: boolean;
	unread: string[];
};

const TELLING_SHAPES = new Set(['email', 'url', 'domain', 'phone', 'date', 'number', 'enum']);

export function isRecordRosterPath(path: string, registryFiles: readonly string[] = []): boolean {
	if (recordFormatOf(path) === null) return false;
	const lower = path.toLowerCase();
	return isPeopleRegistryPath(path) || registryFiles.some((file) => file.toLowerCase() === lower);
}

export function proposeRecordMapping(
	profile: RecordFileProfile,
	options: { registryFiles?: readonly string[] } = {}
): MappingProposal {
	const columns: Record<string, ColumnRole> = {};
	const taken = new Set<ColumnRole>();
	const assign = (column: RecordColumnProfile, role: ColumnRole) => {
		columns[column.name] = role;
		taken.add(role);
	};
	for (const column of profile.columns) {
		const role = roleOfHeader(column.name);
		if (role && (role.startsWith('account:') || !taken.has(role))) assign(column, role);
	}
	for (const column of profile.columns) {
		const role = columns[column.name];
		if (column.shape === 'email' && !taken.has('email') && role !== 'owner_ref') {
			if (role) taken.delete(role);
			assign(column, 'email');
		} else if (role) continue;
		else if ((column.shape === 'url' || column.shape === 'domain') && !taken.has('domain'))
			assign(column, 'domain');
		else if (column.shape === 'phone' && !taken.has('phone')) assign(column, 'phone');
		else if (column.shape === 'date') assign(column, 'date');
	}
	const has = (role: ColumnRole) => taken.has(role);
	const named = has('name') || (has('first_name') && has('last_name'));
	const idColumn = profile.columns.find(
		(column) =>
			!columns[column.name] && ID_HEADER.test(headerWords(column.name)) && column.fill === 1
	);
	const measures = profile.columns.some(
		(column) => column.shape === 'number' && !columns[column.name] && column !== idColumn
	);
	let rowType: RecordRowType | null = null;
	if (named && (has('email') || has('role_title'))) rowType = 'person';
	else if (
		(has('organization') || has('name')) &&
		has('domain') &&
		!has('email') &&
		!has('role_title') &&
		!has('first_name')
	) {
		rowType = 'organization';
		const own = Object.entries(columns).find(([, role]) => role === 'organization')?.[0];
		if (own && !has('name')) columns[own] = 'name';
	} else if (idColumn && (has('date') || measures)) rowType = 'records';
	for (const column of profile.columns) columns[column.name] ??= 'keep';
	const unread = profile.columns
		.filter((column) => columns[column.name] === 'keep' && !TELLING_SHAPES.has(column.shape))
		.map((column) => column.name);
	const byRole = (role: ColumnRole) =>
		profile.columns.find((column) => columns[column.name] === role)?.name ?? null;
	const type = rowType ?? 'records';
	const uniqueId =
		idColumn &&
		idColumn.distinct === profile.statsRows &&
		!idColumn.distinctCapped &&
		profile.statsRows > 0;
	const key =
		type === 'person'
			? (byRole('email') ??
				profile.columns.find((c) => columns[c.name]!.startsWith('account:'))?.name ??
				null)
			: type === 'organization'
				? (byRole('domain') ?? byRole('name'))
				: uniqueId
					? idColumn!.name
					: null;
	const mapping: RecordMapping = {
		rowType: type,
		key,
		columns,
		mode: type === 'records' || profile.rows > RECORD_ROWS_MAX ? 'aggregate' : 'rows',
		...(type === 'person' && isRecordRosterPath(profile.path, options.registryFiles)
			? { team: true as const }
			: {})
	};
	const proposal = {
		mapping,
		unsure: rowType === null || unread.length * 3 > profile.columns.length,
		unread
	};
	return profile.notion ? notionMappingProposal(profile, proposal) : proposal;
}

function readsAsTable(path: string, text: string): boolean {
	const head = text.slice(0, RECORD_HEAD_BYTES);
	return isRecordTable(new CsvParser(sniffDelimiter(head, path)).push(head));
}

export function rosterRowsAllowed(
	path: string,
	files: Readonly<Record<string, RecordMapping>> | undefined,
	text?: string
): boolean {
	const format = recordFormatOf(path);
	if (format === null) return true;
	if (text !== undefined && (format === 'csv' || format === 'tsv') && !readsAsTable(path, text))
		return true;
	const mapping = files?.[path];
	return mapping?.rowType === 'person' && mapping.team === true && mapping.mode !== 'none';
}

export type RecordProposal = {
	blob: string;
	at: string;
	mapping?: RecordMapping;
	why?: string;
	model?: string;
	failed?: 'no_model' | 'failed' | 'invalid';
};

export function recordsToPropose(
	intake: Pick<ByobIntake, 'recordFiles' | 'recordProposals' | 'profile'>,
	profile: Pick<ByobProfile, 'records'> | null
): RecordFileProfile[] {
	return (intake.recordFiles ?? []).filter((file) => {
		const key = recordFileKey(file);
		if (profile?.records?.files[key] || intake.profile?.records?.files[key]) return false;
		const asked = intake.recordProposals?.[key];
		if (asked?.blob === file.blob && asked.failed !== 'failed') return false;
		return proposeRecordMapping(file).unsure;
	});
}
