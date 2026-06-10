import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import { getGitBranch, getGitWorktrees } from "../git/git.js";
import { getMcpAdapterInfo } from "../mcp/mcp-adapter.js";
import type {
	HudSettings,
	SessionStats,
	SubagentStatus,
} from "../types/hud.js";
import {
	formatElapsed,
	formatNumber,
	formatShortcut,
} from "../utils/formatters.js";
import { getModelLabel, getThinkingLabel } from "../utils/model-status.js";

export class HudComponent implements Component {
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
		const sessionName =
			this.pi.getSessionName() ??
			this.ctx.sessionManager.getSessionName() ??
			"New session";
		const sessionId = this.ctx.sessionManager.getSessionId();
		const projectPath = this.ctx.sessionManager.getCwd() || this.ctx.cwd;
		const gitBranch = this.settings.visibility.project
			? getGitBranch(projectPath)
			: undefined;
		const mcpAdapter =
			this.settings.visibility.mcps && !this.isCompact()
				? getMcpAdapterInfo(this.pi, projectPath)
				: undefined;
		const contextUsage = this.ctx.getContextUsage?.();
		const contextWindow =
			contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
		const contextTokens = contextUsage?.tokens ?? stats.totalTokens;
		const contextPercent =
			contextUsage?.percent ??
			(contextWindow > 0 ? (contextTokens / contextWindow) * 100 : null);
		const innerWidth = Math.max(1, width - 2);
		const lines: string[] = [];
		const modelLabel = getModelLabel(model);
		const thinkingLabel = getThinkingLabel(this.pi, model);
		const contextLabel =
			contextPercent === null
				? "ctx unknown"
				: formatContextUsageLabel(contextPercent, "ctx");
		const headerSummary = formatHeaderSummary(
			modelLabel,
			contextLabel,
			innerWidth,
			{
				formatModel: (value) => this.theme.fg("accent", value),
				formatContext: (value) =>
					formatContextUsage(this.theme, value, contextPercent),
			},
		);

		if (this.isCompact()) {
			const projectTitle = this.settings.visibility.project
				? formatProjectTitle(projectPath)
				: null;
			this.pushTopBorder(lines, innerWidth, "HUD");
			if (projectTitle) {
				this.pushLine(
					lines,
					innerWidth,
					`Project: ${this.theme.fg("success", projectTitle)}`,
				);
			}
			if (this.settings.visibility.context) {
				this.pushLine(lines, innerWidth, headerSummary);
			}
			this.pushLine(
				lines,
				innerWidth,
				`${this.theme.fg("warning", `${this.subagentStatus.running} run`)} · ${this.theme.fg("error", `${this.subagentStatus.failed} err`)}`,
			);
			if (this.subagentStatus.activeLabel) {
				this.pushLine(
					lines,
					innerWidth,
					this.theme.fg("accent", `[·] ${this.subagentStatus.activeLabel}`),
				);
			}
			this.pushBottomBorder(lines, innerWidth);
			return lines;
		}

		this.pushTopBorder(lines, innerWidth, "Pi HUD");
		if (this.settings.visibility.context) {
			this.pushLine(lines, innerWidth, headerSummary);
		}
		this.pushLine(lines, innerWidth, this.theme.fg("dim", sessionName));
		this.pushLine(lines, innerWidth, this.theme.fg("dim", sessionId));
		if (this.settings.visibility.context) {
			this.pushLine(
				lines,
				innerWidth,
				this.theme.fg("dim", `${formatNumber(contextWindow)} ctx window`),
			);
		}

		this.pushSection(lines, innerWidth, "Subagents");
		this.pushLine(
			lines,
			innerWidth,
			`${this.theme.fg("warning", `${this.subagentStatus.running} run`)} · ${this.theme.fg("success", `${this.subagentStatus.completed} done`)} · ${this.theme.fg("error", `${this.subagentStatus.failed} err`)}`,
		);
		if (this.subagentStatus.activeItems.length > 0) {
			this.pushLine(
				lines,
				innerWidth,
				this.theme.fg("accent", `[·] ${this.subagentStatus.running} running`),
			);
			for (const item of this.subagentStatus.activeItems.slice(0, 5)) {
				const elapsed =
					item.startedAt !== undefined
						? ` · ◷ ${formatElapsed(item.startedAt)}`
						: "";
				const tokens =
					typeof item.tokens === "number"
						? ` · ${formatNumber(item.tokens)} ctx`
						: "";
				this.pushLine(
					lines,
					innerWidth,
					this.theme.fg("dim", `  • ${item.label}${elapsed}${tokens}`),
				);
			}
			if (this.subagentStatus.activeItems.length > 5) {
				this.pushLine(
					lines,
					innerWidth,
					this.theme.fg(
						"dim",
						`  +${this.subagentStatus.activeItems.length - 5} more`,
					),
				);
			}
		} else if (this.subagentStatus.activeLabel) {
			this.pushLine(
				lines,
				innerWidth,
				this.theme.fg("accent", `[·] ${this.subagentStatus.activeLabel}`),
			);
			this.pushLine(
				lines,
				innerWidth,
				this.theme.fg(
					"dim",
					`  ↳ ◷ ${formatElapsed(this.subagentStatus.activeStartedAt)} ${formatNumber(this.subagentStatus.tokens)} ctx`,
				),
			);
		} else if (this.subagentStatus.seen) {
			this.pushLine(
				lines,
				innerWidth,
				this.theme.fg(
					"dim",
					`subagents ${this.subagentStatus.running} run · ${this.subagentStatus.completed} done`,
				),
			);
		} else {
			this.pushLine(lines, innerWidth, this.theme.fg("dim", "subagents idle"));
		}

		if (this.settings.visibility.context) {
			this.pushSection(lines, innerWidth, "Context");
			this.pushLine(
				lines,
				innerWidth,
				contextTokens === null
					? "tokens unknown"
					: `${formatNumber(contextTokens)} tokens`,
			);
			this.pushLine(
				lines,
				innerWidth,
				contextPercent === null
					? this.theme.fg("dim", "usage unknown")
					: formatContextUsage(
							this.theme,
							formatContextUsageLabel(contextPercent, "used"),
							contextPercent,
						),
			);
			if (thinkingLabel) {
				this.pushLine(lines, innerWidth, this.theme.fg("dim", thinkingLabel));
			}
			this.pushLine(lines, innerWidth, `$${stats.cost.toFixed(4)} spent`);
			this.pushLine(
				lines,
				innerWidth,
				this.theme.fg(
					"dim",
					`in ${formatNumber(stats.inputTokens)} out ${formatNumber(stats.outputTokens)}`,
				),
			);
			this.pushLine(
				lines,
				innerWidth,
				this.theme.fg(
					"dim",
					`cache ${formatNumber(stats.cacheReadTokens)}/${formatNumber(stats.cacheWriteTokens)}`,
				),
			);
		}

		if (this.settings.visibility.project) {
			this.pushSection(lines, innerWidth, "Project");
			this.pushLine(lines, innerWidth, projectPath);
			if (gitBranch) {
				this.pushLine(
					lines,
					innerWidth,
					this.theme.fg("dim", `branch ${gitBranch}`),
				);
			}
		}
		const gitWorktrees = this.settings.visibility.worktrees
			? getGitWorktrees(projectPath)
			: [];
		if (gitWorktrees.length > 1) {
			this.pushSection(lines, innerWidth, "Git worktrees");
			for (const worktree of gitWorktrees.slice(0, 5)) {
				const marker = worktree.current ? "*" : "•";
				this.pushLine(
					lines,
					innerWidth,
					`${marker} ${worktree.label} · ${worktree.path}`,
				);
			}
			if (gitWorktrees.length > 5) {
				this.pushLine(
					lines,
					innerWidth,
					this.theme.fg("dim", `+${gitWorktrees.length - 5} more`),
				);
			}
		}

		if (mcpAdapter?.available) {
			this.pushSection(lines, innerWidth, "Configured MCPs");
			if (mcpAdapter.servers.length === 0) {
				this.pushLine(
					lines,
					innerWidth,
					this.theme.fg("dim", "adapter installed"),
				);
			} else {
				for (const server of mcpAdapter.servers) {
					this.pushLine(lines, innerWidth, server);
				}
			}
		}

		this.pushSection(lines, innerWidth, "Help");
		this.pushLine(
			lines,
			innerWidth,
			this.theme.fg(
				"dim",
				`/hud or ${formatShortcut(this.settings.shortcut)} hide/show`,
			),
		);
		this.pushLine(
			lines,
			innerWidth,
			this.theme.fg(
				"dim",
				`${formatShortcut(this.settings.switchShortcut)} switch mode`,
			),
		);
		this.pushLine(
			lines,
			innerWidth,
			this.theme.fg(
				"dim",
				`${formatShortcut(this.settings.minimizeShortcut)} minimize/expand`,
			),
		);
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
			if (entry.type !== "message" || entry.message.role !== "assistant")
				continue;

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

	private pushTopBorder(
		lines: string[],
		innerWidth: number,
		title: string,
	): void {
		const border = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
		lines.push(border);
		this.pushLine(
			lines,
			innerWidth,
			this.theme.fg("accent", this.theme.bold(` ${title}`)),
		);
		this.pushSeparator(lines, innerWidth);
	}

	private pushBottomBorder(lines: string[], innerWidth: number): void {
		lines.push(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
	}

	private pushSeparator(lines: string[], innerWidth: number): void {
		lines.push(this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`));
	}

	private pushSection(
		lines: string[],
		innerWidth: number,
		title: string,
	): void {
		this.pushBlank(lines, innerWidth);
		this.pushLine(lines, innerWidth, this.theme.fg("accent", title));
	}

	private pushBlank(lines: string[], innerWidth: number): void {
		this.pushLine(lines, innerWidth, "");
	}

	private pushLine(lines: string[], innerWidth: number, text: string): void {
		const content = truncateToWidth(` ${text}`, innerWidth, "…", true);
		lines.push(
			this.theme.fg("border", "│") + content + this.theme.fg("border", "│"),
		);
	}
}

function formatProjectTitle(projectPath: string): string | null {
	const folderName = basename(projectPath.trim());
	if (!folderName) return null;
	return `${folderName[0]?.toLocaleUpperCase() ?? ""}${folderName.slice(1)}`;
}

function formatContextUsageLabel(
	contextPercent: number,
	unit: "ctx" | "used",
): string {
	const warningMarker = contextPercent >= 50 && contextPercent < 70 ? " !" : "";
	return `${contextPercent.toFixed(1)}% ${unit}${warningMarker}`;
}

function formatContextUsage(
	theme: Theme,
	text: string,
	contextPercent: number | null,
): string {
	const emphasized = contextPercent !== null && contextPercent >= 85;
	const content = emphasized ? theme.bold(text) : text;
	return theme.fg(getContextUsageColor(contextPercent), content);
}

function getContextUsageColor(
	contextPercent: number | null,
): Parameters<Theme["fg"]>[0] {
	if (contextPercent === null) return "dim";
	if (contextPercent >= 95) return "error";
	if (contextPercent >= 50) return "warning";
	return "accent";
}

function formatHeaderSummary(
	modelLabel: string,
	contextLabel: string,
	innerWidth: number,
	formatters: {
		formatModel: (value: string) => string;
		formatContext: (value: string) => string;
	},
): string {
	const contentWidth = Math.max(1, innerWidth - 1);
	const separator = " · ";
	const maxModelWidth = contentWidth - separator.length - contextLabel.length;
	if (maxModelWidth <= 0) return formatters.formatContext(contextLabel);
	return `${formatters.formatModel(truncateToWidth(modelLabel, maxModelWidth, "…", false))}${separator}${formatters.formatContext(contextLabel)}`;
}
