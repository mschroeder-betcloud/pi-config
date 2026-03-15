import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const METADATA_FILENAME = "piw.json";
const SCHEMA_VERSION = 1;
const DEFAULT_REMOTE = "origin";

async function runGit(args, cwd, description) {
	try {
		const { stdout = "", stderr = "" } = await execFileAsync("git", args, {
			cwd,
			maxBuffer: 10 * 1024 * 1024,
		});
		return { code: 0, stdout, stderr };
	} catch (error) {
		if (error?.code === "ENOENT") {
			throw new Error("git is not installed or not available on PATH.");
		}

		const details = [error?.stderr ?? "", error?.stdout ?? "", error?.message ?? ""].map((value) => value.trim()).filter(Boolean);
		const message = details.join("\n");
		if (!description) {
			return {
				code: typeof error?.code === "number" ? error.code : 1,
				stdout: error?.stdout ?? "",
				stderr: error?.stderr ?? error?.message ?? "",
			};
		}
		throw new Error(message ? `${description}\n${message}` : description);
	}
}

async function runGitAllowFailure(args, cwd) {
	try {
		const { stdout = "", stderr = "" } = await execFileAsync("git", args, {
			cwd,
			maxBuffer: 10 * 1024 * 1024,
		});
		return { code: 0, stdout, stderr };
	} catch (error) {
		if (error?.code === "ENOENT") {
			throw new Error("git is not installed or not available on PATH.");
		}

		return {
			code: typeof error?.code === "number" ? error.code : 1,
			stdout: error?.stdout ?? "",
			stderr: error?.stderr ?? error?.message ?? "",
		};
	}
}

function trimToNull(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

async function resolveCommit(cwd, revision) {
	const result = await runGitAllowFailure(["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], cwd);
	if (result.code !== 0) {
		return null;
	}

	return trimToNull(result.stdout);
}

async function resolveLocalBranchRef(repoRoot, branchName) {
	if (!trimToNull(branchName)) {
		return null;
	}

	const ref = `refs/heads/${branchName}`;
	const commit = await resolveCommit(repoRoot, ref);
	return commit ? ref : null;
}

function normalizeTargetBranchName(input) {
	const value = trimToNull(input);
	if (!value) {
		return null;
	}

	if (value.startsWith("refs/remotes/origin/")) {
		return value.slice("refs/remotes/origin/".length);
	}

	if (value.startsWith("refs/heads/")) {
		return value.slice("refs/heads/".length);
	}

	if (value.startsWith(`${DEFAULT_REMOTE}/`)) {
		return value.slice(`${DEFAULT_REMOTE}/`.length);
	}

	return value;
}

async function deriveIntegrationTarget(repoRoot, baseInput, explicitTargetBranch) {
	if (explicitTargetBranch !== null) {
		const branch = normalizeTargetBranchName(explicitTargetBranch);
		if (!branch) {
			throw new Error("Integration target branch cannot be empty.");
		}

		const targetCommit = await resolveCommit(repoRoot, `refs/remotes/${DEFAULT_REMOTE}/${branch}`);
		if (!targetCommit) {
			throw new Error(`Target branch '${branch}' does not exist on remote '${DEFAULT_REMOTE}'.`);
		}

		return {
			remote: DEFAULT_REMOTE,
			branch,
			targetCommitAtCreation: targetCommit,
		};
	}

	const baseBranchRef = await resolveLocalBranchRef(repoRoot, baseInput);
	if (!baseBranchRef) {
		return {
			remote: DEFAULT_REMOTE,
			branch: null,
			targetCommitAtCreation: null,
		};
	}

	const branch = baseBranchRef.slice("refs/heads/".length);
	const targetCommit = await resolveCommit(repoRoot, `refs/remotes/${DEFAULT_REMOTE}/${branch}`);
	if (!targetCommit) {
		return {
			remote: DEFAULT_REMOTE,
			branch: null,
			targetCommitAtCreation: null,
		};
	}

	return {
		remote: DEFAULT_REMOTE,
		branch,
		targetCommitAtCreation: targetCommit,
	};
}

function getCreatedFromTarget(baseCommit, integration) {
	if (!baseCommit || !integration?.targetCommitAtCreation) {
		return null;
	}

	return integration.targetCommitAtCreation === baseCommit;
}

function resolveMetadataPathOutput(worktreePath, gitPathOutput) {
	const trimmed = trimToNull(gitPathOutput);
	if (!trimmed) {
		throw new Error("git did not return a metadata path.");
	}

	return path.isAbsolute(trimmed) ? trimmed : path.resolve(worktreePath, trimmed);
}

export function getPiwMetadataFilename() {
	return METADATA_FILENAME;
}

export async function getManagedWorktreeMetadataPath(worktreePath) {
	const result = await runGit(["rev-parse", "--git-path", METADATA_FILENAME], worktreePath, "Failed to determine the piw metadata path.");
	return resolveMetadataPathOutput(worktreePath, result.stdout);
}

export async function buildManagedWorktreeMetadata({ repoRoot, name, branch, nameWasProvided, baseInput, targetBranch = null }) {
	const normalizedBaseInput = trimToNull(baseInput);
	if (!normalizedBaseInput) {
		throw new Error("Base branch or revision cannot be empty.");
	}

	const baseCommit = await resolveCommit(repoRoot, normalizedBaseInput);
	if (!baseCommit) {
		throw new Error(`Base branch or revision '${normalizedBaseInput}' does not exist.`);
	}

	const resolvedRef = await resolveLocalBranchRef(repoRoot, normalizedBaseInput);
	const integration = await deriveIntegrationTarget(repoRoot, normalizedBaseInput, targetBranch);

	return {
		schemaVersion: SCHEMA_VERSION,
		kind: "piw",
		name,
		branch,
		repoRoot,
		nameWasProvided: Boolean(nameWasProvided),
		base: {
			input: normalizedBaseInput,
			resolvedRef,
			commit: baseCommit,
		},
		integration: {
			remote: integration.remote,
			branch: integration.branch,
			targetCommitAtCreation: integration.targetCommitAtCreation,
			createdFromTarget: getCreatedFromTarget(baseCommit, integration),
		},
	};
}

export async function readManagedWorktreeMetadata(worktreePath) {
	const metadataPath = await getManagedWorktreeMetadataPath(worktreePath);

	try {
		const raw = await fs.readFile(metadataPath, "utf8");
		return JSON.parse(raw);
	} catch (error) {
		if (error?.code === "ENOENT") {
			return null;
		}

		if (error instanceof SyntaxError) {
			throw new Error(`Failed to parse piw metadata at '${metadataPath}'.`);
		}

		throw new Error(`Failed to read piw metadata at '${metadataPath}'.`);
	}
}

export async function writeManagedWorktreeMetadata(worktreePath, metadata) {
	const metadataPath = await getManagedWorktreeMetadataPath(worktreePath);
	await fs.mkdir(path.dirname(metadataPath), { recursive: true });
	await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
	return metadataPath;
}
