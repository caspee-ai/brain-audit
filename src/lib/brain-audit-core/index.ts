export {
	buildByobManifest,
	manifestKindOf,
	treeMirrorPairs,
	type ByobManifest,
	type ByobManifestFile,
	type TreeEntry
} from './byob/manifest';
export { dataExtensions } from './byob/data';
export { emptyScope, inFolder, inScope, type ByobScope, type MirrorPair } from './byob/scope';
export {
	classifyBrought,
	intakeSignatureClusters,
	pinnedStrip,
	type BroughtClassified,
	type BroughtClassifyInput
} from './byob/classify';
export { classifyByobPages, type ByobClassification } from './byob/pages';
export { decideRoles, unclearGroupOf } from './byob/roles';
export type { ByobDialect, ByobFile, ByobPage } from './byob/types';
export {
	BYOB_PROFILE_FILE,
	effectiveByobProfile,
	readDeclaredProfile,
	type DeclaredProfile
} from './profile/effective';
export { inferByobProfile } from './profile/infer';
export { layerProfile, type ByobProfile } from './profile/profile';
export {
	auditBrought,
	broughtAuditEntries,
	broughtAuditSourceOf,
	inputsHashOf,
	type BroughtAuditInput
} from './audit/entries';
export {
	broughtAudit,
	type BroughtAudit,
	type BroughtAuditEntry,
	type BroughtAuditSource
} from './audit/summary';
export { scoreOf } from './audit/score';
export { fixedInputsOf, liftedMeritRowsOf, scoreProjectionOf } from './audit/projection';
export { canonicalJson, profileHashOf } from './audit/profile-hash';
export { AUDIT_VERSION } from './audit/version';
export type { AuditFileWrite, AuditSummary, ScoreInputs, ScoreResult } from './audit/types';
export * from './merit';
export * from './method';
