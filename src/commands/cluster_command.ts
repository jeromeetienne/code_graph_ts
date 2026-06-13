import { resolve } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { CLUSTER_EDGE_WEIGHTS } from '../cluster/cluster_weights.js';
import { DEFAULT_COMMUNITY_OPTIONS } from '../cluster/community_detector.js';
import { ClusterReport, GraphClusterer } from '../cluster/graph_clusterer.js';
import { KuzuStore } from '../store/kuzu_store.js';
import { DEFAULT_DB_PATH } from './command_helpers.js';

type ClusterOptions = {
	db: string;
	resolution: string;
	json?: boolean;
};

export class ClusterCommand {
	static register(program: Command): void {
		program
			.command('cluster')
			.description('detect code communities with the Leiden algorithm and attach metadata.community onto nodes')
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.option('--resolution <n>', 'CPM resolution (higher → more, smaller communities)', String(DEFAULT_COMMUNITY_OPTIONS.resolution))
			.option('--json', 'emit the clustering report as JSON', false)
			.action(async (options: ClusterOptions) => {
				await ClusterCommand.run(options);
			});
	}

	private static async run(options: ClusterOptions): Promise<void> {
		const resolution = Number(options.resolution);
		if (Number.isFinite(resolution) === false || resolution <= 0) {
			console.error(chalk.red(`invalid --resolution '${options.resolution}' — expected a positive number`));
			process.exitCode = 1;
			return;
		}
		const store = new KuzuStore(resolve(options.db));
		await store.initSchema();
		try {
			const report = await GraphClusterer.cluster(store, CLUSTER_EDGE_WEIGHTS, {
				...DEFAULT_COMMUNITY_OPTIONS,
				resolution,
			});
			ClusterCommand.print(report, options.json === true);
		} finally {
			await store.close();
		}
	}

	private static print(report: ClusterReport, json: boolean): void {
		if (json === true) {
			console.log(JSON.stringify(report, null, 2));
			return;
		}
		if (report.nodesAssigned === 0) {
			console.log(chalk.yellow('! no weighted edges in graph — run `extract --semantic` and `load` first.'));
			return;
		}
		console.log(chalk.green(`✓ assigned ${report.nodesAssigned} node(s) to ${report.communityCount} communities`));
		console.log(`  resolution ${report.resolution}, CPM quality ${report.quality.toFixed(4)}`);
		console.log(`  largest communities: ${report.sizes.slice(0, 8).join(', ')}`);
	}
}
