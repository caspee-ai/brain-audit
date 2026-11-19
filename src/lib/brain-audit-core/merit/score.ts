import { freshnessOf } from '../constellation/model';
import { PROOF_KEYS } from '$lib/brain-audit-core/byob/citations';
import type { MethodElement, MethodTier, MethodWeights } from '../method/types';
import type {
	EffectiveApplicability,
	MeritApplicability,
	MeritElementInput,
	MeritLevel,
	MeritPageFacts,
	MeritSubject,
	MeritWeightKey
} from './types';

export type MeritWeights = MethodWeights['merit'];
export type TotalWeights = MethodWeights['total'];

export function tierForSubject(
	element: Pick<MethodElement, 'tier' | 'applies_to'>,
	subject: MeritSubject
): MethodTier {
	return element.applies_to?.[subject] ?? element.tier;
}

export function layerForSubject(
	element: Pick<MethodElement, 'layer' | 'layer_applies_to'>,
	subject: MeritSubject
): string {
	return element.layer_applies_to?.[subject] ?? element.layer;
}

export function pageIsSourced(page: MeritPageFacts): boolean {
	if (page.citationsOut > 0) return true;
	const unfilled = new Set(page.keysUnfilled.map((key) => key.toLowerCase()));
	return page.keys.some(
		(key) => PROOF_KEYS.has(key.toLowerCase()) && !unfilled.has(key.toLowerCase())
	);
}

export function pageIsCurrent(page: MeritPageFacts, at: string): boolean {
	const band = freshnessOf(page.statedDate, at);
	return band === 'fresh' || band === 'ageing';
}

export function pageIsOwned(page: MeritPageFacts): boolean {
	return (page.ownerHint ?? '').trim() !== '';
}

export function levelOf(
	input: {
		pages: readonly MeritPageFacts[];
		coversQuestion: boolean | null;
		at: string;
	},
	weights: Pick<MeritWeights, 'level3_share'>
): MeritLevel | null {
	if (input.pages.length === 0) return 0;
	if (input.coversQuestion === null) return null;
	if (!input.coversQuestion) return 1;
	const strong = input.pages.filter(
		(page) => pageIsSourced(page) && pageIsCurrent(page, input.at) && pageIsOwned(page)
	).length;
	return strong > input.pages.length * weights.level3_share ? 3 : 2;
}

export function applicabilityOf(
	element: Pick<MeritElementInput, 'group' | 'tier' | 'verdictApplies' | 'mappedPages'>,
	override: MeritApplicability | null | undefined
): EffectiveApplicability {
	if (override) return { applies: override === 'applies', unsure: false, source: 'override' };
	if (element.verdictApplies)
		return {
			applies: element.verdictApplies !== 'no',
			unsure: element.verdictApplies === 'unsure',
			source: 'model'
		};
	if (element.group === 'module' || element.tier === 'by_type')
		return { applies: true, unsure: true, source: 'tier' };
	if (element.tier === 'always') return { applies: true, unsure: false, source: 'tier' };
	return { applies: element.mappedPages > 0, unsure: false, source: 'tier' };
}

export function weightOf(
	element: Pick<MeritElementInput, 'group' | 'tier'>,
	weights: Pick<MeritWeights, MeritWeightKey>
): number {
	const key: MeritWeightKey =
		element.group === 'module' ? 'module' : (element.tier as MeritWeightKey);
	return weights[key] ?? weights.by_type;
}

export function meritScoreOf(
	elements: readonly MeritElementInput[],
	weights: Pick<MeritWeights, MeritWeightKey | 'max_level'>,
	overrides: ReadonlyMap<string, MeritApplicability> = new Map()
): number | null {
	let weighted = 0;
	let total = 0;
	for (const element of elements) {
		if (element.level === null || element.level === undefined) continue;
		if (!applicabilityOf(element, overrides.get(element.elementId)).applies) continue;
		const weight = weightOf(element, weights);
		weighted += (element.level / weights.max_level) * weight;
		total += weight;
	}
	if (total === 0) return null;
	return Math.round((weighted / total) * 100);
}

export function totalScoreOf(
	weights: TotalWeights,
	structural: number | null,
	merit: number | null
): number | null {
	if (structural === null || merit === null) return null;
	return Math.round(weights.structural * structural + weights.merit * merit);
}
