import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readManagedWorktreeMetadata } from "../src/metadata.js";
import {
	assertBranchExists,
	assertBranchMissing,
	createTempRepo,
	expectedWorktreePath,
	git,
	listWorktreePaths,
	parseCapturedWorktreeInfo,
	readJson,
	runPiw,
} from "./helpers.js";

test("rename updates the managed branch, path, and metadata, and the renamed worktree can be reused", async () => {
	const repo = await createTempRepo();
	const oldPath = expectedWorktreePath(repo.repoPath, "feature-auth");
	const newPath = expectedWorktreePath(repo.repoPath, "feature-login");
	const capturePath = path.join(repo.tempRoot, "capture", "renamed.json");

	try {
		const createResult = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-auth"],
		});
		assert.equal(createResult.code, 0);

		const renameResult = await runPiw({
			cwd: repo.repoPath,
			args: ["rename", "feature-auth", "feature-login"],
		});
		assert.equal(renameResult.code, 0);
		assert.match(renameResult.stdout, /Renamed worktree 'feature-auth' to 'feature-login'\./);

		const worktreePaths = await listWorktreePaths(repo.repoPath);
		assert.ok(!worktreePaths.includes(oldPath));
		assert.ok(worktreePaths.includes(newPath));
		await assertBranchMissing(repo.repoPath, "piw/feature-auth");
		await assertBranchExists(repo.repoPath, "piw/feature-login");

		const metadata = await readManagedWorktreeMetadata(newPath);
		assert.ok(metadata);
		assert.equal(metadata.name, "feature-login");
		assert.equal(metadata.branch, "piw/feature-login");
		assert.equal(metadata.repoRoot, repo.repoPath);
		assert.equal(metadata.nameWasProvided, true);
		assert.equal(metadata.integration.branch, "main");

		const pathResult = await runPiw({
			cwd: repo.repoPath,
			args: ["path", "feature-login"],
		});
		assert.equal(pathResult.code, 0);
		assert.equal(pathResult.stdout.trim(), newPath);

		const reuseResult = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-login"],
			env: { PIW_FAKE_PI_CAPTURE: capturePath },
		});
		assert.equal(reuseResult.code, 0);
		assert.match(reuseResult.stdout, /Reusing worktree 'feature-login'\./);

		const capture = await readJson(capturePath);
		const worktreeInfo = parseCapturedWorktreeInfo(capture);
		assert.equal(capture.cwd, newPath);
		assert.equal(capture.env.PI_WORKTREE_NAME, "feature-login");
		assert.equal(capture.env.PI_WORKTREE_PATH, newPath);
		assert.equal(capture.env.PI_WORKTREE_BRANCH, "piw/feature-login");
		assert.ok(worktreeInfo);
		assert.equal(worktreeInfo.name, "feature-login");
		assert.equal(worktreeInfo.branch, "piw/feature-login");
		assert.equal(worktreeInfo.metadataComplete, true);
	} finally {
		await repo.cleanup();
	}
});

test("rename fails when the target managed worktree name already exists", async () => {
	const repo = await createTempRepo();
	const authPath = expectedWorktreePath(repo.repoPath, "feature-auth");
	const loginPath = expectedWorktreePath(repo.repoPath, "feature-login");

	try {
		const createAuth = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-auth"],
		});
		assert.equal(createAuth.code, 0);

		const createLogin = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-login"],
		});
		assert.equal(createLogin.code, 0);

		const renameResult = await runPiw({
			cwd: repo.repoPath,
			args: ["rename", "feature-auth", "feature-login"],
		});
		assert.equal(renameResult.code, 1);
		assert.match(renameResult.stderr, /A managed worktree named 'feature-login' already exists\./);

		const worktreePaths = await listWorktreePaths(repo.repoPath);
		assert.ok(worktreePaths.includes(authPath));
		assert.ok(worktreePaths.includes(loginPath));
		await assertBranchExists(repo.repoPath, "piw/feature-auth");
		await assertBranchExists(repo.repoPath, "piw/feature-login");
	} finally {
		await repo.cleanup();
	}
});

test("rename refuses to rename the active worktree from inside itself", async () => {
	const repo = await createTempRepo();
	const oldPath = expectedWorktreePath(repo.repoPath, "feature-auth");
	const newPath = expectedWorktreePath(repo.repoPath, "feature-login");

	try {
		const createResult = await runPiw({
			cwd: repo.repoPath,
			args: ["feature-auth"],
		});
		assert.equal(createResult.code, 0);

		const renameResult = await runPiw({
			cwd: oldPath,
			args: ["rename", "feature-auth", "feature-login"],
		});
		assert.equal(renameResult.code, 1);
		assert.match(renameResult.stderr, /Refusing to rename the active worktree 'feature-auth' from inside itself\./);

		const worktreePaths = await listWorktreePaths(repo.repoPath);
		assert.ok(worktreePaths.includes(oldPath));
		assert.ok(!worktreePaths.includes(newPath));
		await assertBranchExists(repo.repoPath, "piw/feature-auth");
		await assertBranchMissing(repo.repoPath, "piw/feature-login");
	} finally {
		await repo.cleanup();
	}
});

test("rename preserves metadata-incomplete managed worktrees as metadata-incomplete", async () => {
	const repo = await createTempRepo();
	const oldPath = expectedWorktreePath(repo.repoPath, "legacy");
	const newPath = expectedWorktreePath(repo.repoPath, "legacy-renamed");
	const capturePath = path.join(repo.tempRoot, "capture", "legacy.json");

	try {
		await git(["worktree", "add", "-b", "piw/legacy", oldPath, "main"], repo.repoPath);
		await assertBranchExists(repo.repoPath, "piw/legacy");

		const renameResult = await runPiw({
			cwd: repo.repoPath,
			args: ["rename", "legacy", "legacy-renamed"],
		});
		assert.equal(renameResult.code, 0);
		assert.match(renameResult.stdout, /Renamed worktree 'legacy' to 'legacy-renamed'\./);

		const worktreePaths = await listWorktreePaths(repo.repoPath);
		assert.ok(!worktreePaths.includes(oldPath));
		assert.ok(worktreePaths.includes(newPath));
		await assertBranchMissing(repo.repoPath, "piw/legacy");
		await assertBranchExists(repo.repoPath, "piw/legacy-renamed");
		assert.equal(await readManagedWorktreeMetadata(newPath), null);

		const reuseResult = await runPiw({
			cwd: repo.repoPath,
			args: ["legacy-renamed"],
			env: { PIW_FAKE_PI_CAPTURE: capturePath },
		});
		assert.equal(reuseResult.code, 0);
		assert.match(reuseResult.stdout, /Reusing worktree 'legacy-renamed'\./);

		const capture = await readJson(capturePath);
		const worktreeInfo = parseCapturedWorktreeInfo(capture);
		assert.ok(worktreeInfo);
		assert.equal(worktreeInfo.name, "legacy-renamed");
		assert.equal(worktreeInfo.branch, "piw/legacy-renamed");
		assert.equal(worktreeInfo.metadataComplete, false);
	} finally {
		await repo.cleanup();
	}
});
