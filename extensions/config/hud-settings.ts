import type { OverlayAnchor } from "@earendil-works/pi-tui";
import type { HudSettings, HudVisibilityKey } from "../types/hud.js";

export const VALID_POSITIONS = [
	"center",
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
	"top-center",
	"bottom-center",
	"left-center",
	"right-center",
] as const satisfies readonly OverlayAnchor[];

export const HUD_VISIBILITY_KEYS = [
	"context",
	"project",
	"worktrees",
	"mcps",
] as const satisfies readonly HudVisibilityKey[];

export const DEFAULT_HUD_VISIBILITY = {
	context: true,
	project: true,
	worktrees: true,
	mcps: true,
} satisfies HudSettings["visibility"];

export const HUD_VISIBILITY_LABELS = {
	context: "Context",
	project: "Project path + Branches",
	worktrees: "Worktrees",
	mcps: "Configured MCPs",
} satisfies Record<HudVisibilityKey, string>;

export const DEFAULT_HUD_SETTINGS: HudSettings = {
	position: "top-right",
	shortcut: "ctrl+shift+h",
	minimizeShortcut: "ctrl+h",
	autoCompactWhileStreaming: true,
	startupNotification: true,
	expandedWidth: 42,
	compactWidth: 26,
	minTerminalWidth: 90,
	margin: { top: 1, right: 1, bottom: 1 },
	visibility: { ...DEFAULT_HUD_VISIBILITY },
};
