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
import { Text } from "@earendil-works/pi-tui";
import { HudComponent } from "./components/hud-component.js";
import {
	getSubagentToolLabel,
	parseSubagentMessage,
	parseSubagentResultCounts,
} from "./parsers/subagents.js";
import {
	formatStartupNotificationContent,
	getUnseenReleaseNotes,
	markReleaseNotesShown,
} from "./release-notes/release-notes.js";
import {
	getProjectPath,
	handleHudSettingsCommand,
	readHudSettings,
	toShortcutKey,
} from "./settings/hud-settings.js";
import type {
	ActiveSubagentToolRun,
	AgentStatus,
	HudSettings,
	SubagentRunCounts,
	SubagentStatus,
} from "./types/hud.js";

export default function (pi: ExtensionAPI) {
	let hudHandle: OverlayHandle | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let hudTui: TUI | null = null;
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
	};

	const isCompact = (settings: HudSettings) =>
		manualCompactOverride ??
		(settings.autoCompactWhileStreaming && assistantTurnActive);

	const recalculateSubagentStatus = () => {
		subagentStatus.running = activeSubagentTools.size;
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

		for (const counts of subagentRuns.values()) {
			subagentStatus.running += counts.running;
			subagentStatus.completed += counts.completed;
			subagentStatus.failed += counts.failed;
			subagentStatus.tokens += counts.tokens;
			if (!subagentStatus.activeLabel && counts.activeLabel) {
				subagentStatus.activeLabel = counts.activeLabel;
				subagentStatus.activeStartedAt = counts.activeStartedAt;
			}
		}
		for (const activeRun of activeSubagentTools.values()) {
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

	const showHud = (ctx: ExtensionContext) => {
		if (!ctx.hasUI || hudHandle !== null || opening) return;

		const settings = readHudSettings(getProjectPath(ctx));
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

	pi.registerMessageRenderer(
		"pi-hud-notification",
		(message, _options, theme) => {
			const lines = String(message.content).split("\n");
			const rendered = [theme.fg("warning", "[Pi-Hud notifications]")];
			for (const line of lines) rendered.push(`  ${line}`);
			return new Text(rendered.join("\n"), 0, 0);
		},
	);

	const notifySessionStart = (event: unknown, ctx: ExtensionContext) => {
		if (!ctx.hasUI || isCLICommand()) return;
		const settings = currentHudSettings ?? readHudSettings(getProjectPath(ctx));
		if (!settings.startupNotification) return;
		if (getSessionStartReason(event) === "reload") return;
		const releaseNotes = getUnseenReleaseNotes();
		pi.sendMessage({
			customType: "pi-hud-notification",
			content: formatStartupNotificationContent(settings, releaseNotes),
			display: true,
		});
		if (releaseNotes) markReleaseNotesShown(releaseNotes.version);
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
		activeSubagentTools.set(event.toolCallId, {
			label: getSubagentToolLabel(event.args),
			startedAt: Date.now(),
		});
		recalculateSubagentStatus();
		requestHudRender();
	});

	pi.on("tool_execution_end", (event) => {
		if (event.toolName !== "subagent") return;
		if (activeSubagentTools.delete(event.toolCallId)) {
			const resultCounts = parseSubagentResultCounts(event.result);
			if (resultCounts) {
				completedSubagentToolRuns += resultCounts.completed;
				failedSubagentToolRuns += resultCounts.failed;
			} else if (event.isError) failedSubagentToolRuns++;
			else completedSubagentToolRuns++;
		}
		recalculateSubagentStatus();
		requestHudRender();
	});

	pi.on("session_start", (event, ctx) => {
		showHud(ctx);
		notifySessionStart(event, ctx);
	});

	pi.on("session_shutdown", () => {
		hideHud();
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
