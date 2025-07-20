import { exec } from "node:child_process";
import fs from "node:fs";
import { resolveTaskRunnerCommand } from "./resolve-task-runner-command";

export function compressCSS(
	inputFile: string,
	outputFile: string,
): Promise<void> {
	return new Promise(async (resolve, reject) => {
		const taskRunner = await resolveTaskRunnerCommand();
		exec(
			`${taskRunner} postcss ${inputFile} --use cssnano --no-map -o ${outputFile}`,
			(error, stdout, stderr) => {
				if (error) {
					console.error(`[iconify] Error compressing CSS: ${error.message}`);
					reject(error);
					return;
				}
				if (stderr) {
					console.error(`[iconify] stderr: ${stderr}`);
				}
				const originalSize = fs.statSync(inputFile).size;
				const compressedSize = fs.statSync(outputFile).size;
				const savings = ((1 - compressedSize / originalSize) * 100).toFixed(2);
				console.log(
					`[iconify] CSS compressed: ${(originalSize / 1024).toFixed(2)} KB -> ${(
						compressedSize / 1024
					).toFixed(2)} KB (saved ${savings}%)`,
				);
				resolve();
			},
		);
	});
}
