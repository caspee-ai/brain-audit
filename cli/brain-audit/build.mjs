/**
 * Bundles the CLI into one file, `dist/brain-audit.mjs`: the CLI's own code, the portable audit
 * core (`src/lib/brain-audit-core/`) and the few pure modules it reaches, with no external
 * import but Node's built-ins. The package has no dependencies; esbuild and the core's own
 * imports (graphology for the constellation's areas) come from the repository root's
 * `node_modules` at build time only.
 *
 * `node cli/brain-audit/build.mjs` (from anywhere). Tests call {@link buildCli} with their own
 * output path.
 */
import { build } from 'esbuild';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The repository root (the source repository or its public mirror; both keep this layout). */
const ROOT = resolve(HERE, '../..');
const LIB = join(ROOT, 'src/lib');

/**
 * `$lib/...` is an alias for `src/lib/`; the core and its pure leaves use it.
 * @type {import('esbuild').Plugin}
 */
const libAlias = {
	name: 'lib-alias',
	setup(b) {
		b.onResolve({ filter: /^\$lib\// }, (args) =>
			b.resolve(`./${args.path.slice(5)}`, { resolveDir: LIB, kind: args.kind })
		);
	}
};

/**
 * Builds the CLI to `outfile` and returns esbuild's metafile. Fails when a module the bundle
 * reaches needs something outside Node's built-ins.
 */
export async function buildCli({ outfile = join(HERE, 'dist/brain-audit.mjs') } = {}) {
	mkdirSync(dirname(outfile), { recursive: true });
	const result = await build({
		entryPoints: [join(HERE, 'src/cli.ts')],
		outfile,
		// Module paths in the bundle's comments are relative to this, so the bundle does not
		// depend on the directory the build runs from (the mirror's rebuild check needs that).
		absWorkingDir: ROOT,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node20',
		minify: false,
		legalComments: 'inline',
		metafile: true,
		logLevel: 'warning',
		banner: { js: '#!/usr/bin/env node' },
		plugins: [libAlias]
	});
	chmodSync(outfile, 0o755);
	return result.metafile;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const meta = await buildCli();
	const out = Object.values(meta.outputs)[0];
	console.log(`brain-audit: ${Object.keys(meta.inputs).length} inputs, ${out.bytes} bytes`);
}
