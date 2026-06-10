import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Input,
	SettingsList,
	Text,
	type Component,
	type Focusable,
	type KeyId,
	type OverlayAnchor,
	type OverlayMargin,
	type SettingItem,
	type SettingsListTheme,
} from "@earendil-works/pi-tui";
import {
	DEFAULT_HUD_SETTINGS,
	HUD_CONTEXT_INDICATORS,
	HUD_MODES,
	HUD_USAGE_DISPLAYS,
	HUD_VISIBILITY_KEYS,
	HUD_VISIBILITY_LABELS,
	VALID_POSITIONS,
} from "../config/hud-settings.js";
import type {
	HudContextIndicator,
	HudMode,
	HudSettings,
	HudUsageDisplay,
	HudVisibility,
	HudVisibilityKey,
} from "../types/hud.js";
import { formatHudSettings } from "../utils/formatters.js";
import { isRecord } from "../utils/records.js";

export function getProjectPath(ctx: ExtensionContext): string {
	return ctx.sessionManager.getCwd() || ctx.cwd;
}

export function readHudSettings(cwd: string): HudSettings {
	let settings = cloneHudSettings(DEFAULT_HUD_SETTINGS);
	for (const path of getSettingsPaths(cwd)) {
		const hud = readHudSettingsObject(path);
		if (hud) settings = normalizeHudSettings(hud, settings);
	}
	return settings;
}

export async function handleHudSettingsCommand(
	args: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const projectPath = getProjectPath(ctx);
	const settings = readHudSettings(projectPath);
	const trimmed = args.trim();
	if (trimmed.length > 0) {
		const updated = updateHudSettingFromArgs(settings, trimmed);
		if (!updated) {
			ctx.ui.notify(getHudSettingsUsage(), "warning");
			return;
		}
		if (trimmed === "visibility") {
			ctx.ui.notify(updated.message, "info");
			return;
		}
		writeProjectHudSettings(projectPath, updated.settings);
		ctx.ui.notify(
			isVisibilityCommand(trimmed)
				? withReloadNotice(updated.message)
				: updated.message,
			isVisibilityCommand(trimmed) ? "warning" : "info",
		);
		return;
	}

	await openHudSettingsModal(ctx, projectPath, settings);
}

export function toShortcutKey(shortcut: string): KeyId | undefined {
	const normalized = normalizeShortcut(shortcut, "");
	return normalized.length > 0 ? (normalized as KeyId) : undefined;
}

function getSettingsPaths(cwd: string): string[] {
	const agentDir =
		process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return [join(agentDir, "settings.json"), join(cwd, ".pi", "settings.json")];
}

function readHudSettingsObject(
	path: string,
): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed) || !isRecord(parsed.hud)) return undefined;
		return parsed.hud;
	} catch {
		return undefined;
	}
}

function normalizeHudSettings(
	input: Record<string, unknown>,
	base: HudSettings,
): HudSettings {
	return {
		mode: normalizeHudMode(input.mode, base.mode),
		position: normalizePosition(input.position, base.position),
		shortcut:
			typeof input.shortcut === "string"
				? normalizeShortcut(input.shortcut, base.shortcut)
				: base.shortcut,
		switchShortcut:
			typeof input.switchShortcut === "string"
				? normalizeShortcut(input.switchShortcut, base.switchShortcut)
				: base.switchShortcut,
		minimizeShortcut:
			typeof input.minimizeShortcut === "string"
				? normalizeShortcut(input.minimizeShortcut, base.minimizeShortcut)
				: base.minimizeShortcut,
		autoCompactWhileStreaming:
			typeof input.autoCompactWhileStreaming === "boolean"
				? input.autoCompactWhileStreaming
				: base.autoCompactWhileStreaming,
		startupNotification:
			typeof input.startupNotification === "boolean"
				? input.startupNotification
				: base.startupNotification,
		usageDisplay: normalizeUsageDisplay(input.usageDisplay, base.usageDisplay),
		contextIndicator: normalizeContextIndicator(
			input.contextIndicator,
			base.contextIndicator,
		),
		expandedWidth: normalizePositiveInteger(
			input.expandedWidth,
			base.expandedWidth,
			20,
			300,
		),
		compactWidth: normalizePositiveInteger(
			input.compactWidth,
			base.compactWidth,
			16,
			60,
		),
		minTerminalWidth: normalizePositiveInteger(
			input.minTerminalWidth,
			base.minTerminalWidth,
			40,
			300,
		),
		margin: normalizeMargin(input.margin, base.margin),
		visibility: normalizeVisibility(input.visibility, base.visibility),
	};
}

function cloneHudSettings(settings: HudSettings): HudSettings {
	return {
		...settings,
		margin: { ...settings.margin },
		visibility: { ...settings.visibility },
	};
}

function normalizeHudMode(value: unknown, fallback: HudMode): HudMode {
	return typeof value === "string" && HUD_MODES.includes(value as HudMode)
		? (value as HudMode)
		: fallback;
}

function normalizeUsageDisplay(
	value: unknown,
	fallback: HudUsageDisplay,
): HudUsageDisplay {
	return typeof value === "string" &&
		HUD_USAGE_DISPLAYS.includes(value as HudUsageDisplay)
		? (value as HudUsageDisplay)
		: fallback;
}

function normalizeContextIndicator(
	value: unknown,
	fallback: HudContextIndicator,
): HudContextIndicator {
	return typeof value === "string" &&
		HUD_CONTEXT_INDICATORS.includes(value as HudContextIndicator)
		? (value as HudContextIndicator)
		: fallback;
}

function normalizeVisibility(
	value: unknown,
	fallback: HudVisibility,
): HudVisibility {
	const visibility = { ...fallback };
	if (!isRecord(value)) return visibility;
	for (const key of HUD_VISIBILITY_KEYS) {
		if (typeof value[key] === "boolean") visibility[key] = value[key];
	}
	return visibility;
}

function normalizePosition(
	value: unknown,
	fallback: OverlayAnchor,
): OverlayAnchor {
	return typeof value === "string" &&
		VALID_POSITIONS.includes(value as OverlayAnchor)
		? (value as OverlayAnchor)
		: fallback;
}

function normalizeShortcut(value: string, fallback: string): string {
	const shortcut = value.trim();
	const parts = shortcut.toLowerCase().split("+");
	const key = parts[parts.length - 1];
	if (key === "enter" || key === "return" || shortcut.toLowerCase() === "alt+m")
		return fallback;
	if (parts.includes("ctrl") && (key === "m" || key === "j")) return fallback;
	return shortcut;
}

function normalizePositiveInteger(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function normalizeMargin(
	value: unknown,
	fallback: OverlayMargin,
): OverlayMargin {
	if (!isRecord(value)) return { ...fallback };
	return {
		top: normalizeMarginValue(value.top, fallback.top),
		right: normalizeMarginValue(value.right, fallback.right),
		bottom: normalizeMarginValue(value.bottom, fallback.bottom),
		left: normalizeMarginValue(value.left, fallback.left),
	};
}

function normalizeMarginValue(
	value: unknown,
	fallback: number | undefined,
): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
		return fallback;
	return Math.min(20, value);
}

function updateHudSettingFromArgs(
	settings: HudSettings,
	args: string,
): { settings: HudSettings; message: string } | undefined {
	const [key, ...valueParts] = args.split(/\s+/);
	const value = valueParts.join(" ").trim();
	if (!key) return undefined;
	if (key === "visibility") {
		if (value.length === 0)
			return { settings, message: formatHudSettings(settings) };
		const [visibilityKey, rawBoolean, ...extra] = valueParts;
		if (
			!visibilityKey ||
			!rawBoolean ||
			extra.length > 0 ||
			!isHudVisibilityKey(visibilityKey)
		)
			return undefined;
		const enabled = parseBoolean(rawBoolean);
		if (enabled === undefined) return undefined;
		return {
			settings: setHudVisibility(settings, visibilityKey, enabled),
			message: formatVisibilityUpdateMessage(visibilityKey, enabled),
		};
	}
	if (value.length === 0) return undefined;
	if (key === "mode") {
		const mode = normalizeHudMode(value, settings.mode);
		if (mode !== value) return undefined;
		return {
			settings: { ...settings, mode },
			message: `HUD mode set to ${mode}.`,
		};
	}
	if (key === "position") {
		const position = normalizePosition(value, settings.position);
		if (position !== value) return undefined;
		return {
			settings: { ...settings, position },
			message: `HUD position set to ${position}. Reopen /hud if it is currently visible.`,
		};
	}
	if (
		key === "shortcut" ||
		key === "switchShortcut" ||
		key === "minimizeShortcut"
	) {
		const shortcut = normalizeShortcut(value, "");
		if (shortcut.length === 0) return undefined;
		return {
			settings: { ...settings, [key]: shortcut },
			message: `HUD ${key} saved. Run /reload for the shortcut registration to change.`,
		};
	}
	if (key === "autoCompactWhileStreaming") {
		const enabled = parseBoolean(value);
		if (enabled === undefined) return undefined;
		return {
			settings: { ...settings, autoCompactWhileStreaming: enabled },
			message: `HUD auto-compact ${enabled ? "enabled" : "disabled"}.`,
		};
	}
	if (key === "startupNotification") {
		const enabled = parseBoolean(value);
		if (enabled === undefined) return undefined;
		return {
			settings: { ...settings, startupNotification: enabled },
			message: `HUD startup notification ${enabled ? "enabled" : "disabled"}.`,
		};
	}
	if (key === "usageDisplay") {
		const usageDisplay = normalizeUsageDisplay(value, settings.usageDisplay);
		if (usageDisplay !== value) return undefined;
		return {
			settings: { ...settings, usageDisplay },
			message: `HUD usage display set to ${usageDisplay}.`,
		};
	}
	if (key === "contextIndicator") {
		const contextIndicator = normalizeContextIndicator(
			value,
			settings.contextIndicator,
		);
		if (contextIndicator !== value) return undefined;
		return {
			settings: { ...settings, contextIndicator },
			message: `HUD context indicator set to ${contextIndicator}.`,
		};
	}
	if (
		key === "expandedWidth" ||
		key === "compactWidth" ||
		key === "minTerminalWidth"
	) {
		const parsed = Number(value);
		if (!Number.isInteger(parsed)) return undefined;
		const updated = { ...settings, [key]: parsed };
		return {
			settings: normalizeHudSettings(updated, settings),
			message: `HUD ${key} set to ${parsed}.`,
		};
	}
	return undefined;
}

type HudSettingsModalEditableId =
	| "mode"
	| "position"
	| "shortcut"
	| "switchShortcut"
	| "minimizeShortcut"
	| "autoCompactWhileStreaming"
	| "startupNotification"
	| "usageDisplay"
	| "contextIndicator"
	| "expandedWidth"
	| "compactWidth"
	| "minTerminalWidth";

type HudSettingsModalActionId =
	| HudSettingsModalEditableId
	| "visibility"
	| "showCurrent"
	| "restoreDefaults"
	| "back";

async function openHudSettingsModal(
	ctx: ExtensionCommandContext,
	projectPath: string,
	settings: HudSettings,
): Promise<void> {
	let current = cloneHudSettings(settings);
	await ctx.ui.custom(
		(tui, theme, _keybindings, done) => {
			const container = new Container();
			container.addChild(
				new Text(theme.fg("accent", theme.bold("HUD Settings")), 1, 1),
			);

			let settingsList: SettingsList;
			let submenuOpen = false;
			const originalVisibility = { ...current.visibility };
			const refreshSettingsList = () => {
				for (const item of createHudSettingsModalItems(
					ctx,
					projectPath,
					theme,
					tui,
					() => current,
					(next) => {
						current = next;
					},
					(open) => {
						submenuOpen = open;
					},
				)) {
					settingsList.updateValue(item.id, item.currentValue);
				}
			};
			const restoreDefaults = () => {
				current = cloneHudSettings(DEFAULT_HUD_SETTINGS);
				writeProjectHudSettings(projectPath, current);
				refreshSettingsList();
				updateVisibilityReloadStatus(ctx, theme, current, originalVisibility);
				ctx.ui.notify(
					"HUD settings restored to defaults. Run /reload if shortcuts or module visibility changed.",
					"info",
				);
				tui.requestRender();
			};

			settingsList = new SettingsList(
				createHudSettingsModalItems(
					ctx,
					projectPath,
					theme,
					tui,
					() => current,
					(next) => {
						current = next;
					},
					(open) => {
						submenuOpen = open;
					},
				),
				16,
				createSettingsListTheme(theme),
				(id, newValue) => {
					const action = id as HudSettingsModalActionId;
					if (action === "back") {
						done(undefined);
						return;
					}
					if (action === "showCurrent") {
						ctx.ui.notify(formatHudSettings(current), "info");
						settingsList.updateValue(action, "open");
						return;
					}
					if (action === "restoreDefaults") {
						restoreDefaults();
						return;
					}
					if (action === "visibility") {
						settingsList.updateValue(action, formatVisibilitySummary(current));
						tui.requestRender();
						return;
					}
					const updated = updateHudSettingFromArgs(
						current,
						`${action} ${newValue}`,
					);
					if (!updated) {
						ctx.ui.notify(
							`Invalid HUD ${formatHudSettingLabel(action)}.`,
							"warning",
						);
						settingsList.updateValue(
							action,
							formatHudSettingValue(current, action),
						);
						tui.requestRender();
						return;
					}
					current = updated.settings;
					writeProjectHudSettings(projectPath, current);
					ctx.ui.notify(getModalUpdateMessage(updated.message), "info");
					settingsList.updateValue(
						action,
						formatHudSettingValue(current, action),
					);
					tui.requestRender();
				},
				() => done(undefined),
			);
			container.addChild(settingsList);
			container.addChild(
				new Text(
					theme.fg(
						"dim",
						"j/k scroll • enter edit/save • r restore • esc back",
					),
					1,
					0,
				),
			);
			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					if (!submenuOpen && (data === "r" || data === "R")) {
						restoreDefaults();
						return;
					}
					settingsList.handleInput?.(data);
					tui.requestRender();
				},
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: 88,
				maxHeight: "80%",
			},
		},
	);
}

function createHudSettingsModalItems(
	ctx: ExtensionCommandContext,
	projectPath: string,
	theme: Theme,
	tui: { requestRender(): void },
	getSettings: () => HudSettings,
	onSettingsChange: (settings: HudSettings) => void,
	onSubmenuStateChange: (open: boolean) => void,
): SettingItem[] {
	const settings = getSettings();
	return [
		{
			id: "mode",
			label: "Mode",
			currentValue: settings.mode,
			values: [...HUD_MODES],
		},
		{
			id: "position",
			label: "Position",
			currentValue: settings.position,
			values: [...VALID_POSITIONS],
		},
		{
			id: "shortcut",
			label: "Shortcut",
			currentValue: settings.shortcut,
			submenu: (currentValue, done) => {
				onSubmenuStateChange(true);
				return createValueInputSubmenu(
					"Shortcut",
					currentValue,
					theme,
					(value) => {
						onSubmenuStateChange(false);
						done(value);
					},
				);
			},
		},
		{
			id: "switchShortcut",
			label: "Switch shortcut",
			currentValue: settings.switchShortcut,
			submenu: (currentValue, done) => {
				onSubmenuStateChange(true);
				return createValueInputSubmenu(
					"Switch shortcut",
					currentValue,
					theme,
					(value) => {
						onSubmenuStateChange(false);
						done(value);
					},
				);
			},
		},
		{
			id: "minimizeShortcut",
			label: "Minimize shortcut",
			currentValue: settings.minimizeShortcut,
			submenu: (currentValue, done) => {
				onSubmenuStateChange(true);
				return createValueInputSubmenu(
					"Minimize shortcut",
					currentValue,
					theme,
					(value) => {
						onSubmenuStateChange(false);
						done(value);
					},
				);
			},
		},
		{
			id: "autoCompactWhileStreaming",
			label: "Auto-compact while streaming",
			currentValue: formatEnabled(settings.autoCompactWhileStreaming),
			values: ["enabled", "disabled"],
		},
		{
			id: "startupNotification",
			label: "Startup notification",
			currentValue: formatEnabled(settings.startupNotification),
			values: ["enabled", "disabled"],
		},
		{
			id: "usageDisplay",
			label: "Usage display",
			currentValue: settings.usageDisplay,
			values: [...HUD_USAGE_DISPLAYS],
		},
		{
			id: "contextIndicator",
			label: "Context indicator",
			currentValue: settings.contextIndicator,
			values: [...HUD_CONTEXT_INDICATORS],
		},
		{
			id: "expandedWidth",
			label: "Expanded width",
			currentValue: String(settings.expandedWidth),
			submenu: (currentValue, done) => {
				onSubmenuStateChange(true);
				return createValueInputSubmenu(
					"Expanded width",
					currentValue,
					theme,
					(value) => {
						onSubmenuStateChange(false);
						done(value);
					},
				);
			},
		},
		{
			id: "compactWidth",
			label: "Compact width",
			currentValue: String(settings.compactWidth),
			submenu: (currentValue, done) => {
				onSubmenuStateChange(true);
				return createValueInputSubmenu(
					"Compact width",
					currentValue,
					theme,
					(value) => {
						onSubmenuStateChange(false);
						done(value);
					},
				);
			},
		},
		{
			id: "minTerminalWidth",
			label: "Min terminal width",
			currentValue: String(settings.minTerminalWidth),
			submenu: (currentValue, done) => {
				onSubmenuStateChange(true);
				return createValueInputSubmenu(
					"Min terminal width",
					currentValue,
					theme,
					(value) => {
						onSubmenuStateChange(false);
						done(value);
					},
				);
			},
		},
		{
			id: "visibility",
			label: "Modules visibility",
			currentValue: formatVisibilitySummary(settings),
			submenu: (_currentValue, done) => {
				onSubmenuStateChange(true);
				return createModulesVisibilityComponent(
					ctx,
					projectPath,
					getSettings(),
					theme,
					tui,
					(selectedValue) => {
						onSubmenuStateChange(false);
						done(selectedValue);
					},
					onSettingsChange,
				);
			},
		},
		{
			id: "showCurrent",
			label: "Show current",
			currentValue: "open",
			values: ["open"],
		},
		{
			id: "restoreDefaults",
			label: "Restore defaults",
			currentValue: "restore",
			values: ["restore"],
		},
		{
			id: "back",
			label: "Back",
			currentValue: "close",
			values: ["close"],
		},
	];
}

function createValueInputSubmenu(
	title: string,
	currentValue: string,
	theme: Theme,
	done: (selectedValue?: string) => void,
): Component & Focusable {
	const input = new Input();
	input.onSubmit = (value) => done(value);
	input.onEscape = () => done(undefined);
	return {
		get focused() {
			return input.focused;
		},
		set focused(value: boolean) {
			input.focused = value;
		},
		render: (width: number) => [
			theme.fg("accent", theme.bold(title)),
			theme.fg("dim", `Current: ${currentValue}`),
			theme.fg("dim", "type replacement • enter save • esc back"),
			...input.render(width),
		],
		invalidate: () => input.invalidate(),
		handleInput: (data: string) => input.handleInput(data),
	};
}

function createModulesVisibilityComponent(
	ctx: ExtensionCommandContext,
	projectPath: string,
	settings: HudSettings,
	theme: Theme,
	tui: { requestRender(): void },
	done: (selectedValue?: string) => void,
	onSettingsChange?: (settings: HudSettings) => void,
): Component {
	let current = settings;
	const originalVisibility = { ...settings.visibility };
	const items: SettingItem[] = [
		...HUD_VISIBILITY_KEYS.map((key) => ({
			id: key,
			label: HUD_VISIBILITY_LABELS[key],
			currentValue: current.visibility[key] ? "enabled" : "disabled",
			values: ["enabled", "disabled"],
		})),
		{
			id: "default",
			label: "Default settings",
			currentValue: "reset",
			values: ["reset"],
			description: "Restore all configurable HUD modules to visible.",
		},
	];
	const container = new Container();
	container.addChild(
		new Text(theme.fg("accent", theme.bold("Modules visibility")), 1, 1),
	);
	const settingsList = new SettingsList(
		items,
		Math.min(items.length + 2, 12),
		createSettingsListTheme(theme),
		(id, newValue) => {
			if (id === "default") {
				current = {
					...current,
					visibility: { ...DEFAULT_HUD_SETTINGS.visibility },
				};
				for (const key of HUD_VISIBILITY_KEYS) {
					settingsList.updateValue(
						key,
						current.visibility[key] ? "enabled" : "disabled",
					);
				}
				writeProjectHudSettings(projectPath, current);
				onSettingsChange?.(current);
				updateVisibilityReloadStatus(ctx, theme, current, originalVisibility);
				tui.requestRender();
				return;
			}
			if (!isHudVisibilityKey(id)) return;
			const enabled = newValue === "enabled";
			current = setHudVisibility(current, id, enabled);
			writeProjectHudSettings(projectPath, current);
			onSettingsChange?.(current);
			updateVisibilityReloadStatus(ctx, theme, current, originalVisibility);
			tui.requestRender();
		},
		() => done(formatVisibilitySummary(current)),
		{ enableSearch: true },
	);
	container.addChild(settingsList);
	return {
		render: (width: number) => container.render(width),
		invalidate: () => container.invalidate(),
		handleInput: (data: string) => {
			settingsList.handleInput?.(data);
			tui.requestRender();
		},
	};
}

function formatEnabled(enabled: boolean): string {
	return enabled ? "enabled" : "disabled";
}

function formatVisibilitySummary(settings: HudSettings): string {
	const enabledKeys = HUD_VISIBILITY_KEYS.filter(
		(key) => settings.visibility[key],
	);
	return enabledKeys.length > 0 ? enabledKeys.join("/") : "none";
}

function formatHudSettingLabel(id: HudSettingsModalEditableId): string {
	switch (id) {
		case "mode":
			return "mode";
		case "position":
			return "position";
		case "shortcut":
			return "shortcut";
		case "switchShortcut":
			return "switch shortcut";
		case "minimizeShortcut":
			return "minimize shortcut";
		case "autoCompactWhileStreaming":
			return "auto-compact setting";
		case "startupNotification":
			return "startup notification setting";
		case "usageDisplay":
			return "usage display";
		case "contextIndicator":
			return "context indicator";
		case "expandedWidth":
			return "expanded width";
		case "compactWidth":
			return "compact width";
		case "minTerminalWidth":
			return "minimum terminal width";
	}
}

function formatHudSettingValue(
	settings: HudSettings,
	id: HudSettingsModalEditableId,
): string {
	switch (id) {
		case "mode":
			return settings.mode;
		case "position":
			return settings.position;
		case "shortcut":
			return settings.shortcut;
		case "switchShortcut":
			return settings.switchShortcut;
		case "minimizeShortcut":
			return settings.minimizeShortcut;
		case "autoCompactWhileStreaming":
			return formatEnabled(settings.autoCompactWhileStreaming);
		case "startupNotification":
			return formatEnabled(settings.startupNotification);
		case "usageDisplay":
			return settings.usageDisplay;
		case "contextIndicator":
			return settings.contextIndicator;
		case "expandedWidth":
			return String(settings.expandedWidth);
		case "compactWidth":
			return String(settings.compactWidth);
		case "minTerminalWidth":
			return String(settings.minTerminalWidth);
	}
}

function updateVisibilityReloadStatus(
	ctx: ExtensionCommandContext,
	theme: Theme,
	settings: HudSettings,
	originalVisibility: HudVisibility,
): void {
	const statusKey = "pi-hud.modules-visibility.reload";
	if (sameVisibility(settings.visibility, originalVisibility)) {
		ctx.ui.setStatus(statusKey, undefined);
		return;
	}
	ctx.ui.setStatus(
		statusKey,
		theme.fg(
			"warning",
			"HUD modules visibility changed. Run /reload to apply.",
		),
	);
}

function sameVisibility(a: HudVisibility, b: HudVisibility): boolean {
	return HUD_VISIBILITY_KEYS.every((key) => a[key] === b[key]);
}

function createSettingsListTheme(theme: Theme): SettingsListTheme {
	return {
		label: (text, selected) =>
			selected ? theme.fg("accent", theme.bold(text)) : text,
		value: (text, selected) =>
			selected ? theme.fg("accent", text) : theme.fg("dim", text),
		description: (text) => theme.fg("dim", text),
		cursor: theme.fg("accent", "›"),
		hint: (text) => theme.fg("dim", text),
	};
}

function isHudVisibilityKey(value: string): value is HudVisibilityKey {
	return HUD_VISIBILITY_KEYS.includes(value as HudVisibilityKey);
}

function isVisibilityCommand(args: string): boolean {
	return args.split(/\s+/)[0] === "visibility";
}

function setHudVisibility(
	settings: HudSettings,
	key: HudVisibilityKey,
	enabled: boolean,
): HudSettings {
	return {
		...settings,
		visibility: { ...settings.visibility, [key]: enabled },
	};
}

function formatVisibilityUpdateMessage(
	key: HudVisibilityKey,
	enabled: boolean,
): string {
	return `HUD visibility ${key} ${enabled ? "enabled" : "disabled"}.`;
}

function getModalUpdateMessage(message: string): string {
	return message.includes("Run /reload") ? message : withReloadNotice(message);
}

function withReloadNotice(message: string): string {
	return `${message} Run /reload for the change to take effect.`;
}

function getHudSettingsUsage(): string {
	return "Usage: /hud-settings mode|position|shortcut|switchShortcut|minimizeShortcut|autoCompactWhileStreaming|startupNotification|usageDisplay|contextIndicator|expandedWidth|compactWidth|minTerminalWidth <value> or visibility [context|project|worktrees|mcps <on|off>]";
}

function parseBoolean(value: string): boolean | undefined {
	const normalized = value.toLowerCase();
	if (["true", "on", "yes", "1", "enabled"].includes(normalized)) return true;
	if (["false", "off", "no", "0", "disabled"].includes(normalized))
		return false;
	return undefined;
}

export function writeProjectHudSettings(cwd: string, hud: HudSettings): void {
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
		mode: settings.mode,
		position: settings.position,
		shortcut: settings.shortcut,
		switchShortcut: settings.switchShortcut,
		minimizeShortcut: settings.minimizeShortcut,
		autoCompactWhileStreaming: settings.autoCompactWhileStreaming,
		startupNotification: settings.startupNotification,
		usageDisplay: settings.usageDisplay,
		contextIndicator: settings.contextIndicator,
		expandedWidth: settings.expandedWidth,
		compactWidth: settings.compactWidth,
		minTerminalWidth: settings.minTerminalWidth,
		margin: settings.margin,
		visibility: { ...settings.visibility },
	};
}
