import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ContextUsage,
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import {
	getCapabilities,
	hyperlink,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { basename } from "node:path";
import {
	getGitBranch,
	getGitStatus,
	getGitWorktrees,
	type GitStatus,
} from "../git/git.js";
import { getMcpAdapterInfo } from "../mcp/mcp-adapter.js";
import {
	readOpenSpecStatus,
	type OpenSpecStatus,
} from "../workflow/openspec-status.js";
import type {
	HudSettings,
	SessionStats,
	SubagentStatus,
} from "../types/hud.js";
import { formatNumber } from "../utils/formatters.js";
import { getModelLabel, getThinkingLabel } from "../utils/model-status.js";

type FooterFactory = NonNullable<
	Parameters<ExtensionUIContext["setFooter"]>[0]
>;
type FooterData = Parameters<FooterFactory>[2];
type FooterTextStyle = {
	text: string;
	color?: Parameters<Theme["fg"]>[0];
	bold?: boolean;
	hyperlinkUrl?: string;
};

const PI_HUD_DOCS_LABEL = "🔗 docs";
const PI_HUD_DOCS_URL = "https://github.com/ludevdot/pi-hud#readme";

export class HudFooter implements Component {
	private unsubscribeBranchChange?: () => void;

	constructor(
		private pi: ExtensionAPI,
		private ctx: ExtensionContext,
		private tui: TUI,
		private theme: Theme,
		private footerData: FooterData,
		private subagentStatus: SubagentStatus,
		private settings: HudSettings,
	) {
		this.unsubscribeBranchChange = this.footerData.onBranchChange(() =>
			this.tui.requestRender(),
		);
	}

	dispose(): void {
		this.unsubscribeBranchChange?.();
		this.unsubscribeBranchChange = undefined;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const projectPath = this.ctx.sessionManager.getCwd() || this.ctx.cwd;
		const projectName = formatProjectTitle(projectPath) ?? "Project";
		const branch = this.footerData.getGitBranch() ?? getGitBranch(projectPath);
		const gitStatus = getGitStatus(projectPath);
		const branchLabel = formatBranchLabel(branch, gitStatus);
		const stats = computeStats(this.ctx);
		const contextUsage = this.ctx.getContextUsage?.();
		const contextWindow =
			contextUsage?.contextWindow ?? this.ctx.model?.contextWindow ?? 0;
		const contextTokens = resolveContextTokens(contextUsage, stats);
		const contextPercent = resolveContextPercent(
			contextUsage,
			contextTokens,
			contextWindow,
		);
		const contextIndicatorSegment = formatContextIndicatorSegment(
			contextPercent,
			this.settings.contextIndicator,
		);
		const modelLabel = getModelLabel(this.ctx.model);
		const thinkingLabel = getThinkingLabel(this.pi, this.ctx.model);
		const contextLine = formatContextLine({
			usageDisplay: this.settings.usageDisplay,
			contextTokens,
			contextIndicatorText: contextIndicatorSegment.text,
			contextWindow,
			modelLabel,
			thinkingLabel,
			cost: stats.cost,
		});
		const worktree = getCurrentWorktreePath(projectPath);
		const extensionStatuses = [
			...this.footerData.getExtensionStatuses().values(),
		].filter((status) => shouldShowExtensionStatus(status));
		const liveMcpLabel = extensionStatuses
			.map((status) => parseMcpExtensionStatus(status))
			.find((status): status is string => status !== null);
		const nonMcpExtensionStatuses = extensionStatuses.filter(
			(status) => parseMcpExtensionStatus(status) === null,
		);
		const mcpAdapter = getMcpAdapterInfo(this.pi, projectPath);
		const mcpLabel = liveMcpLabel ?? formatMcpCount(mcpAdapter);
		const subagentSegment = this.subagentStatus.seen
			? ` │ Subagents: ${this.subagentStatus.running} run · ${this.subagentStatus.completed} done · ${this.subagentStatus.failed} err`
			: "";
		const statusSegment =
			nonMcpExtensionStatuses.length > 0
				? ` │ Status: ${nonMcpExtensionStatuses.join(" │ ")}`
				: "";
		const sessionId = getSessionId(this.ctx);
		const docsHintStyle = formatDocsHintStyle();
		const openSpecStatus = readOpenSpecStatus(projectPath);
		const helpOrFlowLine = openSpecStatus
			? formatFlowLine(
					openSpecStatus,
					PI_HUD_DOCS_LABEL,
					statusSegment,
					safeWidth,
				)
			: `▏ ❔ Help     /hud-mode │ /hud-settings │ ${PI_HUD_DOCS_LABEL}${statusSegment}`;

		const mcpOrWorktreeLine = `▏ 🔌 MCP      ${mcpLabel} │ Worktree: ${worktree}`;

		return [
			this.renderLine(
				`▏ 📁 Project  ${projectName} ${projectPath}${branchLabel}`,
				safeWidth,
			),
			this.renderLine(
				`${contextLine}${subagentSegment}`,
				safeWidth,
				contextIndicatorSegment.styles,
			),
			this.renderLine(mcpOrWorktreeLine, safeWidth),
			this.renderLine(
				helpOrFlowLine,
				safeWidth,
				docsHintStyle ? [docsHintStyle] : [],
			),
			this.renderLine(formatSessionResumeLine(sessionId), safeWidth),
		];
	}

	private renderLine(
		raw: string,
		width: number,
		styles: FooterTextStyle[] = [],
	): string {
		const truncated = truncateToWidth(raw, width, "…", true);
		const padded = padToVisibleWidth(truncated, width);
		return this.theme.bg(
			"customMessageBg",
			applyTextStyles(padded, styles, this.theme),
		);
	}
}

function resolveContextTokens(
	contextUsage: ContextUsage | undefined,
	stats: SessionStats,
): number | null {
	if (contextUsage === undefined) return stats.totalTokens;
	if (contextUsage.tokens === undefined) return stats.totalTokens;
	return contextUsage.tokens;
}

function resolveContextPercent(
	contextUsage: ContextUsage | undefined,
	contextTokens: number | null,
	contextWindow: number,
): number | null {
	if (contextUsage !== undefined && contextUsage.percent !== undefined) {
		return contextUsage.percent;
	}
	return contextWindow > 0 && contextTokens !== null
		? (contextTokens / contextWindow) * 100
		: null;
}

function formatContextLine(options: {
	usageDisplay: HudSettings["usageDisplay"];
	contextTokens: number | null;
	contextIndicatorText: string;
	contextWindow: number;
	modelLabel: string;
	thinkingLabel: string | null;
	cost: number;
}): string {
	const contextUsage = `${options.contextIndicatorText} used/${formatNumber(options.contextWindow)} ctx`;
	if (options.usageDisplay === "subscription") {
		const thinkingSuffix = options.thinkingLabel
			? ` / ${formatSubscriptionThinkingLabel(options.thinkingLabel)}`
			: "";
		return `▏ 🧠 Context  ${contextUsage} │ ${options.modelLabel}${thinkingSuffix}`;
	}

	const thinkingSegment = options.thinkingLabel
		? ` │ ${options.thinkingLabel}`
		: "";
	return `▏ 🧠 Context  ${formatContextTokens(options.contextTokens)} tokens │ ${contextUsage} │ ${options.modelLabel}${thinkingSegment} │ $${options.cost.toFixed(5)} spent`;
}

function formatSubscriptionThinkingLabel(thinkingLabel: string): string {
	return thinkingLabel.replace(/^thinking:\s*/, "");
}

function formatDocsHintStyle(): FooterTextStyle | null {
	return getCapabilities().hyperlinks
		? { text: PI_HUD_DOCS_LABEL, hyperlinkUrl: PI_HUD_DOCS_URL }
		: null;
}

function formatFlowLine(
	status: OpenSpecStatus,
	docsLabel: string,
	statusSegment: string,
	width: number,
): string {
	const suffix = ` │ ${docsLabel}${statusSegment}`;
	const prefix = "▏ 🧭 Flow     ";
	const available = Math.max(
		1,
		width - visibleWidth(prefix) - visibleWidth(suffix),
	);
	return `${prefix}${formatOpenSpecSegment(status, available)}${suffix}`;
}

function formatOpenSpecSegment(status: OpenSpecStatus, width: number): string {
	const taskSegment =
		status.completedTasks !== undefined && status.totalTasks !== undefined
			? ` · tasks ${status.completedTasks}/${status.totalTasks}`
			: "";
	const full = `📐 SDD ${status.changeId}${taskSegment} · next: ${status.nextAction}`;
	if (visibleWidth(full) <= width) return full;

	const medium = `📐 SDD ${status.changeId} · ${status.nextAction}`;
	if (visibleWidth(medium) <= width) return medium;

	return `📐 SDD · ${status.nextAction}`;
}

function getSessionId(ctx: ExtensionContext): string {
	return (
		(ctx.sessionManager as { getSessionId?: () => string }).getSessionId?.() ??
		"unknown"
	);
}

function formatSessionResumeLine(sessionId: string): string {
	if (sessionId === "unknown") {
		return "▏ 🔁 Session  resume unavailable";
	}
	return `▏ 🔁 Session  resume: pi --session ${sessionId}`;
}

function computeStats(ctx: ExtensionContext): SessionStats {
	const stats: SessionStats = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		cost: 0,
		assistantMessages: 0,
	};

	for (const entry of ctx.sessionManager.getBranch()) {
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

function formatProjectTitle(projectPath: string): string | null {
	const folderName = basename(projectPath.trim());
	if (!folderName) return null;
	return `${folderName[0]?.toLocaleUpperCase() ?? ""}${folderName.slice(1)}`;
}

function formatContextTokens(tokens: number | null): string {
	return tokens === null ? "unknown" : formatNumber(tokens);
}

function formatBranchLabel(branch: string | null, status: GitStatus): string {
	if (!branch) return ` ${formatGitStatusIcon(status)}`;
	const suffix = status === "conflict" ? "!" : status === "dirty" ? "*" : "";
	return ` ${formatGitStatusIcon(status)} (${branch}${suffix})`;
}

function formatGitStatusIcon(status: GitStatus): string {
	if (status === "conflict") return "🔴";
	if (status === "dirty") return "🟡";
	return "🟢";
}

function formatContextIndicatorSegment(
	percent: number | null,
	indicator: HudSettings["contextIndicator"],
): { text: string; styles: FooterTextStyle[] } {
	if (indicator === "bar") return formatContextBarSegment(percent);
	const iconSegment = formatContextIconSegment(percent);
	return { text: iconSegment.text, styles: [iconSegment] };
}

function formatContextIconSegment(percent: number | null): FooterTextStyle {
	if (percent === null) return { text: "unknown", color: "dim" };
	const icon = getContextUsageIcon(percent);
	return {
		text: `${icon} ${percent.toFixed(1)}%`,
		color: getContextUsageColor(percent),
		bold: percent >= 85,
	};
}

function formatContextBarSegment(percent: number | null): {
	text: string;
	styles: FooterTextStyle[];
} {
	const barWidth = 20;
	const filledCount =
		percent === null
			? 0
			: Math.max(0, Math.min(barWidth, Math.round((percent / 100) * barWidth)));
	const emptyCount = barWidth - filledCount;
	const filled = "█".repeat(filledCount);
	const empty = "░".repeat(emptyCount);
	const bar = `[${filled}${empty}]`;
	const label = percent === null ? "unknown" : `${percent.toFixed(1)}%`;
	const styles: FooterTextStyle[] = [];
	if (filled.length > 0) {
		styles.push({
			text: filled,
			color: getContextUsageColor(percent),
			bold: percent !== null && percent >= 85,
		});
	}
	if (empty.length > 0) styles.push({ text: empty, color: "dim" });
	if (percent === null) styles.push({ text: label, color: "dim" });
	return { text: `${bar} ${label}`, styles };
}

function getContextUsageIcon(percent: number): string {
	if (percent >= 95) return "🔴";
	if (percent >= 50) return "🟡";
	return "🟢";
}

function getContextUsageColor(
	percent: number | null,
): Parameters<Theme["fg"]>[0] {
	if (percent === null) return "dim";
	if (percent >= 95) return "error";
	if (percent >= 50) return "warning";
	return "accent";
}

function applyTextStyles(
	text: string,
	styles: FooterTextStyle[],
	theme: Theme,
): string {
	return styles.reduce((styledText, style) => {
		if (!styledText.includes(style.text)) return styledText;
		const content = style.bold ? theme.bold(style.text) : style.text;
		const colored = style.color ? theme.fg(style.color, content) : content;
		const linked = style.hyperlinkUrl
			? hyperlink(colored, style.hyperlinkUrl)
			: colored;
		return styledText.replace(style.text, linked);
	}, text);
}

function getCurrentWorktreePath(projectPath: string): string {
	const worktrees = getGitWorktrees(projectPath);
	if (worktrees.length <= 1) return "No worktrees";
	return worktrees.find((worktree) => worktree.current)?.path ?? "No worktrees";
}

function formatMcpCount(adapter: {
	available: boolean;
	servers: string[];
}): string {
	if (!adapter.available) return "0/0 servers";
	const configuredServers = adapter.servers.length;
	return `${configuredServers}/${configuredServers} servers`;
}

function shouldShowExtensionStatus(status: string): boolean {
	return status.trim().length > 0;
}

function parseMcpExtensionStatus(status: string): string | null {
	const match = normalizeStatusText(status).match(/^MCP:\s*(.*)$/);
	const label = match?.[1]?.trim();
	return label ? label : null;
}

function normalizeStatusText(status: string): string {
	return stripTerminalSequences(status)
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function stripTerminalSequences(text: string): string {
	return text
		.replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
		.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function padToVisibleWidth(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}
