/**
 * The audit server the CLI talks to, and which origins it believes. `--api` defaults to the
 * public audit server; the hosts below are trusted without a flag (exact names, no wildcard).
 * Any other host is refused unless the person passes `--unsafe-api-host`, which the CLI then
 * says on stderr and in its JSON (`api_trusted: false`).
 *
 * The report link's key never goes to a host this module did not accept: the link is built
 * here on the `--api` origin, or on the origin of the server's `report_url` only when that
 * origin is the `--api` origin or a public trusted one.
 */

/** Where `--api` points when it is not given. */
export const DEFAULT_API = 'https://audit.caspee.ai';

/** The public audit servers, trusted without a flag. */
export const TRUSTED_ORIGINS: readonly string[] = [
	'https://audit.caspee.ai',
	'https://audit.unabyss.com'
];

/** This machine (a local test server), over http or https, any port. */
export const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** A bad `--api`: the CLI reports it as a usage error (exit 2) before any request. */
export class ApiUsageError extends Error {}

export type Api = {
	/** The base requests are made under: origin and path, no trailing slash. */
	base: string;
	/** `scheme://host[:port]` of {@link base}. */
	origin: string;
	/** The host as written in the URL (`[::1]` keeps its brackets). */
	host: string;
	/** On the built-in list; false only when `--unsafe-api-host` let another host through. */
	trusted: boolean;
};

const isLocal = (url: URL) => LOCAL_HOSTS.includes(url.hostname);

/** Whether `url` is a public trusted server or this machine over http(s). */
function trustedUrl(url: URL): boolean {
	if (TRUSTED_ORIGINS.includes(url.origin)) return true;
	return isLocal(url) && (url.protocol === 'http:' || url.protocol === 'https:');
}

/**
 * `--api` checked: the default when it is not given; `https://` anywhere and `http://` only to
 * this machine; a plain base URL; a trusted host, or any host with `unsafe`.
 */
export function apiBaseOf(value: string | undefined, options: { unsafe?: boolean } = {}): Api {
	let url: URL;
	try {
		url = new URL(value ?? DEFAULT_API);
	} catch {
		throw new ApiUsageError('--api is not a URL.');
	}
	if (!(url.protocol === 'https:' || (url.protocol === 'http:' && isLocal(url))))
		throw new ApiUsageError('--api must be https:// (http:// only for localhost).');
	if (url.hash || url.search || url.username || url.password)
		throw new ApiUsageError('--api must be a plain base URL.');
	const trusted = trustedUrl(url);
	if (!trusted && !options.unsafe)
		throw new ApiUsageError(
			`--api ${url.host} is not a known audit server (${TRUSTED_ORIGINS.join(', ')} or localhost). ` +
				'Pass --unsafe-api-host only if you run that server yourself.'
		);
	return {
		base: `${url.origin}${url.pathname}`.replace(/\/+$/, ''),
		origin: url.origin,
		host: url.host,
		trusted
	};
}

/**
 * The origin the report link is built on: the origin of the server's `report_url` when it is
 * the `--api` origin or a public trusted one, else the `--api` origin. `note` gets a line when
 * a `report_url` was given and not taken. The server's path, query and fragment are never used.
 */
export function reportOriginOf(
	reportUrl: unknown,
	api: Api,
	note?: (text: string) => void
): string {
	if (reportUrl === undefined || reportUrl === null) return api.origin;
	const url = typeof reportUrl === 'string' && URL.canParse(reportUrl) ? new URL(reportUrl) : null;
	if (url && (url.origin === api.origin || TRUSTED_ORIGINS.includes(url.origin))) return url.origin;
	note?.(
		`brain-audit: the server's report URL is not on ${api.origin} or a known audit server; ignored, the link is built on ${api.origin}.\n`
	);
	return api.origin;
}
