import type { MethodWeights } from '../method/types';
import { applicabilityOf, meritScoreOf, totalScoreOf } from '../merit/score';
import type { MeritElementInput } from '../merit/types';
import type { PlainMeasures } from '../pack/summary';
import type { ProjectedScores, ScoreProjection } from '../pack/sealed-pack';
import { FINDING_CATEGORIES, type FindingCategory } from '../pack/vocab';
import { scoreOf } from './score';
import type { AuditShare, ScoreInputs } from './types';

const COVERED_LEVEL = 2;

function plus(share: AuditShare, add: number): AuditShare {
	return {
		numerator: Math.min(share.denominator, share.numerator + add),
		denominator: share.denominator
	};
}

function full(share: AuditShare): AuditShare {
	return { numerator: share.denominator, denominator: share.denominator };
}

export function fixedInputsOf(
	inputs: ScoreInputs,
	measures: Pick<PlainMeasures, 'links' | 'freshness'>,
	fixed: ReadonlySet<FindingCategory>
): ScoreInputs {
	const has = (category: FindingCategory) => fixed.has(category);
	const links = measures.links;
	const linkGain =
		(has('missing_links') ? links.missing : 0) +
		(has('ambiguous_links') ? links.ambiguous : 0) +
		(has('outside_links') ? links.outside : 0);
	const currentGain =
		(has('stale') ? measures.freshness.stale : 0) + (has('undated') ? measures.freshness.none : 0);
	return {
		pages: inputs.pages,
		links: {
			resolved: plus(inputs.links.resolved, linkGain),
			not_orphan: has('orphan') ? full(inputs.links.not_orphan) : inputs.links.not_orphan
		},
		structure: {
			expected_headings: has('missing_expected')
				? full(inputs.structure.expected_headings)
				: inputs.structure.expected_headings,
			no_empty_section: has('empty_sections')
				? full(inputs.structure.no_empty_section)
				: inputs.structure.no_empty_section
		},
		metadata: {
			expected_keys_filled: has('keys_unfilled')
				? full(inputs.metadata.expected_keys_filled)
				: inputs.metadata.expected_keys_filled,
			with_owner: has('no_owner') ? full(inputs.metadata.with_owner) : inputs.metadata.with_owner
		},
		dating: {
			dated: has('undated') ? full(inputs.dating.dated) : inputs.dating.dated,
			current: plus(inputs.dating.current, currentGain)
		}
	};
}

export function liftedMeritRowsOf(
	rows: readonly MeritElementInput[],
	fixed: ReadonlySet<FindingCategory>
): MeritElementInput[] {
	return rows.map((row) => {
		if (row.level === null || row.level === undefined) return row;
		const lift =
			(row.level === 0 && fixed.has('merit_absent')) ||
			(row.level === 1 && fixed.has('merit_thin'));
		if (!lift || !applicabilityOf(row, null).applies) return row;
		return { ...row, level: COVERED_LEVEL };
	});
}

export function scoreProjectionOf(args: {
	inputs: ScoreInputs;
	measures: Pick<PlainMeasures, 'links' | 'freshness'>;
	merit: { rows: readonly MeritElementInput[] } | null;
	weights: Pick<MethodWeights, 'structural' | 'merit' | 'total'>;
	top5: readonly FindingCategory[];
}): ScoreProjection {
	const after = (fixed: ReadonlySet<FindingCategory>): ProjectedScores => {
		const structural = scoreOf(
			fixedInputsOf(args.inputs, args.measures, fixed),
			args.weights
		).score;
		const merit = args.merit
			? meritScoreOf(liftedMeritRowsOf(args.merit.rows, fixed), args.weights.merit)
			: null;
		return { structural, merit, total: totalScoreOf(args.weights.total, structural, merit) };
	};
	const by_category = Object.fromEntries(
		FINDING_CATEGORIES.map((category) => [category, after(new Set([category]))])
	) as Record<FindingCategory, ProjectedScores>;
	return { by_category, top5: after(new Set(args.top5)) };
}
