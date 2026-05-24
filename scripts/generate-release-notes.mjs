#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
);
const version = String(packageJson.version ?? "").trim();
if (!version) {
	console.error("package.json version is required to generate release notes.");
	process.exit(1);
}

function git(args) {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const previousTag = git(["tag", "--list", "v-*-RELEASE", "--sort=-creatordate"])
	.split("\n")
	.map((tag) => tag.trim())
	.find(Boolean);

const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
const rawCommits = git(["log", range, "--pretty=format:%h%x00%s%x1e"]);
const commits = rawCommits
	.split("\x1e")
	.map((entry) => entry.trim())
	.filter(Boolean)
	.map((entry) => {
		const [hash, subject = ""] = entry.split("\x00");
		return { hash, subject };
	});

const outputPath = join(root, "assets", "release-notes.json");
const notes = {
	version,
	previousTag,
	generatedAt: new Date().toISOString(),
	commits,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(notes, null, "\t")}\n`, "utf8");
console.log(
	`Generated assets/release-notes.json for ${version} with ${commits.length} commit(s).`,
);
