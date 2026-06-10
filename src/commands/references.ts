import { Command } from 'commander';
import { CommandHelpers, DEFAULT_DB_PATH, QueryOptions } from './command_helpers.js';

export class References {
	static register(program: Command): void {
		program
			.command('references')
			.description('list everything that references <id> (calls, type usage, heritage, new)')
			.argument('<id>', 'node id to inspect')
			.option('-d, --db <path>', 'Kùzu database path', DEFAULT_DB_PATH)
			.option('--json', 'emit raw JSON', false)
			.action(async (id: string, options: QueryOptions) => {
				await CommandHelpers.withQuery(options.db, async (query) => {
					CommandHelpers.printNeighbors(await query.references(id), options.json === true);
				});
			});
	}
}
