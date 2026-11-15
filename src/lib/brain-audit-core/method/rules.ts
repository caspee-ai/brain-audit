import type { Method, MethodDeclaredTypes, MethodDialectPath, MethodPageShape } from './types';
import { wordAlternation } from './words';

export type MethodKindType = { type: string; set?: Record<string, string> };

export type MethodRules = {
	method: Method;
	atomTypes: ReadonlySet<string>;
	pageShapes: Readonly<Record<string, MethodPageShape>>;
	coreRequired: readonly string[];
	pageDirs: readonly string[];
	entityTypes: ReadonlySet<string>;
	entityPageTypes: ReadonlySet<string>;
	entityRelationships: readonly string[];
	declared: readonly MethodDeclaredTypes[];
	kitPageTypes: ReadonlySet<string>;
	pageKinds: ReadonlySet<string>;
	evidenceKinds: ReadonlySet<string>;
	kindKeys: readonly string[];
	kindIgnore: readonly string[];
	eventSourceKeys: readonly string[];
	eventDateKeys: readonly string[];
	genericDateKeys: readonly string[];
	contentDateKeys: readonly string[];
	captureDateKeys: readonly string[];
	mailFromKeys: readonly string[];
	mailToKeys: readonly string[];
	mailDateKeys: readonly string[];
	sourceValueRoles: Readonly<Record<string, 'record' | 'document'>>;
	conventionName: RegExp;
	procedureStem: RegExp;
	procedureFolders: ReadonlySet<string>;
	clipUrlKeys: readonly string[];
	clipDateKeys: readonly string[];
	rootNotes: RegExp;
	rootSettings: RegExp;
	glossaryStem: RegExp;
	kitTooling: RegExp;
	personFolders: ReadonlySet<string>;
	templateFolders: ReadonlySet<string>;
	claimMap: RegExp;
	ledger: RegExp;
	skillFile: RegExp;
	kitDialectPaths: readonly MethodDialectPath[];
	byKind: ReadonlyMap<string, MethodKindType>;
	asWritten: ReadonlySet<string>;
	kitRegistryTypes: Readonly<Record<string, MethodKindType>>;
	rowTypeCoercions: Readonly<Record<string, readonly string[]>>;
	kitFolders: readonly string[];
	kitMarkerFiles: ReadonlySet<string>;
	claimMapSuffix: string;
	sidecarName: RegExp;
	dialectKeys: readonly string[];
	draftWords: RegExp;
	supersededWords: RegExp;
	currentWords: RegExp;
	everyoneWords: RegExp;
	membersWords: RegExp;
	restrictedWords: RegExp;
	ownerKeysDefault: readonly string[];
	relationFieldDefaults: Readonly<Record<string, string>>;
	citationPatternsDefault: readonly { pattern: string; why: string }[];
	asOfSuffix: RegExp;
	platformKeys: ReadonlySet<string>;
	procedureHomeFolders: ReadonlySet<string>;
	reservedHomes: readonly { prefix: string; type: string }[];
	systemFolders: ReadonlySet<string>;
	organizationFolders: ReadonlySet<string>;
	organizationParents: ReadonlySet<string>;
	decisionFolders: ReadonlySet<string>;
	teamFolders: ReadonlySet<string>;
	teamRelationships: ReadonlySet<string>;
	kitOrganizationTypes: ReadonlySet<string>;
	decisionKinds: ReadonlySet<string>;
	groupKinds: ReadonlySet<string>;
	meFolder: string;
	selfStems: ReadonlySet<string>;
	selfStemsAnywhere: ReadonlySet<string>;
	goalStems: ReadonlySet<string>;
	personKeys: readonly string[];
	nameParticles: ReadonlySet<string>;
	ownerKeys: readonly string[];
	urlSourceKeys: readonly string[];
	mailHeaderKeys: readonly string[];
	typeFolders: readonly [type: string, folders: ReadonlySet<string>][];
	scoreWeights: Readonly<Record<'links' | 'structure' | 'metadata' | 'dating', number>>;
	expectedShare: number;
	minPeers: number;
};

const cache = new WeakMap<Method, MethodRules>();

const literal = (word: string) => wordAlternation([word]);

function compile(method: Method): MethodRules {
	const c = method.conventions;
	const k = method.kit;
	const s = method.weights.structural;
	const alt = wordAlternation;
	const claimMap = `${literal(c.claim_map_suffix)}$`;
	const personFolders = new Set(c.person_folders);
	const organizationFolders = new Set(c.organization_folders);
	const systemFolders = new Set(c.system_folders);
	return {
		method,
		atomTypes: new Set(k.atom_types),
		pageShapes: k.page_shapes,
		coreRequired: k.core_required,
		pageDirs: k.page_dirs,
		entityTypes: new Set(k.entity_types.types),
		entityPageTypes: new Set(k.entity_types.page_types),
		entityRelationships: k.entity_types.relationships,
		declared: c.declared_types,
		kitPageTypes: new Set(c.kit_page_types),
		pageKinds: new Set(c.page_kinds),
		evidenceKinds: new Set(c.evidence_kinds),
		kindKeys: c.kind_keys,
		kindIgnore: c.kind_ignore,
		eventSourceKeys: c.event_source_keys,
		eventDateKeys: c.event_date_keys,
		genericDateKeys: c.generic_date_keys,
		contentDateKeys: c.content_date_keys,
		captureDateKeys: c.capture_date_keys,
		mailFromKeys: c.mail_keys.from,
		mailToKeys: c.mail_keys.to,
		mailDateKeys: c.mail_keys.date,
		sourceValueRoles: c.source_value_roles,
		conventionName: new RegExp(`^(${alt(c.convention_stems)})\\.mdx?$`, 'i'),
		procedureStem: new RegExp(`-(${alt(c.procedure_stem_suffixes)})$`, 'i'),
		procedureFolders: new Set(c.procedure_folders),
		clipUrlKeys: c.clip_url_keys,
		clipDateKeys: c.clip_date_keys,
		rootNotes: new RegExp(`^(${alt(c.root_note_files)})$`, 'i'),
		rootSettings: new RegExp(`^(${alt(c.root_setting_files)})$`, 'i'),
		glossaryStem: new RegExp(`^(${alt(c.glossary_stems)})$`, 'i'),
		kitTooling: new RegExp(`^(${alt(c.kit_tooling_folders)})\\/`, 'i'),
		personFolders,
		templateFolders: new Set(c.template_folders),
		claimMap: new RegExp(claimMap, 'i'),
		ledger: new RegExp(`${literal(c.ledger_suffix)}\\.(md|markdown|mdx)$`, 'i'),
		skillFile: new RegExp(`(^|\\/)${literal(c.skill_file)}$`, 'i'),
		kitDialectPaths: c.kit_dialect_paths,
		byKind: new Map(
			c.kind_table.flatMap((row) =>
				row.kinds.map(
					(kind) => [kind, row.set ? { type: row.type, set: row.set } : { type: row.type }] as const
				)
			)
		),
		asWritten: new Set(c.as_written_types),
		kitRegistryTypes: c.kit_registry_types,
		rowTypeCoercions: c.row_type_coercions,
		kitFolders: c.kit_folders,
		kitMarkerFiles: new Set(c.kit_marker_files),
		claimMapSuffix: c.claim_map_suffix.toLowerCase(),
		sidecarName: new RegExp(`^(${alt(c.sidecar_files)})$|${claimMap}`, 'i'),
		dialectKeys: c.dialect_keys,
		draftWords: new RegExp(`^(${alt(c.status_words.draft)})\\b`),
		supersededWords: new RegExp(`^(${alt(c.status_words.superseded)})\\b`),
		currentWords: new RegExp(`^(${alt(c.status_words.current)})\\b`),
		everyoneWords: new RegExp(`^(${alt(c.access_words.everyone)})$`),
		membersWords: new RegExp(`^(${alt(c.access_words.members)})$`),
		restrictedWords: new RegExp(`^(${alt(c.access_words.restricted)})$`),
		ownerKeysDefault: c.owner_keys_default,
		relationFieldDefaults: c.relation_field_defaults,
		citationPatternsDefault: c.citation_patterns_default,
		asOfSuffix: new RegExp(`^(.+?)_(${alt(c.as_of_suffixes)})$`),
		platformKeys: new Set(c.platform_keys),
		procedureHomeFolders: new Set(c.procedure_home_folders),
		reservedHomes: c.reserved_homes,
		systemFolders,
		organizationFolders,
		organizationParents: new Set(c.organization_parents),
		decisionFolders: new Set(c.decision_folders),
		teamFolders: new Set(c.team_folders),
		teamRelationships: new Set(c.team_relationships),
		kitOrganizationTypes: new Set(c.kit_organization_types),
		decisionKinds: new Set(c.decision_kinds),
		groupKinds: new Set(c.group_kinds),
		meFolder: c.me_folder,
		selfStems: new Set(c.self_stems),
		selfStemsAnywhere: new Set(c.self_stems_anywhere),
		goalStems: new Set(c.goal_stems),
		personKeys: c.person_keys,
		nameParticles: new Set(c.name_particles),
		ownerKeys: c.owner_keys,
		urlSourceKeys: c.url_source_keys,
		mailHeaderKeys: c.mail_header_keys,
		typeFolders: [
			['person', personFolders],
			['organization', organizationFolders],
			['system', systemFolders]
		],
		scoreWeights: {
			links: s.links,
			structure: s.structure,
			metadata: s.metadata,
			dating: s.dating
		},
		expectedShare: s.expected_share,
		minPeers: s.min_peers
	};
}

export function rulesOf(method: Method): MethodRules {
	let rules = cache.get(method);
	if (!rules) {
		rules = compile(method);
		cache.set(method, rules);
	}
	return rules;
}

export function isMethodAtomType(method: Method, type: string): boolean {
	return rulesOf(method).atomTypes.has(type);
}
