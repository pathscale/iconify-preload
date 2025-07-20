import { exec } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { resolveTaskRunnerCommand } from "./resolve-task-runner-command";

const execAsync = promisify(exec);

const taskRunnerCommand = await resolveTaskRunnerCommand();

function isErrorWithMessage(error: unknown): error is Error {
	return error instanceof Error && "message" in error;
}

export async function compressCSS(
	inputFile: string,
	outputFile: string,
): Promise<void> {
	try {
		await execAsync(
			`${taskRunnerCommand} postcss ${inputFile} --use cssnano --no-map -o ${outputFile}`,
		);
		const originalSize = fs.statSync(inputFile).size;
		const compressedSize = fs.statSync(outputFile).size;
		const savings = ((1 - compressedSize / originalSize) * 100).toFixed(2);
		console.log(
			`[iconify] CSS compressed: ${(originalSize / 1024).toFixed(2)} KB -> ${(
				compressedSize / 1024
			).toFixed(2)} KB (saved ${savings}%)`,
		);
	} catch (error) {
		if (isErrorWithMessage(error)) {
			console.error(`[iconify] Error compressing CSS: ${error.message}`);
		}
	}
}
