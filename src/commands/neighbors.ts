import { Command } from 'commander';
import { CommandHelpers, DEFAULT_DB_PATH, QueryOptions } from './command_helpers.js';

export class Neighbors {
	static register(program: Command): void {
		program
			.command('neighbors')
			.description('show the one-hop neighbourhood of <id>')
			.argument('<id>', 'node id to inspect')
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.option('--json', 'emit raw JSON', false)
			.action(async (id: string, options: QueryOptions) => {
				await CommandHelpers.withQuery(options.db, async (query) => {
					CommandHelpers.printNeighbors(await query.neighborhood(id), options.json === true);
				});
			});
	}
}
