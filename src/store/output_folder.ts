import { join, resolve } from 'node:path';

/**
 * The single source of truth for the output-folder layout. Every artifact a CLI
 * command reads or writes under the output folder is derived from one root, so
 * callers pass `--output-folder` and never an individual file path:
 *
 *   <root>/graph/        nodes.jsonl, edges.jsonl, source.json   (JsonlStore / JsonlReader)
 *   <root>/graph.kuzu    embedded Kùzu database                  (KuzuStore)
 *   <root>/prof/         V8 .cpuprofile files                    (profile_and_enrich.sh)
 *   <root>/bench/        <target>.baseline.json benchmark baselines
 *
 * The directory segment names live only here. The store classes own the JSONL
 * filenames (a format concern), and both `KuzuStore` and `JsonlStore` create
 * their own parent directories, so this type never touches the filesystem.
 */
export class OutputFolder {
	private readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
	}

	/** The output folder root itself (absolute). */
	get path(): string {
		return this.root;
	}

	/** Directory holding nodes.jsonl, edges.jsonl, and source.json. */
	get graphDir(): string {
		return join(this.root, 'graph');
	}

	/** Embedded Kùzu database path. */
	get dbPath(): string {
		return join(this.root, 'graph.kuzu');
	}

	/** Directory for V8 .cpuprofile files. */
	get profDir(): string {
		return join(this.root, 'prof');
	}

	/** Directory for benchmark baselines. */
	get benchDir(): string {
		return join(this.root, 'bench');
	}

	/** Baseline file for one benchmark target, e.g. `<root>/bench/titleCase.baseline.json`. */
	baselinePath(target: string): string {
		return join(this.benchDir, `${OutputFolder.sanitizeTarget(target)}.baseline.json`);
	}

	/**
	 * Path of the generated codebase brief for a given file extension (`md`, `pdf`,
	 * or `json`). Like {@link OutputFolder.dbPath}, the basename lives only here so
	 * every output path stays derived from the one root.
	 */
	reportPath(extension: string): string {
		return join(this.root, `CODEBASE_BRIEF.${extension}`);
	}

	/**
	 * Make a benchmark target name safe as a filename. Targets are symbol names
	 * (e.g. `titleCase`) but could contain path-like characters; collapse anything
	 * outside [A-Za-z0-9._-] to '_' so the baseline path stays inside benchDir.
	 */
	private static sanitizeTarget(target: string): string {
		return target.replace(/[^A-Za-z0-9._-]+/g, '_');
	}
}
