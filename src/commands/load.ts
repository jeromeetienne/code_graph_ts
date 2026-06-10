import { resolve } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { JsonlReader } from '../store/jsonl_reader.js';
import { KuzuStore } from '../store/kuzu_store.js';
import { DEFAULT_DB_PATH, DEFAULT_GRAPH_DIR } from './command_helpers.js';

export class Load {
	static register(program: Command): void {
		program
			.command('load')
			.description('load a JSONL graph into an embedded Kùzu database')
			.argument('[graphDir]', 'directory holding nodes.jsonl and edges.jsonl', DEFAULT_GRAPH_DIR)
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.action(async (graphDir: string, options: { db: string }) => {
				await Load.run(graphDir, options.db);
			});
	}

	private static async run(graphDir: string, dbPath: string): Promise<void> {
		const resolvedDb = resolve(dbPath);
		console.log(chalk.cyan(`Loading ${resolve(graphDir)} into ${resolvedDb} ...`));
		const { nodes, edges } = await JsonlReader.read(resolve(graphDir));
		const store = new KuzuStore(resolvedDb);
		await store.initSchema();
		await store.load(nodes, edges);
		await store.close();
		console.log(chalk.green(`✓ loaded ${nodes.length} nodes, ${edges.length} edges`));
	}
}
