function trimToNull(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizeBoolean(value) {
	return typeof value === "boolean" ? value : null;
}

function normalizeBase(raw) {
	if (!raw || typeof raw !== "object") {
		return null;
	}

	return {
		input: trimToNull(raw.input),
		resolvedRef: trimToNull(raw.resolvedRef),
		commit: trimToNull(raw.commit),
	};
}

function normalizeIntegration(raw) {
	if (!raw || typeof raw !== "object") {
		return null;
	}

	return {
		remote: trimToNull(raw.remote),
		branch: trimToNull(raw.branch),
		targetCommitAtCreation: trimToNull(raw.targetCommitAtCreation),
		createdFromTarget: normalizeBoolean(raw.createdFromTarget),
	};
}

export function normalizeWorktreeMetadata(raw) {
	if (!raw || typeof raw !== "object") {
		return null;
	}

	return {
		schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : null,
		kind: trimToNull(raw.kind),
		name: trimToNull(raw.name),
		branch: trimToNull(raw.branch),
		repoRoot: trimToNull(raw.repoRoot),
		nameWasProvided: normalizeBoolean(raw.nameWasProvided),
		base: normalizeBase(raw.base),
		integration: normalizeIntegration(raw.integration),
	};
}

export function isWorktreeMetadataComplete(metadata) {
	return Boolean(
		metadata &&
			metadata.schemaVersion === 1 &&
			metadata.kind === "piw" &&
			metadata.name &&
			metadata.branch &&
			metadata.repoRoot &&
			metadata.base?.commit &&
			metadata.integration?.remote &&
			metadata.integration?.branch &&
			metadata.integration?.targetCommitAtCreation &&
			typeof metadata.integration?.createdFromTarget === "boolean",
	);
}

function parseMetadataJson(rawValue) {
	const value = trimToNull(rawValue);
	if (!value) {
		return null;
	}

	try {
		return normalizeWorktreeMetadata(JSON.parse(value));
	} catch {
		return null;
	}
}

function metadataMatchesSession(metadata, session) {
	return Boolean(
		metadata &&
			metadata.name === session.name &&
			metadata.branch === session.branch &&
			metadata.repoRoot === session.repoRoot,
	);
}

export function buildWorktreeSessionFromEnv(env = process.env) {
	if (env.PI_WORKTREE_SESSION !== "1") {
		return null;
	}

	const session = {
		name: trimToNull(env.PI_WORKTREE_NAME),
		path: trimToNull(env.PI_WORKTREE_PATH),
		branch: trimToNull(env.PI_WORKTREE_BRANCH),
		repoRoot: trimToNull(env.PI_WORKTREE_REPO_ROOT),
		originalCwd: trimToNull(env.PI_WORKTREE_ORIGINAL_CWD) || process.cwd(),
	};

	if (!session.name || !session.path || !session.branch || !session.repoRoot) {
		return null;
	}

	const metadata = parseMetadataJson(env.PI_WORKTREE_METADATA_JSON);
	const hasMatchingMetadata = metadataMatchesSession(metadata, session);
	const completeMetadata = hasMatchingMetadata && isWorktreeMetadataComplete(metadata);

	return {
		active: true,
		kind: "piw",
		managed: true,
		name: session.name,
		path: session.path,
		branch: session.branch,
		repoRoot: session.repoRoot,
		originalCwd: session.originalCwd,
		nameWasProvided: hasMatchingMetadata ? metadata.nameWasProvided : null,
		metadataComplete: completeMetadata,
		base: hasMatchingMetadata ? metadata.base : null,
		integration: hasMatchingMetadata ? metadata.integration : null,
	};
}
