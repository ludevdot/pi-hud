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

export interface SubagentActiveItem {
	id: string;
	label: string;
	startedAt?: number;
	tokens?: number;
	source: "message" | "tool";
}

export interface SubagentStatus {
	running: number;
	completed: number;
	failed: number;
	seen: boolean;
	activeLabel?: string;
	activeStartedAt?: number;
	tokens: number;
	activeItems: SubagentActiveItem[];
}

export interface SubagentRunCounts {
	running: number;
	completed: number;
	failed: number;
	tokens: number;
	activeLabel?: string;
	activeStartedAt?: number;
	activeItems: SubagentActiveItem[];
}

export interface ActiveSubagentToolRun {
	label: string;
	startedAt: number;
	activeItems: SubagentActiveItem[];
}

export type HudMode = "overlay" | "footer";

export type HudUsageDisplay = "metered" | "subscription";

export type HudContextIndicator = "icon" | "bar";

export type HudVisibilityKey = "context" | "project" | "worktrees" | "mcps";

export type HudVisibility = Record<HudVisibilityKey, boolean>;

export interface HudSettings {
	mode: HudMode;
	position: OverlayAnchor;
	shortcut: string;
	switchShortcut: string;
	minimizeShortcut: string;
	autoCompactWhileStreaming: boolean;
	startupNotification: boolean;
	usageDisplay: HudUsageDisplay;
	contextIndicator: HudContextIndicator;
	expandedWidth: number;
	compactWidth: number;
	minTerminalWidth: number;
	margin: OverlayMargin;
	visibility: HudVisibility;
}

export interface ReleaseNotes {
	version: string;
	previousTag?: string;
	generatedAt?: string;
	commits: Array<{ hash: string; subject: string }>;
}

export interface ReleaseNotesState {
	lastReleaseNotesShown?: string;
	footerModeTipShownVersion?: string;
}
