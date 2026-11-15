export const HTML_MAX_RAW_BYTES = 1024 * 1024;

export function isHtmlPath(path: string): boolean {
	return /\.html?$/i.test(path);
}
