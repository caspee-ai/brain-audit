import { freshnessOf, type Freshness } from '../constellation/model';
import { headerDateOf } from '../byob/mirrors';

export function statedDateKeys(keys: {
	content_date: readonly string[];
	as_of: readonly { date_key: string }[];
}): string[] {
	return [...new Set([...keys.content_date, ...keys.as_of.map((entry) => entry.date_key)])].map(
		(key) => key.toLowerCase()
	);
}

function calendarDay(value: string): string | null {
	const day = value.slice(0, 10);
	const [y, m, d] = day.split('-').map(Number);
	const at = new Date(Date.UTC(y!, m! - 1, d!));
	return at.getUTCFullYear() === y && at.getUTCMonth() === m! - 1 && at.getUTCDate() === d
		? day
		: null;
}

export function statedDateOf(
	header: ReadonlyMap<string, readonly string[]>,
	keys: readonly string[]
): string | null {
	let newest: string | null = null;
	for (const key of keys)
		for (const value of header.get(key.toLowerCase()) ?? []) {
			const date = headerDateOf(value);
			const day = date ? calendarDay(date) : null;
			if (day && (newest === null || day > newest)) newest = day;
		}
	return newest;
}

export function freshnessBand(statedDate: string | null, at: string): Freshness {
	return freshnessOf(statedDate, at);
}
