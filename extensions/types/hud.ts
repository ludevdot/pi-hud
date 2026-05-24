import type { OverlayAnchor, OverlayMargin } from "@earendil-works/pi-tui";

export interface SessionStats {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	cost: number;
	assistantMessages: number;
}

export interface AgentStatus {
	running: number;
	completed: number;
}

export interface SubagentStatus {
	running: number;
	completed: number;
	failed: number;
	seen: boolean;
	activeLabel?: string;
	activeStartedAt?: number;
	tokens: number;
}

export interface SubagentRunCounts {
	running: number;
	completed: number;
	failed: number;
	tokens: number;
	activeLabel?: string;
	activeStartedAt?: number;
}

export interface ActiveSubagentToolRun {
	label: string;
	startedAt: number;
}

export type HudVisibilityKey = "context" | "project" | "worktrees" | "mcps";

export type HudVisibility = Record<HudVisibilityKey, boolean>;

export interface HudSettings {
	position: OverlayAnchor;
	shortcut: string;
	minimizeShortcut: string;
	autoCompactWhileStreaming: boolean;
	startupNotification: boolean;
	expandedWidth: number;
	compactWidth: number;
	minTerminalWidth: number;
	margin: OverlayMargin;
	visibility: HudVisibility;
}
