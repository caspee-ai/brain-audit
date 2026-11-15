import type {
	JsonObject,
	JsonValue,
	Method,
	MethodCatalog,
	MethodConventions,
	MethodElement,
	MethodKit,
	MethodModule,
	MethodRubric,
	MethodWeights
} from './types';

export class MethodError extends Error {
	constructor(
		readonly path: string,
		message: string
	) {
		super(`method pack ${path || '(root)'}: ${message}`);
		this.name = 'MethodError';
	}
}

type Reader<T> = (value: unknown, path: string) => T;

type Shape =
	| { leaf: string }
	| { list: Reader<unknown> }
	| { record: Reader<unknown> }
	| { nullable: Reader<unknown> }
	| { fields: Record<string, Reader<unknown>>; optional: readonly string[] };

const SHAPES = new WeakMap<Reader<unknown>, Shape>();

function described<T>(read: Reader<T>, shape: Shape): Reader<T> {
	SHAPES.set(read as Reader<unknown>, shape);
	return read;
}

const fail = (path: string, message: string): never => {
	throw new MethodError(path, message);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const str: Reader<string> = described(
	(v, p) => (typeof v === 'string' ? v : fail(p, 'expected a string')),
	{ leaf: 'string' }
);
const nonEmpty: Reader<string> = described(
	(v, p) => (str(v, p) !== '' ? (v as string) : fail(p, 'is empty')),
	{ leaf: 'non-empty string' }
);
const num: Reader<number> = described(
	(v, p) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(p, 'expected a finite number')),
	{ leaf: 'number' }
);
const int: Reader<number> = described(
	(v, p) => (Number.isInteger(num(v, p)) ? (v as number) : fail(p, 'expected a whole number')),
	{ leaf: 'integer' }
);

function nullable<T>(read: Reader<T>): Reader<T | null> {
	return described<T | null>((v, p) => (v === null ? null : read(v, p)), {
		nullable: read as Reader<unknown>
	});
}

function literal<T extends string>(values: readonly T[]): Reader<T> {
	return described<T>(
		(v, p) =>
			(values as readonly unknown[]).includes(v)
				? (v as T)
				: fail(p, `expected one of ${values.join(', ')}`),
		{ leaf: `one of ${values.join('|')}` }
	);
}

function list<T>(read: Reader<T>): Reader<T[]> {
	return described<T[]>(
		(v, p) =>
			Array.isArray(v) ? v.map((item, i) => read(item, `${p}[${i}]`)) : fail(p, 'expected a list'),
		{ list: read as Reader<unknown> }
	);
}

function record<T>(read: Reader<T>): Reader<Record<string, T>> {
	return described<Record<string, T>>(
		(v, p) => {
			if (!isObject(v)) return fail(p, 'expected an object');
			const out: Record<string, T> = {};
			for (const [key, value] of Object.entries(v)) out[key] = read(value, `${p}.${key}`);
			return out;
		},
		{ record: read as Reader<unknown> }
	);
}

type Fields<T> = { [K in keyof T]-?: Reader<T[K]> };

function shape<T>(fields: Fields<T>, optional: readonly (keyof T)[] = []): Reader<T> {
	const read: Reader<T> = (v, p) => {
		if (!isObject(v)) return fail(p, 'expected an object');
		for (const key of Object.keys(v))
			if (!(key in fields)) fail(`${p}.${key}`, 'is not a method field');
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(fields) as (keyof T & string)[]) {
			if (!(key in v)) {
				if (optional.includes(key)) continue;
				fail(`${p}.${key}`, 'is missing');
			}
			out[key] = (fields[key] as Reader<unknown>)(v[key], `${p}.${key}`);
		}
		return out as T;
	};
	return described(read, {
		fields: fields as Record<string, Reader<unknown>>,
		optional: optional as readonly string[]
	});
}

const json: Reader<JsonValue> = described(
	(v, p) => {
		if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
		if (typeof v === 'number') return num(v, p);
		if (Array.isArray(v)) return list(json)(v, p);
		if (isObject(v)) return record(json)(v, p);
		return fail(p, 'is not JSON');
	},
	{ leaf: 'json' }
);
const jsonObject: Reader<JsonObject> = described(
	(v, p) => (isObject(v) ? (record(json)(v, p) as JsonObject) : fail(p, 'expected an object')),
	{ leaf: 'json object' }
);

const strings = list(str);

const patternWords: Reader<string[]> = described(
	(v, p) => {
		const words = list(nonEmpty)(v, p);
		return words.length > 0 ? words : fail(p, 'is empty: the engine compiles it into a pattern');
	},
	{ leaf: 'pattern words' }
);
const tier = literal(['always', 'when_present', 'by_type'] as const);
const subject = literal(['company', 'person'] as const);

const element: Reader<MethodElement> = shape<MethodElement>(
	{
		id: nonEmpty,
		number: int,
		name: nonEmpty,
		group: nonEmpty,
		tier,
		applies_to: shape({ company: tier, person: tier }),
		applies_when: str,
		question: nonEmpty,
		atom_types: strings,
		proposed_atom_types: strings,
		form: nonEmpty,
		forms: strings,
		completeness: str,
		usually_in: strings,
		apps: strings,
		sensitivity: nonEmpty,
		never: strings,
		questions: strings,
		listings: strings,
		action_questions: strings,
		expected_metrics: strings,
		notes: str
	},
	['applies_to', 'expected_metrics', 'notes']
);

const catalog: Reader<MethodCatalog> = shape<MethodCatalog>({
	catalog_version: int,
	groups: strings,
	forms: strings,
	tiers: list(tier),
	sensitivities: strings,
	elements: list(element),
	modules: list(
		shape<MethodModule>({
			id: nonEmpty,
			name: nonEmpty,
			evidence: strings,
			apps: strings,
			activates: strings,
			elements: list(element)
		})
	),
	company_types: record(shape({ subject, module: nullable(nonEmpty) })),
	category_apps: record(strings)
});

const rubric: Reader<MethodRubric> = shape<MethodRubric>({
	rubric_version: int,
	grades_version: int,
	read_limit: int,
	rationale_max_chars: int,
	brain_words: shape({ company: str, person: str }),
	instructions: strings,
	applies: shape({ yes: str, no: str, unsure: str }),
	depth: shape({ '0': str, '1': str, '2': str, '3': str }),
	grades_schema: jsonObject
});

const weights: Reader<MethodWeights> = shape<MethodWeights>({
	structural: shape({
		links: num,
		structure: num,
		metadata: num,
		dating: num,
		expected_share: num,
		min_peers: int
	}),
	merit: shape({
		always: num,
		when_present: num,
		by_type: num,
		module: num,
		covered_level: int,
		max_level: int,
		level3_share: num
	}),
	total: shape({ structural: num, merit: num })
});

const kit: Reader<MethodKit> = shape<MethodKit>({
	contract_version: nonEmpty,
	core_required: strings,
	atom_types: strings,
	page_shapes: record(
		shape({ version: int, sections: strings, now_cap: nullable(int), required: strings })
	),
	page_dirs: strings,
	entity_types: shape({
		types: strings,
		page_types: strings,
		subtypes: strings,
		relationships: strings
	})
});

const fieldsMap = record(str);
const kindTarget = shape<{ type: string; set?: Record<string, string> }>(
	{ type: nonEmpty, set: fieldsMap },
	['set']
);

const conventions: Reader<MethodConventions> = shape<MethodConventions>({
	declared_types: list(shape({ role: nonEmpty, shape: nonEmpty, types: strings })),
	kit_page_types: strings,
	page_kinds: strings,
	evidence_kinds: strings,
	kind_keys: strings,
	kind_ignore: strings,
	event_source_keys: strings,
	event_date_keys: strings,
	generic_date_keys: strings,
	content_date_keys: strings,
	capture_date_keys: strings,
	mail_keys: shape({ from: strings, to: strings, date: strings }),
	source_value_roles: record(literal(['record', 'document'] as const)),
	convention_stems: patternWords,
	procedure_stem_suffixes: patternWords,
	procedure_folders: strings,
	clip_url_keys: strings,
	clip_date_keys: strings,
	root_note_files: patternWords,
	root_setting_files: patternWords,
	glossary_stems: patternWords,
	kit_tooling_folders: patternWords,
	person_folders: strings,
	template_folders: strings,
	claim_map_suffix: nonEmpty,
	ledger_suffix: nonEmpty,
	skill_file: nonEmpty,
	kit_dialect_paths: list(shape({ path: nonEmpty, role: nonEmpty, shape: nonEmpty })),
	kind_table: list(
		shape<{ kinds: string[]; type: string; set?: Record<string, string> }>(
			{ kinds: strings, type: nonEmpty, set: fieldsMap },
			['set']
		)
	),
	as_written_types: strings,
	kit_registry_types: record(kindTarget),
	row_type_coercions: record(strings),
	kit_folders: strings,
	kit_marker_files: strings,
	sidecar_files: patternWords,
	dialect_keys: strings,
	status_words: shape({ draft: patternWords, superseded: patternWords, current: patternWords }),
	access_words: shape({
		everyone: patternWords,
		members: patternWords,
		restricted: patternWords
	}),
	owner_keys_default: strings,
	relation_field_defaults: fieldsMap,
	citation_patterns_default: list(shape({ pattern: nonEmpty, why: str })),
	as_of_suffixes: patternWords,
	platform_keys: strings,
	procedure_home_folders: strings,
	reserved_homes: list(shape({ prefix: nonEmpty, type: nonEmpty })),
	system_folders: strings,
	organization_folders: strings,
	organization_parents: strings,
	decision_folders: strings,
	team_folders: strings,
	team_relationships: strings,
	kit_organization_types: strings,
	decision_kinds: strings,
	group_kinds: strings,
	me_folder: nonEmpty,
	self_stems: strings,
	self_stems_anywhere: strings,
	goal_stems: strings,
	person_keys: strings,
	name_particles: strings,
	owner_keys: strings,
	url_source_keys: strings,
	mail_header_keys: strings
});

const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;

const method: Reader<Method> = shape<Method>({
	method_version: nonEmpty,
	content_hash: described(
		(v, p) => (CONTENT_HASH.test(str(v, p)) ? (v as string) : fail(p, 'not sha256:<hex>')),
		{ leaf: 'sha256' }
	),
	catalog,
	mapping: record(shape({ folders: strings, kinds: strings })),
	rubric,
	weights,
	kit,
	conventions
});

function checkReferences(m: Method): void {
	const { catalog: c } = m;
	const ids = new Set<string>();
	const elements = [
		...c.elements.map((e, i) => [e, `catalog.elements[${i}]`] as const),
		...c.modules.flatMap((mod, j) =>
			mod.elements.map((e, i) => [e, `catalog.modules[${j}].elements[${i}]`] as const)
		)
	];
	for (const [e, p] of elements) {
		if (ids.has(e.id)) fail(`${p}.id`, `duplicate element ${e.id}`);
		ids.add(e.id);
		if (!c.groups.includes(e.group)) fail(`${p}.group`, `unknown group ${e.group}`);
		if (!c.tiers.includes(e.tier)) fail(`${p}.tier`, `unknown tier ${e.tier}`);
		for (const form of [e.form, ...e.forms])
			if (!c.forms.includes(form)) fail(`${p}.forms`, `unknown form ${form}`);
		if (!c.sensitivities.includes(e.sensitivity))
			fail(`${p}.sensitivity`, `unknown sensitivity ${e.sensitivity}`);
	}
	const core = new Set(c.elements.map((e) => e.id));
	const modules = new Set<string>();
	c.modules.forEach((mod, j) => {
		if (modules.has(mod.id)) fail(`catalog.modules[${j}].id`, `duplicate module ${mod.id}`);
		modules.add(mod.id);
		for (const id of mod.activates)
			if (!core.has(id)) fail(`catalog.modules[${j}].activates`, `unknown core element ${id}`);
	});
	for (const [type, profile] of Object.entries(c.company_types))
		if (profile.module !== null && !modules.has(profile.module))
			fail(`catalog.company_types.${type}.module`, `unknown module ${profile.module}`);
	for (const id of Object.keys(m.mapping))
		if (!ids.has(id)) fail(`mapping.${id}`, 'unknown element');
	const types = new Set(m.kit.atom_types);
	for (const type of Object.keys(m.kit.page_shapes))
		if (!types.has(type)) fail(`kit.page_shapes.${type}`, 'not an atom type');
	for (const type of m.kit.atom_types)
		if (!(type in m.kit.page_shapes)) fail(`kit.atom_types`, `${type} has no page shape`);
}

export function parseMethod(value: unknown): Method {
	const parsed = method(value, '');
	checkReferences(parsed);
	return parsed;
}

export function methodShapePaths(): string[] {
	const lines: string[] = [];
	const walk = (read: Reader<unknown>, path: string, suffix: string) => {
		const at = SHAPES.get(read);
		if (!at) throw new Error(`methodShapePaths: undescribed reader at ${path}`);
		if ('leaf' in at) lines.push(`${path}: ${at.leaf}${suffix}`);
		else if ('list' in at) walk(at.list, `${path}[]`, suffix);
		else if ('record' in at) walk(at.record, `${path}{}`, suffix);
		else if ('nullable' in at) walk(at.nullable, path, `${suffix} | null`);
		else
			for (const [key, field] of Object.entries(at.fields)) {
				const name = at.optional.includes(key) ? `${key}?` : key;
				walk(field, path ? `${path}.${name}` : name, suffix);
			}
	};
	walk(method as Reader<unknown>, '', '');
	return lines.sort();
}
