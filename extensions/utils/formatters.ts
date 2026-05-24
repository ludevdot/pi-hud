import { HUD_VISIBILITY_KEYS } from "../config/hud-settings.js";
import type { HudSettings } from "../types/hud.js";

export function formatHudSettings(settings: HudSettings): string {
	const visibility = HUD_VISIBILITY_KEYS.map(
		(key) => `${key}:${settings.visibility[key] ? "on" : "off"}`,
	).join(", ");
	return `HUD position=${settings.position}, shortcut=${settings.shortcut || "disabled"}, minimizeShortcut=${settings.minimizeShortcut || "disabled"}, autoCompactWhileStreaming=${settings.autoCompactWhileStreaming}, startupNotification=${settings.startupNotification}, expandedWidth=${settings.expandedWidth}, compactWidth=${settings.compactWidth}, minTerminalWidth=${settings.minTerminalWidth}, visibility=${visibility}`;
}

export function formatShortcut(shortcut: string): string {
	const trimmed = shortcut.trim();
	return trimmed.length > 0 ? trimmed : "disabled";
}

export function formatElapsed(startedAt: number | undefined): string {
	const elapsedSeconds = startedAt
		? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
		: 0;
	const minutes = Math.floor(elapsedSeconds / 60);
	const seconds = elapsedSeconds % 60;
	return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function formatNumber(value: number): string {
	if (value < 1000) return value.toLocaleString();
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}
