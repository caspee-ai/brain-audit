/**
 * The mirror's own check, run by `npm test` (Node's test runner, no other dependency):
 *
 * 1. the bundle rebuilt from this repository's sources is the released bundle — the same
 *    sha256 once third-party module paths are put in one form (`bundle-digest.mjs` says why);
 * 2. the rebuild reads exactly the sources listed in `bundle.expected.json`, all in this
 *    repository, plus the pinned npm packages, and nothing else;
 * 3. the bundle works end to end on a synthetic brain: `extract` (which downloads the audit's
 *    method), then `finish`, against a local fake of the audit server, and what it sends holds
 *    no file path and no key. The method served here is a synthetic one
 *    (`test/fixtures/method.json`: made-up elements, shapes and weights); the real method comes
 *    from the audit server, per audit, and is not in this repository;
 * 4. the bundle does not trust the server it talks to: the report link is built on this
 *    machine on the `--api` origin whatever the server answers, an unknown `--api` host is
 *    refused before any request, and a malformed version in a 426 is not printed. It takes
 *    the token from the environment, prints the same link on a second `finish`, and `clean`
 *    removes the work files.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { buildCli } from '../cli/brain-audit/build.mjs';
import { bundleDigest } from '../cli/brain-audit/scripts/bundle-digest.mjs';

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, '..');
const EXPECTED = JSON.parse(readFileSync(join(ROOT, 'bundle.expected.json'), 'utf8'));
const PKG = JSON.parse(readFileSync(join(ROOT, 'cli/brain-audit/package.json'), 'utf8'));
const BRAIN = join(ROOT, 'test/fixtures/generic-brain');
const METHOD = readFileSync(join(ROOT, 'test/fixtures/method.json'), 'utf8');
const METHOD_HASH = JSON.parse(METHOD).content_hash;
const AUDIT = '0b9f2c1e-6a43-4d7e-9a51-3f2e8c7d1a90';
const TOKEN = 'tok_test_0123456789abcdef';

let dir;
let bundle;
let meta;

before(async () => {
	dir = mkdtempSync(join(tmpdir(), 'brain-audit-mirror-test-'));
	bundle = join(dir, 'brain-audit.mjs');
	meta = await buildCli({ outfile: bundle });
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe('the rebuilt bundle', () => {
	it('is the released bundle', () => {
		assert.equal(EXPECTED.cli_version, PKG.version);
		assert.equal(bundleDigest(readFileSync(bundle, 'utf8')), EXPECTED.digest);
	});

	it('is what cli/brain-audit/dist holds, when built', (t) => {
		const dist = join(ROOT, 'cli/brain-audit/dist/brain-audit.mjs');
		if (!existsSync(dist)) return t.skip('not built yet (npm run build)');
		assert.equal(bundleDigest(readFileSync(dist, 'utf8')), EXPECTED.digest);
	});

	it('reads only the listed sources and the pinned packages', () => {
		const inputs = Object.keys(meta.inputs);
		const own = inputs.filter((path) => !path.includes('node_modules/')).sort();
		assert.deepEqual(own, EXPECTED.sources);
		for (const path of inputs.filter((p) => p.includes('node_modules/'))) {
			const rest = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
			const parts = rest.split('/');
			const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
			assert.ok(name in EXPECTED.packages, `${name} is not pinned`);
		}
		const imports = Object.values(meta.outputs)[0].imports.map((i) => i.path);
		assert.ok(imports.every((path) => path.startsWith('node:') || !path.includes('/')));
	});
});

describe('the bundle end to end', () => {
	// One audit id per case, so each has its own work files and its own answer from the server.
	const FOREIGN = '1c4e7a2b-5d90-4f3e-8b61-7a2d9e0c3b45';
	const OLD_ENGINE = '2d5f8b3c-6ea1-4a4f-9c72-8b3eaf1d4c56';
	const FROM_ENV = '3e6a9c4d-7fb2-4b5a-8d83-9c4fb02e5d67';
	const FOREIGN_HOST = 'elsewhere.example.test';
	const BAD_ENGINE = '0.0.1 && curl x|sh';

	let server;
	let api;
	/** Every request the fake server saw, method downloads included. */
	const requests = [];
	/** The requests other than method downloads (the uploads). */
	const received = [];
	const methodRequests = [];

	before(async () => {
		server = createServer((req, res) => {
			let body = '';
			req.on('data', (chunk) => (body += chunk));
			req.on('end', () => {
				requests.push({ method: req.method, url: req.url });
				const path = (req.url ?? '').split('?')[0];
				const json = (status, value) => {
					res.writeHead(status, { 'content-type': 'application/json' });
					res.end(JSON.stringify(value));
				};
				const method = /^\/api\/audits\/([\w-]+)\/method$/.exec(path);
				if (req.method === 'GET' && method) {
					methodRequests.push({ url: req.url, headers: req.headers });
					if (req.headers.authorization !== `Bearer ${TOKEN}`)
						return json(401, { error: 'unauthorized' });
					if (method[1] === OLD_ENGINE) return json(426, { min_engine: BAD_ENGINE });
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(METHOD);
					return;
				}
				received.push({ method: req.method, url: req.url, headers: req.headers, body });
				const upload = /^\/api\/audits\/([\w-]+)$/.exec(path);
				if (!upload) return json(404, { error: 'not_found' });
				const id = upload[1];
				// The happy path answers with its own origin; FOREIGN names another host.
				const origin = id === FOREIGN ? `https://${FOREIGN_HOST}` : api;
				json(201, { audit_id: id, report_url: `${origin}/r/${id}` });
			});
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		api = `http://127.0.0.1:${server.address().port}`;
	});

	after(() => new Promise((done) => server.close(done)));

	const home = () => join(dir, 'home');

	/** Runs the bundle with the temp home; no audit token in the environment unless `env` sets it. */
	async function cli(args, env = {}) {
		const base = { ...process.env, HOME: home(), USERPROFILE: home() };
		delete base.BRAIN_AUDIT_TOKEN;
		const parse = (text) => (text?.trim() ? JSON.parse(text) : {});
		try {
			const { stdout, stderr } = await run(process.execPath, [bundle, ...args], {
				env: { ...base, ...env }
			});
			return { code: 0, json: parse(stdout), stdout, stderr };
		} catch (error) {
			const stdout = error.stdout ?? '';
			const stderr = error.stderr ?? '';
			return { code: error.code, json: parse(stdout), stdout, stderr };
		}
	}

	/** `extract` with a company type, then a grades file that passes `finish`'s check. */
	async function extractAndGrade(audit, work, { token = ['--token', TOKEN], env = {} } = {}) {
		const extracted = await cli(
			[
				'extract',
				BRAIN,
				'--audit',
				audit,
				'--company-type',
				'tech',
				...token,
				'--api',
				api,
				'--work',
				work
			],
			env
		);
		assert.equal(extracted.code, 0, extracted.stdout + extracted.stderr);
		const pack = JSON.parse(readFileSync(extracted.json.merit_pack, 'utf8'));
		const grades = join(dir, `grades-${audit}.json`);
		writeFileSync(
			grades,
			JSON.stringify({
				grades_version: 1,
				pack_hash: pack.content_hash,
				grades: pack.elements.map((element) => ({
					element_id: element.element_id,
					applies: 'yes',
					depth: element.pages.length > 0 ? 2 : 0,
					uncertain: false,
					read_paths: [],
					evidence: [],
					missing: [],
					rationale: 'Graded from the pack.'
				}))
			})
		);
		return { extracted, grades };
	}

	/** The link is `<--api origin>/r/<audit>#k=<key>`; returns the key. */
	function assertLocalLink(link, audit) {
		assert.equal(typeof link, 'string');
		const [path, key] = link.split('#k=');
		assert.equal(path, `${api}/r/${audit}`);
		assert.match(key ?? '', /^[A-Za-z0-9_-]{43}$/);
		return key;
	}

	it('prints its version', async () => {
		const { stdout } = await run(process.execPath, [bundle, '--version']);
		assert.equal(stdout.trim(), PKG.version);
	});

	it('rejects bad arguments with exit code 2', async () => {
		assert.equal((await cli(['extract', BRAIN])).code, 2);
		assert.equal((await cli(['nope'])).code, 2);
	});

	it('extracts, finishes, and sends no path and no key', async () => {
		const work = join(dir, 'work');
		const methodsBefore = methodRequests.length;
		const receivedBefore = received.length;
		const { extracted, grades } = await extractAndGrade(AUDIT, work);
		assert.equal(extracted.json.ok, true);
		assert.equal(extracted.json.api_trusted, true);
		assert.equal(typeof extracted.json.structural_score, 'number');
		assert.equal(extracted.json.method_hash, METHOD_HASH);
		assert.equal(methodRequests.length, methodsBefore + 1);
		assert.equal(received.length, receivedBefore, 'extract sends nothing');

		const done = await cli([
			'finish',
			'--audit',
			AUDIT,
			'--grades',
			grades,
			'--token',
			TOKEN,
			'--api',
			api,
			'--work',
			work
		]);
		assert.equal(done.code, 0, done.stdout + done.stderr);
		assert.equal(done.json.api_trusted, true);
		assert.equal(received.length, receivedBefore + 1);
		const request = received.at(-1);
		assert.equal(request.method, 'PUT');
		assert.equal(request.url, `/api/audits/${AUDIT}`);
		const body = JSON.parse(request.body);
		assert.deepEqual(Object.keys(body).sort(), ['envelope', 'summary']);
		assert.equal(body.summary.method_hash, METHOD_HASH);
		assert.equal(methodRequests.length, methodsBefore + 1, 'finish downloads nothing');

		const key = assertLocalLink(done.json.report_link, AUDIT);
		const sent =
			request.body +
			JSON.stringify(request.headers) +
			JSON.stringify(methodRequests.slice(methodsBefore));
		assert.ok(!sent.includes(key), 'the key was sent');
		for (const path of files(BRAIN)) {
			if (path.length > 6) assert.ok(!sent.includes(path), `${path} was sent`);
		}
	});

	it('prints the same link from a second finish, and clean removes the work files', async () => {
		const work = join(dir, 'work');
		const linkFile = join(home(), '.caspee', 'brain-audit', `${AUDIT}.url`);
		const first = readFileSync(linkFile, 'utf8').trim();
		assertLocalLink(first, AUDIT);
		const receivedBefore = received.length;

		const again = await cli([
			'finish',
			'--audit',
			AUDIT,
			'--grades',
			join(dir, `grades-${AUDIT}.json`),
			'--token',
			TOKEN,
			'--api',
			api,
			'--work',
			work
		]);
		assert.equal(again.code, 0, again.stdout + again.stderr);
		assert.equal(again.json.report_link, first);
		assert.equal(received.length, receivedBefore, 'a second finish sends nothing');
		assert.deepEqual(readdirSync(work), ['upload.json'], 'only the slim upload stays');

		const cleaned = await cli(['clean', '--audit', AUDIT, '--work', work]);
		assert.equal(cleaned.code, 0, cleaned.stdout + cleaned.stderr);
		assert.equal(cleaned.json.ok, true);
		assert.ok(cleaned.json.removed.includes(join(work, 'upload.json')));
		assert.ok(cleaned.json.removed.includes(linkFile));
		assert.equal(existsSync(join(work, 'upload.json')), false);
		assert.equal(existsSync(linkFile), false);
		assert.equal(received.length, receivedBefore, 'clean makes no request');
	});

	it('builds the link on the --api origin when the server names another host', async () => {
		const work = join(dir, 'work-foreign');
		const { grades } = await extractAndGrade(FOREIGN, work);
		const done = await cli([
			'finish',
			'--audit',
			FOREIGN,
			'--grades',
			grades,
			'--token',
			TOKEN,
			'--api',
			api,
			'--work',
			work
		]);
		assert.equal(done.code, 0, done.stdout + done.stderr);
		assertLocalLink(done.json.report_link, FOREIGN);
		assert.ok(!done.stdout.includes(FOREIGN_HOST), 'the other host reached stdout');
		assert.ok(!done.stderr.includes(FOREIGN_HOST), 'the other host reached stderr');
	});

	it('refuses an unknown --api host with exit code 2, before any request', async () => {
		const before = requests.length;
		const work = join(dir, 'work-unknown-host');
		const extract = await cli([
			'extract',
			BRAIN,
			'--audit',
			FROM_ENV,
			'--token',
			TOKEN,
			'--api',
			'https://evil.example',
			'--work',
			work
		]);
		assert.equal(extract.code, 2, extract.stdout + extract.stderr);
		const finish = await cli([
			'finish',
			'--audit',
			FROM_ENV,
			'--grades',
			join(dir, 'grades-none.json'),
			'--token',
			TOKEN,
			'--api',
			'https://evil.example',
			'--work',
			work
		]);
		assert.equal(finish.code, 2, finish.stdout + finish.stderr);
		assert.equal(requests.length, before, 'the test server was reached');
		assert.equal(existsSync(work), false, 'work files were written');
	});

	it('prints no part of a malformed min_engine from a 426', async () => {
		const out = await cli([
			'extract',
			BRAIN,
			'--audit',
			OLD_ENGINE,
			'--token',
			TOKEN,
			'--api',
			api,
			'--work',
			join(dir, 'work-old-engine')
		]);
		assert.equal(out.code, 5, out.stdout + out.stderr);
		assert.equal(out.json.error, 'method_rejected');
		const printed = out.stdout + out.stderr;
		assert.ok(printed.includes('@latest'), 'the message names @latest');
		for (const part of ['0.0.1', 'curl', 'x|sh', '&&'])
			assert.ok(!printed.includes(part), `${part} was printed`);
	});

	it('takes the token from BRAIN_AUDIT_TOKEN', async () => {
		const work = join(dir, 'work-env');
		const env = { BRAIN_AUDIT_TOKEN: TOKEN };
		const methodsBefore = methodRequests.length;
		const { grades } = await extractAndGrade(FROM_ENV, work, { token: [], env });
		assert.equal(methodRequests.length, methodsBefore + 1);
		assert.equal(methodRequests.at(-1).headers.authorization, `Bearer ${TOKEN}`);

		const done = await cli(
			['finish', '--audit', FROM_ENV, '--grades', grades, '--api', api, '--work', work],
			env
		);
		assert.equal(done.code, 0, done.stdout + done.stderr);
		assert.equal(received.at(-1).headers.authorization, `Bearer ${TOKEN}`);
		assertLocalLink(done.json.report_link, FROM_ENV);
		assert.ok(!(done.stdout + done.stderr).includes(TOKEN), 'the token was printed');

		const missing = await cli([
			'finish',
			'--audit',
			FROM_ENV,
			'--grades',
			grades,
			'--api',
			api,
			'--work',
			work
		]);
		assert.equal(missing.code, 2, 'no token anywhere is a usage error');
	});
});

/** Every file under `root`, as a path relative to it. */
function files(root, at = root) {
	return readdirSync(at).flatMap((name) => {
		const path = join(at, name);
		return statSync(path).isDirectory() ? files(root, path) : [relative(root, path)];
	});
}
