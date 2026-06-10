import { Command } from 'commander';
import { CommandHelpers } from './command_helpers.js';

export class DeadExports {
	static register(program: Command): void {
		CommandHelpers.registerSymbolQuery(program, 'dead-exports', '', 'list exported symbols with no inbound references', (query) =>
			query.deadExports());
	}
}
