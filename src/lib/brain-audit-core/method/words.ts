export function wordAlternation(words: readonly string[]): string {
	return words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}
