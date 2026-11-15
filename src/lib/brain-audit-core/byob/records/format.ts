import { extensionOf } from '../data';

export const RECORD_FORMATS = ['csv', 'tsv', 'xlsx', 'jsonl', 'json'] as const;
export type RecordFormat = (typeof RECORD_FORMATS)[number];

const FORMAT_OF: Record<string, RecordFormat> = {
	csv: 'csv',
	tsv: 'tsv',
	xlsx: 'xlsx',
	jsonl: 'jsonl',
	ndjson: 'jsonl',
	json: 'json'
};

export function recordFormatOf(path: string): RecordFormat | null {
	return FORMAT_OF[extensionOf(path)] ?? null;
}
