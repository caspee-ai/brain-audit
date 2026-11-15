import type { MethodTier } from '../method/types';

export type MeritVerdict = 'yes' | 'no' | 'unsure';
export type MeritApplicability = 'applies' | 'not_applicable';
export type MeritHow = 'type' | 'cluster' | 'title';
export type MeritSubject = 'company' | 'person';
export type MeritWeightKey = MethodTier | 'module';
export type MeritCallKind = 'map' | 'titles' | `group:${string}`;

export type MeritLevel = 0 | 1 | 2 | 3;

export type ApplicabilitySource = 'override' | 'model' | 'tier';

export type EffectiveApplicability = {
	applies: boolean;
	unsure: boolean;
	source: ApplicabilitySource;
};

export type MeritElementInput = {
	elementId: string;
	group: string;
	tier: string;
	verdictApplies: MeritVerdict | null;
	level: number | null;
	mappedPages: number;
};

export type MeritElementResult = MeritElementInput & {
	reason: string | null;
	coversQuestion: boolean | null;
	missing: string[];
};

export type MeritPageFacts = {
	citationsOut: number;
	keys: readonly string[];
	keysUnfilled: readonly string[];
	statedDate: string | null;
	ownerHint: string | null;
};
