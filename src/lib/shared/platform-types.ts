// Types the audit core takes from the Caspee platform, which this repository does not carry.
// They describe records the platform passes in (the CLI never builds them), written here as
// the fields the core reads and nothing more: the platform's own records have more, and each
// of them still fits the shape below. Types only, erased at build time, so they do not change
// the bundle.

import type { RecordProposal } from '$lib/brain-audit-core/byob/records/mapping';
import type { NotionDatabaseProfile } from '$lib/brain-audit-core/byob/records/notion';
import type { ByobProfile } from '$lib/brain-audit-core/profile/profile';

/** One column of a table of records, as the platform profiled it. */
export type RecordColumnProfile = {
	name: string;
	/** Share of the read rows with a value, 0–1. */
	fill: number;
	/** Distinct values among the read rows. */
	distinct: number;
	/** More distinct values than counted. */
	distinctCapped?: true;
	/** What the values look like: `email`, `url`, `domain`, `phone`, `date`, `number`, `enum`, … */
	shape: string;
};

/** One file (one sheet of a workbook) that is a table of records. */
export type RecordFileProfile = {
	path: string;
	/** The git blob it was read at. */
	blob: string;
	/** A workbook sheet's name. */
	sheet?: string;
	/** Records, the header not counted. */
	rows: number;
	/** Rows the column statistics were read from. */
	statsRows: number;
	columns: RecordColumnProfile[];
	/** The Notion database a CSV export is. */
	notion?: NotionDatabaseProfile;
};

/** What the platform read of a brought repository. */
export type ByobIntake = {
	recordFiles?: RecordFileProfile[];
	recordProposals?: Record<string, RecordProposal>;
	profile?: ByobProfile;
};

/** A brought repository pinned to a brain: what it read, and the owner's edits. */
export type ByobBinding = {
	intake: ByobIntake | null;
	profile?: ByobProfile | null;
};
