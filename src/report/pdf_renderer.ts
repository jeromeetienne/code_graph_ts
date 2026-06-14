/** Thrown when no HTML-to-PDF engine is installed, so callers can fall back gracefully. */
export class PdfUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PdfUnavailableError';
	}
}

type PdfPage = {
	setContent: (html: string, options?: { waitUntil?: string }) => Promise<void>;
	pdf: (options?: { format?: string; printBackground?: boolean; margin?: Record<string, string> }) => Promise<Uint8Array>;
};

type PdfBrowser = {
	newPage: () => Promise<PdfPage>;
	close: () => Promise<void>;
};

type PdfEngine = {
	launch: (options?: Record<string, unknown>) => Promise<PdfBrowser>;
};

/**
 * Converts the report's visual HTML to a PDF through an optional, lazily-loaded
 * headless-browser engine (Puppeteer). The engine is never a hard dependency, so
 * `markdown`/`json` users never pull it in; when it is absent this throws
 * {@link PdfUnavailableError} for the command to handle (it falls back to writing
 * the HTML). Keeping the conversion here leaves {@link GraphReport} pure.
 */
export class PdfRenderer {
	static async fromHtml(html: string): Promise<Uint8Array> {
		const engine = await PdfRenderer.loadEngine();
		const browser = await engine.launch({ headless: true });
		try {
			const page = await browser.newPage();
			await page.setContent(html, { waitUntil: 'networkidle0' });
			return await page.pdf({
				format: 'A4',
				printBackground: true,
				margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
			});
		} finally {
			await browser.close();
		}
	}

	/**
	 * Resolves the optional PDF engine by name at runtime. The specifier is a
	 * `string`-typed variable on purpose, so the type checker treats it as a dynamic
	 * import (`Promise<unknown>`) and does not require `puppeteer` to be installed
	 * to type-check the project.
	 */
	private static async loadEngine(): Promise<PdfEngine> {
		const moduleName: string = 'puppeteer';
		let imported: { default?: PdfEngine } & Partial<PdfEngine>;
		try {
			imported = (await import(moduleName)) as { default?: PdfEngine } & Partial<PdfEngine>;
		} catch {
			throw new PdfUnavailableError('PDF output needs a headless-browser engine — install one with `npm i -D puppeteer`.');
		}
		const engine = imported.default ?? (imported.launch !== undefined ? (imported as PdfEngine) : undefined);
		if (engine === undefined) {
			throw new PdfUnavailableError('the installed `puppeteer` does not expose a launch() entry point.');
		}
		return engine;
	}
}
