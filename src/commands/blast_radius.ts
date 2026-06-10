import { Command } from 'commander';
import { CommandHelpers, DEFAULT_DB_PATH, QueryOptions } from './command_helpers.js';

type BlastOptions = QueryOptions & {
	depth: string;
};

export class BlastRadius {
	static register(program: Command): void {
		program
			.command('blast-radius')
			.description('list every symbol transitively impacted by changing <id>')
			.argument('<id>', 'node id to analyse')
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.option('--depth <n>', 'maximum traversal depth', '10')
			.option('--json', 'emit raw JSON', false)
			.action(async (id: string, options: BlastOptions) => {
				await CommandHelpers.withQuery(options.db, async (query) => {
					CommandHelpers.printRefs(await query.blastRadius(id, Number(options.depth)), options.json === true);
				});
			});
	}
}
