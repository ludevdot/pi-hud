import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../utils/records.js";

export function getMcpAdapterInfo(
	pi: ExtensionAPI,
	cwd: string,
): { available: boolean; servers: string[] } {
	const hasAdapter =
		pi
			.getAllTools()
			.some((tool) => isMcpAdapterSource(tool.sourceInfo.source)) ||
		pi
			.getCommands()
			.some((command) => isMcpAdapterSource(command.sourceInfo.source));
	if (!hasAdapter) return { available: false, servers: [] };
	return { available: true, servers: getConfiguredMcpServers(cwd) };
}

function isMcpAdapterSource(source: string): boolean {
	return (
		source.includes("pi-mcp-adapter") ||
		source.includes("nicobailon/pi-mcp-adapter")
	);
}

function getConfiguredMcpServers(cwd: string): string[] {
	const names = new Set<string>();
	for (const path of getMcpConfigPaths(cwd)) {
		for (const name of readExistingMcpServerNames(path) ?? []) {
			names.add(name);
		}
	}
	return sortServerNames([...names]);
}

function getPiAgentMcpConfigPath(): string {
	const agentDir =
		process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(agentDir, "mcp.json");
}

function getMcpConfigPaths(cwd: string): string[] {
	return [
		join(homedir(), ".config", "mcp", "mcp.json"),
		getPiAgentMcpConfigPath(),
		join(cwd, ".mcp.json"),
		join(cwd, ".pi", "mcp.json"),
	];
}

function readExistingMcpServerNames(path: string): string[] | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return [];
		const servers = parsed.mcpServers ?? parsed["mcp-servers"];
		if (!isRecord(servers)) return [];
		return Object.keys(servers);
	} catch {
		return [];
	}
}

function sortServerNames(servers: string[]): string[] {
	return [...servers].sort((a, b) => a.localeCompare(b));
}
