export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export class CsvParser {
	private row: string[] = [];
	private cell = '';
	private quoted = false;
	private quoteSeen = false;
	private afterCr = false;
	private started = false;

	constructor(private readonly delimiter: CsvDelimiter) {}

	push(text: string): string[][] {
		const rows: string[][] = [];
		const delimiter = this.delimiter;
		for (let i = 0; i < text.length; i += 1) {
			const char = text[i]!;
			if (this.afterCr) {
				this.afterCr = false;
				if (char === '\n') continue;
			}
			if (this.quoted) {
				if (this.quoteSeen) {
					this.quoteSeen = false;
					if (char === '"') {
						this.cell += '"';
						continue;
					}
					this.quoted = false;
				} else if (char === '"') {
					this.quoteSeen = true;
					continue;
				} else {
					this.cell += char;
					continue;
				}
			}
			if (char === delimiter) {
				this.row.push(this.cell);
				this.cell = '';
				this.started = true;
			} else if (char === '\n' || char === '\r') {
				if (this.started || this.cell.length > 0) rows.push(this.closeRow());
				if (char === '\r') this.afterCr = true;
			} else if (char === '"' && this.cell.length === 0) {
				this.quoted = true;
				this.started = true;
			} else {
				this.cell += char;
				this.started = true;
			}
		}
		return rows;
	}

	end(): string[][] {
		this.quoteSeen = false;
		this.quoted = false;
		return this.started || this.cell.length > 0 ? [this.closeRow()] : [];
	}

	private closeRow(): string[] {
		this.row.push(this.cell);
		const row = this.row;
		this.row = [];
		this.cell = '';
		this.started = false;
		return row;
	}
}

export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
	const parser = new CsvParser(delimiter);
	return [...parser.push(text), ...parser.end()];
}

export const CSV_DETECT_ROWS = 50;

export function sniffDelimiter(head: string, path = ''): CsvDelimiter {
	if (/\.tsv$/i.test(path)) return '\t';
	let best: { delimiter: CsvDelimiter; score: number } = { delimiter: ',', score: 0 };
	for (const delimiter of CSV_DELIMITERS) {
		const parser = new CsvParser(delimiter);
		const rows = parser.push(head).slice(0, CSV_DETECT_ROWS + 1);
		if (rows.length === 0) continue;
		const width = rows[0]!.length;
		if (width < 2) continue;
		const same = rows.filter((row) => row.length === width).length / rows.length;
		const score = width * same * same;
		if (score > best.score) best = { delimiter, score };
	}
	return best.delimiter;
}

export const HEADER_CELL_MAX = 60;

export function isRecordTable(rows: readonly (readonly string[])[]): boolean {
	const header = rows[0];
	if (!header || !isRecordHeader(header)) return false;
	const next = rows.slice(1, CSV_DETECT_ROWS + 1);
	if (next.length === 0) return false;
	return next.filter((row) => row.length === header.length).length / next.length >= 0.8;
}

export function isRecordHeader(header: readonly string[]): boolean {
	const cells = header.map((cell) => cell.trim());
	const named = cells.filter((cell) => cell.length > 0);
	if (named.length < 2) return false;
	if (named.some((cell) => cell.length > HEADER_CELL_MAX)) return false;
	return new Set(named.map((cell) => cell.toLowerCase())).size === named.length;
}
