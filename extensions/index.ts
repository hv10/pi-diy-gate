import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type Config = {
	enabled: boolean;
	judgeDifficulty: boolean;
	model?: string;
	validRejectEvery: number;
	validRandomRejectProbability: number;
	difficultRejectEvery: number;
	visibleFeedback: boolean;
};

type GateState = {
	validRequests: number;
	difficultRequests: number;
};

type Judgement = {
	difficult: boolean;
	solvableWithinFiveMinutes: boolean;
	timeIntensive: boolean;
	rationale: string;
};

type SessionEntry = {
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
		toolName?: string;
		details?: unknown;
	};
};

const DEFAULT_CONFIG: Config = {
	enabled: true,
	judgeDifficulty: true,
	validRejectEvery: 5,
	validRandomRejectProbability: 0.01,
	difficultRejectEvery: 10,
	visibleFeedback: true,
};

const userConfigPath = () => join(homedir(), ".pi", "agent", "pi-diy-gate.json");
const statePath = () => join(homedir(), ".pi", "agent", "pi-diy-gate-state.json");

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function readJsonFile(path: string): unknown {
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf8"));
}

function loadConfig(cwd: string, projectTrusted: boolean): Config {
	const raw = {
		...(readJsonFile(userConfigPath()) as object | undefined),
		...(projectTrusted ? (readJsonFile(join(cwd, CONFIG_DIR_NAME, "pi-diy-gate.json")) as object | undefined) : undefined),
	} as Partial<Config>;

	return {
		enabled: raw.enabled ?? DEFAULT_CONFIG.enabled,
		judgeDifficulty: raw.judgeDifficulty ?? DEFAULT_CONFIG.judgeDifficulty,
		model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined,
		validRejectEvery: Math.max(0, Number(raw.validRejectEvery ?? DEFAULT_CONFIG.validRejectEvery)),
		validRandomRejectProbability: clamp(
			Number(raw.validRandomRejectProbability ?? DEFAULT_CONFIG.validRandomRejectProbability),
			0,
			1,
		),
		difficultRejectEvery: Math.max(0, Number(raw.difficultRejectEvery ?? DEFAULT_CONFIG.difficultRejectEvery)),
		visibleFeedback: raw.visibleFeedback ?? DEFAULT_CONFIG.visibleFeedback,
	};
}

function loadState(): GateState {
	const raw = readJsonFile(statePath()) as Partial<GateState> | undefined;
	return {
		validRequests: Math.max(0, Number(raw?.validRequests ?? 0)),
		difficultRequests: Math.max(0, Number(raw?.difficultRequests ?? 0)),
	};
}

function saveState(state: GateState) {
	mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
	writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const block = part as { type?: string; text?: string; name?: string; arguments?: unknown };
			if (block.type === "text" && typeof block.text === "string") return block.text;
			if (block.type === "toolCall" && typeof block.name === "string") {
				return `[tool call: ${block.name} ${JSON.stringify(block.arguments ?? {})}]`;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function lastTurnText(entries: SessionEntry[]): string {
	const parts: string[] = [];
	let sawUser = false;
	let sawAssistant = false;

	for (let i = entries.length - 1; i >= 0; i--) {
		const message = entries[i]?.message;
		if (!message?.role || (message.role !== "user" && message.role !== "assistant")) continue;
		const text = textFromContent(message.content).trim();
		if (!text) continue;
		parts.unshift(`${message.role}: ${text}`);
		if (message.role === "user") sawUser = true;
		if (message.role === "assistant") sawAssistant = true;
		if (sawUser && sawAssistant) break;
	}

	return parts.join("\n\n");
}

function conversationText(entries: SessionEntry[]): string {
	return entries
		.map((entry) => {
			const message = entry.message;
			if (!message?.role) return "";
			const text = textFromContent(message.content).trim();
			if (!text) return "";
			return `${message.role}: ${text}`;
		})
		.filter(Boolean)
		.join("\n\n");
}

function extractJsonObject(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
	return JSON.parse(candidate);
}

function parseJudgement(text: string): Judgement {
	const raw = extractJsonObject(text) as Partial<Judgement>;
	return {
		difficult: raw.difficult === true,
		solvableWithinFiveMinutes: raw.solvableWithinFiveMinutes === true,
		timeIntensive: raw.timeIntensive === true || raw.solvableWithinFiveMinutes === false,
		rationale: typeof raw.rationale === "string" ? raw.rationale : "No rationale returned.",
	};
}

export function decideRejection(
	judgement: Judgement,
	state: GateState,
	config: Config,
	randomValue: number,
): { reject: boolean; reason: "valid-frequency" | "valid-random" | "difficult-frequency" | "none"; state: GateState } {
	const valid = !config.judgeDifficulty || (!judgement.difficult && judgement.solvableWithinFiveMinutes);
	const next = { ...state };

	if (valid) {
		next.validRequests += 1;
		if (config.validRejectEvery > 0 && next.validRequests % config.validRejectEvery === 0) {
			return { reject: true, reason: "valid-frequency", state: next };
		}
		if (randomValue < config.validRandomRejectProbability) {
			return { reject: true, reason: "valid-random", state: next };
		}
		return { reject: false, reason: "none", state: next };
	}

	if (judgement.difficult) {
		next.difficultRequests += 1;
		if (config.difficultRejectEvery > 0 && next.difficultRequests % config.difficultRejectEvery === 0) {
			return { reject: true, reason: "difficult-frequency", state: next };
		}
	}

	return { reject: false, reason: "none", state: next };
}

function judgementPrompt(prompt: string, lastTurn: string): string {
	return [
		"Judge only the current user prompt and the immediately previous conversation turn.",
		"Ignore all other conversation context.",
		"A valid request is BOTH not genuinely difficult and solvable by the user within 5 minutes.",
		"Return only JSON with this exact shape:",
		'{"difficult":boolean,"solvableWithinFiveMinutes":boolean,"timeIntensive":boolean,"rationale":"short reason"}',
		"",
		"<last_turn>",
		lastTurn || "(none)",
		"</last_turn>",
		"",
		"<current_prompt>",
		prompt,
		"</current_prompt>",
	].join("\n");
}

function solutionPrompt(prompt: string, fullConversation: string): string {
	return [
		"You are helping a Pi extension create a teaching prompt.",
		"Do not implement anything. Do not write files, commands, patches, or final user-facing prose.",
		"Explain how you would solve the user's request as private guidance for another model.",
		"Use the full conversation context below.",
		"",
		"<full_conversation>",
		fullConversation || "(none)",
		"</full_conversation>",
		"",
		"<current_prompt>",
		prompt,
		"</current_prompt>",
	].join("\n");
}

function learningPrompt(originalPrompt: string, recommendedSolution: string): string {
	return [
		"Convert the recommended solution into a reverse-learning prompt for the user.",
		"Use only the original prompt and recommended solution below.",
		"Do not reveal the full solution. Do not give code, commands, or exact final answers.",
		"Ask the user to try the task themselves and give pointers about what information to inspect.",
		"Start with: This request should be done by yourself.",
		"",
		"<original_prompt>",
		originalPrompt,
		"</original_prompt>",
		"",
		"<recommended_solution>",
		recommendedSolution,
		"</recommended_solution>",
	].join("\n");
}

function parseModelRef(ref: string): [string, string] {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) throw new Error(`Expected model as provider/model, got ${ref}`);
	return [ref.slice(0, slash), ref.slice(slash + 1)];
}

function resolveModel(ctx: any, config: Config): any {
	if (!config.model) {
		if (!ctx.model) throw new Error("No active model selected.");
		return ctx.model;
	}

	const [provider, id] = parseModelRef(config.model);
	const model = ctx.modelRegistry.find(provider, id);
	if (!model) throw new Error(`Model not found: ${config.model}`);
	if (ctx.modelRegistry.hasConfiguredAuth && !ctx.modelRegistry.hasConfiguredAuth(model)) {
		throw new Error(`No authentication configured for ${config.model}`);
	}
	return model;
}

async function callModel(ctx: any, config: Config, prompt: string, reason: string): Promise<string> {
	const response = await ctx.modelRegistry.complete(
		resolveModel(ctx, config),
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{
			reasoningEffort: "low",
			cacheRetention: "none",
			sessionId: `pi-diy-gate-${reason}-${randomUUID()}`,
		} as any,
	);

	return (response.content ?? [])
		.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n")
		.trim();
}

function rejectionText(reason: string, config: Config): string {
	const suffix = config.judgeDifficulty
		? "for a request judged doable within 5 minutes."
		: "because difficulty judging is off and every request counts as valid practice.";
	return [
		"This request should be done by yourself.",
		"",
		reason === "valid-random" ? `This was a random practice rejection ${suffix}` : `This was the scheduled practice rejection ${suffix}`,
	].join("\n");
}

function show(ctx: any, config: Config, text: string) {
	if (!config.visibleFeedback || !ctx.hasUI) return;
	ctx.ui.setStatus("pi-diy-gate", text);
	ctx.ui.notify(`Pi DIY gate: ${text}`, "info");
}

export default function (pi: ExtensionAPI) {
	let runtimeEnabled: boolean | undefined;
	let runtimeJudgeDifficulty: boolean | undefined;
	let runtimeModel: string | undefined;

	const getConfig = (ctx: any): Config => {
		const config = loadConfig(ctx.cwd, ctx.isProjectTrusted());
		if (runtimeEnabled !== undefined) config.enabled = runtimeEnabled;
		if (runtimeJudgeDifficulty !== undefined) config.judgeDifficulty = runtimeJudgeDifficulty;
		if (runtimeModel !== undefined) config.model = runtimeModel || undefined;
		return config;
	};

	pi.registerEntryRenderer("pi-diy-gate", (entry: any, options: any, theme: any) => {
		return new Text(theme.fg("warning", entry.data?.content ?? ""), options.outputPad, 0);
	});

	pi.registerCommand("diy-on", {
		description: "Enable Pi DIY gate for this Pi run",
		handler: async (_args, ctx) => {
			runtimeEnabled = true;
			ctx.ui.notify("Pi DIY gate enabled", "info");
		},
	});

	pi.registerCommand("diy-off", {
		description: "Disable Pi DIY gate for this Pi run",
		handler: async (_args, ctx) => {
			runtimeEnabled = false;
			ctx.ui.notify("Pi DIY gate disabled", "info");
			ctx.ui.setStatus("pi-diy-gate", undefined);
		},
	});

	pi.registerCommand("diy-judge-on", {
		description: "Enable difficulty judging for this Pi run",
		handler: async (_args, ctx) => {
			runtimeJudgeDifficulty = true;
			ctx.ui.notify("DIY difficulty judging enabled", "info");
		},
	});

	pi.registerCommand("diy-judge-off", {
		description: "Disable difficulty judging; every request counts as valid",
		handler: async (_args, ctx) => {
			runtimeJudgeDifficulty = false;
			ctx.ui.notify("DIY difficulty judging disabled", "info");
		},
	});

	pi.registerCommand("diy-model", {
		description: "Set Pi DIY gate model for this Pi run: /diy-model provider/model, current, or default",
		handler: async (args, ctx) => {
			const value = args.trim();
			if (!value) {
				const config = getConfig(ctx);
				ctx.ui.notify(`DIY model: ${config.model ?? "current Pi model"}`, "info");
				return;
			}
			if (value === "default") {
				runtimeModel = undefined;
				ctx.ui.notify("DIY model reset to config/default", "info");
				return;
			}
			if (value === "current") {
				runtimeModel = "";
				ctx.ui.notify("DIY model set to current Pi model", "info");
				return;
			}

			if (!value.includes("/")) {
				ctx.ui.notify("Use /diy-model provider/model", "warning");
				return;
			}
			const [provider, id] = parseModelRef(value);
			if (!ctx.modelRegistry.find(provider, id)) {
				ctx.ui.notify(`Model not found: ${value}`, "warning");
				return;
			}
			runtimeModel = value;
			ctx.ui.notify(`DIY model set to ${value}`, "info");
		},
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" as const };

		let config = DEFAULT_CONFIG;
		try {
			config = getConfig(ctx);
			if (!config.enabled) return { action: "continue" as const };
			show(ctx, config, "loaded config");

			const entries = ctx.sessionManager.getBranch() as SessionEntry[];
			const judgement = config.judgeDifficulty
				? parseJudgement(await callModel(ctx, config, judgementPrompt(event.text, lastTurnText(entries)), "judge"))
				: { difficult: false, solvableWithinFiveMinutes: true, timeIntensive: false, rationale: "Difficulty judging disabled." };

			show(ctx, config, "updating counters");
			const decision = decideRejection(judgement, loadState(), config, Math.random());
			saveState(decision.state);

			if (!decision.reject) {
				show(ctx, config, "request allowed");
				ctx.ui.setStatus("pi-diy-gate", undefined);
				return { action: "continue" as const };
			}

			show(ctx, config, "rejecting request");
			let content = rejectionText(decision.reason, config);

			if (decision.reason === "difficult-frequency") {
				show(ctx, config, "asking model for private solution outline");
				const solution = await callModel(ctx, config, solutionPrompt(event.text, conversationText(entries)), "solution");
				show(ctx, config, "building reverse-learning prompt");
				content = await callModel(ctx, config, learningPrompt(event.text, solution), "learning");
				if (!content.startsWith("This request should be done by yourself.")) {
					content = `This request should be done by yourself.\n\n${content}`;
				}
			}

			pi.appendEntry("pi-diy-gate", { content });
			ctx.ui.setStatus("pi-diy-gate", undefined);
			return { action: "handled" as const };
		} catch (error) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Pi DIY gate failed open: ${error instanceof Error ? error.message : String(error)}`, "warning");
				ctx.ui.setStatus("pi-diy-gate", undefined);
			}
			return { action: "continue" as const };
		}
	});
}
