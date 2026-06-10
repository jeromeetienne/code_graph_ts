import { resolve } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { GraphBuilder } from './extract/graph-builder';
import { ProjectLoader } from './extract/project-loader';
import { GraphQuery, NeighborRef, SymbolRef } from './query/graph-query';
import { GraphEdge } from './schema/edge';
import { GraphNode } from './schema/node';
import { JsonlReader } from './store/jsonl-reader';
import { JsonlStore } from './store/jsonl-store';
import { KuzuStore } from './store/kuzu-store';

type ExtractOptions = {
	out: string;
	semantic: boolean;
};

type QueryOptions = {
	db: string;
	json?: boolean;
};

type BlastOptions = QueryOptions & {
	depth: string;
};

export class Cli {
	static run(argv: string[]): void {
		const program = new Command();
		program
			.name('ts-knowledge-graph')
			.description('Parse a TypeScript project into a knowledge graph and query it');

		program
			.command('extract')
			.argument('<root>', 'path to the TypeScript project to parse')
			.option('-o, --out <dir>', 'output directory for the JSONL graph', './graph')
			.option('--semantic', 'resolve heritage and CALLS edges (slower)', false)
			.action(async (root: string, options: ExtractOptions) => {
				await Cli.extract(root, options);
			});

		program
			.command('load')
			.description('load a JSONL graph into an embedded Kùzu database')
			.argument('<graphDir>', 'directory holding nodes.jsonl and edges.jsonl')
			.option('-d, --db <path>', 'Kùzu database path', './graph.kuzu')
			.action(async (graphDir: string, options: { db: string }) => {
				await Cli.load(graphDir, options.db);
			});

		Cli.registerQuery(program, 'find', '<pattern>', 'find symbols whose name contains <pattern>', (query, arg) =>
			query.find(arg));
		Cli.registerQuery(program, 'who-calls', '<id>', 'list symbols that call <id>', (query, arg) =>
			query.whoCalls(arg));
		Cli.registerQuery(program, 'calls', '<id>', 'list symbols that <id> calls', (query, arg) =>
			query.calls(arg));
		Cli.registerQuery(program, 'dead-exports', '', 'list exported symbols with no inbound references', (query) =>
			query.deadExports());

		program
			.command('blast-radius')
			.description('list every symbol transitively impacted by changing <id>')
			.argument('<id>', 'node id to analyse')
			.option('-d, --db <path>', 'Kùzu database path', './graph.kuzu')
			.option('--depth <n>', 'maximum traversal depth', '10')
			.option('--json', 'emit raw JSON', false)
			.action(async (id: string, options: BlastOptions) => {
				await Cli.withQuery(options.db, async (query) => {
					Cli.printRefs(await query.blastRadius(id, Number(options.depth)), options.json === true);
				});
			});

		program
			.command('neighbors')
			.description('show the one-hop neighbourhood of <id>')
			.argument('<id>', 'node id to inspect')
			.option('-d, --db <path>', 'Kùzu database path', './graph.kuzu')
			.option('--json', 'emit raw JSON', false)
			.action(async (id: string, options: QueryOptions) => {
				await Cli.withQuery(options.db, async (query) => {
					Cli.printNeighbors(await query.neighborhood(id), options.json === true);
				});
			});

		void program.parseAsync(argv);
	}

	private static registerQuery(
		program: Command,
		name: string,
		argSpec: string,
		description: string,
		run: (query: GraphQuery, arg: string) => Promise<SymbolRef[]>,
	): void {
		const command = program.command(argSpec === '' ? name : `${name} ${argSpec}`).description(description);
		command
			.option('-d, --db <path>', 'Kùzu database path', './graph.kuzu')
			.option('--json', 'emit raw JSON', false)
			.action(async (...args: unknown[]) => {
				const options = args[args.length - 2] as QueryOptions;
				const arg = argSpec === '' ? '' : (args[0] as string);
				await Cli.withQuery(options.db, async (query) => {
					Cli.printRefs(await run(query, arg), options.json === true);
				});
			});
	}

	private static async extract(root: string, options: ExtractOptions): Promise<void> {
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
		Cli.printBreakdown(nodes, edges);
	}

	private static async load(graphDir: string, dbPath: string): Promise<void> {
		const resolvedDb = resolve(dbPath);
		console.log(chalk.cyan(`Loading ${resolve(graphDir)} into ${resolvedDb} ...`));
		const { nodes, edges } = await JsonlReader.read(resolve(graphDir));
		const store = new KuzuStore(resolvedDb);
		await store.initSchema();
		await store.load(nodes, edges);
		await store.close();
		console.log(chalk.green(`✓ loaded ${nodes.length} nodes, ${edges.length} edges`));
	}

	private static async withQuery(dbPath: string, fn: (query: GraphQuery) => Promise<void>): Promise<void> {
		const store = new KuzuStore(resolve(dbPath));
		await store.initSchema();
		try {
			await fn(new GraphQuery(store));
		} finally {
			await store.close();
		}
	}

	private static printRefs(refs: SymbolRef[], json: boolean): void {
		if (json === true) {
			console.log(JSON.stringify(refs, null, 2));
			return;
		}
		if (refs.length === 0) {
			console.log(chalk.yellow('(no results)'));
			return;
		}
		for (const ref of refs) {
			console.log(`${chalk.gray(ref.kind.padEnd(14))} ${chalk.bold(ref.name)}  ${chalk.gray(`${ref.filePath}:${ref.startLine}`)}`);
		}
		console.log(chalk.gray(`\n${refs.length} result(s)`));
	}

	private static printNeighbors(neighbors: NeighborRef[], json: boolean): void {
		if (json === true) {
			console.log(JSON.stringify(neighbors, null, 2));
			return;
		}
		if (neighbors.length === 0) {
			console.log(chalk.yellow('(no neighbours)'));
			return;
		}
		for (const neighbor of neighbors) {
			const arrow = neighbor.direction === 'out' ? '->' : '<-';
			console.log(`${chalk.cyan(arrow)} ${chalk.gray(neighbor.edgeKind.padEnd(12))} ${chalk.bold(neighbor.name)}  ${chalk.gray(`${neighbor.filePath}:${neighbor.startLine}`)}`);
		}
		console.log(chalk.gray(`\n${neighbors.length} edge(s)`));
	}

	private static printBreakdown(nodes: GraphNode[], edges: GraphEdge[]): void {
		console.log(chalk.bold('\nNodes'));
		for (const [kind, count] of Cli.countBy(nodes.map((node) => node.kind))) {
			console.log(`  ${kind.padEnd(16)} ${count}`);
		}
		console.log(chalk.bold('\nEdges'));
		for (const [kind, count] of Cli.countBy(edges.map((edge) => edge.kind))) {
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

Cli.run(process.argv);
