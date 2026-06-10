import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
export class Verifier {
    static async typecheck(rootPath) {
        return Verifier.runCommand('npx tsc --noEmit', rootPath);
    }
    static async runCommand(command, cwd) {
        try {
            const { stdout, stderr } = await run(command, { cwd, maxBuffer: 10 * 1024 * 1024 });
            return { ok: true, output: `${stdout}${stderr}`.trim() };
        }
        catch (error) {
            const shaped = error;
            return { ok: false, output: `${shaped.stdout ?? ''}${shaped.stderr ?? ''}`.trim() };
        }
    }
}
//# sourceMappingURL=verifier.js.map