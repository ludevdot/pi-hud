import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { getGitBranch } from "./git/git.js";
import { getMcpAdapterInfo } from "./mcp/mcp-adapter.js";
import { getSubagentToolLabel, parseSubagentMessage, parseSubagentResultCounts } from "./parsers/subagents.js";
import { getProjectPath, handleHudSettingsCommand, readHudSettings, toShortcutKey } from "./settings/hud-settings.js";
import type { ActiveSubagentToolRun, AgentStatus, HudSettings, SessionStats, SubagentRunCounts, SubagentStatus } from "./types/hud.js";
import { formatElapsed, formatNumber, formatShortcut } from "./utils/formatters.js";

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
	const subagentStatus: SubagentStatus = { running: 0, completed: 0, failed: 0, seen: false, tokens: 0 };
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

	const isCompact = (settings: HudSettings) => manualCompactOverride ?? (settings.autoCompactWhileStreaming && assistantTurnActive);

	const recalculateSubagentStatus = () => {
		subagentStatus.running = activeSubagentTools.size;
		subagentStatus.completed = completedSubagentToolRuns;
		subagentStatus.failed = failedSubagentToolRuns;
		subagentStatus.seen = subagentRuns.size > 0 || activeSubagentTools.size > 0 || completedSubagentToolRuns > 0 || failedSubagentToolRuns > 0;
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
				.custom<void>((tui, theme, _keybindings, done) => {
					hudTui = tui;
					return new HudComponent(pi, ctx, tui, theme, done, subagentStatus, settings, () => isCompact(settings));
				}, {
					overlay: true,
					overlayOptions: () => createHudOverlayOptions(settings, isCompact(settings)),
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
				})
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

	pi.on("session_start", (_event, ctx) => {
		showHud(ctx);
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
	const startupMinimizeShortcut = toShortcutKey(startupSettings.minimizeShortcut);
	if (startupMinimizeShortcut) {
		pi.registerShortcut(startupMinimizeShortcut, {
			description: "Minimize or expand the session HUD",
			handler: () => {
				toggleCompact();
			},
		});
	}

}

class HudComponent implements Component {
	constructor(
		private pi: ExtensionAPI,
		private ctx: ExtensionContext,
		private tui: TUI,
		private theme: Theme,
		private done: () => void,
		private subagentStatus: SubagentStatus,
		private settings: HudSettings,
		private isCompact: () => boolean,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}

		if (matchesKey(data, "r")) {
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const stats = this.computeStats();
		const model = this.ctx.model;
		const sessionName = this.pi.getSessionName() ?? this.ctx.sessionManager.getSessionName() ?? "New session";
		const sessionId = this.ctx.sessionManager.getSessionId();
		const projectPath = this.ctx.sessionManager.getCwd() || this.ctx.cwd;
		const gitBranch = getGitBranch(projectPath);
		const mcpAdapter = getMcpAdapterInfo(this.pi, projectPath);
		const contextUsage = this.ctx.getContextUsage?.();
		const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
		const contextTokens = contextUsage?.tokens ?? stats.totalTokens;
		const contextPercent = contextUsage?.percent ?? (contextWindow > 0 ? (contextTokens / contextWindow) * 100 : null);
		const innerWidth = Math.max(1, width - 2);
		const lines: string[] = [];
		const modelLabel = model?.name ?? model?.id ?? "No model";
		const contextLabel = contextPercent === null ? "ctx unknown" : `${contextPercent.toFixed(1)}% ctx`;
		const headerSummary = formatHeaderSummary(modelLabel, contextLabel, innerWidth);

		if (this.isCompact()) {
			this.pushTopBorder(lines, innerWidth, "HUD");
			this.pushLine(lines, innerWidth, this.theme.fg("accent", headerSummary));
			this.pushLine(lines, innerWidth, `${this.theme.fg("warning", `${this.subagentStatus.running} run`)} · ${this.theme.fg("error", `${this.subagentStatus.failed} err`)}`);
			if (this.subagentStatus.activeLabel) {
				this.pushLine(lines, innerWidth, this.theme.fg("accent", `[·] ${this.subagentStatus.activeLabel}`));
			}
			this.pushBottomBorder(lines, innerWidth);
			return lines;
		}

		this.pushTopBorder(lines, innerWidth, "Pi HUD");
		this.pushLine(lines, innerWidth, this.theme.fg("accent", headerSummary));
		this.pushLine(lines, innerWidth, this.theme.fg("dim", sessionName));
		this.pushLine(lines, innerWidth, this.theme.fg("dim", sessionId));
		this.pushLine(lines, innerWidth, this.theme.fg("dim", `${formatNumber(contextWindow)} ctx window`));

		this.pushSection(lines, innerWidth, "Subagents");
		this.pushLine(
			lines,
			innerWidth,
			`${this.theme.fg("warning", `${this.subagentStatus.running} run`)} · ${this.theme.fg("success", `${this.subagentStatus.completed} done`)} · ${this.theme.fg("error", `${this.subagentStatus.failed} err`)}`,
		);
		if (this.subagentStatus.activeLabel) {
			this.pushLine(lines, innerWidth, this.theme.fg("accent", `[·] ${this.subagentStatus.activeLabel}`));
			this.pushLine(lines, innerWidth, this.theme.fg("dim", `  ↳ ◷ ${formatElapsed(this.subagentStatus.activeStartedAt)} ${formatNumber(this.subagentStatus.tokens)} ctx`));
		} else if (this.subagentStatus.seen) {
			this.pushLine(lines, innerWidth, this.theme.fg("dim", `subagents ${this.subagentStatus.running} run · ${this.subagentStatus.completed} done`));
		} else {
			this.pushLine(lines, innerWidth, this.theme.fg("dim", "subagents idle"));
		}

		this.pushSection(lines, innerWidth, "Context");
		this.pushLine(lines, innerWidth, contextTokens === null ? "tokens unknown" : `${formatNumber(contextTokens)} tokens`);
		this.pushLine(lines, innerWidth, contextPercent === null ? "usage unknown" : `${contextPercent.toFixed(1)}% used`);
		this.pushLine(lines, innerWidth, `$${stats.cost.toFixed(4)} spent`);
		this.pushLine(lines, innerWidth, this.theme.fg("dim", `in ${formatNumber(stats.inputTokens)} out ${formatNumber(stats.outputTokens)}`));
		this.pushLine(lines, innerWidth, this.theme.fg("dim", `cache ${formatNumber(stats.cacheReadTokens)}/${formatNumber(stats.cacheWriteTokens)}`));

		this.pushSection(lines, innerWidth, "Project");
		this.pushLine(lines, innerWidth, projectPath);
		if (gitBranch) {
			this.pushLine(lines, innerWidth, this.theme.fg("dim", `branch ${gitBranch}`));
		}

		if (mcpAdapter.available) {
			this.pushSection(lines, innerWidth, "Configured MCPs");
			if (mcpAdapter.servers.length === 0) {
				this.pushLine(lines, innerWidth, this.theme.fg("dim", "adapter installed"));
			} else {
				for (const server of mcpAdapter.servers) {
					this.pushLine(lines, innerWidth, server);
				}
			}
		}

		this.pushSection(lines, innerWidth, "Help");
		this.pushLine(lines, innerWidth, this.theme.fg("dim", `/hud or ${formatShortcut(this.settings.shortcut)} hide/show`));
		this.pushLine(lines, innerWidth, this.theme.fg("dim", `${formatShortcut(this.settings.minimizeShortcut)} minimize/expand`));
		this.pushBottomBorder(lines, innerWidth);

		return lines;
	}

	invalidate(): void {}

	private computeStats(): SessionStats {
		const stats: SessionStats = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 0,
			cost: 0,
			assistantMessages: 0,
		};

		for (const entry of this.ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;

			const message = entry.message as AssistantMessage;
			stats.inputTokens += message.usage.input || 0;
			stats.outputTokens += message.usage.output || 0;
			stats.cacheReadTokens += message.usage.cacheRead || 0;
			stats.cacheWriteTokens += message.usage.cacheWrite || 0;
			stats.totalTokens += message.usage.totalTokens || 0;
			stats.cost += message.usage.cost.total || 0;
			stats.assistantMessages++;
		}

		return stats;
	}

	private pushTopBorder(lines: string[], innerWidth: number, title: string): void {
		const border = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
		lines.push(border);
		this.pushLine(lines, innerWidth, this.theme.fg("accent", this.theme.bold(` ${title}`)));
		this.pushSeparator(lines, innerWidth);
	}

	private pushBottomBorder(lines: string[], innerWidth: number): void {
		lines.push(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
	}

	private pushSeparator(lines: string[], innerWidth: number): void {
		lines.push(this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`));
	}

	private pushSection(lines: string[], innerWidth: number, title: string): void {
		this.pushBlank(lines, innerWidth);
		this.pushLine(lines, innerWidth, this.theme.fg("accent", title));
	}

	private pushBlank(lines: string[], innerWidth: number): void {
		this.pushLine(lines, innerWidth, "");
	}

	private pushLine(lines: string[], innerWidth: number, text: string): void {
		const content = truncateToWidth(` ${text}`, innerWidth, "…", true);
		lines.push(this.theme.fg("border", "│") + content + this.theme.fg("border", "│"));
	}
}

function formatHeaderSummary(modelLabel: string, contextLabel: string, innerWidth: number): string {
	const contentWidth = Math.max(1, innerWidth - 1);
	const separator = " · ";
	const maxModelWidth = contentWidth - separator.length - contextLabel.length;
	if (maxModelWidth <= 0) return contextLabel;
	return `${truncateToWidth(modelLabel, maxModelWidth, "…", false)}${separator}${contextLabel}`;
}

function createHudOverlayOptions(settings: HudSettings, compact: boolean): OverlayOptions {
	return {
		anchor: settings.position,
		width: compact ? settings.compactWidth : settings.expandedWidth,
		maxHeight: "100%",
		margin: settings.margin,
		visible: (termWidth) => termWidth >= settings.minTerminalWidth,
		nonCapturing: true,
	};
}

