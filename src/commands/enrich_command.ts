import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { EnrichReport, RuntimeEnricher } from '../enrich/runtime_enricher.js';
import { KuzuStore } from '../store/kuzu_store.js';
import { DEFAULT_DB_PATH } from './command_helpers.js';

type EnrichOptions = {
	db: string;
	root: string;
	json?: boolean;
};

export class EnrichCommand {
	static register(program: Command): void {
		program
			.command('enrich')
			.description('ingest a V8 CPU profile and attach runtime metrics onto graph nodes')
			.argument('<profile>', 'path to a V8 .cpuprofile file (node --cpu-prof)')
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.option('-r, --root <path>', 'project root the profile paths resolve against', process.cwd())
			.option('--json', 'emit the enrichment report as JSON', false)
			.action(async (profile: string, options: EnrichOptions) => {
				await EnrichCommand.run(profile, options);
			});
	}

	private static async run(profile: string, options: EnrichOptions): Promise<void> {
		const profilePath = resolve(profile);
		const profileText = await readFile(profilePath, 'utf8');
		const store = new KuzuStore(resolve(options.db));
		await store.initSchema();
		try {
			const report = await RuntimeEnricher.enrich(store, profileText, { root: resolve(options.root) });
			EnrichCommand.print(report, options.json === true);
		} finally {
			await store.close();
		}
	}

	private static print(report: EnrichReport, json: boolean): void {
		if (json === true) {
			console.log(JSON.stringify(report, null, 2));
			return;
		}

		const coverage = report.totalSamples > 0
			? Math.round((report.matchedSamples / report.totalSamples) * 100)
			: 0;
		console.log(chalk.green(`✓ enriched ${report.matchedNodes} node(s) with metadata.runtime`));
		console.log(
			`  attributed ${chalk.bold(report.matchedSamples)} / ${report.totalSamples} samples (${coverage}%), ` +
			`${chalk.bold(`${report.matchedSelfMs} ms`)} self time`,
		);
		console.log(
			`  joined ${chalk.bold(report.matchedFrames)} frame(s): ` +
			`${report.matchedByName} by name, ${report.matchedByRange} by range`,
		);
		console.log(`  dropped ${chalk.bold(report.droppedFrames)} frame(s), ${report.droppedSamples} sample(s) — not in graph`);
		console.log(`  attached ${chalk.bold(report.runtimeEdges)} runtime call edge(s) (CALLS_RUNTIME), ${report.droppedCallEdges} unresolved`);

		if (report.hotspots.length > 0) {
			console.log(chalk.bold('\nTop self time'));
			for (const hotspot of report.hotspots.slice(0, 10)) {
				console.log(
					`  ${chalk.gray(`${hotspot.selfMs} ms`.padStart(10))}  ${chalk.bold(hotspot.name)} ` +
					`${chalk.gray(`(${hotspot.samples} samples)`)}  ${chalk.gray(hotspot.filePath)}`,
				);
			}
		}

		if (report.dropped.length > 0) {
			console.log(chalk.bold('\nTop unattributed'));
			for (const group of report.dropped.slice(0, 5)) {
				console.log(`  ${chalk.gray(`${group.samples} samples`.padStart(12))}  ${chalk.gray(group.label)}`);
			}
		}
	}
}
