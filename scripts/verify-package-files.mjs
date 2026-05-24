#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

const requiredPaths = [
	"assets/pi-hud.jpeg",
	"assets/hud.png",
	"assets/release-notes.json",
	"extensions/config/hud-settings.ts",
	"extensions/git/git.ts",
	"extensions/hud.ts",
	"extensions/mcp/mcp-adapter.ts",
	"extensions/parsers/subagents.ts",
	"extensions/settings/hud-settings.ts",
	"extensions/types/hud.ts",
	"skills/release/SKILL.md",
	"scripts/generate-release-notes.mjs",
	"extensions/utils/formatters.ts",
	"extensions/utils/records.ts",
	"CHANGELOG.md",
	"RELEASING.md",
	"LICENSE",
	"README.md",
	"package.json",
];

const missing = requiredPaths.filter((relativePath) => {
	const absolutePath = join(root, relativePath);
	return !existsSync(absolutePath) || !statSync(absolutePath).isFile();
});

if (missing.length > 0) {
	console.error("pi-hud package is missing required Pi resources:");
	for (const relativePath of missing) {
		console.error(`- ${relativePath}`);
	}
	console.error("\nRefusing to pack/publish an incomplete npm package.");
	process.exit(1);
}

console.log(
	`pi-hud package resource check passed (${requiredPaths.length} files).`,
);
