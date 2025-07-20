import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

type RuntimePlatformName = "bun" | "deno" | "node";

const execAsync = promisify(exec);

async function detectRuntimeExecutable(): Promise<RuntimePlatformName> {
	try {
		await execAsync("bun --version");
		return "bun";
	} catch {}

	try {
		await execAsync("deno --version");
		return "deno";
	} catch {}

	try {
		await execAsync("node --version");
		return "node";
	} catch {}

	console.error("[iconify] Could not detect runtime executable");
	// TODO: should we design an error code system or always return 1 on error?
	process.exit(1);
}

const runtimeToTaskRunnerCommandMap: Record<RuntimePlatformName, string> = {
	node: "npx",
	bun: "bunx",
	// \x7F is ASCII for DEL
	// we need it to glue together the `deno task npm:` part
	// with the npm script that is going to be run
	deno: "deno task npm:\x7F",
};

export async function resolveTaskRunnerCommand() {
	const platformName = await detectRuntimeExecutable();
	return runtimeToTaskRunnerCommandMap[platformName];
}
