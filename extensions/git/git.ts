import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export interface GitWorktree {
	path: string;
	label: string;
	current: boolean;
}

export function getGitBranch(cwd: string): string | null {
	const gitPaths = findGitPaths(cwd);
	if (!gitPaths) return null;
	const result = spawnSync("git", ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"], {
		cwd: gitPaths.repoDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const branch = result.status === 0 ? result.stdout.trim() : "";
	return branch || null;
}

export function getGitWorktrees(cwd: string): GitWorktree[] {
	const gitPaths = findGitPaths(cwd);
	if (!gitPaths) return [];
	const result = spawnSync("git", ["--no-optional-locks", "worktree", "list", "--porcelain"], {
		cwd: gitPaths.repoDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) return [];
	return parseGitWorktreeList(result.stdout, gitPaths.repoDir);
}

function parseGitWorktreeList(output: string, currentRepoDir: string): GitWorktree[] {
	return output
		.trim()
		.split(/\n\s*\n/)
		.map((block) => {
			const lines = block.split("\n");
			const path = getPorcelainValue(lines, "worktree");
			if (!path || !isNearCurrentRepo(path, currentRepoDir)) return null;
			const branchRef = getPorcelainValue(lines, "branch");
			const label = branchRef?.replace(/^refs\/heads\//, "") ?? "detached";
			return { path, label, current: resolve(path) === resolve(currentRepoDir) };
		})
		.filter((entry): entry is GitWorktree => entry !== null);
}

function isNearCurrentRepo(path: string, currentRepoDir: string): boolean {
	return dirname(resolve(path)) === dirname(resolve(currentRepoDir));
}

function getPorcelainValue(lines: string[], key: string): string | null {
	const prefix = `${key} `;
	const line = lines.find((candidate) => candidate.startsWith(prefix));
	return line ? line.slice(prefix.length).trim() : null;
}

function findGitPaths(cwd: string): { repoDir: string; headPath: string } | null {
	let dir = cwd;
	while (true) {
		const gitPath = join(dir, ".git");
		if (existsSync(gitPath)) {
			try {
				const stat = statSync(gitPath);
				if (stat.isFile()) {
					const content = readFileSync(gitPath, "utf8").trim();
					if (content.startsWith("gitdir: ")) {
						const gitDir = resolve(dir, content.slice(8).trim());
						const headPath = join(gitDir, "HEAD");
						if (!existsSync(headPath)) return null;
						return { repoDir: dir, headPath };
					}
				} else if (stat.isDirectory()) {
					const headPath = join(gitPath, "HEAD");
					if (!existsSync(headPath)) return null;
					return { repoDir: dir, headPath };
				}
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}
