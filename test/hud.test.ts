import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
	resetCapabilitiesCache,
	setCapabilities,
	visibleWidth,
	type Component,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi } from "vitest";
import { readHudSettings } from "../extensions/settings/hud-settings.js";
import {
	createAssistantMessageEvent,
	createHarness,
	createSubagentMessageEvent,
	createSubagentProgressMessageEvent,
	expectCommandReturnsPromptly,
	getOverlayOptions,
} from "./helpers/hud-harness.js";

const fsMockState = vi.hoisted(() => ({
	settingsFiles: new Map<string, string>(),
	virtualFiles: new Map<string, string>(),
	virtualDirectories: new Set<string>(),
	releaseNotes: undefined as string | undefined,
	releaseNotesState: undefined as string | undefined,
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(
		(path: string) =>
			fsMockState.settingsFiles.has(path) ||
			fsMockState.virtualFiles.has(path) ||
			fsMockState.virtualDirectories.has(path) ||
			(path.endsWith("release-notes.json") &&
				fsMockState.releaseNotes !== undefined) ||
			(path.endsWith("state/pi-hud.json") &&
				fsMockState.releaseNotesState !== undefined) ||
			path.endsWith(".git") ||
			path.endsWith("HEAD") ||
			path.endsWith(".mcp.json"),
	),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn((path: string) => {
		const mocked = fsMockState.settingsFiles.get(path);
		if (mocked !== undefined) return mocked;
		const virtual = fsMockState.virtualFiles.get(path);
		if (virtual !== undefined) return virtual;
		if (path.endsWith("release-notes.json")) return fsMockState.releaseNotes;
		if (path.endsWith("state/pi-hud.json"))
			return fsMockState.releaseNotesState;
		if (path.endsWith(".mcp.json"))
			return JSON.stringify({ mcpServers: { filesystem: {}, github: {} } });
		return "";
	}),
	readdirSync: vi.fn((path: string, options?: { withFileTypes?: boolean }) => {
		const prefix = `${path}/`;
		const names = new Set<string>();
		for (const filePath of fsMockState.virtualFiles.keys()) {
			if (!filePath.startsWith(prefix)) continue;
			const [name] = filePath.slice(prefix.length).split("/");
			if (name) names.add(name);
		}
		for (const directoryPath of fsMockState.virtualDirectories) {
			if (!directoryPath.startsWith(prefix)) continue;
			const [name] = directoryPath.slice(prefix.length).split("/");
			if (name) names.add(name);
		}
		if (!options?.withFileTypes) return [...names];
		return [...names].map((name) => ({
			name,
			isDirectory: () => fsMockState.virtualDirectories.has(`${path}/${name}`),
		}));
	}),
	statSync: vi.fn((path: string) => ({
		isFile: () => fsMockState.virtualFiles.has(path),
		isDirectory: () =>
			fsMockState.virtualDirectories.has(path) ||
			!fsMockState.virtualFiles.has(path),
	})),
	writeFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn((_command, args) => {
		if (Array.isArray(args) && args.includes("status")) {
			return { status: 0, stdout: "" };
		}
		return { status: 0, stdout: "main\n" };
	}),
}));

afterEach(() => {
	resetCapabilitiesCache();
	fsMockState.settingsFiles.clear();
	fsMockState.virtualFiles.clear();
	fsMockState.virtualDirectories.clear();
	fsMockState.releaseNotes = undefined;
	fsMockState.releaseNotesState = undefined;
	delete process.env.PI_CODING_AGENT_DIR;
	vi.mocked(spawnSync).mockImplementation(
		(_command, args) =>
			(Array.isArray(args) && args.includes("status")
				? { status: 0, stdout: "" }
				: { status: 0, stdout: "main\n" }) as never,
	);
	vi.clearAllMocks();
});

function mockSettingsFile(path: string, settings: unknown): void {
	fsMockState.settingsFiles.set(path, JSON.stringify(settings));
}

function mockReleaseNotes(notes: unknown): void {
	fsMockState.releaseNotes = JSON.stringify(notes);
}

function mockOpenSpecChange(
	changeId: string,
	tasks: { completed: number; total: number },
): void {
	const openspecRoot = "/repo/project/openspec";
	const changeRoot = `${openspecRoot}/changes/${changeId}`;
	fsMockState.virtualDirectories.add(openspecRoot);
	fsMockState.virtualDirectories.add(`${openspecRoot}/changes`);
	fsMockState.virtualDirectories.add(changeRoot);
	fsMockState.virtualFiles.set(`${openspecRoot}/config.yaml`, "version: 1\n");
	fsMockState.virtualFiles.set(
		`${changeRoot}/tasks.md`,
		Array.from({ length: tasks.total }, (_, index) =>
			index < tasks.completed ? "- [x] done" : "- [ ] todo",
		).join("\n"),
	);
}

function mockOpenSpecArchiveChange(changeId: string): void {
	const openspecRoot = "/repo/project/openspec";
	const archiveRoot = `${openspecRoot}/changes/archive`;
	fsMockState.virtualDirectories.add(openspecRoot);
	fsMockState.virtualDirectories.add(`${openspecRoot}/changes`);
	fsMockState.virtualDirectories.add(archiveRoot);
	fsMockState.virtualDirectories.add(`${archiveRoot}/${changeId}`);
	fsMockState.virtualFiles.set(`${openspecRoot}/config.yaml`, "version: 1\n");
}

function mockOpenSpecVerifyReport(changeId: string): void {
	fsMockState.virtualFiles.set(
		`/repo/project/openspec/changes/${changeId}/verify-report.md`,
		"# Verify Report\n",
	);
}

function mockReleaseNotesState(state: unknown): void {
	fsMockState.releaseNotesState = JSON.stringify(state);
}

function hasInputHandler(
	component: Component | undefined,
): component is Component & { handleInput(data: string): void } {
	return typeof component?.handleInput === "function";
}

function unwrapBg(line: string): string {
	return line
		.replace(/^<bg:customMessageBg>/, "")
		.replace(/<\/bg:customMessageBg>$/, "")
		.replace(/<\/?(?:accent|warning|error|dim|bold)>/g, "");
}

describe("pi-hud extension", () => {
	test("loads default mode and visibility and safely merges supported keys only", () => {
		process.env.PI_CODING_AGENT_DIR = "/agent";
		expect(readHudSettings("/repo/project")).toMatchObject({
			mode: "overlay",
			switchShortcut: "ctrl+.",
			usageDisplay: "metered",
			contextIndicator: "icon",
			visibility: {
				context: true,
				project: true,
				worktrees: true,
				mcps: true,
			},
		});
		mockSettingsFile("/agent/settings.json", {
			hud: { switchShortcut: "ctrl+s" },
		});
		expect(readHudSettings("/repo/project").switchShortcut).toBe("ctrl+.");
		mockSettingsFile("/agent/settings.json", {
			hud: { visibility: { context: false, mcps: false } },
		});
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: {
				visibility: {
					context: true,
					mcps: "yes",
					subagents: false,
					unknown: false,
				},
			},
		});
		expect(readHudSettings("/repo/project")).toMatchObject({
			mode: "overlay",
			visibility: {
				context: true,
				project: true,
				worktrees: true,
				mcps: false,
			},
		});
		mockSettingsFile("/agent/settings.json", {
			hud: { mode: "footer" },
		});
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "unsupported" },
		});
		expect(readHudSettings("/repo/project").mode).toBe("footer");
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: {
				mode: "overlay",
				usageDisplay: "subscription",
				contextIndicator: "bar",
			},
		});
		expect(readHudSettings("/repo/project").mode).toBe("overlay");
		expect(readHudSettings("/repo/project").usageDisplay).toBe("subscription");
		expect(readHudSettings("/repo/project").contextIndicator).toBe("bar");
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { usageDisplay: "verbose", contextIndicator: "sparkline" },
		});
		expect(readHudSettings("/repo/project").usageDisplay).toBe("metered");
		expect(readHudSettings("/repo/project").contextIndicator).toBe("icon");
	});

	test("persists, reports, and validates HUD visibility arguments", async () => {
		const { commands, ctx, notify } = createHarness();

		await commands.get("hud-settings")!.handler("visibility", ctx);
		expect(writeFileSync).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining(
				"visibility=context:on, project:on, worktrees:on, mcps:on",
			),
			"info",
		);
		expect(notify).not.toHaveBeenCalledWith(
			expect.stringContaining("subagents"),
			"info",
		);

		await commands
			.get("hud-settings")!
			.handler("visibility worktrees off", ctx);
		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"worktrees": false'),
			"utf8",
		);
		expect(notify).toHaveBeenCalledWith(
			"HUD visibility worktrees disabled. Run /reload for the change to take effect.",
			"warning",
		);
		vi.mocked(writeFileSync).mockClear();
		await commands
			.get("hud-settings")!
			.handler("visibility subagents off", ctx);
		await commands
			.get("hud-settings")!
			.handler("visibility context maybe", ctx);
		expect(writeFileSync).not.toHaveBeenCalled();
	});

	test("omits hidden expanded and compact HUD items while keeping subagents", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: {
				visibility: {
					context: false,
					project: false,
					worktrees: false,
					mcps: false,
					subagents: false,
				},
			},
		});
		const { commands, shortcuts, ctx, eventHandlers, capturedComponents } =
			createHarness({ mcpAdapter: true });

		await expectCommandReturnsPromptly(commands.get("hud")!, ctx);
		let rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("Subagents");
		expect(rendered).toContain("subagents idle");
		expect(rendered).not.toContain("Context");
		expect(rendered).not.toContain("6.0% used");
		expect(rendered).not.toContain("Project");
		expect(rendered).not.toContain("branch main");
		expect(rendered).not.toContain("Git worktrees");
		expect(rendered).not.toContain("Configured MCPs");

		for (const handler of eventHandlers.get("tool_execution_start") ?? [])
			await handler(
				{
					type: "tool_execution_start",
					toolName: "subagent",
					toolCallId: "tool-1",
					args: { task: "visible agent" },
				},
				ctx,
			);
		await shortcuts.get("ctrl+h")!.handler(ctx);
		rendered = capturedComponents[0]!.render(26).join("\n");
		expect(rendered).not.toContain("HUD /");
		expect(rendered).not.toContain("6.0% ctx");
		expect(rendered).toContain("1 run");
		expect(rendered).toContain("[·] visible agent");
	});

	test("/hud-settings opens a centered modal, renders rows, persists changes, and cancels cleanly", async () => {
		const {
			commands,
			ctx,
			custom,
			notify,
			select,
			capturedComponents,
			capturedOptions,
		} = createHarness({ resolveCustom: true });

		await commands.get("hud-settings")!.handler("", ctx);

		expect(select).not.toHaveBeenCalled();
		expect(custom).toHaveBeenCalledTimes(1);
		expect(capturedOptions[0]).toMatchObject({ overlay: true });
		expect(getOverlayOptions(capturedOptions[0])).toMatchObject({
			anchor: "center",
			width: 88,
			maxHeight: "80%",
		});
		expect(capturedComponents).toHaveLength(1);
		const settingsComponent = capturedComponents[0];
		if (!hasInputHandler(settingsComponent)) {
			throw new Error("Expected HUD settings modal to handle input.");
		}

		const rendered = settingsComponent.render(88).join("\n");
		expect(rendered).toContain("HUD Settings");
		expect(rendered).toContain("Mode");
		expect(rendered).toContain("overlay");
		expect(rendered).toContain("Position");
		expect(rendered).toContain("Shortcut");
		expect(rendered).toContain("Switch shortcut");
		expect(rendered).toContain("Minimize shortcut");
		expect(rendered).toContain("Auto-compact while streaming");
		expect(rendered).toContain("Startup notification");
		expect(rendered).toContain("Usage display");
		expect(rendered).toContain("metered");
		expect(rendered).toContain("Context indicator");
		expect(rendered).toContain("icon");
		expect(rendered).toContain("Expanded width");
		expect(rendered).toContain("Compact width");
		expect(rendered).toContain("Min terminal width");
		expect(rendered).toContain("Modules visibility");
		expect(rendered).toContain("Show current");
		expect(rendered).toContain("Restore defaults");

		settingsComponent.handleInput(" ");
		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"mode": "footer"'),
			"utf8",
		);
		expect(notify).toHaveBeenCalledWith(
			"HUD mode set to footer. Run /reload for the change to take effect.",
			"info",
		);

		vi.mocked(writeFileSync).mockClear();
		settingsComponent.handleInput("\x1b[B");
		settingsComponent.handleInput("\x1b[B");
		settingsComponent.handleInput(" ");
		settingsComponent.handleInput("r");
		expect(writeFileSync).not.toHaveBeenCalled();

		vi.mocked(writeFileSync).mockClear();
		const cancelHarness = createHarness({ resolveCustom: true });
		await cancelHarness.commands
			.get("hud-settings")!
			.handler("", cancelHarness.ctx);
		const cancelComponent = cancelHarness.capturedComponents[0];
		if (!hasInputHandler(cancelComponent)) {
			throw new Error("Expected HUD settings modal to handle input.");
		}
		cancelComponent.handleInput("\x1b");
		expect(writeFileSync).not.toHaveBeenCalled();
	});

	test("/hud-settings input submenus save typed replacements", async () => {
		const { commands, ctx, capturedComponents } = createHarness({
			resolveCustom: true,
		});

		await commands.get("hud-settings")!.handler("", ctx);
		const settingsComponent = capturedComponents[0];
		if (!hasInputHandler(settingsComponent)) {
			throw new Error("Expected HUD settings modal to handle input.");
		}

		for (let index = 0; index < 9; index += 1) {
			settingsComponent.handleInput("\x1b[B");
		}
		settingsComponent.handleInput(" ");
		settingsComponent.handleInput("5");
		settingsComponent.handleInput("6");
		settingsComponent.handleInput("\n");

		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"expandedWidth": 56'),
			"utf8",
		);
		expect(writeFileSync).not.toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"expandedWidth": 5642'),
			"utf8",
		);
	});

	test("/hud-settings restore defaults marks visibility reload when modules change", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { visibility: { context: false } },
		});
		const { commands, ctx, setStatus, capturedComponents } = createHarness({
			resolveCustom: true,
		});

		await commands.get("hud-settings")!.handler("", ctx);
		const settingsComponent = capturedComponents[0];
		if (!hasInputHandler(settingsComponent)) {
			throw new Error("Expected HUD settings modal to handle input.");
		}

		settingsComponent.handleInput("r");

		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"context": true'),
			"utf8",
		);
		expect(setStatus).toHaveBeenCalledWith(
			"pi-hud.modules-visibility.reload",
			expect.stringContaining("Run /reload"),
		);
	});

	test("registers HUD commands and default shortcuts only", () => {
		const { commands, shortcuts } = createHarness();

		expect(commands.has("hud")).toBe(true);
		expect(commands.has("hud-settings")).toBe(true);
		expect(commands.has("hud-mode")).toBe(true);
		expect(commands.has("sidebar")).toBe(false);
		expect(commands.has("session-sidebar")).toBe(false);
		expect([...shortcuts.keys()].sort()).toEqual([
			"ctrl+.",
			"ctrl+h",
			"ctrl+shift+h",
		]);
	});

	test("shows a UI-only notification when an interactive session starts and skips reload", async () => {
		const { ctx, eventHandlers, notify, registerMessageRenderer, sendMessage } =
			createHarness();
		const handlers = eventHandlers.get("session_start") ?? [];

		for (const handler of handlers) await handler({ reason: "startup" }, ctx);
		expect(notify).toHaveBeenCalledWith(
			"Pi HUD loaded. Shortcut: ctrl+shift+h.",
			"info",
		);
		expect(String(notify.mock.calls[0]?.[0])).not.toMatch(/^\/[\w-]+/);
		expect(registerMessageRenderer).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();

		notify.mockClear();
		for (const handler of handlers) await handler({ reason: "reload" }, ctx);
		expect(notify).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
	});

	test("uses configured shortcut in startup notification", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { shortcut: "ctrl+alt+h" },
		});
		const { ctx, eventHandlers, notify, sendMessage } = createHarness();
		const handlers = eventHandlers.get("session_start") ?? [];

		for (const handler of handlers) await handler({ reason: "startup" }, ctx);

		expect(notify).toHaveBeenCalledWith(
			"Pi HUD loaded. Shortcut: ctrl+alt+h.",
			"info",
		);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	test("respects startup notification setting and CLI command guard", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { startupNotification: false },
		});
		const { ctx, eventHandlers, notify, sendMessage } = createHarness();
		const handlers = eventHandlers.get("session_start") ?? [];

		for (const handler of handlers) await handler({ reason: "startup" }, ctx);
		expect(notify).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();

		fsMockState.settingsFiles.clear();
		const originalArgv = process.argv;
		process.argv = ["node", "pi", "update"];
		try {
			const cliHarness = createHarness();
			const cliHandlers = cliHarness.eventHandlers.get("session_start") ?? [];
			for (const handler of cliHandlers) {
				await handler({ reason: "startup" }, cliHarness.ctx);
			}
			expect(cliHarness.notify).not.toHaveBeenCalled();
			expect(cliHarness.sendMessage).not.toHaveBeenCalled();
		} finally {
			process.argv = originalArgv;
		}
	});

	test("does not treat dev extension flags as a CLI command", async () => {
		const originalArgv = process.argv;
		process.argv = [
			"node",
			"pi",
			"--no-extensions",
			"-e",
			"/repo/pi-hud/extensions/hud.ts",
		];
		try {
			const { ctx, eventHandlers, notify, sendMessage } = createHarness();
			const handlers = eventHandlers.get("session_start") ?? [];
			for (const handler of handlers) await handler({ reason: "startup" }, ctx);
			expect(notify).toHaveBeenCalledWith(
				"Pi HUD loaded. Shortcut: ctrl+shift+h.",
				"info",
			);
			expect(sendMessage).not.toHaveBeenCalled();
		} finally {
			process.argv = originalArgv;
		}
	});

	test("shows packaged release notes once per version", async () => {
		process.env.PI_CODING_AGENT_DIR = "/agent";
		mockReleaseNotes({
			version: "0.3.1",
			previousTag: "v-0.3.0-RELEASE",
			commits: [
				{ hash: "abc1234", subject: "Add startup notification" },
				{ hash: "def5678", subject: "Render release notes" },
			],
		});
		const { ctx, eventHandlers, notify, sendMessage } = createHarness();
		const handlers = eventHandlers.get("session_start") ?? [];

		for (const handler of handlers) await handler({ reason: "startup" }, ctx);

		expect(notify).toHaveBeenCalledWith(
			[
				"Pi HUD loaded. Shortcut: ctrl+shift+h.",
				"",
				"Latest release 0.3.1",
				"abc1234 Add startup notification",
				"def5678 Render release notes",
				"",
				"New: Pi HUD can now replace the footer. Try /hud-mode footer.",
			].join("\n"),
			"info",
		);
		expect(sendMessage).not.toHaveBeenCalled();
		expect(writeFileSync).toHaveBeenCalledWith(
			"/agent/state/pi-hud.json",
			expect.stringContaining('"lastReleaseNotesShown": "0.3.1"'),
			"utf8",
		);
		expect(writeFileSync).toHaveBeenCalledWith(
			"/agent/state/pi-hud.json",
			expect.stringContaining('"footerModeTipShownVersion": "0.3.1"'),
			"utf8",
		);
	});

	test("skips release notes that were already shown", async () => {
		process.env.PI_CODING_AGENT_DIR = "/agent";
		mockReleaseNotes({
			version: "0.3.1",
			commits: [{ hash: "abc1234", subject: "Add startup notification" }],
		});
		mockReleaseNotesState({
			lastReleaseNotesShown: "0.3.1",
			footerModeTipShownVersion: "0.3.1",
		});
		const { ctx, eventHandlers, notify, sendMessage } = createHarness();
		const handlers = eventHandlers.get("session_start") ?? [];

		for (const handler of handlers) await handler({ reason: "startup" }, ctx);

		expect(notify).toHaveBeenCalledWith(
			"Pi HUD loaded. Shortcut: ctrl+shift+h.",
			"info",
		);
		expect(sendMessage).not.toHaveBeenCalled();
		expect(writeFileSync).not.toHaveBeenCalledWith(
			"/agent/state/pi-hud.json",
			expect.any(String),
			"utf8",
		);
	});

	test("shows the footer mode tip when release notes were already seen", async () => {
		process.env.PI_CODING_AGENT_DIR = "/agent";
		mockReleaseNotes({
			version: "0.3.1",
			commits: [{ hash: "abc1234", subject: "Add startup notification" }],
		});
		mockReleaseNotesState({ lastReleaseNotesShown: "0.3.1" });
		const { ctx, eventHandlers, notify } = createHarness();
		const handlers = eventHandlers.get("session_start") ?? [];

		for (const handler of handlers) await handler({ reason: "startup" }, ctx);

		expect(notify).toHaveBeenCalledWith(
			[
				"Pi HUD loaded. Shortcut: ctrl+shift+h.",
				"",
				"New: Pi HUD can now replace the footer. Try /hud-mode footer.",
			].join("\n"),
			"info",
		);
		expect(writeFileSync).toHaveBeenCalledWith(
			"/agent/state/pi-hud.json",
			expect.stringContaining('"footerModeTipShownVersion": "0.3.1"'),
			"utf8",
		);
	});

	test("updates startup notification from command arguments", async () => {
		const { commands, ctx, notify } = createHarness();

		await commands.get("hud-settings")!.handler("startupNotification off", ctx);

		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"startupNotification": false'),
			"utf8",
		);
		expect(notify).toHaveBeenCalledWith(
			"HUD startup notification disabled.",
			"info",
		);
	});

	test("updates usage display from command arguments", async () => {
		const { commands, ctx, notify } = createHarness();

		await commands
			.get("hud-settings")!
			.handler("usageDisplay subscription", ctx);

		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"usageDisplay": "subscription"'),
			"utf8",
		);
		expect(notify).toHaveBeenCalledWith(
			"HUD usage display set to subscription.",
			"info",
		);

		vi.mocked(writeFileSync).mockClear();
		await commands.get("hud-settings")!.handler("usageDisplay verbose", ctx);
		expect(writeFileSync).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("Usage: /hud-settings"),
			"warning",
		);
	});

	test("updates context indicator from command arguments", async () => {
		const { commands, ctx, notify } = createHarness();

		await commands.get("hud-settings")!.handler("contextIndicator bar", ctx);

		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"contextIndicator": "bar"'),
			"utf8",
		);
		expect(notify).toHaveBeenCalledWith(
			"HUD context indicator set to bar.",
			"info",
		);

		vi.mocked(writeFileSync).mockClear();
		await commands
			.get("hud-settings")!
			.handler("contextIndicator sparkline", ctx);
		expect(writeFileSync).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("Usage: /hud-settings"),
			"warning",
		);
	});

	test("opens as a non-capturing overlay and returns without waiting for overlay dismissal", async () => {
		const { commands, ctx, custom, capturedOptions, capturedComponents } =
			createHarness();

		await expectCommandReturnsPromptly(commands.get("hud")!, ctx);

		expect(custom).toHaveBeenCalledTimes(1);
		expect(capturedOptions[0]).toMatchObject({ overlay: true });
		const initialOverlayOptions = getOverlayOptions(capturedOptions[0]);
		expect(initialOverlayOptions).toMatchObject({
			anchor: "top-right",
			width: 42,
			maxHeight: "100%",
			nonCapturing: true,
		});
		const overlayOptions = initialOverlayOptions;
		expect(overlayOptions.visible?.(89, 40)).toBe(false);
		expect(overlayOptions.visible?.(90, 40)).toBe(true);
		const rendered = capturedComponents[0]?.render(42).join("\n");
		expect(rendered).toContain("12.0k tokens");
		expect(rendered).toContain("6.0% used");
		expect(rendered).toContain("thinking: medium");
		expect(rendered).toContain("branch main");
		expect(rendered).not.toContain("Git worktrees");
		expect(rendered).not.toContain("MCP");
		expect(rendered).toContain("/hud or ctrl+shift+h hide/show");
		expect(rendered).toContain("ctrl+. switch mode");
		expect(rendered).toContain("ctrl+h minimize/expand");
	});

	test("highlights the switch mode shortcut helper", async () => {
		const { commands, ctx, capturedComponents } = createHarness({
			showThemeColors: true,
		});

		await expectCommandReturnsPromptly(commands.get("hud")!, ctx);

		const rendered = capturedComponents[0]?.render(42).join("\n");
		expect(rendered).toContain("<warning>ctrl+. switch mode</warning>");
	});

	test("auto-compacts for the assistant turn and expands when it ends", async () => {
		const {
			commands,
			ctx,
			eventHandlers,
			capturedOptions,
			capturedComponents,
		} = createHarness();

		await commands.get("hud")!.handler("", ctx);
		expect(getOverlayOptions(capturedOptions[0]).width).toBe(42);
		let rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("Pi HUD");
		expect(rendered).toContain("Model Name · 6.0% ctx");

		for (const handler of eventHandlers.get("message_update") ?? []) {
			await handler(createAssistantMessageEvent("message_update"), ctx);
		}

		expect(getOverlayOptions(capturedOptions[0]).width).toBe(42);

		for (const handler of eventHandlers.get("turn_start") ?? []) {
			await handler({ type: "turn_start" }, ctx);
		}

		expect(getOverlayOptions(capturedOptions[0]).width).toBe(26);
		rendered = capturedComponents[0]!.render(26).join("\n");
		expect(rendered).toContain("HUD");
		expect(rendered).toContain("Project: Project");
		expect(rendered).toContain("Model Name · 6.0% ctx");

		for (const handler of eventHandlers.get("message_end") ?? []) {
			await handler(createAssistantMessageEvent("message_end"), ctx);
		}

		expect(getOverlayOptions(capturedOptions[0]).width).toBe(26);

		for (const handler of eventHandlers.get("turn_end") ?? []) {
			await handler({ type: "turn_end" }, ctx);
		}

		expect(getOverlayOptions(capturedOptions[0]).width).toBe(42);
		rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("Pi HUD");
	});

	test("preserves context usage in compact header with long model names", async () => {
		const { commands, shortcuts, ctx, capturedComponents } = createHarness({
			modelName: "Very Long Model Name For Header",
		});

		await commands.get("hud")!.handler("", ctx);
		await shortcuts.get("ctrl+h")!.handler(ctx);
		const rendered = capturedComponents[0]!.render(26).join("\n");

		expect(rendered).toContain("HUD");
		expect(rendered).toContain("Project: Project");
		expect(rendered).toContain("6.0% ctx");
		expect(rendered).not.toContain("Very Long Model Name For Header");
	});

	test("shows unknown context in compact overlay when post-compaction usage is unknown", async () => {
		const { commands, shortcuts, ctx, capturedComponents } = createHarness({
			contextTokens: null,
			contextPercent: null,
			contextWindow: 100,
			showThemeColors: true,
		});

		await commands.get("hud")!.handler("", ctx);
		await shortcuts.get("ctrl+h")!.handler(ctx);
		const rendered = capturedComponents[0]!.render(80).join("\n");

		expect(rendered).toContain("<dim>ctx unknown</dim>");
		expect(rendered).not.toContain("% ctx");
		expect(rendered).not.toContain("1275.0%");
	});

	test.each([
		{ percent: 49, expected: "<accent>49.0% ctx</accent>" },
		{ percent: 50, expected: "<warning>50.0% ctx !</warning>" },
		{ percent: 69, expected: "<warning>69.0% ctx !</warning>" },
		{ percent: 70, expected: "<warning>70.0% ctx</warning>" },
		{ percent: 85, expected: "<warning><bold>85.0% ctx</bold></warning>" },
		{ percent: 95, expected: "<error><bold>95.0% ctx</bold></error>" },
	])("colors compact context usage at $percent percent", async ({
		percent,
		expected,
	}) => {
		const { commands, shortcuts, ctx, capturedComponents } = createHarness({
			contextPercent: percent,
			showThemeColors: true,
		});

		await commands.get("hud")!.handler("", ctx);
		await shortcuts.get("ctrl+h")!.handler(ctx);
		const rendered = capturedComponents[0]!.render(80).join("\n");

		expect(rendered).toContain(expected);
	});

	test.each([
		{ percent: 49, expected: "<accent>49.0% used</accent>" },
		{ percent: 50, expected: "<warning>50.0% used !</warning>" },
		{ percent: 69, expected: "<warning>69.0% used !</warning>" },
		{ percent: 70, expected: "<warning>70.0% used</warning>" },
		{ percent: 85, expected: "<warning><bold>85.0% used</bold></warning>" },
		{ percent: 95, expected: "<error><bold>95.0% used</bold></error>" },
	])("colors expanded context usage at $percent percent", async ({
		percent,
		expected,
	}) => {
		const { commands, ctx, capturedComponents } = createHarness({
			contextPercent: percent,
			showThemeColors: true,
		});

		await commands.get("hud")!.handler("", ctx);
		const rendered = capturedComponents[0]!.render(80).join("\n");

		expect(rendered).toContain(expected);
	});

	test("shows unknown context in expanded overlay when post-compaction usage is unknown", async () => {
		const { commands, ctx, capturedComponents } = createHarness({
			contextTokens: null,
			contextPercent: null,
			contextWindow: 100,
			showThemeColors: true,
		});

		await commands.get("hud")!.handler("", ctx);
		const rendered = capturedComponents[0]!.render(80).join("\n");

		expect(rendered).toContain("<dim>ctx unknown</dim>");
		expect(rendered).toContain("tokens unknown");
		expect(rendered).toContain("<dim>usage unknown</dim>");
		expect(rendered).not.toContain("1.3k tokens");
		expect(rendered).not.toContain("1275.0% used");
	});

	test("falls back to session totals when context usage API is unavailable", async () => {
		const { commands, ctx, capturedComponents } = createHarness({
			omitContextUsage: true,
			showThemeColors: true,
		});

		await commands.get("hud")!.handler("", ctx);
		const rendered = capturedComponents[0]!.render(80).join("\n");

		expect(rendered).toContain("1.3k tokens");
		expect(rendered).toContain("<accent>0.6% used</accent>");
	});

	test("skips worktree lookup while compact", async () => {
		const { commands, shortcuts, ctx, capturedComponents } = createHarness();

		await commands.get("hud")!.handler("", ctx);
		await shortcuts.get("ctrl+h")!.handler(ctx);
		capturedComponents[0]!.render(26);

		expect(
			vi
				.mocked(spawnSync)
				.mock.calls.some(
					([, args]) => Array.isArray(args) && args.includes("worktree"),
				),
		).toBe(false);
	});

	test("updates project HUD settings from command arguments", async () => {
		const { commands, ctx, notify } = createHarness();

		await commands.get("hud-settings")!.handler("position bottom-right", ctx);

		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"position": "bottom-right"'),
			"utf8",
		);
		expect(notify).toHaveBeenCalledWith(
			"HUD position set to bottom-right. Reopen /hud if it is currently visible.",
			"info",
		);

		await commands
			.get("hud-settings")!
			.handler("switchShortcut ctrl+.", ctx);

		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"switchShortcut": "ctrl+."'),
			"utf8",
		);
		expect(notify).toHaveBeenCalledWith(
			"HUD switchShortcut saved. Run /reload for the shortcut registration to change.",
			"info",
		);

		await commands.get("hud-settings")!.handler("minimizeShortcut f2", ctx);

		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"minimizeShortcut": "ctrl+h"'),
			"utf8",
		);
		expect(notify).toHaveBeenCalledWith(
			"HUD minimizeShortcut saved. Run /reload for the shortcut registration to change.",
			"info",
		);
	});

	test("rejects conflicting HUD shortcuts", async () => {
		const { commands, ctx, notify } = createHarness();

		await commands.get("hud-settings")!.handler("minimizeShortcut ctrl+m", ctx);
		await commands
			.get("hud-settings")!
			.handler("minimizeShortcut ctrl+shift+m", ctx);
		await commands.get("hud-settings")!.handler("minimizeShortcut alt+m", ctx);
		await commands.get("hud-settings")!.handler("switchShortcut ctrl+s", ctx);

		expect(writeFileSync).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledTimes(4);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("Usage: /hud-settings"),
			"warning",
		);
	});

	test("renders git worktrees when multiple worktrees are registered", async () => {
		vi.mocked(spawnSync).mockImplementation((command, args) => {
			if (
				command === "git" &&
				Array.isArray(args) &&
				args.includes("worktree")
			) {
				return {
					status: 0,
					stdout: [
						"worktree /repo/project",
						"HEAD abc123",
						"branch refs/heads/main",
						"",
						"worktree /tmp/project-publish",
						"HEAD 123abc",
						"detached",
						"",
						"worktree /repo/project-feature",
						"HEAD def456",
						"branch refs/heads/feature/worktrees",
					].join("\n"),
				} as never;
			}
			return { status: 0, stdout: "main\n" } as never;
		});
		const { commands, ctx, capturedComponents } = createHarness();

		await expectCommandReturnsPromptly(commands.get("hud")!, ctx);

		const rendered = capturedComponents[0]?.render(42).join("\n");
		expect(rendered).toContain("Git worktrees");
		expect(rendered).toContain("* main · /repo/project");
		expect(rendered).toContain("• feature/worktrees · /repo/project-fe");
		expect(rendered).not.toContain("detached");
		expect(rendered).not.toContain("/tmp/project-publish");
	});

	test("renders configured MCP servers only when the adapter package is installed", async () => {
		const { commands, ctx, capturedComponents } = createHarness({
			mcpAdapter: true,
		});

		await expectCommandReturnsPromptly(commands.get("hud")!, ctx);

		const rendered = capturedComponents[0]?.render(42).join("\n");
		expect(rendered).toContain("Configured MCPs");
		expect(rendered).toContain("filesystem");
		expect(rendered).toContain("github");
	});

	test("prefers Pi agent MCP config over stale project MCP config", async () => {
		process.env.PI_CODING_AGENT_DIR = "/agent";
		mockSettingsFile("/agent/mcp.json", {
			mcpServers: { context7: {}, engram: {} },
		});
		mockSettingsFile("/repo/project/.mcp.json", {
			mcpServers: { codegraph: {}, playwright: {}, "rag-mcp": {} },
		});
		const { commands, ctx, capturedComponents } = createHarness({
			mcpAdapter: true,
		});

		await expectCommandReturnsPromptly(commands.get("hud")!, ctx);

		const rendered = capturedComponents[0]?.render(42).join("\n");
		expect(rendered).toContain("Configured MCPs");
		expect(rendered).toContain("context7");
		expect(rendered).toContain("engram");
		expect(rendered).not.toContain("codegraph");
		expect(rendered).not.toContain("playwright");
		expect(rendered).not.toContain("rag-mcp");
	});

	test("does not fall back to stale project MCP config when Pi agent config is empty", async () => {
		process.env.PI_CODING_AGENT_DIR = "/agent";
		mockSettingsFile("/agent/mcp.json", { mcpServers: {} });
		mockSettingsFile("/repo/project/.mcp.json", {
			mcpServers: { codegraph: {}, playwright: {}, "rag-mcp": {} },
		});
		const { commands, ctx, capturedComponents } = createHarness({
			mcpAdapter: true,
		});

		await expectCommandReturnsPromptly(commands.get("hud")!, ctx);

		const rendered = capturedComponents[0]?.render(42).join("\n");
		expect(rendered).toContain("Configured MCPs");
		expect(rendered).toContain("adapter installed");
		expect(rendered).not.toContain("codegraph");
		expect(rendered).not.toContain("playwright");
		expect(rendered).not.toContain("rag-mcp");
	});

	test("starts as overlay by default and leaves the built-in footer alone", async () => {
		const { eventHandlers, ctx, custom, setFooter } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		expect(custom).toHaveBeenCalledTimes(1);
		expect(setFooter).not.toHaveBeenCalled();
	});

	test("starts in footer mode without opening the overlay", async () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, custom, setFooter, capturedFooterComponents } =
			createHarness({ showThemeColors: true, mcpAdapter: true });

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		expect(custom).not.toHaveBeenCalled();
		expect(setFooter).toHaveBeenCalledTimes(1);
		const rendered = capturedFooterComponents[0]!.render(120);
		expect(rendered).toHaveLength(5);
		expect(
			rendered.every((line) => line.startsWith("<bg:customMessageBg>")),
		).toBe(true);
		expect(
			new Set(rendered.map((line) => visibleWidth(unwrapBg(line)))),
		).toEqual(new Set([120]));
		const footerText = rendered.map(unwrapBg).join("\n");
		expect(footerText).toContain("📁 Project  Project /repo/project 🟢 (main)");
		expect(footerText).toContain(
			"🧠 Context  12.0k tokens │ 🟢 6.0% used/200.0k ctx",
		);
		expect(footerText).toContain("Model Name");
		expect(footerText).toContain("thinking: medium");
		expect(footerText).toContain("$0.01000 spent");
		expect(footerText).toContain("MCP      2/2 servers");
		expect(footerText).toContain("Worktree: No worktrees");
		expect(footerText).toContain("/hud-mode │ /hud-settings │ 🔗 docs");
		expect(footerText).not.toContain("\u001B]8;;");
		expect(footerText).toContain(
			"🔁 Session  resume: pi --session session-1234",
		);
	});

	test("footer subscription usage display hides token and cost details", async () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer", usageDisplay: "subscription" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			showThemeColors: true,
			mcpAdapter: true,
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(120)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain(
			"🧠 Context  🟢 6.0% used/200.0k ctx │ Model Name / medium",
		);
		expect(footerText).not.toContain("12.0k tokens");
		expect(footerText).not.toContain("$0.01000 spent");
		expect(footerText).not.toContain("thinking: medium");
	});

	test("footer icon indicator shows unknown when post-compaction usage is unknown", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			contextTokens: null,
			contextPercent: null,
			contextWindow: 100,
			showThemeColors: true,
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const contextLine = capturedFooterComponents[0]!.render(140)[1]!;
		const plainContextLine = unwrapBg(contextLine);
		expect(contextLine).toContain("<dim>unknown</dim>");
		expect(plainContextLine).toContain(
			"🧠 Context  unknown tokens │ unknown used/100 ctx",
		);
		expect(plainContextLine).not.toContain("1.3k tokens");
		expect(plainContextLine).not.toContain("1275.0%");
	});

	test("footer bar indicator shows empty unknown bar when post-compaction usage is unknown", async () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer", contextIndicator: "bar" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			contextTokens: null,
			contextPercent: null,
			contextWindow: 100,
			showThemeColors: true,
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const contextLine = capturedFooterComponents[0]!.render(140)[1]!;
		const plainContextLine = unwrapBg(contextLine);
		expect(contextLine).toContain("<dim>░░░░░░░░░░░░░░░░░░░░</dim>");
		expect(contextLine).toContain("<dim>unknown</dim>");
		expect(plainContextLine).toContain(
			"🧠 Context  unknown tokens │ [░░░░░░░░░░░░░░░░░░░░] unknown used/100 ctx",
		);
		expect(plainContextLine).not.toContain("1275.0%");
	});

	test("footer context indicator can render a colored bar in metered mode", async () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer", contextIndicator: "bar" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			contextPercent: 66,
			showThemeColors: true,
			mcpAdapter: true,
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const contextLine = capturedFooterComponents[0]!.render(140)[1]!;
		const plainContextLine = unwrapBg(contextLine);
		expect(contextLine).toContain("<warning>█████████████</warning>");
		expect(contextLine).toContain("<dim>░░░░░░░</dim>");
		expect(plainContextLine).toContain(
			"🧠 Context  12.0k tokens │ [█████████████░░░░░░░] 66.0% used/200.0k ctx",
		);
		expect(plainContextLine).toContain("$0.01000 spent");
		expect(plainContextLine).not.toContain("🟡 66.0%");
	});

	test("footer context indicator can render a colored bar in subscription mode", async () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: {
				mode: "footer",
				usageDisplay: "subscription",
				contextIndicator: "bar",
			},
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			contextPercent: 96,
			showThemeColors: true,
			mcpAdapter: true,
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const contextLine = capturedFooterComponents[0]!.render(140)[1]!;
		const plainContextLine = unwrapBg(contextLine);
		expect(contextLine).toContain(
			"<error><bold>███████████████████</bold></error>",
		);
		expect(contextLine).toContain("<dim>░</dim>");
		expect(plainContextLine).toContain(
			"🧠 Context  [███████████████████░] 96.0% used/200.0k ctx │ Model Name / medium",
		);
		expect(plainContextLine).not.toContain("12.0k tokens");
		expect(plainContextLine).not.toContain("$0.01000 spent");
		expect(plainContextLine).not.toContain("🔴 96.0%");
	});

	test("footer shows compact SDD flow when a single OpenSpec change is active", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		mockOpenSpecChange("improve-footer", { completed: 3, total: 8 });
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(160)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain(
			"🧭 Flow     📐 SDD improve-footer · tasks 3/8 · next: apply",
		);
		expect(footerText).toContain("🔗 docs");
		expect(footerText).not.toContain("❔ Help");
	});

	test("footer shortens SDD flow before line truncation", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		mockOpenSpecChange("very-long-open-spec-change-name", {
			completed: 1,
			total: 3,
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const flowLine = unwrapBg(capturedFooterComponents[0]!.render(44)[3]!);
		expect(visibleWidth(flowLine)).toBe(44);
		expect(flowLine).toContain("📐 SDD · apply");
		expect(flowLine).not.toContain("tasks 1/3");
	});

	test("footer omits SDD flow when no active OpenSpec change is detected", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(120)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain("❔ Help     /hud-mode");
		expect(footerText).not.toContain("📐 SDD");
	});

	test("footer omits SDD flow when multiple OpenSpec changes are present", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		mockOpenSpecChange("first-change", { completed: 1, total: 2 });
		mockOpenSpecChange("second-change", { completed: 0, total: 2 });
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(120)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain("❔ Help     /hud-mode");
		expect(footerText).not.toContain("📐 SDD");
	});

	test("footer keeps SDD flow for completed tasks that still need verification", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		mockOpenSpecChange("needs-verify", { completed: 4, total: 4 });
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(160)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain(
			"🧭 Flow     📐 SDD needs-verify · tasks 4/4 · next: verify",
		);
		expect(footerText).not.toContain("❔ Help");
	});

	test("footer omits SDD flow for completed verified OpenSpec changes", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		mockOpenSpecChange("stale-verified-change", { completed: 49, total: 49 });
		mockOpenSpecVerifyReport("stale-verified-change");
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(160)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain("❔ Help     /hud-mode");
		expect(footerText).not.toContain("📐 SDD");
		expect(footerText).not.toContain("tasks 49/49");
		expect(footerText).not.toContain("next: sync");
	});

	test("footer ignores archived OpenSpec changes when detecting active SDD flow", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		mockOpenSpecChange("active-change", { completed: 1, total: 4 });
		mockOpenSpecArchiveChange("old-change");
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(160)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain(
			"🧭 Flow     📐 SDD active-change · tasks 1/4 · next: apply",
		);
		expect(footerText).not.toContain("❔ Help");
	});

	test("footer omits SDD flow when only archived OpenSpec changes exist", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		mockOpenSpecArchiveChange("old-change");
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(120)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain("❔ Help     /hud-mode");
		expect(footerText).not.toContain("📐 SDD");
	});

	test("footer omits thinking level for non-reasoning models", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			modelReasoning: false,
			thinkingLevel: "medium",
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(120)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain("Model Name");
		expect(footerText).not.toContain("thinking:");
	});

	test("rerenders when model or thinking level changes", async () => {
		const { commands, ctx, eventHandlers, requestRender } = createHarness();

		await commands.get("hud")!.handler("", ctx);
		requestRender.mockClear();

		for (const handler of eventHandlers.get("model_select") ?? []) {
			await handler({ type: "model_select" }, ctx);
		}
		for (const handler of eventHandlers.get("thinking_level_select") ?? []) {
			await handler({ type: "thinking_level_select" }, ctx);
		}

		expect(requestRender).toHaveBeenCalledTimes(2);
	});

	test("footer links docs only when terminal hyperlinks are supported", async () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const footerText = capturedFooterComponents[0]!
			.render(120)
			.map(unwrapBg)
			.join("\n");
		expect(footerText).toContain("/hud-mode │ /hud-settings │ ");
		expect(footerText).toContain(
			"\u001B]8;;https://github.com/ludevdot/pi-hud#readme\u001B\\🔗 docs\u001B]8;;\u001B\\",
		);
	});

	test("footer does not emit a partial docs hyperlink when truncated", async () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const helpLine = unwrapBg(capturedFooterComponents[0]!.render(44)[3]!);
		expect(visibleWidth(helpLine)).toBe(44);
		expect(helpLine).not.toContain(
			"\u001B]8;;https://github.com/ludevdot/pi-hud#readme",
		);
	});

	test("/hud-mode switches, toggles, persists, and restores footer immediately", async () => {
		const { commands, ctx, custom, notify, setFooter, hideHandle } =
			createHarness();
		const hudMode = commands.get("hud-mode")!;

		await hudMode.handler("footer", ctx);
		expect(writeFileSync).toHaveBeenLastCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"mode": "footer"'),
			"utf8",
		);
		expect(setFooter).toHaveBeenCalledTimes(1);
		expect(custom).not.toHaveBeenCalled();
		expect(notify).toHaveBeenLastCalledWith("HUD mode set to footer.", "info");

		await hudMode.handler("", ctx);
		expect(writeFileSync).toHaveBeenLastCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"mode": "overlay"'),
			"utf8",
		);
		expect(setFooter).toHaveBeenLastCalledWith(undefined);
		expect(custom).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenLastCalledWith("HUD mode set to overlay.", "info");

		await hudMode.handler("footer", ctx);
		expect(hideHandle).toHaveBeenCalledTimes(1);
		expect(setFooter).toHaveBeenCalledTimes(3);

		vi.mocked(writeFileSync).mockClear();
		await hudMode.handler("invalid", ctx);
		expect(writeFileSync).not.toHaveBeenCalled();
		expect(notify).toHaveBeenLastCalledWith(
			"Usage: /hud-mode [footer|overlay]",
			"warning",
		);
	});

	test("switch shortcut toggles between footer and overlay immediately", async () => {
		const { shortcuts, ctx, custom, notify, setFooter } = createHarness();

		await shortcuts.get("ctrl+.")!.handler(ctx);
		expect(writeFileSync).toHaveBeenLastCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"mode": "footer"'),
			"utf8",
		);
		expect(setFooter).toHaveBeenCalledTimes(1);
		expect(custom).not.toHaveBeenCalled();
		expect(notify).toHaveBeenLastCalledWith("HUD mode set to footer.", "info");

		await shortcuts.get("ctrl+.")!.handler(ctx);
		expect(writeFileSync).toHaveBeenLastCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"mode": "overlay"'),
			"utf8",
		);
		expect(setFooter).toHaveBeenLastCalledWith(undefined);
		expect(custom).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenLastCalledWith("HUD mode set to overlay.", "info");
	});

	test("/hud-mode restores expanded overlay after switching from minimized overlay through footer", async () => {
		const { commands, shortcuts, ctx, capturedOptions } = createHarness();
		const hudMode = commands.get("hud-mode")!;

		await commands.get("hud")!.handler("", ctx);
		await shortcuts.get("ctrl+h")!.handler(ctx);
		expect(getOverlayOptions(capturedOptions[0]).width).toBe(26);

		await hudMode.handler("footer", ctx);
		await hudMode.handler("overlay", ctx);

		expect(getOverlayOptions(capturedOptions[1]).width).toBe(42);
	});

	test("switch shortcut restores expanded overlay after switching from minimized overlay through footer", async () => {
		const { commands, shortcuts, ctx, capturedOptions } = createHarness();

		await commands.get("hud")!.handler("", ctx);
		await shortcuts.get("ctrl+h")!.handler(ctx);
		expect(getOverlayOptions(capturedOptions[0]).width).toBe(26);

		await shortcuts.get("ctrl+.")!.handler(ctx);
		await shortcuts.get("ctrl+.")!.handler(ctx);

		expect(getOverlayOptions(capturedOptions[1]).width).toBe(42);
	});

	test("footer handles unknown session ids gracefully", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			sessionId: "unknown",
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		expect(capturedFooterComponents[0]!.render(120).join("\n")).toContain(
			"🔁 Session  resume unavailable",
		);
	});

	test("footer preserves the full resume command for long session ids", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const sessionId = "019e9925-92bb-78d7-aa4a-44ef32c10fcc";
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			sessionId,
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const rendered = capturedFooterComponents[0]!.render(160).join("\n");
		expect(rendered).toContain(`🔁 Session  resume: pi --session ${sessionId}`);
		expect(rendered).not.toContain("019e…0fcc");
	});

	test("footer prefers live MCP extension status over configured MCP fallback", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			mcpAdapter: true,
			extensionStatuses: new Map([
				["lsp", "LSP Inactive"],
				["mcp", "MCP: 1/5 servers"],
			]),
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const rendered = capturedFooterComponents[0]!
			.render(120)
			.map(unwrapBg)
			.join("\n");
		expect(rendered).toContain("MCP      1/5 servers");
		expect(rendered).toContain("Status: LSP Inactive");
		expect(rendered).not.toContain("Status: LSP Inactive │ MCP: 1/5 servers");
		expect(rendered).not.toContain("MCP      2/2 servers");
		expect(rendered).toContain("Worktree: No worktrees");
	});

	test("footer suppresses styled MCP status from help status segment", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness({
			mcpAdapter: true,
			extensionStatuses: new Map([
				["mcp", "\u001B[32mMCP:\u001B[0m 2/3 servers"],
			]),
		});

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		const rendered = capturedFooterComponents[0]!
			.render(120)
			.map(unwrapBg)
			.join("\n");
		expect(rendered).toContain("MCP      2/3 servers");
		expect(rendered).not.toContain("Status: MCP:");
		expect(rendered).not.toContain("Status:");
		expect(rendered).not.toContain("MCP      2/2 servers");
	});

	test("footer shows the current path when linked worktrees exist", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		vi.mocked(spawnSync).mockImplementation((command, args) => {
			if (
				command === "git" &&
				Array.isArray(args) &&
				args.includes("worktree")
			) {
				return {
					status: 0,
					stdout: [
						"worktree /repo/project",
						"HEAD abc123",
						"branch refs/heads/main",
						"",
						"worktree /repo/project-feature",
						"HEAD def456",
						"branch refs/heads/feature/footer",
					].join("\n"),
				} as never;
			}
			return (
				Array.isArray(args) && args.includes("status")
					? { status: 0, stdout: "" }
					: { status: 0, stdout: "main\n" }
			) as never;
		});
		const { eventHandlers, ctx, capturedFooterComponents } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		expect(capturedFooterComponents[0]!.render(100).join("\n")).toContain(
			"Worktree: /repo/project",
		);
	});

	test("footer marks dirty and conflicted git branches with status icons", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		vi.mocked(spawnSync).mockImplementation(
			(_command, args) =>
				(Array.isArray(args) && args.includes("status")
					? { status: 0, stdout: " M file.ts\n" }
					: { status: 0, stdout: "main\n" }) as never,
		);
		const dirtyHarness = createHarness();

		for (const handler of dirtyHarness.eventHandlers.get("session_start") ??
			[]) {
			await handler({ type: "session_start" }, dirtyHarness.ctx);
		}

		expect(
			dirtyHarness.capturedFooterComponents[0]!.render(80).join("\n"),
		).toContain("🟡 (main*)");

		vi.mocked(spawnSync).mockImplementation(
			(_command, args) =>
				(Array.isArray(args) && args.includes("status")
					? { status: 0, stdout: "UU file.ts\n" }
					: { status: 0, stdout: "main\n" }) as never,
		);
		const conflictHarness = createHarness();

		for (const handler of conflictHarness.eventHandlers.get("session_start") ??
			[]) {
			await handler({ type: "session_start" }, conflictHarness.ctx);
		}

		expect(
			conflictHarness.capturedFooterComponents[0]!.render(80).join("\n"),
		).toContain("🔴 (main!)");
	});

	test("footer context percentage uses warning and error styling", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const warningHarness = createHarness({
			contextPercent: 66,
			showThemeColors: true,
		});
		for (const handler of warningHarness.eventHandlers.get("session_start") ??
			[]) {
			await handler({ type: "session_start" }, warningHarness.ctx);
		}
		expect(
			warningHarness.capturedFooterComponents[0]!.render(120).join("\n"),
		).toContain("<warning>🟡 66.0%</warning>");

		const highWarningHarness = createHarness({
			contextPercent: 88,
			showThemeColors: true,
		});
		for (const handler of highWarningHarness.eventHandlers.get(
			"session_start",
		) ?? []) {
			await handler({ type: "session_start" }, highWarningHarness.ctx);
		}
		expect(
			highWarningHarness.capturedFooterComponents[0]!.render(120).join("\n"),
		).toContain("<warning><bold>🟡 88.0%</bold></warning>");

		const errorHarness = createHarness({
			contextPercent: 96,
			showThemeColors: true,
		});
		for (const handler of errorHarness.eventHandlers.get("session_start") ??
			[]) {
			await handler({ type: "session_start" }, errorHarness.ctx);
		}
		expect(
			errorHarness.capturedFooterComponents[0]!.render(120).join("\n"),
		).toContain("<error><bold>🔴 96.0%</bold></error>");
	});

	test("footer mode restores Pi's default footer on shutdown", async () => {
		mockSettingsFile("/repo/project/.pi/settings.json", {
			hud: { mode: "footer" },
		});
		const { eventHandlers, ctx, setFooter } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}
		for (const handler of eventHandlers.get("session_shutdown") ?? []) {
			await handler({ type: "session_shutdown" }, ctx);
		}

		expect(setFooter).toHaveBeenLastCalledWith(undefined);
	});

	test("minimizes and expands with the configured minimize shortcut", async () => {
		const {
			commands,
			shortcuts,
			ctx,
			capturedOptions,
			capturedComponents,
			requestRender,
		} = createHarness();

		await commands.get("hud")!.handler("", ctx);
		expect(getOverlayOptions(capturedOptions[0]).width).toBe(42);

		await shortcuts.get("ctrl+h")!.handler(ctx);
		expect(requestRender).toHaveBeenCalled();
		expect(getOverlayOptions(capturedOptions[0]).width).toBe(26);
		expect(capturedComponents[0]!.render(26).join("\n")).toContain("HUD");

		await shortcuts.get("ctrl+h")!.handler(ctx);
		expect(getOverlayOptions(capturedOptions[0]).width).toBe(42);
		expect(capturedComponents[0]!.render(42).join("\n")).toContain("Pi HUD");
	});

	test("minimize shortcut can expand during an auto-compact assistant turn", async () => {
		const {
			commands,
			shortcuts,
			ctx,
			eventHandlers,
			capturedOptions,
			capturedComponents,
		} = createHarness();

		await commands.get("hud")!.handler("", ctx);
		for (const handler of eventHandlers.get("turn_start") ?? []) {
			await handler({ type: "turn_start" }, ctx);
		}
		expect(getOverlayOptions(capturedOptions[0]).width).toBe(26);

		await shortcuts.get("ctrl+h")!.handler(ctx);
		expect(getOverlayOptions(capturedOptions[0]).width).toBe(42);
		expect(capturedComponents[0]!.render(42).join("\n")).toContain("Pi HUD");
	});

	test("toggles by hiding the captured handle and recreates a fresh overlay", async () => {
		vi.useFakeTimers();
		try {
			const { commands, ctx, custom, requestRender, hideHandle } =
				createHarness();
			const hud = commands.get("hud")!;
			await hud.handler("", ctx);
			expect(custom).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(1000);
			expect(requestRender).toHaveBeenCalledTimes(1);

			await hud.handler("", ctx);
			expect(hideHandle).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(1000);
			expect(requestRender).toHaveBeenCalledTimes(1);

			await hud.handler("", ctx);
			expect(custom).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	test("clears opening state when custom overlay creation rejects", async () => {
		const { commands, ctx, custom } = createHarness({ rejectCustom: true });

		await commands.get("hud")!.handler("", ctx);
		await Promise.resolve();
		await commands.get("hud")!.handler("", ctx);

		expect(custom).toHaveBeenCalledTimes(2);
	});

	test("cleans up HUD state on session shutdown", async () => {
		vi.useFakeTimers();
		try {
			const { commands, ctx, eventHandlers, requestRender, hideHandle } =
				createHarness();

			await commands.get("hud")!.handler("", ctx);
			for (const handler of eventHandlers.get("session_shutdown") ?? []) {
				await handler({ type: "session_shutdown" }, ctx);
			}

			expect(hideHandle).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(1000);
			expect(requestRender).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	test("renders observable subagent status", async () => {
		const { commands, ctx, eventHandlers, capturedComponents } =
			createHarness();

		await commands.get("hud")!.handler("", ctx);
		let rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("0 run");
		expect(rendered).toContain("0 err");
		expect(rendered).toContain("subagents idle");

		for (const handler of eventHandlers.get("message_end") ?? []) {
			await handler(
				createSubagentMessageEvent("subagent-run-1", "running"),
				ctx,
			);
		}

		rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("1 run");
		expect(rendered).toContain("[·] 1 running");
		expect(rendered).toContain("• subagent");

		for (const handler of eventHandlers.get("message_end") ?? []) {
			await handler(
				createSubagentMessageEvent("subagent-run-1", "completed"),
				ctx,
			);
		}

		rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("0 run");
		expect(rendered).toContain("1 done");
		expect(rendered).toContain("0 err");
	});

	test("renders multiple active subagents as an expanded list", async () => {
		vi.useFakeTimers();
		try {
			const { commands, ctx, eventHandlers, capturedComponents } =
				createHarness();

			await commands.get("hud")!.handler("", ctx);
			for (const handler of eventHandlers.get("message_end") ?? []) {
				await handler(
					createSubagentProgressMessageEvent("subagent-run-1", [
						{ status: "running", agent: "scout", durationMs: 3000 },
						{ status: "running", agent: "reviewer", durationMs: 1000 },
					]),
					ctx,
				);
			}

			const rendered = capturedComponents[0]!.render(42).join("\n");
			expect(rendered).toContain("2 run");
			expect(rendered).toContain("[·] 2 running");
			expect(rendered).toContain("• scout");
			expect(rendered).toContain("• reviewer");
			expect(rendered).toContain("00:03");
			expect(rendered).toContain("00:01");
		} finally {
			vi.useRealTimers();
		}
	});

	test("caps expanded active subagent list", async () => {
		const { commands, ctx, eventHandlers, capturedComponents } =
			createHarness();

		await commands.get("hud")!.handler("", ctx);
		for (const handler of eventHandlers.get("message_end") ?? []) {
			await handler(
				createSubagentProgressMessageEvent(
					"subagent-run-1",
					Array.from({ length: 6 }, (_, index) => ({
						status: "running",
						agent: `agent-${index + 1}`,
					})),
				),
				ctx,
			);
		}

		const rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("6 run");
		expect(rendered).toContain("• agent-1");
		expect(rendered).toContain("• agent-5");
		expect(rendered).not.toContain("• agent-6");
		expect(rendered).toContain("+1 more");
	});

	test("renders batched subagent tool tasks as individual active rows", async () => {
		const { commands, ctx, eventHandlers, capturedComponents } =
			createHarness();

		await commands.get("hud")!.handler("", ctx);
		for (const handler of eventHandlers.get("tool_execution_start") ?? []) {
			await handler(
				{
					type: "tool_execution_start",
					toolName: "subagent",
					toolCallId: "tool-1",
					args: {
						tasks: [
							{ agent: "scout", task: "Map files" },
							{ agent: "reviewer", task: "Review diff" },
						],
					},
				},
				ctx,
			);
		}

		let rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("2 run");
		expect(rendered).toContain("[·] 2 running");
		expect(rendered).toContain("• Map files");
		expect(rendered).toContain("• Review diff");

		for (const handler of eventHandlers.get("tool_execution_end") ?? []) {
			await handler(
				{
					type: "tool_execution_end",
					toolName: "subagent",
					toolCallId: "tool-1",
					isError: false,
				},
				ctx,
			);
		}

		rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("0 run");
		expect(rendered).toContain("2 done");
	});

	test("keeps compact subagent status summary-only", async () => {
		const { commands, shortcuts, ctx, eventHandlers, capturedComponents } =
			createHarness();

		await commands.get("hud")!.handler("", ctx);
		for (const handler of eventHandlers.get("message_end") ?? []) {
			await handler(
				createSubagentProgressMessageEvent("subagent-run-1", [
					{ status: "running", agent: "scout" },
					{ status: "running", agent: "reviewer" },
				]),
				ctx,
			);
		}
		await shortcuts.get("ctrl+h")!.handler(ctx);

		const rendered = capturedComponents[0]!.render(26).join("\n");
		expect(rendered).toContain("2 run");
		expect(rendered).toContain("[·] scout");
		expect(rendered).not.toContain("• scout");
		expect(rendered).not.toContain("• reviewer");
	});

	test("renders live subagent tool execution with elapsed detail", async () => {
		vi.useFakeTimers();
		try {
			const { commands, ctx, eventHandlers, capturedComponents } =
				createHarness();

			await commands.get("hud")!.handler("", ctx);
			for (const handler of eventHandlers.get("tool_execution_start") ?? []) {
				await handler(
					{
						type: "tool_execution_start",
						toolName: "subagent",
						toolCallId: "tool-1",
						args: { task: "Run for up to 10 seconds" },
					},
					ctx,
				);
			}
			vi.advanceTimersByTime(2000);

			let rendered = capturedComponents[0]!.render(42).join("\n");
			expect(rendered).toContain("1 run");
			expect(rendered).toContain("[·] 1 running");
			expect(rendered).toContain("• Run for up to 10 seconds");
			expect(rendered).toContain("00:02");

			for (const handler of eventHandlers.get("tool_execution_end") ?? []) {
				await handler(
					{
						type: "tool_execution_end",
						toolName: "subagent",
						toolCallId: "tool-1",
						isError: false,
					},
					ctx,
				);
			}

			rendered = capturedComponents[0]!.render(42).join("\n");
			expect(rendered).toContain("0 run");
			expect(rendered).toContain("1 done");
		} finally {
			vi.useRealTimers();
		}
	});

	test("counts failed subagent tool result as error", async () => {
		const { commands, ctx, eventHandlers, capturedComponents } =
			createHarness();

		await commands.get("hud")!.handler("", ctx);
		for (const handler of eventHandlers.get("tool_execution_start") ?? []) {
			await handler(
				{
					type: "tool_execution_start",
					toolName: "subagent",
					toolCallId: "tool-1",
					args: { task: "fail" },
				},
				ctx,
			);
		}
		for (const handler of eventHandlers.get("tool_execution_end") ?? []) {
			await handler(
				{
					type: "tool_execution_end",
					toolName: "subagent",
					toolCallId: "tool-1",
					isError: false,
					result: { details: { results: [{ exitCode: 1 }] } },
				},
				ctx,
			);
		}

		const rendered = capturedComponents[0]!.render(42).join("\n");
		expect(rendered).toContain("0 run");
		expect(rendered).toContain("0 done");
		expect(rendered).toContain("1 err");
	});
});
