import type { JsonObject, Method, MethodCatalog, MethodRubric, MethodTier } from '../method/types';
import type { CompanyType } from '../pack/vocab';
import { elementChecklist } from './checklist';
import { meritElementsFor, meritProfileOf } from './company-type';
import { layerForSubject, tierForSubject } from './score';
import type { MeritSubject } from './types';

export type MeritRubricElement = {
	element_id: string;
	name: string;
	group: string;
	tier: MethodTier;
	layer: string;
	question: string;
	applies_when: string;
	checklist: { id: string; text: string }[];
};

export type MeritCatalog = {
	catalog_version: number;
	layers: string[];
	company_type: CompanyType;
	subject: MeritSubject;
	elements: MeritRubricElement[];
};

export type MeritRubric = {
	rubric_version: number;
	grades_version: number;
	instructions: string[];
	applies: Record<'yes' | 'no' | 'unsure', string>;
	depth: Record<'0' | '1' | '2' | '3', string>;
	rationale_max_chars: number;
};

export type MeritRubricBundle = {
	catalog: MeritCatalog;
	rubric: MeritRubric;
	grades_schema: Record<string, unknown>;
	read_limit: number;
};

export function meritCatalogFor(catalog: MethodCatalog, companyType: CompanyType): MeritCatalog {
	const profile = meritProfileOf(catalog, companyType);
	return {
		catalog_version: catalog.catalog_version,
		layers: [...catalog.layers],
		company_type: profile.company_type,
		subject: profile.subject,
		elements: meritElementsFor(catalog, companyType).map((element) => ({
			element_id: element.id,
			name: element.name,
			group: element.group,
			tier: tierForSubject(element, profile.subject),
			layer: layerForSubject(element, profile.subject),
			question: element.question,
			applies_when: element.applies_when,
			checklist: elementChecklist(element).items.map((item) => ({ id: item.id, text: item.text }))
		}))
	};
}

function render(line: string, brain: string, readLimit: number): string {
	return line.split('{brain}').join(brain).split('{read_limit}').join(String(readLimit));
}

export function meritRubricText(
	rubric: MethodRubric,
	subject: MeritSubject,
	readLimit: number
): MeritRubric {
	const brain = rubric.brain_words[subject];
	return {
		rubric_version: rubric.rubric_version,
		grades_version: rubric.grades_version,
		instructions: rubric.instructions.map((line) => render(line, brain, readLimit)),
		applies: { ...rubric.applies },
		depth: { ...rubric.depth },
		rationale_max_chars: rubric.rationale_max_chars
	};
}

export function meritGradesSchema(
	rubric: Pick<MethodRubric, 'grades_schema'>,
	readLimit: number
): Record<string, unknown> {
	const schema = JSON.parse(JSON.stringify(rubric.grades_schema)) as JsonObject;
	const grades = (schema.properties as JsonObject).grades as JsonObject;
	const item = (grades.items as JsonObject).properties as JsonObject;
	(item.read_paths as JsonObject).maxItems = readLimit;
	return schema;
}

export function meritRubricFor(
	method: Pick<Method, 'catalog' | 'rubric'>,
	companyType: CompanyType,
	readLimit: number = method.rubric.read_limit
): MeritRubricBundle {
	if (!Number.isInteger(readLimit) || readLimit < 0)
		throw new Error('read limit must be a whole number ≥ 0');
	const catalog = meritCatalogFor(method.catalog, companyType);
	return {
		catalog,
		rubric: meritRubricText(method.rubric, catalog.subject, readLimit),
		grades_schema: meritGradesSchema(method.rubric, readLimit),
		read_limit: readLimit
	};
}
