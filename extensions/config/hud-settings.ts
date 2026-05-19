import type { OverlayAnchor } from "@earendil-works/pi-tui";
import type { HudSettings } from "../types/hud.js";

export const VALID_POSITIONS: OverlayAnchor[] = ["center", "top-left", "top-right", "bottom-left", "bottom-right", "top-center", "bottom-center", "left-center", "right-center"];

export const DEFAULT_HUD_SETTINGS: HudSettings = {
	position: "top-right",
	shortcut: "f2",
	minimizeShortcut: "ctrl+h",
	autoCompactWhileStreaming: true,
	expandedWidth: 42,
	compactWidth: 26,
	minTerminalWidth: 90,
	margin: { top: 1, right: 1, bottom: 1 },
};
