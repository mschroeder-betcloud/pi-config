import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readManagedWorktreeMetadata } from "../src/metadata.js";
import {
	assertBranchExists,
	assertBranchMissing,
	createTempRepo,
	expectedWorktreePath,
	listWorktreePaths,
	parseCapturedWorktreeInfo,
	readCapturedMetadata,
	readJson,
	runPiw,
} from "./helpers.js";

test("creates a named managed worktree, persists metadata, and launches pi with worktree awareness", async () => {
	const repo = await createTempRepo();
	const capturePath = path.join(repo.tempRoot, "capture", "named.json");

	try {
		const result = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-auth"],
			env: {
				PIW_FAKE_PI_CAPTURE: capturePath,
			},
		});

		assert.equal(result.code, 0);
		const worktreePath = expectedWorktreePath(repo.repoPath, "feature-auth");
		const capture = await readJson(capturePath);
		const metadata = readCapturedMetadata(capture);
		const worktreeInfo = parseCapturedWorktreeInfo(capture);
		const persistedMetadata = await readManagedWorktreeMetadata(worktreePath);
		const worktreePaths = await listWorktreePaths(repo.repoPath);

		assert.equal(capture.cwd, worktreePath);
		assert.equal(capture.env.PI_WORKTREE_SESSION, "1");
		assert.equal(capture.env.PI_WORKTREE_NAME, "feature-auth");
		assert.equal(capture.env.PI_WORKTREE_PATH, worktreePath);
		assert.equal(capture.env.PI_WORKTREE_BRANCH, "piw/feature-auth");
		assert.equal(capture.env.PI_WORKTREE_REPO_ROOT, repo.repoPath);
		assert.equal(capture.env.PI_WORKTREE_ORIGINAL_CWD, repo.repoPath);
		assert.ok(capture.argv.includes("--extension"));
		assert.ok(
			capture.argv.some((arg) => arg.endsWith("packages/piw/extensions/worktree-awareness/index.ts")),
			"expected wrapper to pass the private worktree-awareness extension",
		);
		assert.ok(worktreePaths.includes(worktreePath));
		await assertBranchExists(repo.repoPath, "piw/feature-auth");

		assert.ok(metadata, "expected PI_WORKTREE_METADATA_JSON to be provided");
		assert.deepEqual(metadata, persistedMetadata);
		assert.equal(metadata.kind, "piw");
		assert.equal(metadata.name, "feature-auth");
		assert.equal(metadata.branch, "piw/feature-auth");
		assert.equal(metadata.repoRoot, repo.repoPath);
		assert.equal(metadata.nameWasProvided, true);
		assert.equal(metadata.base.input, "main");
		assert.equal(metadata.base.resolvedRef, "refs/heads/main");
		assert.match(metadata.base.commit, /^[0-9a-f]{40}$/);
		assert.equal(metadata.integration.remote, "origin");
		assert.equal(metadata.integration.branch, "main");
		assert.equal(metadata.integration.targetCommitAtCreation, metadata.base.commit);
		assert.equal(metadata.integration.createdFromTarget, true);

		assert.ok(worktreeInfo);
		assert.equal(worktreeInfo.kind, "piw");
		assert.equal(worktreeInfo.managed, true);
		assert.equal(worktreeInfo.metadataComplete, true);
		assert.equal(worktreeInfo.nameWasProvided, true);
		assert.equal(worktreeInfo.integration.branch, "main");
		assert.equal(worktreeInfo.integration.createdFromTarget, true);
	} finally {
		await repo.cleanup();
	}
});

test("creates an auto-named managed worktree, marks it disposable, and deletes it on clean exit", async () => {
	const repo = await createTempRepo();
	const capturePath = path.join(repo.tempRoot, "capture", "auto.json");

	try {
		const result = await runPiw({
			cwd: repo.repoPath,
			args: [],
			env: {
				PIW_FAKE_PI_CAPTURE: capturePath,
			},
		});

		assert.equal(result.code, 0);
		const capture = await readJson(capturePath);
		const metadata = readCapturedMetadata(capture);
		const worktreeInfo = parseCapturedWorktreeInfo(capture);
		const name = capture.env.PI_WORKTREE_NAME;
		const worktreePath = expectedWorktreePath(repo.repoPath, name);
		const worktreePaths = await listWorktreePaths(repo.repoPath);
		assert.match(name, /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+(?:-[0-9]+)?$/);
		assert.equal(capture.env.PI_WORKTREE_BRANCH, `piw/${name}`);
		assert.equal(capture.env.PI_WORKTREE_PATH, worktreePath);
		assert.match(result.stdout, new RegExp(`Deleted worktree '${name}'\\.`));
		assert.ok(!worktreePaths.includes(worktreePath));
		await assertBranchMissing(repo.repoPath, `piw/${name}`);

		assert.ok(metadata, "expected PI_WORKTREE_METADATA_JSON to be provided");
		assert.equal(metadata.name, name);
		assert.equal(metadata.nameWasProvided, false);
		assert.equal(metadata.integration.remote, "origin");
		assert.equal(metadata.integration.branch, "main");
		assert.equal(metadata.integration.createdFromTarget, true);

		assert.ok(worktreeInfo);
		assert.equal(worktreeInfo.metadataComplete, true);
		assert.equal(worktreeInfo.nameWasProvided, false);
	} finally {
		await repo.cleanup();
	}
});
