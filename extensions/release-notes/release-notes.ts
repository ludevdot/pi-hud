import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	HudSettings,
	ReleaseNotes,
	ReleaseNotesState,
} from "../types/hud.js";
import { formatShortcut } from "../utils/formatters.js";
import { isRecord } from "../utils/records.js";

const releaseNotesPath = fileURLToPath(
	new URL("../../assets/release-notes.json", import.meta.url),
);

export function formatStartupNotificationContent(
	settings: HudSettings,
	releaseNotes: ReleaseNotes | undefined,
): string {
	const lines = [
		`/hud or ${formatShortcut(settings.shortcut)} toggle to show or hide HUD`,
	];
	if (!releaseNotes) return lines.join("\n");

	lines.push("", `Latest release ${releaseNotes.version}`);
	const commitsToShow = releaseNotes.commits.slice(0, 5);
	for (const commit of commitsToShow) {
		lines.push(`${commit.hash} ${commit.subject}`);
	}
	const hiddenCommitCount = releaseNotes.commits.length - commitsToShow.length;
	if (hiddenCommitCount > 0) lines.push(`… and ${hiddenCommitCount} more`);
	return lines.join("\n");
}

export function getUnseenReleaseNotes(): ReleaseNotes | undefined {
	const releaseNotes = readReleaseNotes();
	if (!releaseNotes) return undefined;
	const state = readReleaseNotesState();
	return state.lastReleaseNotesShown === releaseNotes.version
		? undefined
		: releaseNotes;
}

export function readReleaseNotes(): ReleaseNotes | undefined {
	if (!existsSync(releaseNotesPath)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(releaseNotesPath, "utf8"));
		if (!isRecord(parsed) || typeof parsed.version !== "string") {
			return undefined;
		}
		const commits = Array.isArray(parsed.commits)
			? parsed.commits.flatMap((commit) => {
					if (
						!isRecord(commit) ||
						typeof commit.hash !== "string" ||
						typeof commit.subject !== "string"
					) {
						return [];
					}
					return [{ hash: commit.hash, subject: commit.subject }];
				})
			: [];
		return {
			version: parsed.version,
			previousTag:
				typeof parsed.previousTag === "string" ? parsed.previousTag : undefined,
			generatedAt:
				typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined,
			commits,
		};
	} catch {
		return undefined;
	}
}

export function readReleaseNotesState(): ReleaseNotesState {
	const path = getReleaseNotesStatePath();
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return {};
		return {
			lastReleaseNotesShown:
				typeof parsed.lastReleaseNotesShown === "string"
					? parsed.lastReleaseNotesShown
					: undefined,
		};
	} catch {
		return {};
	}
}

export function markReleaseNotesShown(version: string): void {
	const path = getReleaseNotesStatePath();
	const state = { ...readReleaseNotesState(), lastReleaseNotesShown: version };
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`, "utf8");
	} catch {
		// Startup notifications are best-effort; never block Pi startup on state.
	}
}

export function getReleaseNotesStatePath(): string {
	const agentDir =
		process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(agentDir, "state", "pi-hud.json");
}
