import { Command } from 'commander';
import { CommandHelpers } from './command_helpers.js';

export class WhoCalls {
	static register(program: Command): void {
		CommandHelpers.registerSymbolQuery(program, 'who-calls', '<id>', 'list symbols that call <id>', (query, arg) =>
			query.whoCalls(arg));
	}
}
