#!/usr/bin/env node
import { Command } from 'commander';
import { BlastRadiusCommand } from './commands/blast_radius_command.js';
import { CallsCommand } from './commands/calls_command.js';
import { DeadExportsCommand } from './commands/dead_exports_command.js';
import { ExtractCommand } from './commands/extract_command.js';
import { FindCommand } from './commands/find_command.js';
import { InstallCommand } from './commands/install_command.js';
import { LoadCommand } from './commands/load_command.js';
import { NeighborsCommand } from './commands/neighbors_command.js';
import { ReferencesCommand } from './commands/references_command.js';
import { WebCommand } from './commands/web_command.js';
import { WhoCallsCommand } from './commands/who_calls_command.js';

export class Cli {
	static run(argv: string[]): void {
		const program = new Command();
		program
			.name('ts-knowledge-graph')
			.description('Parse a TypeScript project into a knowledge graph and query it');

		ExtractCommand.register(program);
		LoadCommand.register(program);
		FindCommand.register(program);
		WhoCallsCommand.register(program);
		CallsCommand.register(program);
		DeadExportsCommand.register(program);
		BlastRadiusCommand.register(program);
		NeighborsCommand.register(program);
		ReferencesCommand.register(program);
		WebCommand.register(program);
		InstallCommand.register(program);

		void program.parseAsync(argv);
	}
}

Cli.run(process.argv);
