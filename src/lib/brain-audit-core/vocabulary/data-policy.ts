export const DATA_CATEGORIES = [
	'credential',
	'iban',
	'card_number',
	'national_id',
	'person_tax_id',
	'home_address',
	'health',
	'family',
	'private_finances',
	'compensation'
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export const RETIRED_DATA_CATEGORIES = ['clients_separate', 'employer_confidential'] as const;

export const DATA_CHOICES = ['out', 'restricted', 'open'] as const;
export type DataChoice = (typeof DATA_CHOICES)[number];

export type DataPolicy = {
	version: 2;
	categories: Partial<Record<DataCategory, DataChoice>>;
};

export const FLOOR: readonly DataCategory[] = ['credential', 'iban', 'card_number'];

export function isFloorCategory(category: DataCategory): boolean {
	return FLOOR.includes(category);
}

function isCategory(value: unknown): value is DataCategory {
	return typeof value === 'string' && (DATA_CATEGORIES as readonly string[]).includes(value);
}

function isChoice(value: unknown): value is DataChoice {
	return typeof value === 'string' && (DATA_CHOICES as readonly string[]).includes(value);
}

export function parseDataPolicy(value: unknown): DataPolicy | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (record.version !== undefined && record.version !== 1 && record.version !== 2) return null;
	const categories: Partial<Record<DataCategory, DataChoice>> = {};
	const given = record.categories;
	if (given && typeof given === 'object' && !Array.isArray(given))
		for (const [key, choice] of Object.entries(given as Record<string, unknown>))
			if (isCategory(key) && isChoice(choice)) categories[key] = choice;
	for (const category of FLOOR) categories[category] = 'out';
	return { version: 2, categories };
}
