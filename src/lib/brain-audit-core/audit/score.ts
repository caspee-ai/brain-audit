import type { MethodWeights } from '../method/types';
import {
	SUBSCORE_KEYS,
	type AuditShare,
	type AuditSubscores,
	type ScoreInputs,
	type ScoreResult,
	type SubscoreKey
} from './types';

function subscoreOf(shares: readonly AuditShare[]): number | null {
	const measured = shares.filter((share) => share.denominator > 0);
	if (measured.length === 0) return null;
	const mean =
		measured.reduce(
			(sum, share) => sum + Math.min(1, Math.max(0, share.numerator / share.denominator)),
			0
		) / measured.length;
	return mean * 100;
}

function sharesOf(inputs: ScoreInputs, key: SubscoreKey): AuditShare[] {
	switch (key) {
		case 'links':
			return [inputs.links.resolved, inputs.links.not_orphan];
		case 'structure':
			return [inputs.structure.expected_headings, inputs.structure.no_empty_section];
		case 'metadata':
			return [inputs.metadata.expected_keys_filled, inputs.metadata.with_owner];
		case 'dating':
			return [inputs.dating.dated, inputs.dating.current];
	}
}

export function scoreOf(
	inputs: ScoreInputs,
	weights: Pick<MethodWeights, 'structural'>
): ScoreResult {
	const w = weights.structural;
	const raw = {} as Record<SubscoreKey, number | null>;
	for (const key of SUBSCORE_KEYS)
		raw[key] = inputs.pages > 0 ? subscoreOf(sharesOf(inputs, key)) : null;

	const subscores = {} as AuditSubscores;
	for (const key of SUBSCORE_KEYS)
		subscores[key] = {
			score: raw[key] === null ? null : Math.round(raw[key]),
			weight: w[key]
		};
	const left_out = SUBSCORE_KEYS.filter((key) => raw[key] === null);

	const measured = SUBSCORE_KEYS.filter((key) => raw[key] !== null);
	const weight = measured.reduce((sum, key) => sum + w[key], 0);
	if (inputs.pages <= 0 || weight === 0) return { score: null, subscores, left_out };

	const total = measured.reduce((sum, key) => sum + raw[key]! * w[key], 0) / weight;
	return { score: Math.round(total), subscores, left_out };
}
