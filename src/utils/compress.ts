import { exec } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolveTaskRunnerCommand } from './resolve-task-runner-command';

const execAsync = promisify(exec);
export async function compressCSS(inputFile: string, outputFile: string): Promise<void> {
	const taskRunner = await resolveTaskRunnerCommand();
	const command = `${taskRunner} postcss ${inputFile} --use cssnano --no-map -o ${outputFile}`;
	try {
		const { stderr } = await execAsync(command);
		if (stderr) console.error(`[iconify] stderr: ${stderr}`);
		const originalSize = await stat(inputFile).then((s) => s.size);
		const compressedSize = await stat(outputFile).then((s) => s.size);
		const savings = ((1 - compressedSize / originalSize) * 100).toFixed(2);
		console.log(`[iconify] CSS compressed: ${(originalSize / 1024).toFixed(2)} KB -> ${(compressedSize / 1024).toFixed(2)} KB (saved ${savings}%)`);
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		console.error(`[iconify] Error compressing CSS: ${err.message}`);
		throw err;
	}
}
