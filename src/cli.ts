#!/usr/bin/env node
import { Command } from 'commander';
import { BlastRadius } from './commands/blast_radius.js';
import { Calls } from './commands/calls.js';
import { DeadExports } from './commands/dead_exports.js';
import { Extract } from './commands/extract.js';
import { Find } from './commands/find.js';
import { Load } from './commands/load.js';
import { Neighbors } from './commands/neighbors.js';
import { Optimize } from './commands/optimize.js';
import { References } from './commands/references.js';
import { WhoCalls } from './commands/who_calls.js';

export class Cli {
	static run(argv: string[]): void {
		const program = new Command();
		program
			.name('ts-knowledge-graph')
			.description('Parse a TypeScript project into a knowledge graph and query it');

		Extract.register(program);
		Load.register(program);
		Find.register(program);
		WhoCalls.register(program);
		Calls.register(program);
		DeadExports.register(program);
		BlastRadius.register(program);
		Neighbors.register(program);
		References.register(program);
		Optimize.register(program);

		void program.parseAsync(argv);
	}
}

Cli.run(process.argv);
