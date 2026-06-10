import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	OverlayHandle,
	OverlayOptions,
	TUI,
} from "@earendil-works/pi-tui";
import { HudComponent } from "./components/hud-component.js";
import { HudFooter } from "./components/hud-footer.js";
import {
	getSubagentToolActiveItems,
	getSubagentToolLabel,
	parseSubagentMessage,
	parseSubagentResultCounts,
} from "./parsers/subagents.js";
import {
	formatStartupNotificationContent,
	getUnseenFooterModeTipVersion,
	getUnseenReleaseNotes,
	markStartupNotificationsShown,
} from "./release-notes/release-notes.js";
import {
	getProjectPath,
	handleHudSettingsCommand,
	readHudSettings,
	toShortcutKey,
	writeProjectHudSettings,
} from "./settings/hud-settings.js";
import type {
	ActiveSubagentToolRun,
	AgentStatus,
	HudMode,
	HudSettings,
	SubagentRunCounts,
	SubagentStatus,
} from "./types/hud.js";

export default function (pi: ExtensionAPI) {
	let hudHandle: OverlayHandle | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let hudTui: TUI | null = null;
	let footerTui: TUI | null = null;
	let footerActive = false;
	let generation = 0;
	let opening = false;
	let assistantTurnActive = false;
	let manualCompactOverride: boolean | undefined;
	let currentHudSettings: HudSettings | undefined;
	const agentStatus: AgentStatus = { running: 0, completed: 0 };
	const subagentStatus: SubagentStatus = {
		running: 0,
		completed: 0,
		failed: 0,
		seen: false,
		tokens: 0,
		activeItems: [],
	};
	const subagentRuns = new Map<string, SubagentRunCounts>();
	const activeSubagentTools = new Map<string, ActiveSubagentToolRun>();
	let completedSubagentToolRuns = 0;
	let failedSubagentToolRuns = 0;

	const clearRefreshTimer = () => {
		if (refreshTimer === null) return;
		clearInterval(refreshTimer);
		refreshTimer = null;
	};

	const resetHudState = () => {
		clearRefreshTimer();
		hudHandle = null;
		hudTui = null;
		opening = false;
		currentHudSettings = undefined;
	};

	const hideHud = () => {
		generation++;
		const handle = hudHandle;
		resetHudState();
		handle?.hide();
	};

	const requestHudRender = () => {
		hudTui?.requestRender();
		footerTui?.requestRender();
	};

	const isCompact = (settings: HudSettings) =>
		manualCompactOverride ??
		(settings.autoCompactWhileStreaming && assistantTurnActive);

	const recalculateSubagentStatus = () => {
		subagentStatus.running = 0;
		subagentStatus.completed = completedSubagentToolRuns;
		subagentStatus.failed = failedSubagentToolRuns;
		subagentStatus.seen =
			subagentRuns.size > 0 ||
			activeSubagentTools.size > 0 ||
			completedSubagentToolRuns > 0 ||
			failedSubagentToolRuns > 0;
		subagentStatus.activeLabel = undefined;
		subagentStatus.activeStartedAt = undefined;
		subagentStatus.tokens = 0;
		subagentStatus.activeItems = [];

		for (const counts of subagentRuns.values()) {
			subagentStatus.running += counts.running;
			subagentStatus.completed += counts.completed;
			subagentStatus.failed += counts.failed;
			subagentStatus.tokens += counts.tokens;
			subagentStatus.activeItems.push(...counts.activeItems);
			if (!subagentStatus.activeLabel && counts.activeLabel) {
				subagentStatus.activeLabel = counts.activeLabel;
				subagentStatus.activeStartedAt = counts.activeStartedAt;
			}
		}
		for (const activeRun of activeSubagentTools.values()) {
			subagentStatus.running += activeRun.activeItems.length;
			subagentStatus.activeItems.push(...activeRun.activeItems);
			if (!subagentStatus.activeLabel) {
				subagentStatus.activeLabel = activeRun.label;
				subagentStatus.activeStartedAt = activeRun.startedAt;
			}
		}
	};

	const updateSubagentStatusFromMessage = (message: unknown): boolean => {
		const parsed = parseSubagentMessage(message);
		if (!parsed) return false;
		subagentRuns.set(parsed.requestId, parsed.counts);
		recalculateSubagentStatus();
		return true;
	};

	const startRefreshTimer = (currentGeneration: number, tui: TUI) => {
		clearRefreshTimer();
		refreshTimer = setInterval(() => {
			if (currentGeneration !== generation || hudHandle === null) {
				clearRefreshTimer();
				return;
			}
			tui.requestRender();
		}, 1000);
	};

	const showHud = (ctx: ExtensionContext, settingsOverride?: HudSettings) => {
		if (!ctx.hasUI || hudHandle !== null || opening) return;

		const settings = settingsOverride ?? readHudSettings(getProjectPath(ctx));
		currentHudSettings = settings;
		const currentGeneration = ++generation;
		opening = true;
		try {
			ctx.ui
				.custom<void>(
					(tui, theme, _keybindings, done) => {
						hudTui = tui;
						return new HudComponent(
							pi,
							ctx,
							tui,
							theme,
							done,
							subagentStatus,
							settings,
							() => isCompact(settings),
						);
					},
					{
						overlay: true,
						overlayOptions: () =>
							createHudOverlayOptions(settings, isCompact(settings)),
						onHandle: (handle) => {
							if (currentGeneration !== generation) {
								handle.hide();
								return;
							}
							hudHandle = handle;
							opening = false;
							if (hudTui !== null) {
								startRefreshTimer(currentGeneration, hudTui);
							}
						},
					},
				)
				.catch(() => {
					if (currentGeneration !== generation) return;
					resetHudState();
				});
		} catch {
			if (currentGeneration === generation) resetHudState();
		}
	};

	const showFooter = (ctx: ExtensionContext, settings: HudSettings) => {
		if (!ctx.hasUI) return;
		hideHud();
		currentHudSettings = settings;
		footerActive = true;
		ctx.ui.setFooter((tui, theme, footerData) => {
			footerTui = tui;
			return new HudFooter(
				pi,
				ctx,
				tui,
				theme,
				footerData,
				subagentStatus,
				settings,
			);
		});
	};

	const hideFooter = (ctx: ExtensionContext) => {
		if (!ctx.hasUI || !footerActive) return;
		ctx.ui.setFooter(undefined);
		footerActive = false;
		footerTui = null;
	};

	const applyHudMode = (ctx: ExtensionContext, settings: HudSettings) => {
		const previousMode = currentHudSettings?.mode;
		if (previousMode !== undefined && previousMode !== settings.mode) {
			manualCompactOverride = undefined;
		}
		currentHudSettings = settings;
		if (settings.mode === "footer") {
			showFooter(ctx, settings);
			return;
		}
		hideFooter(ctx);
		showHud(ctx, settings);
	};

	const toggleHud = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (hudHandle !== null || opening) {
			hideHud();
			return;
		}
		showHud(ctx);
	};

	const toggleCompact = () => {
		const settings = currentHudSettings ?? readHudSettings(process.cwd());
		manualCompactOverride = !isCompact(settings);
		requestHudRender();
	};

	const switchHudMode = (ctx: ExtensionContext) => {
		const projectPath = getProjectPath(ctx);
		const currentSettings = currentHudSettings ?? readHudSettings(projectPath);
		const mode: HudMode =
			currentSettings.mode === "footer" ? "overlay" : "footer";
		const settings = { ...currentSettings, mode };
		writeProjectHudSettings(projectPath, settings);
		applyHudMode(ctx, settings);
		ctx.ui.notify(`HUD mode set to ${mode}.`, "info");
	};

	const notifySessionStart = (event: unknown, ctx: ExtensionContext) => {
		if (!ctx.hasUI || isCLICommand()) return;
		const settings = currentHudSettings ?? readHudSettings(getProjectPath(ctx));
		if (!settings.startupNotification) return;
		if (getSessionStartReason(event) === "reload") return;
		const releaseNotes = getUnseenReleaseNotes();
		const footerModeTipVersion = getUnseenFooterModeTipVersion();
		ctx.ui.notify(
			formatStartupNotificationContent(
				settings,
				releaseNotes,
				footerModeTipVersion !== undefined,
			),
			"info",
		);
		if (releaseNotes || footerModeTipVersion) {
			markStartupNotificationsShown({
				releaseNotesVersion: releaseNotes?.version,
				footerModeTipVersion,
			});
		}
	};

	pi.on("agent_start", () => {
		agentStatus.running++;
		requestHudRender();
	});

	pi.on("agent_end", () => {
		agentStatus.running = Math.max(0, agentStatus.running - 1);
		agentStatus.completed++;
		requestHudRender();
	});

	pi.on("turn_start", () => {
		if (assistantTurnActive) return;
		assistantTurnActive = true;
		requestHudRender();
	});

	pi.on("turn_end", () => {
		if (!assistantTurnActive) return;
		assistantTurnActive = false;
		requestHudRender();
	});

	pi.on("model_select", () => {
		requestHudRender();
	});

	pi.on("thinking_level_select", () => {
		requestHudRender();
	});

	pi.on("message_start", (event) => {
		if (updateSubagentStatusFromMessage(event.message)) requestHudRender();
	});

	pi.on("message_update", (event) => {
		if (updateSubagentStatusFromMessage(event.message)) requestHudRender();
	});

	pi.on("message_end", (event) => {
		if (updateSubagentStatusFromMessage(event.message)) requestHudRender();
	});

	pi.on("tool_execution_start", (event) => {
		if (event.toolName !== "subagent") return;
		const startedAt = Date.now();
		activeSubagentTools.set(event.toolCallId, {
			label: getSubagentToolLabel(event.args),
			startedAt,
			activeItems: getSubagentToolActiveItems(
				event.args,
				event.toolCallId,
				startedAt,
			),
		});
		recalculateSubagentStatus();
		requestHudRender();
	});

	pi.on("tool_execution_end", (event) => {
		if (event.toolName !== "subagent") return;
		const activeRun = activeSubagentTools.get(event.toolCallId);
		if (activeRun) {
			activeSubagentTools.delete(event.toolCallId);
			const resultCounts = parseSubagentResultCounts(event.result);
			if (resultCounts) {
				completedSubagentToolRuns += resultCounts.completed;
				failedSubagentToolRuns += resultCounts.failed;
			} else if (event.isError)
				failedSubagentToolRuns += activeRun.activeItems.length;
			else completedSubagentToolRuns += activeRun.activeItems.length;
		}
		recalculateSubagentStatus();
		requestHudRender();
	});

	pi.on("session_start", (event, ctx) => {
		const settings = readHudSettings(getProjectPath(ctx));
		applyHudMode(ctx, settings);
		notifySessionStart(event, ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		hideHud();
		if (ctx) hideFooter(ctx);
		agentStatus.running = 0;
		agentStatus.completed = 0;
		assistantTurnActive = false;
		manualCompactOverride = undefined;
		subagentRuns.clear();
		activeSubagentTools.clear();
		completedSubagentToolRuns = 0;
		failedSubagentToolRuns = 0;
		recalculateSubagentStatus();
	});

	pi.registerCommand("hud", {
		description: "Toggle the session HUD overlay",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			toggleHud(ctx);
		},
	});

	pi.registerCommand("hud-settings", {
		description: "Configure the session HUD",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			await handleHudSettingsCommand(args, ctx);
		},
	});

	pi.registerCommand("hud-mode", {
		description: "Switch Pi HUD between overlay and footer mode",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const projectPath = getProjectPath(ctx);
			const currentSettings =
				currentHudSettings ?? readHudSettings(projectPath);
			const mode = parseHudModeCommand(args, currentSettings.mode);
			if (!mode) {
				ctx.ui.notify(getHudModeUsage(), "warning");
				return;
			}
			const settings = { ...currentSettings, mode };
			writeProjectHudSettings(projectPath, settings);
			applyHudMode(ctx, settings);
			ctx.ui.notify(`HUD mode set to ${mode}.`, "info");
		},
	});

	const startupSettings = readHudSettings(process.cwd());
	const startupShortcut = toShortcutKey(startupSettings.shortcut);
	if (startupShortcut) {
		pi.registerShortcut(startupShortcut, {
			description: "Toggle the session HUD",
			handler: (ctx: ExtensionContext) => {
				toggleHud(ctx);
			},
		});
	}
	const startupSwitchShortcut = toShortcutKey(startupSettings.switchShortcut);
	if (startupSwitchShortcut) {
		pi.registerShortcut(startupSwitchShortcut, {
			description: "Switch Pi HUD between overlay and footer mode",
			handler: (ctx: ExtensionContext) => {
				switchHudMode(ctx);
			},
		});
	}
	const startupMinimizeShortcut = toShortcutKey(
		startupSettings.minimizeShortcut,
	);
	if (startupMinimizeShortcut) {
		pi.registerShortcut(startupMinimizeShortcut, {
			description: "Minimize or expand the session HUD",
			handler: () => {
				toggleCompact();
			},
		});
	}
}

function parseHudModeCommand(
	args: string,
	currentMode: HudMode,
): HudMode | undefined {
	const trimmed = args.trim().toLowerCase();
	if (trimmed.length === 0)
		return currentMode === "footer" ? "overlay" : "footer";
	if (trimmed === "footer" || trimmed === "overlay") return trimmed;
	return undefined;
}

function getHudModeUsage(): string {
	return "Usage: /hud-mode [footer|overlay]";
}

function isCLICommand(): boolean {
	const args = process.argv.slice(2);
	const optionsWithValue = new Set([
		"-e",
		"--extension",
		"-m",
		"--model",
		"--provider",
		"--system-prompt",
		"--append-system-prompt",
		"-t",
		"--tools",
	]);
	let skipNext = false;
	for (const arg of args) {
		if (skipNext) {
			skipNext = false;
			continue;
		}
		if (arg === "--") return false;
		if (arg.startsWith("--") && arg.includes("=")) continue;
		if (optionsWithValue.has(arg)) {
			skipNext = true;
			continue;
		}
		if (arg.startsWith("-")) continue;
		return true;
	}
	return false;
}

function getSessionStartReason(event: unknown): string | undefined {
	return typeof event === "object" &&
		event !== null &&
		"reason" in event &&
		typeof event.reason === "string"
		? event.reason
		: undefined;
}

function createHudOverlayOptions(
	settings: HudSettings,
	compact: boolean,
): OverlayOptions {
	return {
		anchor: settings.position,
		width: compact ? settings.compactWidth : settings.expandedWidth,
		maxHeight: "100%",
		margin: settings.margin,
		visible: (termWidth) => termWidth >= settings.minTerminalWidth,
		nonCapturing: true,
	};
}
