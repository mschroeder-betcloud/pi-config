import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
	assertBranchExists,
	assertBranchMissing,
	createTempRepo,
	expectedWorktreePath,
	git,
	listWorktreePaths,
	parseCapturedWorktreeInfo,
	readCapturedMetadata,
	readJson,
	runPiw,
} from "./helpers.js";

test("defaults a new worktree to the recorded target tip when the local base has diverged", async () => {
	const repo = await createTempRepo();
	const capturePath = path.join(repo.tempRoot, "capture", "out-of-date-target.json");

	try {
		await git(["commit", "--allow-empty", "-m", "local change"], repo.repoPath);

		const result = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-auth", "--target", "main"],
			env: { PIW_FAKE_PI_CAPTURE: capturePath },
		});
		assert.equal(result.code, 0);

		const capture = await readJson(capturePath);
		const metadata = readCapturedMetadata(capture);
		const worktreeInfo = parseCapturedWorktreeInfo(capture);

		assert.ok(metadata);
		assert.equal(metadata.base.input, "origin/main");
		assert.equal(metadata.base.resolvedRef, "refs/remotes/origin/main");
		assert.equal(metadata.integration.remote, "origin");
		assert.equal(metadata.integration.branch, "main");
		assert.equal(metadata.integration.targetCommitAtCreation, metadata.base.commit);
		assert.equal(metadata.integration.createdFromTarget, true);

		assert.ok(worktreeInfo);
		assert.equal(worktreeInfo.metadataComplete, true);
		assert.equal(worktreeInfo.integration.createdFromTarget, true);
	} finally {
		await repo.cleanup();
	}
});

test("infers the recorded target from a remote-tracking creation base", async () => {
	const repo = await createTempRepo();
	const capturePath = path.join(repo.tempRoot, "capture", "implicit-target.json");

	try {
		await git(["commit", "--allow-empty", "-m", "local change"], repo.repoPath);

		const result = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-auth"],
			env: { PIW_FAKE_PI_CAPTURE: capturePath },
		});
		assert.equal(result.code, 0);

		const capture = await readJson(capturePath);
		const metadata = readCapturedMetadata(capture);
		const worktreeInfo = parseCapturedWorktreeInfo(capture);

		assert.ok(metadata);
		assert.equal(metadata.base.input, "origin/main");
		assert.equal(metadata.base.resolvedRef, "refs/remotes/origin/main");
		assert.equal(metadata.integration.remote, "origin");
		assert.equal(metadata.integration.branch, "main");
		assert.equal(metadata.integration.targetCommitAtCreation, metadata.base.commit);
		assert.equal(metadata.integration.createdFromTarget, true);

		assert.ok(worktreeInfo);
		assert.equal(worktreeInfo.metadataComplete, true);
		assert.equal(worktreeInfo.integration.branch, "main");
		assert.equal(worktreeInfo.integration.createdFromTarget, true);
	} finally {
		await repo.cleanup();
	}
});

test("keeps an explicit base even when the recorded target tip differs", async () => {
	const repo = await createTempRepo();
	const capturePath = path.join(repo.tempRoot, "capture", "explicit-base.json");

	try {
		await git(["commit", "--allow-empty", "-m", "local change"], repo.repoPath);

		const result = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-auth", "--base", "main", "--target", "main"],
			env: { PIW_FAKE_PI_CAPTURE: capturePath },
		});
		assert.equal(result.code, 0);

		const capture = await readJson(capturePath);
		const metadata = readCapturedMetadata(capture);
		const worktreeInfo = parseCapturedWorktreeInfo(capture);

		assert.ok(metadata);
		assert.equal(metadata.base.input, "main");
		assert.equal(metadata.base.resolvedRef, "refs/heads/main");
		assert.equal(metadata.integration.remote, "origin");
		assert.equal(metadata.integration.branch, "main");
		assert.notEqual(metadata.integration.targetCommitAtCreation, metadata.base.commit);
		assert.equal(metadata.integration.createdFromTarget, false);

		assert.ok(worktreeInfo);
		assert.equal(worktreeInfo.metadataComplete, true);
		assert.equal(worktreeInfo.integration.createdFromTarget, false);
	} finally {
		await repo.cleanup();
	}
});

test("fails fast when an explicit target branch does not exist on origin and cleans up the new worktree", async () => {
	const repo = await createTempRepo();
	const worktreePath = expectedWorktreePath(repo.repoPath, "feature-auth");

	try {
		const result = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-auth", "--target", "develop"],
		});

		assert.equal(result.code, 1);
		assert.match(result.stderr, /Target branch 'develop' does not exist on remote 'origin'\./);
		const worktreePaths = await listWorktreePaths(repo.repoPath);
		assert.ok(!worktreePaths.includes(worktreePath));
		await assertBranchMissing(repo.repoPath, "piw/feature-auth");
	} finally {
		await repo.cleanup();
	}
});

test("reused legacy managed worktrees without metadata are exposed as metadata-incomplete", async () => {
	const repo = await createTempRepo();
	const capturePath = path.join(repo.tempRoot, "capture", "legacy.json");
	const worktreePath = expectedWorktreePath(repo.repoPath, "legacy");

	try {
		await git(["worktree", "add", "-b", "piw/legacy", worktreePath, "main"], repo.repoPath);
		await assertBranchExists(repo.repoPath, "piw/legacy");

		const result = await runPiw({
			cwd: repo.repoPath,
			args: ["legacy"],
			env: { PIW_FAKE_PI_CAPTURE: capturePath },
		});
		assert.equal(result.code, 0);
		assert.match(result.stdout, /Reusing worktree 'legacy'\./);

		const capture = await readJson(capturePath);
		const worktreeInfo = parseCapturedWorktreeInfo(capture);
		assert.equal(capture.env.PI_WORKTREE_METADATA_JSON, undefined);
		assert.ok(worktreeInfo);
		assert.equal(worktreeInfo.metadataComplete, false);
		assert.equal(worktreeInfo.base, null);
		assert.equal(worktreeInfo.integration, null);
		assert.equal(worktreeInfo.nameWasProvided, null);
	} finally {
		await repo.cleanup();
	}
});
