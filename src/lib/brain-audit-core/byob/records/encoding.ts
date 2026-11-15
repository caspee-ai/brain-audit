export const RECORD_ENCODINGS = [
	'utf-8',
	'utf-16le',
	'utf-16be',
	'windows-1250',
	'windows-1252'
] as const;
export type RecordEncoding = (typeof RECORD_ENCODINGS)[number];

const CP1250_HIGH =
	'€\u0081‚\u0083„…†‡\u0088‰Š‹ŚŤŽŹ\u0090‘’“”•–—\u0098™š›śťžź' +
	'\u00a0ˇ˘Ł¤Ą¦§¨©Ş«¬\u00ad®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľż' +
	'ŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢß' +
	'ŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙';

const CP1252_C1 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

const CP1250_TELLS = new Set([0xb9, 0x9f, 0xa5, 0x8c, 0x8f, 0xb3]);

function isUtf8Head(bytes: Uint8Array): boolean {
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
		return true;
	} catch {
		return false;
	}
}

export function sniffEncoding(head: Uint8Array): RecordEncoding {
	if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
	if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
	if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8';
	if (isUtf8Head(head)) return 'utf-8';
	for (const byte of head) if (CP1250_TELLS.has(byte)) return 'windows-1250';
	return 'windows-1252';
}

export type RecordDecoder = { decode(chunk?: Uint8Array): string };

function singleByte(high: (byte: number) => string): RecordDecoder {
	return {
		decode(chunk) {
			if (!chunk) return '';
			let out = '';
			for (let i = 0; i < chunk.length; i += 1) {
				const byte = chunk[i]!;
				out += byte < 0x80 ? String.fromCharCode(byte) : high(byte);
			}
			return out;
		}
	};
}

function utf16(littleEndian: boolean): RecordDecoder {
	let carry: number | null = null;
	let high: number | null = null;
	return {
		decode(chunk) {
			if (!chunk) {
				const rest = high !== null ? '�' : '';
				high = null;
				carry = null;
				return rest;
			}
			let out = '';
			let i = 0;
			const unitAt = (a: number, b: number) => (littleEndian ? a | (b << 8) : (a << 8) | b);
			const units: number[] = [];
			if (carry !== null && chunk.length > 0) {
				units.push(unitAt(carry, chunk[0]!));
				carry = null;
				i = 1;
			}
			for (; i + 1 < chunk.length; i += 2) units.push(unitAt(chunk[i]!, chunk[i + 1]!));
			if (i < chunk.length) carry = chunk[i]!;
			for (const unit of units) {
				if (high !== null) {
					if (unit >= 0xdc00 && unit <= 0xdfff) {
						out += String.fromCharCode(high, unit);
						high = null;
						continue;
					}
					out += '�';
					high = null;
				}
				if (unit >= 0xd800 && unit <= 0xdbff) high = unit;
				else out += String.fromCharCode(unit);
			}
			return out;
		}
	};
}

export function createRecordDecoder(encoding: RecordEncoding): RecordDecoder {
	const inner: RecordDecoder =
		encoding === 'utf-8'
			? (() => {
					const decoder = new TextDecoder('utf-8');
					return {
						decode: (chunk?: Uint8Array) =>
							chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode()
					};
				})()
			: encoding === 'utf-16le' || encoding === 'utf-16be'
				? utf16(encoding === 'utf-16le')
				: encoding === 'windows-1250'
					? singleByte((byte) => CP1250_HIGH[byte - 0x80]!)
					: singleByte((byte) =>
							byte < 0xa0 ? CP1252_C1[byte - 0x80]! : String.fromCharCode(byte)
						);
	let first = true;
	return {
		decode(chunk) {
			const text = inner.decode(chunk);
			if (!first || text.length === 0) return text;
			first = false;
			return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
		}
	};
}

export function decodeRecordBytes(
	bytes: Uint8Array,
	encoding: RecordEncoding = sniffEncoding(bytes.subarray(0, RECORD_HEAD_BYTES))
): { text: string; encoding: RecordEncoding } {
	const decoder = createRecordDecoder(encoding);
	return { text: decoder.decode(bytes) + decoder.decode(), encoding };
}

export const RECORD_HEAD_BYTES = 64 * 1024;
