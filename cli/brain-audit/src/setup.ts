/**
 * `brain-audit setup [brain_dir] [--agent <id>] [--start] [--yes]`: sets up the person's agent
 * for the audit in one command, then (with `--start`) opens it on the brain folder.
 *
 * It does what the setup on audit.caspee.ai shows by hand, for the agent it finds (or the one
 * `--agent` names):
 *
 * - **Claude Code**: `claude mcp add --transport http --scope user brain-audit <mcp>` and the
 *   skill in `~/.claude/skills/brain-audit/SKILL.md`.
 * - **Codex**: `codex mcp add brain-audit --url <mcp>` and the instructions appended to
 *   `~/.codex/AGENTS.md`.
 * - **Cursor**: the server added to `~/.cursor/mcp.json` (other entries kept) and the rule in
 *   `<brain_dir>/.cursor/rules/brain-audit.mdc`.
 *
 * The skill, instructions or rule is downloaded from the audit server (`GET /agents/<agent>`,
 * the file the website serves); that is setup's only request. It lists every change and asks
 * before making any (`--yes` skips the question; without a terminal to ask in, `--yes` is
 * required). A step already done is skipped, so running it twice changes nothing.
 *
 * `--start` then runs the agent in the brain folder with the audit's opening prompt; the agent
 * reads the brain from there, guided by the audit MCP. Nothing of the brain is read by setup.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

/** The agents setup knows, as the website names them. */
export const SETUP_AGENTS = ['claude-code', 'codex', 'cursor'] as const;
export type SetupAgent = (typeof SETUP_AGENTS)[number];

const isSetupAgent = (value: string): value is SetupAgent =>
	(SETUP_AGENTS as readonly string[]).includes(value);

/** The MCP server's name in each agent's config. */
export const MCP_NAME = 'brain-audit';

const LABEL: Record<SetupAgent, string> = {
	'claude-code': 'Claude Code',
	codex: 'Codex',
	cursor: 'Cursor'
};

/** The command that runs each agent in a terminal (Cursor's is its CLI, when installed). */
const COMMAND: Record<SetupAgent, string> = {
	'claude-code': 'claude',
	codex: 'codex',
	cursor: 'cursor-agent'
};

/** A line every kit the audit server serves holds; anything else is not a kit. */
const KIT_MARK = '# Caspee Brain Audit';
/** The most a kit may weigh; the real ones are a few kilobytes. */
const KIT_MAX_BYTES = 64 * 1024;

/** What the person says to the agent; the folder is named so the agent need not ask. */
export function startPrompt(brainDir: string): string {
	return `Run the Caspee brain audit on my brain folder: ${brainDir}`;
}

/** A failure setup explains to the person: an error code, a message and the exit code. */
export class SetupError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly exit: number
	) {
		super(message);
	}
}

/** The result of a command run to completion with its output captured. */
export type ExecResult = { code: number; stdout: string; stderr: string };

/** What setup takes from the machine; tests pass their own. */
export type SetupDeps = {
	home: string;
	cwd: string;
	env: Readonly<Record<string, string | undefined>>;
	platform: NodeJS.Platform;
	fetch: typeof fetch;
	/** Runs a command and captures its output (the agents' own `mcp add`). */
	exec: (command: string, args: string[]) => Promise<ExecResult>;
	/** Runs a command in `cwd` on this terminal and resolves with its exit code (`--start`). */
	spawn: (command: string, args: string[], cwd: string) => Promise<number>;
	/** Asks the person a question and resolves with the answer; null when there is no terminal. */
	ask: ((question: string) => Promise<string>) | null;
	/** Lines for the person. */
	say: (text: string) => void;
};

export type SetupOptions = {
	brainDir?: string;
	agent?: string;
	start: boolean;
	yes: boolean;
	/** The audit server's base (already checked by the caller). */
	api: string;
};

/** The full path of `command` on `PATH`, or null. */
export function findOnPath(
	command: string,
	env: Readonly<Record<string, string | undefined>>,
	platform: NodeJS.Platform
): string | null {
	const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter);
	const exts =
		platform === 'win32'
			? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
			: [''];
	for (const dir of dirs) {
		if (!dir) continue;
		for (const ext of exts) {
			const file = join(dir, command + ext);
			try {
				if (statSync(file).isFile()) return file;
			} catch {
				// not here
			}
		}
	}
	return null;
}

/** The agents installed on this machine, in {@link SETUP_AGENTS} order. */
export function detectAgents(deps: SetupDeps): SetupAgent[] {
	const found: SetupAgent[] = [];
	if (findOnPath('claude', deps.env, deps.platform)) found.push('claude-code');
	if (findOnPath('codex', deps.env, deps.platform)) found.push('codex');
	if (
		findOnPath('cursor', deps.env, deps.platform) ||
		findOnPath('cursor-agent', deps.env, deps.platform) ||
		existsSync(join(deps.home, '.cursor'))
	)
		found.push('cursor');
	return found;
}

async function chooseAgent(options: SetupOptions, deps: SetupDeps): Promise<SetupAgent> {
	if (options.agent !== undefined) {
		if (!isSetupAgent(options.agent))
			throw new SetupError(
				'usage',
				`--agent is one of ${SETUP_AGENTS.join(', ')}; ${JSON.stringify(options.agent)} is not.`,
				2
			);
		return options.agent;
	}
	const found = detectAgents(deps);
	if (found.length === 0)
		throw new SetupError(
			'no_agent',
			'No Claude Code, Codex or Cursor found on this machine. Install one, or name it with --agent claude-code|codex|cursor. The setup by hand is at https://audit.caspee.ai/#setup.',
			3
		);
	if (found.length === 1) return found[0]!;
	if (!deps.ask)
		throw new SetupError(
			'usage',
			`Found ${found.map((a) => LABEL[a]).join(', ')}; choose one with --agent ${found.join('|')}.`,
			2
		);
	deps.say(`Found ${found.length} agents:\n`);
	found.forEach((a, i) => deps.say(`  ${i + 1}. ${LABEL[a]}\n`));
	for (;;) {
		const answer = (await deps.ask(`Which one should run the audit? [1-${found.length}] `)).trim();
		const n = answer === '' ? 1 : Number(answer);
		if (Number.isInteger(n) && n >= 1 && n <= found.length) return found[n - 1]!;
		const named = found.find((a) => a === answer.toLowerCase());
		if (named) return named;
	}
}

/** The kit file for `agent`, downloaded from the audit server and checked. */
async function downloadKit(agent: SetupAgent, api: string, deps: SetupDeps): Promise<string> {
	const url = `${api}/agents/${agent}`;
	let response: Response;
	try {
		response = await deps.fetch(url, { redirect: 'error' });
	} catch (error) {
		throw new SetupError(
			'kit_failed',
			`Could not reach ${api} to download the ${LABEL[agent]} setup file: ${error instanceof Error ? error.message : String(error)}`,
			6
		);
	}
	if (!response.ok)
		throw new SetupError(
			'kit_failed',
			`${api} answered ${response.status} for the ${LABEL[agent]} setup file.`,
			6
		);
	const body = await response.text();
	if (Buffer.byteLength(body) > KIT_MAX_BYTES || !body.includes(KIT_MARK) || body.includes('\0'))
		throw new SetupError(
			'kit_invalid',
			`What ${api} sent for the ${LABEL[agent]} setup file is not a setup file; nothing was changed.`,
			5
		);
	return body;
}

/** One change setup would make: what the person is told, and how it is made. */
type Step = { says: string; done: boolean; make: () => Promise<void> };

function writeFile(file: string, text: string) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text, { mode: 0o644 });
}

const readOr = (file: string, fallback: string) =>
	existsSync(file) ? readFileSync(file, 'utf8') : fallback;

async function runAgentCommand(deps: SetupDeps, command: string, args: string[]) {
	const result = await deps.exec(command, args).catch((error: unknown) => ({
		code: -1,
		stdout: '',
		stderr: error instanceof Error ? error.message : String(error)
	}));
	if (result.code !== 0)
		throw new SetupError(
			'agent_command_failed',
			`\`${[command, ...args].join(' ')}\` failed${result.stderr.trim() ? `: ${result.stderr.trim().split('\n')[0]}` : '.'}`,
			1
		);
}

/** The changes for `agent`, each marked done when it is already in place. */
async function stepsFor(
	agent: SetupAgent,
	kit: string,
	brainDir: string,
	mcpUrl: string,
	deps: SetupDeps
): Promise<Step[]> {
	const tilde = (path: string) =>
		path.startsWith(`${deps.home}/`) ? `~${path.slice(deps.home.length)}` : path;
	if (agent === 'claude-code') {
		const known = await deps
			.exec('claude', ['mcp', 'get', MCP_NAME])
			.then((r) => r.code === 0)
			.catch(() => false);
		const skill = join(deps.home, '.claude', 'skills', MCP_NAME, 'SKILL.md');
		return [
			{
				says: `Connect the audit MCP to Claude Code: claude mcp add --transport http --scope user ${MCP_NAME} ${mcpUrl}`,
				done: known,
				make: () =>
					runAgentCommand(deps, 'claude', [
						'mcp',
						'add',
						'--transport',
						'http',
						'--scope',
						'user',
						MCP_NAME,
						mcpUrl
					])
			},
			{
				says: `Write the audit skill to ${tilde(skill)}`,
				done: readOr(skill, '') === kit,
				make: async () => writeFile(skill, kit)
			}
		];
	}
	if (agent === 'codex') {
		const config = join(deps.home, '.codex', 'config.toml');
		const agentsMd = join(deps.home, '.codex', 'AGENTS.md');
		const current = readOr(agentsMd, '');
		return [
			{
				says: `Connect the audit MCP to Codex: codex mcp add ${MCP_NAME} --url ${mcpUrl}`,
				done: readOr(config, '').includes(`[mcp_servers.${MCP_NAME}]`),
				make: () => runAgentCommand(deps, 'codex', ['mcp', 'add', MCP_NAME, '--url', mcpUrl])
			},
			{
				says: `Append the audit instructions to ${tilde(agentsMd)}`,
				done: current.includes(KIT_MARK),
				make: async () => {
					const sep =
						current === '' || current.endsWith('\n\n')
							? ''
							: current.endsWith('\n')
								? '\n'
								: '\n\n';
					writeFile(agentsMd, `${current}${sep}${kit}`);
				}
			}
		];
	}
	const mcpJson = join(deps.home, '.cursor', 'mcp.json');
	let config: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = {};
	if (existsSync(mcpJson)) {
		const text = readFileSync(mcpJson, 'utf8');
		try {
			config = text.trim() === '' ? {} : JSON.parse(text);
		} catch {
			throw new SetupError(
				'cursor_config_invalid',
				`${mcpJson} is not valid JSON, so setup will not edit it. Add the server by hand: "${MCP_NAME}": { "url": "${mcpUrl}" } under "mcpServers".`,
				3
			);
		}
		if (typeof config !== 'object' || config === null || Array.isArray(config))
			throw new SetupError('cursor_config_invalid', `${mcpJson} is not a JSON object.`, 3);
	}
	const servers = (config.mcpServers ?? {}) as Record<string, { url?: string }>;
	const rule = join(brainDir, '.cursor', 'rules', `${MCP_NAME}.mdc`);
	return [
		{
			says: `Add the audit MCP to ${tilde(mcpJson)} (other servers kept)`,
			done: servers[MCP_NAME]?.url === mcpUrl,
			make: async () => {
				const next = { ...config, mcpServers: { ...servers, [MCP_NAME]: { url: mcpUrl } } };
				writeFile(mcpJson, `${JSON.stringify(next, null, 2)}\n`);
			}
		},
		{
			says: `Write the audit rule to ${rule}`,
			done: readOr(rule, '') === kit,
			make: async () => writeFile(rule, kit)
		}
	];
}

async function confirm(deps: SetupDeps): Promise<boolean> {
	const answer = (await deps.ask!('Make these changes? [Y/n] ')).trim().toLowerCase();
	return answer === '' || answer === 'y' || answer === 'yes';
}

/** Runs setup; resolves with the exit code (the agent's own, after `--start`). */
export async function setup(options: SetupOptions, deps: SetupDeps): Promise<number> {
	const brainDir = resolve(deps.cwd, options.brainDir ?? '.');
	if (!existsSync(brainDir) || !statSync(brainDir).isDirectory())
		throw new SetupError('not_a_folder', `${brainDir} is not a folder.`, 3);
	if (!options.yes && !deps.ask)
		throw new SetupError(
			'usage',
			"setup changes your agent's settings and asks first; with no terminal to ask in, pass --yes.",
			2
		);
	const agent = await chooseAgent(options, deps);
	const mcpUrl = `${options.api}/mcp`;
	const kit = await downloadKit(agent, options.api, deps);
	const steps = await stepsFor(agent, kit, brainDir, mcpUrl, deps);
	const todo = steps.filter((s) => !s.done);

	deps.say(`\nCaspee Brain Audit setup for ${LABEL[agent]}\n\n`);
	for (const step of steps) deps.say(`  ${step.done ? '✓ already done:' : '•'} ${step.says}\n`);
	deps.say('\n');
	if (todo.length > 0) {
		if (!options.yes && !(await confirm(deps))) {
			deps.say('Nothing was changed.\n');
			return 1;
		}
		for (const step of todo) {
			await step.make();
			deps.say(`  ✓ ${step.says}\n`);
		}
		deps.say('\n');
	}
	deps.say(`${LABEL[agent]} is set up for the audit.\n`);

	const prompt = startPrompt(brainDir);
	if (options.start) {
		const command = COMMAND[agent];
		if (findOnPath(command, deps.env, deps.platform)) {
			deps.say(`Starting ${LABEL[agent]} in ${brainDir}…\n\n`);
			return deps.spawn(command, [prompt], brainDir);
		}
		deps.say(
			`${command} is not on this machine, so the audit cannot start from here. Open ${brainDir} in ${LABEL[agent]} and say:\n\n  ${prompt}\n`
		);
		return 0;
	}
	deps.say(
		`\nNext: open ${LABEL[agent]} in ${brainDir} (a new session, so it loads the audit) and say:\n\n  ${prompt}\n`
	);
	return 0;
}
