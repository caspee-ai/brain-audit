import type { Method } from '../method/types';
import type { MeritGrade, PackMerit } from '../pack/sealed-pack';
import { meritElementsFor } from './company-type';
import { checklistIdsByElement, meritChecklist } from './checklist';
import { meritElementRows, type MeritElementVerdict } from './judge';
import type { MeritPageRow } from './mapping';
import { ruleMappedPages, type MeritMetadataPack } from './pack';
import { applicabilityOf, meritScoreOf } from './score';
import type { MeritElementInput, MeritElementResult, MeritLevel, MeritVerdict } from './types';

export type AgentGrade = {
	element_id: string;
	applies: MeritVerdict;
	depth: MeritLevel;
	uncertain: boolean;
	read_paths: string[];
	evidence: string[];
	missing: string[];
	rationale: string;
};

export type AgentGrades = {
	grades_version: number;
	pack_hash: string;
	grades: AgentGrade[];
};

export type ParseGradesResult = { ok: true; grades: AgentGrades } | { ok: false; errors: string[] };

const VERDICTS: readonly string[] = ['yes', 'no', 'unsure'];
const GRADE_KEYS = new Set([
	'element_id',
	'applies',
	'depth',
	'uncertain',
	'read_paths',
	'evidence',
	'missing',
	'rationale'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] | null {
	return Array.isArray(value) && value.every((v) => typeof v === 'string')
		? (value as string[])
		: null;
}

function isRelativePath(path: string): boolean {
	return (
		path.length > 0 &&
		!path.startsWith('/') &&
		!path.includes('\\') &&
		!/^[A-Za-z]:/.test(path) &&
		!path.split('/').some((segment) => segment === '..' || segment === '')
	);
}

export type ParseGradesOptions = {
	files?: ReadonlySet<string>;
};

export function parseAgentGrades(
	method: Pick<Method, 'catalog' | 'mapping' | 'rubric'>,
	input: unknown,
	pack: MeritMetadataPack,
	options: ParseGradesOptions = {}
): ParseGradesResult {
	const gradesVersion = method.rubric.grades_version;
	const rationaleMax = method.rubric.rationale_max_chars;
	const errors: string[] = [];
	if (!isRecord(input)) return { ok: false, errors: ['grades: not an object'] };
	for (const key of Object.keys(input))
		if (!['grades_version', 'pack_hash', 'grades'].includes(key))
			errors.push(`grades.${key}: unknown field`);
	if (input.grades_version !== gradesVersion)
		errors.push(`grades_version: expected ${gradesVersion}`);
	if (input.pack_hash !== pack.content_hash)
		errors.push("pack_hash: not this merit pack's content_hash");
	if (!Array.isArray(input.grades)) {
		errors.push('grades: not a list');
		return { ok: false, errors };
	}

	const elements = new Map(pack.elements.map((element) => [element.element_id, element]));
	const pages = new Set(pack.pages.map((page) => page.path));
	const mapped = ruleMappedPages(method, pack);
	const seen = new Map<string, AgentGrade>();

	input.grades.forEach((raw: unknown, i: number) => {
		const at = `grades[${i}]`;
		if (!isRecord(raw)) return void errors.push(`${at}: not an object`);
		for (const key of Object.keys(raw))
			if (!GRADE_KEYS.has(key)) errors.push(`${at}.${key}: unknown field`);
		const id = raw.element_id;
		const element = typeof id === 'string' ? elements.get(id) : undefined;
		if (typeof id !== 'string') errors.push(`${at}.element_id: not a string`);
		else if (!element) errors.push(`${at}.element_id: unknown element ${id}`);
		else if (seen.has(id)) errors.push(`${at}.element_id: ${id} graded twice`);

		const applies = raw.applies;
		if (typeof applies !== 'string' || !VERDICTS.includes(applies))
			errors.push(`${at}.applies: not one of yes, no, unsure`);
		const depth = raw.depth;
		if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > 3)
			errors.push(`${at}.depth: not a whole number 0–3`);
		const uncertain = raw.uncertain;
		if (typeof uncertain !== 'boolean') errors.push(`${at}.uncertain: not a boolean`);

		const reads = strings(raw.read_paths);
		if (!reads) errors.push(`${at}.read_paths: not a list of strings`);
		else {
			if (reads.length > pack.read_limit)
				errors.push(
					`${at}.read_paths: ${reads.length} files, more than the limit ${pack.read_limit}`
				);
			if (reads.length > 0 && uncertain !== true)
				errors.push(`${at}.read_paths: files read for an element not marked uncertain`);
			if (new Set(reads).size !== reads.length) errors.push(`${at}.read_paths: repeated path`);
			for (const path of reads)
				if (options.files ? !options.files.has(path) : !isRelativePath(path))
					errors.push(`${at}.read_paths: ${path} is not a file of the brain`);
		}

		const evidence = strings(raw.evidence);
		if (!evidence) errors.push(`${at}.evidence: not a list of strings`);
		else {
			if (new Set(evidence).size !== evidence.length) errors.push(`${at}.evidence: repeated path`);
			for (const path of evidence)
				if (!pages.has(path)) errors.push(`${at}.evidence: ${path} is not a page of the pack`);
			if (depth === 0 && evidence.length > 0)
				errors.push(`${at}.evidence: depth 0 names no evidence`);
			if (
				typeof depth === 'number' &&
				depth > 0 &&
				evidence.length === 0 &&
				element &&
				(mapped.get(element.element_id)?.length ?? 0) === 0
			)
				errors.push(`${at}.evidence: depth ${depth} needs a page (none mapped, none cited)`);
		}

		const missing = strings(raw.missing);
		if (!missing) errors.push(`${at}.missing: not a list of strings`);
		else if (element) {
			const ids = new Set(element.checklist.map((item) => item.id));
			for (const item of missing)
				if (!ids.has(item)) errors.push(`${at}.missing: unknown checklist item ${item}`);
			if (new Set(missing).size !== missing.length) errors.push(`${at}.missing: repeated item`);
		}

		const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim() : null;
		if (rationale === null || rationale === '')
			errors.push(`${at}.rationale: empty or not a string`);
		else if ([...rationale].length > rationaleMax)
			errors.push(`${at}.rationale: longer than ${rationaleMax} characters`);

		if (element && typeof id === 'string' && !seen.has(id))
			seen.set(id, {
				element_id: id,
				applies: applies as MeritVerdict,
				depth: depth as MeritLevel,
				uncertain: uncertain as boolean,
				read_paths: reads ? [...reads] : [],
				evidence: evidence ? [...evidence].sort() : [],
				missing: missing
					? element.checklist.map((item) => item.id).filter((item) => missing.includes(item))
					: [],
				rationale: rationale ?? ''
			});
	});

	for (const element of pack.elements)
		if (!seen.has(element.element_id))
			errors.push(`grades: element ${element.element_id} not graded`);

	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		grades: {
			grades_version: gradesVersion,
			pack_hash: pack.content_hash,
			grades: pack.elements.map((element) => seen.get(element.element_id)!)
		}
	};
}

export type ScoredGrade = {
	grade: AgentGrade;
	row: MeritElementResult;
	pages: string[];
	applicable: boolean;
};

export type AgentMeritScore = {
	score: number | null;
	elements: ScoredGrade[];
	rows: MeritElementInput[];
	findings: { merit_absent: number; merit_thin: number };
};

export function meritScoreOfAgentGrades(
	method: Pick<Method, 'catalog' | 'mapping' | 'weights'>,
	grades: AgentGrades,
	pack: MeritMetadataPack
): AgentMeritScore {
	const elements = meritElementsFor(method.catalog, pack.company_type);
	const byId = new Map(grades.grades.map((grade) => [grade.element_id, grade]));
	const ruleMapped = ruleMappedPages(method, pack);
	const mapped = new Map<string, string[]>();
	for (const element of elements) {
		const paths = new Set([
			...(ruleMapped.get(element.id) ?? []),
			...(byId.get(element.id)?.evidence ?? [])
		]);
		if (paths.size > 0) mapped.set(element.id, [...paths].sort());
	}
	const rowOf = new Map<string, MeritPageRow>(pack.pages.map((page) => [page.path, page]));
	const keysUnfilled = new Map(pack.pages.map((page) => [page.path, page.keys_unfilled]));
	const verdicts = new Map<string, MeritElementVerdict>();
	for (const grade of grades.grades)
		verdicts.set(grade.element_id, {
			applies: grade.applies,
			reason: grade.rationale,
			covers_question: grade.depth >= 2,
			missing: grade.missing
		});
	const rows = meritElementRows({
		subject: pack.subject,
		elements,
		weights: method.weights.merit,
		mapped,
		rowOf,
		keysUnfilled,
		verdicts,
		unanswered: new Set(),
		checklist: checklistIdsByElement(meritChecklist(method.catalog, elements)),
		at: pack.measured_at
	}).map((row) => {
		const depth = byId.get(row.elementId)?.depth;
		return depth === undefined || row.level === null
			? row
			: { ...row, level: Math.min(row.level, depth) };
	});

	const scored: ScoredGrade[] = [];
	let absent = 0;
	let thin = 0;
	for (const row of rows) {
		const grade = byId.get(row.elementId);
		if (!grade) continue;
		const applicable = applicabilityOf(row, null).applies;
		if (applicable && row.level === 0) absent += 1;
		if (applicable && row.level === 1) thin += 1;
		scored.push({ grade, row, pages: mapped.get(row.elementId) ?? [], applicable });
	}
	return {
		score: meritScoreOf(rows, method.weights.merit),
		elements: scored,
		rows,
		findings: { merit_absent: absent, merit_thin: thin }
	};
}

export function toPackMerit(
	scored: AgentMeritScore,
	pack: Pick<MeritMetadataPack, 'rubric_version' | 'read_limit' | 'elements'>,
	indexOf: (path: string) => number | undefined
): PackMerit {
	const elementOf = new Map(pack.elements.map((element) => [element.element_id, element]));
	const index = (path: string): number => {
		const i = indexOf(path);
		if (i === undefined) throw new Error(`toPackMerit: ${path} is not in the tree`);
		return i;
	};
	return {
		rubric_version: pack.rubric_version,
		score: scored.score,
		read_limit: pack.read_limit,
		elements: scored.elements.map(({ grade, row, pages }): MeritGrade => {
			const element = elementOf.get(grade.element_id)!;
			const text = new Map(element.checklist.map((item) => [item.id, item.text]));
			return {
				element_id: element.element_id,
				name: element.name,
				group: element.group,
				tier: element.tier,
				applies: grade.applies,
				level: row.level as MeritGrade['level'],
				evidence: pages.map(index),
				read: grade.read_paths.map(index),
				reason: grade.rationale,
				missing: grade.missing.map((id) => text.get(id) ?? id)
			};
		})
	};
}
