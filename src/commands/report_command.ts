import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { GraphQuery } from '../query/graph_query.js';
import { GraphReport } from '../report/graph_report.js';
import { GraphReportData, ReportData } from '../report/report_data.js';
import { PdfRenderer, PdfUnavailableError } from '../report/pdf_renderer.js';
import { KuzuStore } from '../store/kuzu_store.js';
import { OutputFolder } from '../store/output_folder.js';
import { CommandHelpers } from './command_helpers.js';

type ReportFormat = 'markdown' | 'pdf' | 'json';

const FORMATS: ReportFormat[] = ['markdown', 'pdf', 'json'];
const EXTENSION: Record<ReportFormat, string> = { markdown: 'md', pdf: 'pdf', json: 'json' };
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

type ReportCommandOptions = {
	outputFolder: string;
	format: string;
	output?: string;
	limit: string;
	stdout?: boolean;
};

/**
 * `report` command — gathers a {@link GraphReportData} from the loaded graph and
 * writes a CODEBASE_BRIEF in the chosen format. `markdown` and `json` come
 * straight from the pure {@link GraphReport} renderer; `pdf` renders the visual
 * HTML and converts it through the optional {@link PdfRenderer}, falling back to
 * the HTML when no engine is installed.
 */
export class ReportCommand {
	static register(program: Command): void {
		const command = program
			.command('report')
			.description('generate a CODEBASE_BRIEF summarising structure, impact, runtime, and boundary');
		CommandHelpers.addOutputFolderOption(command)
			.option('--format <format>', `output format: ${FORMATS.join(', ')}`, 'markdown')
			.option('--output <file>', 'output file (default: <output-folder>/CODEBASE_BRIEF.<ext>)')
			.option('--limit <n>', 'maximum rows per ranking', String(DEFAULT_LIMIT))
			.option('--stdout', 'write to stdout instead of a file (markdown/json only)', false)
			.action(async (options: ReportCommandOptions) => {
				await ReportCommand.run(options);
			});
	}

	private static async run(options: ReportCommandOptions): Promise<void> {
		if (FORMATS.includes(options.format as ReportFormat) === false) {
			console.error(chalk.red(`unknown format '${options.format}' — choose one of: ${FORMATS.join(', ')}`));
			process.exitCode = 1;
			return;
		}
		const format = options.format as ReportFormat;
		const folder = new OutputFolder(options.outputFolder);
		if (existsSync(folder.dbPath) === false) {
			console.error(chalk.red(`database not found at ${folder.dbPath} — run \`extract\` then \`load\` first`));
			process.exitCode = 1;
			return;
		}

		const data = await ReportCommand.gather(folder, options);
		if (format === 'pdf') {
			await ReportCommand.emitPdf(data, folder, options);
			return;
		}
		const content = GraphReport.render(data, format);
		if (options.stdout === true) {
			console.log(content);
			return;
		}
		const outPath = options.output ?? folder.reportPath(EXTENSION[format]);
		await writeFile(outPath, content, 'utf8');
		console.log(chalk.green(`✓ wrote ${outPath}`));
	}

	private static async gather(folder: OutputFolder, options: ReportCommandOptions): Promise<GraphReportData> {
		const store = new KuzuStore(folder.dbPath);
		await store.initSchema();
		try {
			const query = new GraphQuery(store);
			return await ReportData.gather(store, query, {
				generatedAt: new Date().toISOString().slice(0, 10),
				project: basename(folder.path),
				outputFolder: options.outputFolder,
				limit: ReportCommand.clampLimit(options.limit),
			});
		} finally {
			await store.close();
		}
	}

	private static async emitPdf(data: GraphReportData, folder: OutputFolder, options: ReportCommandOptions): Promise<void> {
		if (options.stdout === true) {
			console.error(chalk.red('--stdout is not supported for --format pdf — choose markdown or json, or drop --stdout'));
			process.exitCode = 1;
			return;
		}
		const outPath = options.output ?? folder.reportPath('pdf');
		const html = GraphReport.renderVisualHtml(data);
		try {
			const pdf = await PdfRenderer.fromHtml(html);
			await writeFile(outPath, pdf);
			console.log(chalk.green(`✓ wrote ${outPath}`));
		} catch (error) {
			if (error instanceof PdfUnavailableError === false) {
				throw error;
			}
			const htmlPath = outPath.replace(/\.pdf$/, '.html');
			await writeFile(htmlPath, html, 'utf8');
			console.warn(chalk.yellow(`! ${error.message}`));
			console.warn(chalk.yellow(`  wrote the HTML layout to ${htmlPath} — open it and print to PDF, or install the engine for direct PDF output.`));
		}
	}

	private static clampLimit(value: string): number {
		const parsed = Number(value);
		if (Number.isFinite(parsed) === false) {
			return DEFAULT_LIMIT;
		}
		const floored = Math.floor(parsed);
		if (floored < 1) {
			return DEFAULT_LIMIT;
		}
		return floored > MAX_LIMIT ? MAX_LIMIT : floored;
	}
}
