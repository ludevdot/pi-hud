import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId, OverlayAnchor, OverlayMargin } from "@earendil-works/pi-tui";
import { DEFAULT_HUD_SETTINGS, VALID_POSITIONS } from "../config/hud-settings.js";
import type { HudSettings } from "../types/hud.js";
import { formatHudSettings } from "../utils/formatters.js";
import { isRecord } from "../utils/records.js";

export function getProjectPath(ctx: ExtensionContext): string {
	return ctx.sessionManager.getCwd() || ctx.cwd;
}

export function readHudSettings(cwd: string): HudSettings {
	let settings = { ...DEFAULT_HUD_SETTINGS, margin: { ...DEFAULT_HUD_SETTINGS.margin } };
	for (const path of getSettingsPaths(cwd)) {
		const hud = readHudSettingsObject(path);
		if (hud) settings = normalizeHudSettings(hud, settings);
	}
	return settings;
}

export async function handleHudSettingsCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const projectPath = getProjectPath(ctx);
	const settings = readHudSettings(projectPath);
	const trimmed = args.trim();
	if (trimmed.length > 0) {
		const updated = updateHudSettingFromArgs(settings, trimmed);
		if (!updated) {
			ctx.ui.notify("Usage: /hud-settings position|shortcut|minimizeShortcut|autoCompactWhileStreaming|expandedWidth|compactWidth|minTerminalWidth <value>", "warning");
			return;
		}
		writeProjectHudSettings(projectPath, updated.settings);
		ctx.ui.notify(updated.message, "info");
		return;
	}

	const choice = await ctx.ui.select("HUD settings", ["position", "shortcut", "minimizeShortcut", "autoCompactWhileStreaming", "expandedWidth", "compactWidth", "minTerminalWidth", "show current"]);
	if (!choice) return;
	if (choice === "show current") {
		ctx.ui.notify(formatHudSettings(settings), "info");
		return;
	}

	if (choice === "position") {
		const position = await ctx.ui.select("HUD position", VALID_POSITIONS);
		if (!position) return;
		const updated = { ...settings, position: position as OverlayAnchor };
		writeProjectHudSettings(projectPath, updated);
		ctx.ui.notify(`HUD position set to ${position}. Reopen /hud if it is currently visible.`, "info");
		return;
	}

	if (choice === "shortcut" || choice === "minimizeShortcut") {
		const shortcut = await ctx.ui.input(`HUD ${choice}`, settings[choice]);
		if (shortcut === undefined) return;
		const normalizedShortcut = normalizeShortcut(shortcut, "");
		if (normalizedShortcut.length === 0) {
			ctx.ui.notify("Invalid HUD shortcut. Do not use enter, return, alt+m, ctrl+m, ctrl+shift+m, ctrl+j, or ctrl+shift+j because they conflict with Pi or terminal input keys.", "warning");
			return;
		}
		const updated = { ...settings, [choice]: normalizedShortcut };
		writeProjectHudSettings(projectPath, updated);
		ctx.ui.notify(`HUD ${choice} saved. Run /reload for the shortcut registration to change.`, "info");
		return;
	}

	if (choice === "autoCompactWhileStreaming") {
		const value = await ctx.ui.select("Auto-compact while streaming", ["enabled", "disabled"]);
		if (!value) return;
		const updated = { ...settings, autoCompactWhileStreaming: value === "enabled" };
		writeProjectHudSettings(projectPath, updated);
		ctx.ui.notify(`HUD auto-compact ${value}.`, "info");
		return;
	}

	const numericChoice = choice as "expandedWidth" | "compactWidth" | "minTerminalWidth";
	const value = await ctx.ui.input(`HUD ${numericChoice}`, String(settings[numericChoice]));
	if (value === undefined) return;
	const updated = updateHudSettingFromArgs(settings, `${numericChoice} ${value}`);
	if (!updated) {
		ctx.ui.notify(`Invalid value for ${numericChoice}.`, "warning");
		return;
	}
	writeProjectHudSettings(projectPath, updated.settings);
	ctx.ui.notify(updated.message, "info");
}

export function toShortcutKey(shortcut: string): KeyId | undefined {
	const normalized = normalizeShortcut(shortcut, "");
	return normalized.length > 0 ? (normalized as KeyId) : undefined;
}

function getSettingsPaths(cwd: string): string[] {
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return [join(agentDir, "settings.json"), join(cwd, ".pi", "settings.json")];
}

function readHudSettingsObject(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed) || !isRecord(parsed.hud)) return undefined;
		return parsed.hud;
	} catch {
		return undefined;
	}
}

function normalizeHudSettings(input: Record<string, unknown>, base: HudSettings): HudSettings {
	return {
		position: normalizePosition(input.position, base.position),
		shortcut: typeof input.shortcut === "string" ? normalizeShortcut(input.shortcut, base.shortcut) : base.shortcut,
		minimizeShortcut: typeof input.minimizeShortcut === "string" ? normalizeShortcut(input.minimizeShortcut, base.minimizeShortcut) : base.minimizeShortcut,
		autoCompactWhileStreaming: typeof input.autoCompactWhileStreaming === "boolean" ? input.autoCompactWhileStreaming : base.autoCompactWhileStreaming,
		expandedWidth: normalizePositiveInteger(input.expandedWidth, base.expandedWidth, 20, 300),
		compactWidth: normalizePositiveInteger(input.compactWidth, base.compactWidth, 16, 60),
		minTerminalWidth: normalizePositiveInteger(input.minTerminalWidth, base.minTerminalWidth, 40, 300),
		margin: normalizeMargin(input.margin, base.margin),
	};
}

function normalizePosition(value: unknown, fallback: OverlayAnchor): OverlayAnchor {
	return typeof value === "string" && VALID_POSITIONS.includes(value as OverlayAnchor) ? (value as OverlayAnchor) : fallback;
}

function normalizeShortcut(value: string, fallback: string): string {
	const shortcut = value.trim();
	const parts = shortcut.toLowerCase().split("+");
	const key = parts[parts.length - 1];
	if (key === "enter" || key === "return" || shortcut.toLowerCase() === "alt+m") return fallback;
	if (parts.includes("ctrl") && (key === "m" || key === "j")) return fallback;
	return shortcut;
}

function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function normalizeMargin(value: unknown, fallback: OverlayMargin): OverlayMargin {
	if (!isRecord(value)) return { ...fallback };
	return {
		top: normalizeMarginValue(value.top, fallback.top),
		right: normalizeMarginValue(value.right, fallback.right),
		bottom: normalizeMarginValue(value.bottom, fallback.bottom),
		left: normalizeMarginValue(value.left, fallback.left),
	};
}

function normalizeMarginValue(value: unknown, fallback: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fallback;
	return Math.min(20, value);
}

function updateHudSettingFromArgs(settings: HudSettings, args: string): { settings: HudSettings; message: string } | undefined {
	const [key, ...valueParts] = args.split(/\s+/);
	const value = valueParts.join(" ").trim();
	if (!key || value.length === 0) return undefined;
	if (key === "position") {
		const position = normalizePosition(value, settings.position);
		if (position !== value) return undefined;
		return { settings: { ...settings, position }, message: `HUD position set to ${position}. Reopen /hud if it is currently visible.` };
	}
	if (key === "shortcut" || key === "minimizeShortcut") {
		const shortcut = normalizeShortcut(value, "");
		if (shortcut.length === 0) return undefined;
		return { settings: { ...settings, [key]: shortcut }, message: `HUD ${key} saved. Run /reload for the shortcut registration to change.` };
	}
	if (key === "autoCompactWhileStreaming") {
		const enabled = parseBoolean(value);
		if (enabled === undefined) return undefined;
		return { settings: { ...settings, autoCompactWhileStreaming: enabled }, message: `HUD auto-compact ${enabled ? "enabled" : "disabled"}.` };
	}
	if (key === "expandedWidth" || key === "compactWidth" || key === "minTerminalWidth") {
		const parsed = Number(value);
		if (!Number.isInteger(parsed)) return undefined;
		const updated = { ...settings, [key]: parsed };
		return { settings: normalizeHudSettings(updated, settings), message: `HUD ${key} set to ${parsed}.` };
	}
	return undefined;
}

function parseBoolean(value: string): boolean | undefined {
	const normalized = value.toLowerCase();
	if (["true", "on", "yes", "1", "enabled"].includes(normalized)) return true;
	if (["false", "off", "no", "0", "disabled"].includes(normalized)) return false;
	return undefined;
}

function writeProjectHudSettings(cwd: string, hud: HudSettings): void {
	const path = join(cwd, ".pi", "settings.json");
	let root: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (isRecord(parsed)) root = { ...parsed };
		} catch {
			root = {};
		}
	}
	root.hud = serializeHudSettings(hud);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(root, null, "\t")}\n`, "utf8");
}

function serializeHudSettings(settings: HudSettings): Record<string, unknown> {
	return {
		position: settings.position,
		shortcut: settings.shortcut,
		minimizeShortcut: settings.minimizeShortcut,
		autoCompactWhileStreaming: settings.autoCompactWhileStreaming,
		expandedWidth: settings.expandedWidth,
		compactWidth: settings.compactWidth,
		minTerminalWidth: settings.minTerminalWidth,
		margin: settings.margin,
	};
}
