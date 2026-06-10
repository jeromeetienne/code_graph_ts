import { resolve } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { GraphBuilder } from '../extract/graph_builder.js';
import { ProjectLoader } from '../extract/project_loader.js';
import { GraphEdge } from '../schema/edge.js';
import { GraphNode } from '../schema/node.js';
import { JsonlStore } from '../store/jsonl_store.js';
import { DEFAULT_GRAPH_DIR } from './command_helpers.js';

type ExtractOptions = {
	out: string;
	semantic: boolean;
};

export class Extract {
	static register(program: Command): void {
		program
			.command('extract')
			.argument('<root>', 'path to the TypeScript project to parse')
			.option('-o, --out <dir>', 'output directory for the JSONL graph', DEFAULT_GRAPH_DIR)
			.option('--semantic', 'resolve heritage and CALLS edges (slower)', false)
			.action(async (root: string, options: ExtractOptions) => {
				await Extract.run(root, options);
			});
	}

	private static async run(root: string, options: ExtractOptions): Promise<void> {
		const rootPath = resolve(root);
		const outPath = resolve(options.out);

		console.log(chalk.cyan(`Loading project at ${rootPath} ...`));
		const project = ProjectLoader.load(rootPath);

		const builder = new GraphBuilder();
		builder.build(project, rootPath, { semantic: options.semantic });

		const nodes = builder.getNodes();
		const edges = builder.getEdges();
		await JsonlStore.write(outPath, nodes, edges);

		console.log(chalk.green(`✓ ${nodes.length} nodes, ${edges.length} edges -> ${outPath}`));
		Extract.printBreakdown(nodes, edges);
	}

	private static printBreakdown(nodes: GraphNode[], edges: GraphEdge[]): void {
		console.log(chalk.bold('\nNodes'));
		for (const [kind, count] of Extract.countBy(nodes.map((node) => node.kind))) {
			console.log(`  ${kind.padEnd(16)} ${count}`);
		}
		console.log(chalk.bold('\nEdges'));
		for (const [kind, count] of Extract.countBy(edges.map((edge) => edge.kind))) {
			console.log(`  ${kind.padEnd(16)} ${count}`);
		}
	}

	private static countBy(values: string[]): [string, number][] {
		const counts = new Map<string, number>();
		for (const value of values) {
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1]);
	}
}
