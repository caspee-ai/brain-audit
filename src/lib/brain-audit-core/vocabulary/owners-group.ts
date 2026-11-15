export const BRAIN_OWNERS_GROUP = 'Admins';

export const BRAIN_OWNERS_GROUP_NAMES_LOWER = [BRAIN_OWNERS_GROUP.toLowerCase()] as const;

export function isBrainOwnersGroupName(name: string): boolean {
	return (BRAIN_OWNERS_GROUP_NAMES_LOWER as readonly string[]).includes(name.trim().toLowerCase());
}

export function groupDisplayName(name: string): string {
	return isBrainOwnersGroupName(name) ? BRAIN_OWNERS_GROUP : name;
}

export function teamGroupName(name: string): string {
	return isBrainOwnersGroupName(name) ? `${name.trim()} (team)` : name.trim();
}

const LEGACY_READER_NAME = 'brain owners';

export function namesAdminsGroupReader(name: string): boolean {
	return isBrainOwnersGroupName(name) || name.trim().toLowerCase() === LEGACY_READER_NAME;
}

export function readerDisplayName(name: string): string {
	return namesAdminsGroupReader(name) ? BRAIN_OWNERS_GROUP : name;
}
