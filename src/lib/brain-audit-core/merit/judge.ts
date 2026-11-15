import type { MethodElement } from '../method/types';
import type { MeritPageRow } from './mapping';
import { levelOf, tierForSubject, type MeritWeights } from './score';
import type { MeritElementResult, MeritPageFacts, MeritSubject, MeritVerdict } from './types';

export const PAGES_PER_ELEMENT = 40;

export const MERIT_UNANSWERED_REASON = 'unanswered';

type JudgeElement = Pick<MethodElement, 'id' | 'group' | 'tier' | 'applies_to'>;

export function needsJudgement(
	element: Pick<MethodElement, 'group' | 'tier' | 'applies_to'>,
	subject: MeritSubject,
	mappedPages: number
): boolean {
	return (
		mappedPages > 0 || element.group === 'module' || tierForSubject(element, subject) === 'by_type'
	);
}

export type JudgementGroup = { group: string; element_ids: string[] };

export function judgementGroups(
	groups: readonly string[],
	subject: MeritSubject,
	mapped: ReadonlyMap<string, readonly string[]>,
	elements: readonly JudgeElement[]
): JudgementGroup[] {
	return groups.flatMap((group) => {
		const ids = elements
			.filter((e) => e.group === group && needsJudgement(e, subject, mapped.get(e.id)?.length ?? 0))
			.map((e) => e.id);
		return ids.length > 0 ? [{ group, element_ids: ids }] : [];
	});
}

export type JudgedPage = Omit<MeritPageRow, 'cluster_id'>;

export function judgedPage(row: MeritPageRow): JudgedPage {
	return {
		path: row.path,
		title: row.title,
		type: row.type,
		area: row.area,
		tags: [...row.tags].sort(),
		keys: [...row.keys].sort(),
		chars: row.chars,
		links_in: row.links_in,
		citations_out: row.citations_out,
		stated_date: row.stated_date,
		owner_hint: row.owner_hint
	};
}

export type BrainOverview = {
	pages: number;
	by_area: Readonly<Record<string, number>>;
	by_type: Readonly<Record<string, number>>;
};

export function overviewOf(rows: readonly MeritPageRow[]): BrainOverview {
	const byArea: Record<string, number> = {};
	const byType: Record<string, number> = {};
	for (const row of rows) {
		const area = row.area ?? '(none)';
		const type = row.type ?? '(none)';
		byArea[area] = (byArea[area] ?? 0) + 1;
		byType[type] = (byType[type] ?? 0) + 1;
	}
	return { pages: rows.length, by_area: byArea, by_type: byType };
}

export function pageFactsOf(
	row: Pick<MeritPageRow, 'citations_out' | 'keys' | 'stated_date' | 'owner_hint'>,
	keysUnfilled: readonly string[]
): MeritPageFacts {
	return {
		citationsOut: row.citations_out,
		keys: row.keys,
		keysUnfilled,
		statedDate: row.stated_date,
		ownerHint: row.owner_hint
	};
}

export type MeritElementVerdict = {
	applies: MeritVerdict;
	reason: string;
	covers_question: boolean;
	missing: readonly string[];
};

export function meritElementRows(args: {
	subject: MeritSubject;
	elements: readonly Pick<MethodElement, 'id' | 'group' | 'tier' | 'applies_to'>[];
	weights: Pick<MeritWeights, 'level3_share'>;
	mapped: ReadonlyMap<string, readonly string[]>;
	rowOf: ReadonlyMap<string, MeritPageRow>;
	keysUnfilled: ReadonlyMap<string, readonly string[]>;
	verdicts: ReadonlyMap<string, MeritElementVerdict>;
	unanswered: ReadonlySet<string>;
	checklist: ReadonlyMap<string, readonly string[]>;
	at: string;
}): MeritElementResult[] {
	return args.elements.map((element): MeritElementResult => {
		const paths = args.mapped.get(element.id) ?? [];
		const pages = paths.flatMap((path) => {
			const row = args.rowOf.get(path);
			return row ? [pageFactsOf(row, args.keysUnfilled.get(path) ?? [])] : [];
		});
		const base = {
			elementId: element.id,
			group: element.group,
			tier: tierForSubject(element, args.subject),
			mappedPages: paths.length
		};
		const verdict = args.verdicts.get(element.id);
		if (verdict)
			return {
				...base,
				verdictApplies: verdict.applies,
				reason: verdict.reason,
				coversQuestion: verdict.covers_question,
				level: levelOf(
					{ pages, coversQuestion: verdict.covers_question, at: args.at },
					args.weights
				),
				missing: [...verdict.missing]
			};
		if (!needsJudgement(element, args.subject, paths.length))
			return {
				...base,
				verdictApplies: null,
				reason: null,
				coversQuestion: null,
				level: 0,
				missing: [...(args.checklist.get(element.id) ?? [])]
			};
		return {
			...base,
			verdictApplies: null,
			reason: args.unanswered.has(element.id) ? MERIT_UNANSWERED_REASON : null,
			coversQuestion: null,
			level: null,
			missing: []
		};
	});
}
