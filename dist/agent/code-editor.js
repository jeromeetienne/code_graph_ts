import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export class CodeEditor {
    constructor(rootPath) {
        this.backups = new Map();
        this.rootPath = rootPath;
    }
    async apply(request) {
        const absolute = resolve(this.rootPath, request.filePath);
        const original = await CodeEditor.readSafe(absolute);
        if (original === undefined) {
            return { ok: false, message: `file not found: ${request.filePath}` };
        }
        const occurrences = original.split(request.find).length - 1;
        if (occurrences === 0) {
            return { ok: false, message: 'find text not found in file' };
        }
        if (occurrences > 1) {
            return { ok: false, message: `find text matched ${occurrences} times; include more surrounding context to make it unique` };
        }
        if (this.backups.has(absolute) === false) {
            this.backups.set(absolute, original);
        }
        await writeFile(absolute, original.replace(request.find, request.replace), 'utf8');
        return { ok: true, message: 'applied' };
    }
    async revert(filePath) {
        const absolute = resolve(this.rootPath, filePath);
        const original = this.backups.get(absolute);
        if (original !== undefined) {
            await writeFile(absolute, original, 'utf8');
        }
    }
    static async readSafe(absolute) {
        try {
            return await readFile(absolute, 'utf8');
        }
        catch {
            return undefined;
        }
    }
}
//# sourceMappingURL=code-editor.js.map