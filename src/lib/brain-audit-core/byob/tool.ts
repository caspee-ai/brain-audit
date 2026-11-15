import { hasNotionId, journalDate } from './names';

export const BROUGHT_TOOLS = [
	'kit',
	'obsidian',
	'logseq',
	'notion',
	'dendron',
	'foam',
	'hugo',
	'docusaurus',
	'mkdocs',
	'gitbook',
	'jekyll',
	'llm_wiki',
	'basic_memory',
	'generic'
] as const;
export type BroughtTool = (typeof BROUGHT_TOOLS)[number];

export function isBroughtTool(value: unknown): value is BroughtTool {
	return typeof value === 'string' && (BROUGHT_TOOLS as readonly string[]).includes(value);
}

export type BroughtToolReading = { tool: BroughtTool; signals: string[] };

const MARKDOWN = /\.(md|markdown|mdx)$/i;
const stemOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
const has = (lower: Set<string>, path: string) => lower.has(path.toLowerCase());
const anyStarts = (paths: readonly string[], prefix: string) =>
	paths.some((path) => path.toLowerCase().startsWith(prefix));

const OBSERVATIONS = /^##\s+observations\b/im;
const RELATIONS = /^##\s+relations\b/im;

export function detectBroughtTool(
	treePaths: readonly string[],
	options: { dialect?: 'kit' | 'generic'; bodies?: ReadonlyMap<string, string> } = {}
): BroughtToolReading {
	if (options.dialect === 'kit') return { tool: 'kit', signals: ['the kit dialect'] };
	const lower = new Set(treePaths.map((path) => path.toLowerCase()));
	const markdown = treePaths.filter((path) => MARKDOWN.test(path));
	const stems = markdown.map(stemOf);
	const share = (count: number) => (stems.length === 0 ? 0 : count / stems.length);

	if (has(lower, 'logseq/config.edn')) return { tool: 'logseq', signals: ['logseq/config.edn'] };
	const journals = markdown.filter((path) => /^journals\//i.test(path));
	if (
		anyStarts(markdown, 'pages/') &&
		journals.length > 0 &&
		journals.every((path) => journalDate(stemOf(path)) !== null)
	)
		return { tool: 'logseq', signals: ['pages/ and journals/ with dated names'] };
	if (anyStarts(treePaths, '.obsidian/')) return { tool: 'obsidian', signals: ['.obsidian/'] };
	const notion = stems.filter(hasNotionId).length;
	if (stems.length > 0 && share(notion) >= 0.5)
		return { tool: 'notion', signals: [`${notion} of ${stems.length} names end in a Notion id`] };
	if (
		has(lower, 'dendron.yml') ||
		treePaths.some((path) => /(^|\/)dendron\.code-workspace$/i.test(path))
	)
		return { tool: 'dendron', signals: ['dendron.yml'] };
	const dotted = stems.filter((stem) => /^[a-z][\w-]*\.[a-z][\w.-]*$/i.test(stem));
	if (stems.length >= 5 && share(dotted.length) >= 0.6) {
		const firsts = new Map<string, number>();
		for (const stem of dotted) {
			const first = stem.split('.')[0]!.toLowerCase();
			firsts.set(first, (firsts.get(first) ?? 0) + 1);
		}
		if ([...firsts.values()].some((n) => n >= 2))
			return { tool: 'dendron', signals: ['dotted hierarchy names'] };
	}
	if (anyStarts(treePaths, '.foam/') || has(lower, '.vscode/foam.json'))
		return { tool: 'foam', signals: ['.foam/'] };
	if (
		['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml'].some((name) => has(lower, name)) &&
		anyStarts(treePaths, 'content/')
	)
		return { tool: 'hugo', signals: ['a Hugo config and content/'] };
	if (treePaths.some((path) => /^docusaurus\.config\.(js|ts|mjs|cjs)$/i.test(path)))
		return { tool: 'docusaurus', signals: ['docusaurus.config'] };
	if (has(lower, 'mkdocs.yml') || has(lower, 'mkdocs.yaml'))
		return { tool: 'mkdocs', signals: ['mkdocs.yml'] };
	if (has(lower, 'summary.md') && (has(lower, '.gitbook.yaml') || has(lower, 'book.json')))
		return { tool: 'gitbook', signals: ['SUMMARY.md and a GitBook config'] };
	if (has(lower, '_config.yml') && anyStarts(treePaths, '_posts/'))
		return { tool: 'jekyll', signals: ['_config.yml and _posts/'] };
	const instructions = has(lower, 'claude.md') || has(lower, 'agents.md');
	const indexAndLog = has(lower, 'index.md') && has(lower, 'log.md');
	const rawAndWiki = anyStarts(treePaths, 'raw/') && anyStarts(treePaths, 'wiki/');
	if (instructions && (indexAndLog || rawAndWiki))
		return {
			tool: 'llm_wiki',
			signals: [
				indexAndLog ? 'a root index.md and log.md' : 'raw/ and wiki/',
				'CLAUDE.md or AGENTS.md'
			]
		};
	if (options.bodies && options.bodies.size > 0) {
		let observed = 0;
		for (const body of options.bodies.values())
			if (OBSERVATIONS.test(body) && RELATIONS.test(body)) observed += 1;
		if (observed >= 3 && observed / options.bodies.size >= 0.2)
			return { tool: 'basic_memory', signals: ['## Observations and ## Relations sections'] };
	}
	return { tool: 'generic', signals: [] };
}

export const TOOL_WRAPPERS: Partial<Record<BroughtTool, readonly string[]>> = {
	logseq: ['pages/'],
	hugo: ['content/'],
	docusaurus: ['docs/'],
	mkdocs: ['docs/'],
	jekyll: ['_posts/']
};

export const JOURNAL_FOLDERS = new Set([
	'journals',
	'journal',
	'daily',
	'daily notes',
	'daily-notes',
	'dailies',
	'diary',
	'calendar'
]);

export function isJournalPath(path: string): boolean {
	const slash = path.lastIndexOf('/');
	if (slash < 0) return false;
	if (journalDate(stemOf(path)) === null) return false;
	return path
		.slice(0, slash)
		.toLowerCase()
		.split('/')
		.some((folder) => JOURNAL_FOLDERS.has(folder));
}

export function withToolWrappers(
	strip: readonly string[],
	tool: BroughtTool,
	paths: readonly string[]
): string[] {
	const out = [...strip];
	for (const wrapper of TOOL_WRAPPERS[tool] ?? [])
		if (
			!out.some((s) => s.toLowerCase() === wrapper) &&
			paths.some((path) => path.toLowerCase().startsWith(wrapper))
		)
			out.push(wrapper);
	return out;
}

export const EVIDENCE_FOLDERS = new Set([
	'raw',
	'sources',
	'source',
	'clippings',
	'clips',
	'web-clips',
	'web clips',
	'readwise',
	'captures',
	'transcripts',
	'highlights'
]);

export function isEvidenceFolderPath(path: string): boolean {
	const slash = path.lastIndexOf('/');
	if (slash < 0) return false;
	return path
		.slice(0, slash)
		.toLowerCase()
		.split('/')
		.some((folder) => EVIDENCE_FOLDERS.has(folder));
}
