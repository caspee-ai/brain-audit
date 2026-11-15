import type { MethodCatalog, MethodElement } from '../method/types';

export type ChecklistKind = 'listing' | 'question' | 'metric';

export type ChecklistItem = {
	id: string;
	element_id: string;
	kind: ChecklistKind;
	n: number;
	text: string;
};

export type ElementChecklist = {
	element_id: string;
	group: string;
	items: ChecklistItem[];
};

export type MeritChecklist = {
	catalog_version: number;
	elements: ElementChecklist[];
};

export function checklistItemId(elementId: string, kind: ChecklistKind, n: number): string {
	return `${elementId}:${kind}:${n}`;
}

export type ChecklistSource = Pick<
	MethodElement,
	'id' | 'group' | 'listings' | 'action_questions' | 'expected_metrics'
>;

export function elementChecklist(element: ChecklistSource): ElementChecklist {
	const items: ChecklistItem[] = [];
	const add = (kind: ChecklistKind, texts: readonly string[]) =>
		texts.forEach((text, index) =>
			items.push({
				id: checklistItemId(element.id, kind, index + 1),
				element_id: element.id,
				kind,
				n: index + 1,
				text
			})
		);
	add('listing', element.listings);
	add('question', element.action_questions);
	add('metric', element.expected_metrics ?? []);
	return { element_id: element.id, group: element.group, items };
}

export function meritChecklist(
	catalog: Pick<MethodCatalog, 'catalog_version'>,
	elements: readonly ChecklistSource[]
): MeritChecklist {
	return { catalog_version: catalog.catalog_version, elements: elements.map(elementChecklist) };
}

export function checklistIdsByElement(checklist: MeritChecklist): Map<string, string[]> {
	return new Map(
		checklist.elements.map((element) => [element.element_id, element.items.map((i) => i.id)])
	);
}
