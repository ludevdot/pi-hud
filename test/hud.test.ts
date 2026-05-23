import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi } from "vitest";
import { readHudSettings } from "../extensions/settings/hud-settings.js";
import {
	createAssistantMessageEvent,
	createHarness,
	createSubagentMessageEvent,
	expectCommandReturnsPromptly,
	getOverlayOptions,
} from "./helpers/hud-harness.js";

const fsMockState = vi.hoisted(() => ({
	settingsFiles: new Map<string, string>(),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(
		(path: string) =>
			fsMockState.settingsFiles.has(path) ||
			path.endsWith(".git") ||
			path.endsWith("HEAD") ||
			path.endsWith(".mcp.json"),
	),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn((path: string) => {
		const mocked = fsMockState.settingsFiles.get(path);
		if (mocked !== undefined) return mocked;
		if (path.endsWith(".mcp.json"))
			return JSON.stringify({ mcpServers: { filesystem: {}, github: {} } });
		return "";
	}),
	statSync: vi.fn(() => ({ isFile: () => false, isDirectory: () => true })),
	writeFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(() => ({ status: 0, stdout: "main\n" })),
}));

afterEach(() => {
	fsMockState.settingsFiles.clear();
	delete process.env.PI_CODING_AGENT_DIR;
	vi.mocked(spawnSync).mockImplementation(
		() => ({ status: 0, stdout: "main\n" }) as never,
	);
	vi.clearAllMocks();
});

function mockSettingsFile(path: string, settings: unknown): void {
	fsMockState.settingsFiles.set(path, JSON.stringify(settings));
}

function hasInputHandler(
	component: Component | undefined,
): component is Component & { handleInput(data: string): void } {
	return typeof component?.handleInput === "function";
}

describe("pi-hud extension", () => {
	test("loads default visibility and safely merges supported keys only", () => {
		process.env.PI_CODING_AGENT_DIR = "/agent";
		expect(readHudSettings("/repo/project").visibility).toEqual({
			context: true,
			project: true,
			worktrees: true,
			mcps: true,
		});
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
		expect(readHudSettings("/repo/project").visibility).toEqual({
			context: true,
			project: true,
			worktrees: true,
			mcps: false,
		});
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
		expect(rendered).not.toContain("6.0% ctx");
		expect(rendered).toContain("1 run");
		expect(rendered).toContain("[·] visible agent");
	});

	test("interactive modules visibility opens toggles, reset default, and one reload status", async () => {
		const {
			commands,
			ctx,
			custom,
			notify,
			select,
			setStatus,
			capturedComponents,
		} = createHarness({
			selectChoices: ["Modules visibility"],
			resolveCustom: true,
		});

		await commands.get("hud-settings")!.handler("", ctx);

		expect(select).toHaveBeenCalledWith(
			"HUD settings",
			expect.arrayContaining(["Modules visibility"]),
		);
		expect(custom).toHaveBeenCalledTimes(1);
		expect(capturedComponents).toHaveLength(1);
		const visibilityComponent = capturedComponents[0];
		if (!hasInputHandler(visibilityComponent)) {
			throw new Error("Expected Modules visibility component to handle input.");
		}

		const rendered = visibilityComponent.render(60).join("\n");
		expect(rendered).toContain("Modules visibility");
		expect(rendered).toContain("Context");
		expect(rendered).toContain("Project path + Branches");
		expect(rendered).toContain("Worktrees");
		expect(rendered).toContain("Configured MCPs");
		expect(rendered).toContain("Default settings");
		expect(rendered).not.toContain("Subagents");

		visibilityComponent.handleInput(" ");
		expect(writeFileSync).toHaveBeenCalledWith(
			"/repo/project/.pi/settings.json",
			expect.stringContaining('"context": false'),
			"utf8",
		);
		expect(notify).not.toHaveBeenCalledWith(
			expect.stringContaining("Run /reload"),
			"warning",
		);
		expect(setStatus).toHaveBeenCalledWith(
			"pi-hud.modules-visibility.reload",
			expect.stringContaining("Run /reload"),
		);

		visibilityComponent.handleInput(" ");
		expect(setStatus).toHaveBeenLastCalledWith(
			"pi-hud.modules-visibility.reload",
			undefined,
		);
	});

	test("registers HUD commands and default shortcuts only", () => {
		const { commands, shortcuts } = createHarness();

		expect(commands.has("hud")).toBe(true);
		expect(commands.has("hud-settings")).toBe(true);
		expect(commands.has("sidebar")).toBe(false);
		expect(commands.has("session-sidebar")).toBe(false);
		expect([...shortcuts.keys()].sort()).toEqual(["ctrl+h", "f2"]);
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
		expect(rendered).toContain("branch main");
		expect(rendered).not.toContain("Git worktrees");
		expect(rendered).not.toContain("MCP");
		expect(rendered).toContain("/hud or f2 hide/show");
		expect(rendered).toContain("ctrl+h minimize/expand");
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

		expect(rendered).toContain("6.0% ctx");
		expect(rendered).not.toContain("Very Long Model Name For Header");
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

		expect(writeFileSync).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledTimes(3);
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

	test("starts visible by default on session start", async () => {
		const { eventHandlers, ctx, custom } = createHarness();

		for (const handler of eventHandlers.get("session_start") ?? []) {
			await handler({ type: "session_start" }, ctx);
		}

		expect(custom).toHaveBeenCalledTimes(1);
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
		expect(rendered).toContain("[·] subagent");

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
			expect(rendered).toContain("[·] Run for up to 10 seconds");
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
