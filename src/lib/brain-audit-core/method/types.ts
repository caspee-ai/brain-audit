export type MethodTier = 'always' | 'when_present' | 'by_type';

export type MethodSubject = 'company' | 'person';

export type MethodElement = {
	id: string;
	number: number;
	name: string;
	group: string;
	tier: MethodTier;
	applies_to?: { company: MethodTier; person: MethodTier };
	applies_when: string;
	question: string;
	atom_types: string[];
	proposed_atom_types: string[];
	form: string;
	forms: string[];
	completeness: string;
	usually_in: string[];
	apps: string[];
	sensitivity: string;
	never: string[];
	questions: string[];
	listings: string[];
	action_questions: string[];
	expected_metrics?: string[];
	notes?: string;
};

export type MethodModule = {
	id: string;
	name: string;
	evidence: string[];
	apps: string[];
	activates: string[];
	elements: MethodElement[];
};

export type MethodCompanyType = { subject: MethodSubject; module: string | null };

export type MethodCatalog = {
	catalog_version: number;
	groups: string[];
	forms: string[];
	tiers: MethodTier[];
	sensitivities: string[];
	elements: MethodElement[];
	modules: MethodModule[];
	company_types: Record<string, MethodCompanyType>;
	category_apps: Record<string, string[]>;
};

export type MethodHint = { folders: string[]; kinds: string[] };

export type MethodRubric = {
	rubric_version: number;
	grades_version: number;
	read_limit: number;
	rationale_max_chars: number;
	brain_words: Record<MethodSubject, string>;
	instructions: string[];
	applies: { yes: string; no: string; unsure: string };
	depth: { '0': string; '1': string; '2': string; '3': string };
	grades_schema: JsonObject;
};

export type MethodWeights = {
	structural: {
		links: number;
		structure: number;
		metadata: number;
		dating: number;
		expected_share: number;
		min_peers: number;
	};
	merit: {
		always: number;
		when_present: number;
		by_type: number;
		module: number;
		covered_level: number;
		max_level: number;
		level3_share: number;
	};
	total: { structural: number; merit: number };
};

export type MethodPageShape = {
	version: number;
	sections: string[];
	now_cap: number | null;
	required: string[];
};

export type MethodKit = {
	contract_version: string;
	core_required: string[];
	atom_types: string[];
	page_shapes: Record<string, MethodPageShape>;
	page_dirs: string[];
	entity_types: {
		types: string[];
		page_types: string[];
		subtypes: string[];
		relationships: string[];
	};
};

export type MethodDeclaredTypes = { role: string; shape: string; types: string[] };

export type MethodDialectPath = { path: string; role: string; shape: string };

export type MethodKindRow = { kinds: string[]; type: string; set?: Record<string, string> };

export type MethodConventions = {
	declared_types: MethodDeclaredTypes[];
	kit_page_types: string[];
	page_kinds: string[];
	evidence_kinds: string[];
	kind_keys: string[];
	kind_ignore: string[];
	event_source_keys: string[];
	event_date_keys: string[];
	generic_date_keys: string[];
	content_date_keys: string[];
	capture_date_keys: string[];
	mail_keys: { from: string[]; to: string[]; date: string[] };
	source_value_roles: Record<string, 'record' | 'document'>;
	convention_stems: string[];
	procedure_stem_suffixes: string[];
	procedure_folders: string[];
	clip_url_keys: string[];
	clip_date_keys: string[];
	root_note_files: string[];
	root_setting_files: string[];
	glossary_stems: string[];
	kit_tooling_folders: string[];
	person_folders: string[];
	template_folders: string[];
	claim_map_suffix: string;
	ledger_suffix: string;
	skill_file: string;
	kit_dialect_paths: MethodDialectPath[];
	kind_table: MethodKindRow[];
	as_written_types: string[];
	kit_registry_types: Record<string, { type: string; set?: Record<string, string> }>;
	row_type_coercions: Record<string, string[]>;
	kit_folders: string[];
	kit_marker_files: string[];
	sidecar_files: string[];
	dialect_keys: string[];
	status_words: { draft: string[]; superseded: string[]; current: string[] };
	access_words: { everyone: string[]; members: string[]; restricted: string[] };
	owner_keys_default: string[];
	relation_field_defaults: Record<string, string>;
	citation_patterns_default: { pattern: string; why: string }[];
	as_of_suffixes: string[];
	platform_keys: string[];
	procedure_home_folders: string[];
	reserved_homes: { prefix: string; type: string }[];
	system_folders: string[];
	organization_folders: string[];
	organization_parents: string[];
	decision_folders: string[];
	team_folders: string[];
	team_relationships: string[];
	kit_organization_types: string[];
	decision_kinds: string[];
	group_kinds: string[];
	me_folder: string;
	self_stems: string[];
	self_stems_anywhere: string[];
	goal_stems: string[];
	person_keys: string[];
	name_particles: string[];
	owner_keys: string[];
	url_source_keys: string[];
	mail_header_keys: string[];
};

export type Method = {
	method_version: string;
	content_hash: string;
	catalog: MethodCatalog;
	mapping: Record<string, MethodHint>;
	rubric: MethodRubric;
	weights: MethodWeights;
	kit: MethodKit;
	conventions: MethodConventions;
};

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
