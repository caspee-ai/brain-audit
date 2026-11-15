import { parseSealedPack, type SealedPack } from './sealed-pack';

export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const KEY_TEXT_LENGTH = 43;

const MAGIC = [0x55, 0x42, 0x41] as const;
export const ENVELOPE_VERSION = 1;
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES;

export class SealError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SealError';
	}
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map([...ALPHABET].map((ch, i) => [ch, i]));

export function base64urlEncode(bytes: Uint8Array): string {
	let out = '';
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
		out +=
			ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const n = bytes[i] << 16;
		out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63];
	} else if (rest === 2) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
		out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
	}
	return out;
}

export function base64urlDecode(text: string): Uint8Array | null {
	if (text.length % 4 === 1) return null;
	const out = new Uint8Array(Math.floor((text.length * 3) / 4));
	let bits = 0;
	let value = 0;
	let o = 0;
	for (const ch of text) {
		const v = LOOKUP.get(ch);
		if (v === undefined) return null;
		value = (value << 6) | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[o++] = (value >> bits) & 0xff;
		}
	}
	if ((value & ((1 << bits) - 1)) !== 0) return null;
	return out;
}

export function decodeKey(text: string): Uint8Array | null {
	if (text.length !== KEY_TEXT_LENGTH) return null;
	const bytes = base64urlDecode(text);
	return bytes && bytes.length === KEY_BYTES ? bytes : null;
}

export type Sealed = {
	key: string;
	iv: Uint8Array;
	ciphertext: Uint8Array;
};

function subtle(): SubtleCrypto {
	const c = globalThis.crypto;
	if (!c?.subtle) throw new SealError('WebCrypto is not available (Node ≥ 20 or a browser)');
	return c.subtle;
}

const aadOf = (auditId: string) => new TextEncoder().encode(auditId);

function buf(bytes: Uint8Array): ArrayBuffer {
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
}

export async function seal(plain: Uint8Array, auditId: string): Promise<Sealed> {
	const raw = globalThis.crypto.getRandomValues(new Uint8Array(KEY_BYTES));
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const cryptoKey = await subtle().importKey('raw', buf(raw), 'AES-GCM', false, ['encrypt']);
	const ciphertext = new Uint8Array(
		await subtle().encrypt(
			{ name: 'AES-GCM', iv: buf(iv), additionalData: buf(aadOf(auditId)), tagLength: 128 },
			cryptoKey,
			buf(plain)
		)
	);
	return { key: base64urlEncode(raw), iv, ciphertext };
}

export async function open(sealed: Sealed, auditId: string): Promise<Uint8Array> {
	const raw = decodeKey(sealed.key);
	if (!raw) throw new SealError('not a 256-bit base64url key');
	if (sealed.iv.length !== IV_BYTES) throw new SealError('not a 96-bit IV');
	const cryptoKey = await subtle().importKey('raw', buf(raw), 'AES-GCM', false, ['decrypt']);
	try {
		return new Uint8Array(
			await subtle().decrypt(
				{
					name: 'AES-GCM',
					iv: buf(sealed.iv),
					additionalData: buf(aadOf(auditId)),
					tagLength: 128
				},
				cryptoKey,
				buf(sealed.ciphertext)
			)
		);
	} catch {
		throw new SealError('the pack does not open with this key for this audit');
	}
}

export function encodeEnvelope(iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
	if (iv.length !== IV_BYTES) throw new SealError('not a 96-bit IV');
	const out = new Uint8Array(HEADER_BYTES + ciphertext.length);
	out.set(MAGIC, 0);
	out[MAGIC.length] = ENVELOPE_VERSION;
	out.set(iv, MAGIC.length + 1);
	out.set(ciphertext, HEADER_BYTES);
	return out;
}

export function decodeEnvelope(bytes: Uint8Array): { iv: Uint8Array; ciphertext: Uint8Array } {
	if (bytes.length < HEADER_BYTES + 16) throw new SealError('not a sealed pack: too short');
	if (MAGIC.some((b, i) => bytes[i] !== b)) throw new SealError('not a sealed pack');
	if (bytes[MAGIC.length] !== ENVELOPE_VERSION)
		throw new SealError('a sealed pack of an unknown version');
	return {
		iv: bytes.slice(MAGIC.length + 1, HEADER_BYTES),
		ciphertext: bytes.slice(HEADER_BYTES)
	};
}

export function isEnvelope(bytes: Uint8Array): boolean {
	return (
		bytes.length >= HEADER_BYTES + 16 &&
		MAGIC.every((b, i) => bytes[i] === b) &&
		bytes[MAGIC.length] === ENVELOPE_VERSION
	);
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
	const out = new Blob([buf(bytes)])
		.stream()
		.pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>);
	return new Uint8Array(await new Response(out).arrayBuffer());
}

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	if (typeof CompressionStream === 'undefined')
		throw new SealError('CompressionStream is not available (Node ≥ 18 or a current browser)');
	return pipe(bytes, new CompressionStream('gzip'));
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
	if (typeof DecompressionStream === 'undefined')
		throw new SealError('DecompressionStream is not available');
	try {
		return await pipe(bytes, new DecompressionStream('gzip'));
	} catch {
		throw new SealError('the opened pack is not gzip');
	}
}

export async function sealPack(
	pack: SealedPack,
	auditId: string
): Promise<{ key: string; envelope: Uint8Array }> {
	if (pack.audit_id !== auditId) throw new SealError('the pack names another audit');
	const plain = await gzip(new TextEncoder().encode(JSON.stringify(pack)));
	const { key, iv, ciphertext } = await seal(plain, auditId);
	return { key, envelope: encodeEnvelope(iv, ciphertext) };
}

export async function openPack(
	envelope: Uint8Array,
	key: string,
	auditId: string
): Promise<SealedPack> {
	const { iv, ciphertext } = decodeEnvelope(envelope);
	const plain = await gunzip(await open({ key, iv, ciphertext }, auditId));
	let json: unknown;
	try {
		json = JSON.parse(new TextDecoder().decode(plain));
	} catch {
		throw new SealError('the opened pack is not JSON');
	}
	const parsed = parseSealedPack(json, auditId);
	if (!parsed.ok) throw new SealError(`the opened pack is malformed: ${parsed.errors.join('; ')}`);
	return parsed.pack;
}
