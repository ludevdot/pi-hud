import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type {
	Component,
	OverlayHandle,
	OverlayOptions,
	TUI,
} from "@earendil-works/pi-tui";
import { expect, vi } from "vitest";
import hudExtension from "../../extensions/hud.js";

export type RegisteredCommand = {
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
};

type EventHandler = (
	event: unknown,
	ctx: ExtensionCommandContext,
) => void | Promise<void>;

interface HudHarness {
	commands: Map<string, RegisteredCommand>;
	eventHandlers: Map<string, EventHandler[]>;
	shortcuts: Map<
		string,
		{ handler: (ctx: ExtensionCommandContext) => void | Promise<void> }
	>;
	ctx: ExtensionCommandContext;
	custom: ReturnType<typeof vi.fn>;
	notify: ReturnType<typeof vi.fn>;
	setStatus: ReturnType<typeof vi.fn>;
	select: ReturnType<typeof vi.fn>;
	input: ReturnType<typeof vi.fn>;
	requestRender: ReturnType<typeof vi.fn>;
	hideHandle: ReturnType<typeof vi.fn>;
	capturedComponents: Component[];
	capturedOptions: NonNullable<Parameters<ExtensionUIContext["custom"]>[1]>[];
}

interface HarnessOptions {
	rejectCustom?: boolean;
	resolveCustom?: boolean;
	mcpAdapter?: boolean;
	modelName?: string;
	selectChoices?: Array<string | undefined>;
	inputValues?: Array<string | undefined>;
}

export function createHarness(options: HarnessOptions = {}): HudHarness {
	const commands = new Map<string, RegisteredCommand>();
	const eventHandlers = new Map<string, EventHandler[]>();
	const shortcuts = new Map<
		string,
		{ handler: (ctx: ExtensionCommandContext) => void | Promise<void> }
	>();
	const requestRender = vi.fn();
	const hideHandle = vi.fn();
	const capturedComponents: Component[] = [];
	const capturedOptions: NonNullable<
		Parameters<ExtensionUIContext["custom"]>[1]
	>[] = [];
	const fakeTui = { requestRender } as unknown as TUI;
	const fakeTheme = createTheme();
	const fakeHandle = {
		hide: hideHandle,
		setHidden: vi.fn(),
		isHidden: vi.fn(() => false),
		focus: vi.fn(),
		unfocus: vi.fn(),
		isFocused: vi.fn(() => false),
	} satisfies OverlayHandle;

	const notify = vi.fn();
	const setStatus = vi.fn();
	const selectChoices = [...(options.selectChoices ?? [])];
	const inputValues = [...(options.inputValues ?? [])];
	const select = vi.fn(async () => selectChoices.shift());
	const input = vi.fn(async () => inputValues.shift());
	const custom = vi.fn(
		(
			factory: Parameters<ExtensionUIContext["custom"]>[0],
			customOptions?: Parameters<ExtensionUIContext["custom"]>[1],
		) => {
			capturedOptions.push(customOptions ?? {});
			if (options.rejectCustom) {
				return Promise.reject(new Error("custom overlay failed"));
			}

			const done = vi.fn();
			const component = factory(fakeTui, fakeTheme as never, {} as never, done);
			capturedComponents.push(component as Component);
			customOptions?.onHandle?.(fakeHandle);
			if (options.resolveCustom) return Promise.resolve(undefined);
			return new Promise<void>(() => {});
		},
	);

	const api = {
		on: (event: string, handler: EventHandler) => {
			const handlers = eventHandlers.get(event) ?? [];
			handlers.push(handler);
			eventHandlers.set(event, handlers);
		},
		registerCommand: (name: string, command: RegisteredCommand) => {
			commands.set(name, command);
		},
		registerShortcut: (
			shortcut: string,
			shortcutOptions: {
				handler: (ctx: ExtensionCommandContext) => void | Promise<void>;
			},
		) => {
			shortcuts.set(shortcut, shortcutOptions);
		},
		getSessionName: () => "Named session",
		getAllTools: () =>
			options.mcpAdapter
				? [
						{
							name: "mcp",
							description: "MCP proxy",
							parameters: {},
							sourceInfo: createMcpAdapterSourceInfo(),
						},
					]
				: [],
		getCommands: () =>
			options.mcpAdapter
				? [
						{
							name: "mcp",
							source: "extension",
							sourceInfo: createMcpAdapterSourceInfo(),
						},
					]
				: [],
	} as unknown as ExtensionAPI;

	hudExtension(api);

	const assistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		usage: {
			input: 1000,
			output: 200,
			cacheRead: 50,
			cacheWrite: 25,
			totalTokens: 1275,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
		},
	};

	const ctx = {
		hasUI: true,
		ui: {
			custom,
			notify,
			setStatus,
			select,
			input,
		} as unknown as ExtensionCommandContext["ui"],
		cwd: "/repo",
		getContextUsage: () => ({
			tokens: 12_000,
			contextWindow: 200_000,
			percent: 6,
		}),
		sessionManager: {
			getSessionName: () => undefined,
			getSessionId: () => "session-1234",
			getCwd: () => "/repo/project",
			getBranch: () => [{ type: "message", message: assistantMessage }],
		} as unknown as ExtensionCommandContext["sessionManager"],
		model: {
			id: "model-id",
			name: options.modelName ?? "Model Name",
			contextWindow: 200_000,
		},
	} as unknown as ExtensionCommandContext;

	return {
		commands,
		eventHandlers,
		shortcuts,
		ctx,
		custom,
		notify,
		setStatus,
		select,
		input,
		requestRender,
		hideHandle,
		capturedComponents,
		capturedOptions,
	};
}

export async function expectCommandReturnsPromptly(
	command: RegisteredCommand,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const result = await Promise.race([
		command.handler("", ctx).then(() => "resolved" as const),
		new Promise<"pending">((resolve) =>
			setTimeout(() => resolve("pending"), 0),
		),
	]);
	expect(result).toBe("resolved");
}

export function getOverlayOptions(
	options: NonNullable<Parameters<ExtensionUIContext["custom"]>[1]> | undefined,
): OverlayOptions {
	const overlayOptions = options?.overlayOptions;
	if (typeof overlayOptions === "function") return overlayOptions();
	return overlayOptions ?? {};
}

export function createAssistantMessageEvent(
	type: "message_start" | "message_update" | "message_end",
): unknown {
	return {
		type,
		message: {
			role: "assistant",
			content: [{ type: "text", text: "streaming" }],
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { total: 0 },
			},
		},
	};
}

export function createSubagentMessageEvent(
	requestId: string,
	status: "running" | "completed" | "failed",
): unknown {
	return {
		type: "message_end",
		message: {
			role: "custom",
			customType: "subagent-slash-result",
			details: {
				requestId,
				result: { details: { progress: [{ status }] } },
			},
		},
	};
}

function createTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function createMcpAdapterSourceInfo() {
	return {
		path: "/packages/pi-mcp-adapter/index.js",
		source: "npm:pi-mcp-adapter",
		scope: "user",
		origin: "package",
	};
}
