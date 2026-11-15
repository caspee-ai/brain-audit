const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export function decodeUtf8(bytes: Uint8Array): string | null {
	if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
		return decodeUtf16(bytes, true);
	if (bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
		return decodeUtf16(bytes, false);
	try {
		return strictUtf8.decode(bytes).replace(/^\uFEFF/, '');
	} catch {
		return null;
	}
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string | null {
	if (bytes.byteLength % 2 !== 0) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const units: number[] = [];
	for (let i = 2; i < bytes.byteLength; i += 2) units.push(view.getUint16(i, littleEndian));
	let out = '';
	for (let i = 0; i < units.length; i += 1) {
		const unit = units[i]!;
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const low = units[i + 1];
			if (low === undefined || low < 0xdc00 || low > 0xdfff) return null;
			out += String.fromCharCode(unit, low);
			i += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return null;
		else out += String.fromCharCode(unit);
	}
	return out;
}
