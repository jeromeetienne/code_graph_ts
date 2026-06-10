import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Project } from 'ts-morph';

export class ProjectLoader {
	static load(rootPath: string): Project {
		const tsConfigFilePath = join(rootPath, 'tsconfig.json');
		if (existsSync(tsConfigFilePath) === true) {
			return new Project({ tsConfigFilePath });
		}
		const project = new Project();
		project.addSourceFilesAtPaths([
			join(rootPath, '**/*.ts'),
			join(rootPath, '**/*.tsx'),
			`!${join(rootPath, '**/node_modules/**')}`,
		]);
		return project;
	}
}
