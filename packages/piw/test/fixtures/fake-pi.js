#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runGit(args) {
	await execFileAsync("git", args, {
		cwd: process.cwd(),
		maxBuffer: 10 * 1024 * 1024,
	});
}

async function main() {
	const capturePath = process.env.PIW_FAKE_PI_CAPTURE;
	if (capturePath) {
		await mkdir(path.dirname(capturePath), { recursive: true });
		const capturedEnv = Object.fromEntries(
			Object.entries(process.env).filter(([key]) => key.startsWith("PI_WORKTREE_")),
		);
		await writeFile(
			capturePath,
			JSON.stringify(
				{
					cwd: process.cwd(),
					argv: process.argv.slice(2),
					env: capturedEnv,
				},
				null,
				2,
			),
		);
	}

	const touchPath = process.env.PIW_FAKE_PI_TOUCH;
	if (touchPath) {
		const absoluteTouchPath = path.isAbsolute(touchPath) ? touchPath : path.join(process.cwd(), touchPath);
		await mkdir(path.dirname(absoluteTouchPath), { recursive: true });
		await writeFile(absoluteTouchPath, "dirty\n");
	}

	const commitPath = process.env.PIW_FAKE_PI_COMMIT;
	if (commitPath) {
		const absoluteCommitPath = path.isAbsolute(commitPath) ? commitPath : path.join(process.cwd(), commitPath);
		await mkdir(path.dirname(absoluteCommitPath), { recursive: true });
		await writeFile(absoluteCommitPath, "committed\n");
		const relativeCommitPath = path.relative(process.cwd(), absoluteCommitPath) || path.basename(absoluteCommitPath);
		await runGit(["add", "--", relativeCommitPath]);
		await runGit(["commit", "-m", process.env.PIW_FAKE_PI_COMMIT_MESSAGE || `test commit ${path.basename(relativeCommitPath)}`]);
	}

	const exitCode = Number.parseInt(process.env.PIW_FAKE_PI_EXIT_CODE || "0", 10);
	process.exit(Number.isNaN(exitCode) ? 0 : exitCode);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
