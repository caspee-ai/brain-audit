import { BYOB_DATA_SOURCE_PARAM } from '../vocabulary/byob';
import { EXTRACTION_MAX_BYTES } from '$lib/shared/limits';
import { htmlToText } from '$lib/shared/html';

export { BYOB_DATA_SOURCE_PARAM };

export const DATA_SOURCE_REASON = 'data_source';

export const DEFERRED_SOURCE_REASON = 'read when a page opens it';

const TEXT_DATA_TYPES: Record<string, string> = {
	json: 'text/json',
	jsonl: 'text/x-ndjson',
	csv: 'text/csv',
	tsv: 'text/tab-separated-values',
	yml: 'text/yaml',
	yaml: 'text/yaml',
	toml: 'text/x-toml',
	xml: 'text/xml',
	html: 'text/html',
	htm: 'text/html',
	eml: 'message/rfc822',
	ics: 'text/calendar'
};

const BINARY_DATA_TYPES: Record<string, string> = {
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	xls: 'application/vnd.ms-excel',
	pdf: 'application/pdf',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

export const BINARY_DATA_EXTENSIONS: readonly string[] = Object.keys(BINARY_DATA_TYPES);

export const DEFAULT_DATA_INCLUDE: readonly string[] = [
	...Object.keys(TEXT_DATA_TYPES),
	...BINARY_DATA_EXTENSIONS
];

export const READABLE_DATA_EXTENSIONS: ReadonlySet<string> = new Set(DEFAULT_DATA_INCLUDE);

export const DEFAULT_DATA_EXCLUDE: readonly string[] = [
	'py',
	'js',
	'ts',
	'sh',
	'plist',
	'lock',
	'base'
];

export const BYOB_DATA_INLINE_MAX_BYTES = 1024 * 1024;
export const BYOB_DATA_MAX_BYTES = EXTRACTION_MAX_BYTES;

const CREDENTIALS =
	/(^|\/)(\.env(\.[^/]*)?|\.netrc|\.npmrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|[^/]*\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)|[^/]*(credential|secret|service[-_]?account|private[-_]?key|access[-_]?token|api[-_]?key)[^/]*)$/i;

export function isCredentialPath(path: string): boolean {
	return CREDENTIALS.test(path);
}

export type ByobDataScope = { include: string[]; exclude: string[] };

const DATA_NOISE =
	/(^|\/)(_site|__macosx|node_modules|_buildlog|_rejects|\.trash)\/|^(views|imported-v2)\/|(^|\/)(package(-lock)?\.json|(ts|js)config[^/]*\.json|composer\.(json|lock)|[^/]*-lock\.ya?ml|[^/]*\.lock|docker-compose[^/]*\.ya?ml|_config\.ya?ml|mkdocs\.ya?ml|netlify\.toml|vercel\.json|wrangler\.(toml|jsonc?)|cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|licen[cs]e[^/]*|notice(\.[^/]*)?|cmakelists\.txt|go\.sum|robots\.txt|renovate\.json|manifest\.json)$|\.sync-conflict-|\(conflicted copy/i;

export function isDataNoise(path: string): boolean {
	return DATA_NOISE.test(path);
}

export function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function dataExtensions(data: ByobDataScope | null | undefined): ReadonlySet<string> {
	const include = data && data.include.length > 0 ? data.include : DEFAULT_DATA_INCLUDE;
	const exclude = new Set([...DEFAULT_DATA_EXCLUDE, ...(data?.exclude ?? [])]);
	return new Set(
		include
			.map((ext) => ext.replace(/^\./, '').toLowerCase())
			.filter((ext) => !exclude.has(ext) && (ext in TEXT_DATA_TYPES || ext in BINARY_DATA_TYPES))
	);
}

export function isDataPath(path: string, extensions: ReadonlySet<string>): boolean {
	return extensions.has(extensionOf(path));
}

export function dataContentType(path: string): string {
	const ext = extensionOf(path);
	return `${TEXT_DATA_TYPES[ext] ?? BINARY_DATA_TYPES[ext] ?? 'text/plain'}; ${BYOB_DATA_SOURCE_PARAM}`;
}

export function isBinaryDataPath(path: string): boolean {
	return extensionOf(path) in BINARY_DATA_TYPES;
}

export function isDeferredData(path: string, size: number, maxFileBytes: number): boolean {
	return isBinaryDataPath(path) || size > Math.min(BYOB_DATA_INLINE_MAX_BYTES, maxFileBytes);
}

export function isHtmlDataPath(path: string): boolean {
	const ext = extensionOf(path);
	return ext === 'html' || ext === 'htm';
}

export function broughtDataText(path: string, text: string): string {
	return isHtmlDataPath(path) ? htmlToText(text) : text;
}

export function isDataContentType(contentType: string | null | undefined): boolean {
	return (contentType ?? '').endsWith(BYOB_DATA_SOURCE_PARAM);
}
