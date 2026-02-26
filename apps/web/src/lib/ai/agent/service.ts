import { generateUUID } from "@/utils/id";
import { streamChatCompletion } from "./llm-client";
import { buildSystemPrompt } from "./system-prompt";
import { getAllToolSchemas, getToolByName } from "./tools";
import type {
	AgentLLMConfig,
	AgentMessage,
	AgentToolResult,
	OpenAIChatMessage,
	PendingToolConfirmation,
} from "./types";

const MAX_TOOL_ROUNDS = 20;

export interface AgentServiceCallbacks {
	onMessageStart: () => void;
	onContentDelta: (delta: string) => void;
	onContentDone: (fullContent: string) => void;
	onToolCallStart: (toolCall: {
		id: string;
		name: string;
		arguments: Record<string, unknown>;
	}) => void;
	onToolCallResult: (toolCall: {
		id: string;
		name: string;
		result: AgentToolResult;
	}) => void;
	onMessagesUpdated: (messages: AgentMessage[]) => void;
	onConfirmationRequired: (
		confirmation: PendingToolConfirmation,
	) => Promise<boolean>;
	onDone: () => void;
	onError: (error: Error) => void;
}

function agentMessagesToOpenAI({
	messages,
}: {
	messages: AgentMessage[];
}): OpenAIChatMessage[] {
	return messages
		.filter((m) => m.role !== "system")
		.map((m) => {
			if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
				return {
					role: "assistant" as const,
					content: m.content || null,
					tool_calls: m.toolCalls.map((tc) => ({
						id: tc.id,
						type: "function" as const,
						function: {
							name: tc.name,
							arguments: JSON.stringify(tc.arguments),
						},
					})),
				};
			}

			if (m.role === "tool") {
				return {
					role: "tool" as const,
					content: m.content,
					tool_call_id: m.toolCallId ?? "",
				};
			}

			return {
				role: m.role as "user" | "assistant",
				content: m.content,
			};
		});
}

export async function runAgentLoop({
	config,
	messages,
	autoMode,
	callbacks,
	signal,
}: {
	config: AgentLLMConfig;
	messages: AgentMessage[];
	autoMode: boolean;
	callbacks: AgentServiceCallbacks;
	signal: AbortSignal;
}): Promise<AgentMessage[]> {
	const systemPrompt = buildSystemPrompt();
	const toolSchemas = getAllToolSchemas();
	const conversationMessages = [...messages];
	let rounds = 0;

	while (rounds < MAX_TOOL_ROUNDS) {
		if (signal.aborted) break;
		rounds++;

		callbacks.onMessageStart();

		const openaiMessages: OpenAIChatMessage[] = [
			{ role: "system", content: systemPrompt },
			...agentMessagesToOpenAI({ messages: conversationMessages }),
		];

		const result = await streamChatCompletion({
			config,
			messages: openaiMessages,
			tools: toolSchemas,
			callbacks: {
				onContent: (delta) => callbacks.onContentDelta(delta),
				onDone: () => {},
				onError: (error) => callbacks.onError(error),
			},
			signal,
		});

		if (signal.aborted) break;

		const assistantMessage: AgentMessage = {
			id: generateUUID(),
			role: "assistant",
			content: result.content,
			timestamp: Date.now(),
			toolCalls:
				result.toolCalls.length > 0
					? result.toolCalls.map((tc) => ({
							id: tc.id,
							name: tc.name,
							arguments: JSON.parse(tc.arguments || "{}"),
						}))
					: undefined,
		};

		conversationMessages.push(assistantMessage);
		callbacks.onMessagesUpdated(conversationMessages);

		if (result.content) {
			callbacks.onContentDone(result.content);
		}

		if (!result.toolCalls || result.toolCalls.length === 0) {
			break;
		}

		for (const toolCall of result.toolCalls) {
			if (signal.aborted) break;

			const parsedArgs = JSON.parse(toolCall.arguments || "{}");
			const tool = getToolByName({ name: toolCall.name });

			if (!tool) {
				const errorResult: AgentToolResult = {
					success: false,
					message: `Unknown tool: ${toolCall.name}`,
				};
				conversationMessages.push({
					id: generateUUID(),
					role: "tool",
					content: JSON.stringify(errorResult),
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					timestamp: Date.now(),
				});
				callbacks.onMessagesUpdated(conversationMessages);
				callbacks.onToolCallResult({
					id: toolCall.id,
					name: toolCall.name,
					result: errorResult,
				});
				continue;
			}

			callbacks.onToolCallStart({
				id: toolCall.id,
				name: toolCall.name,
				arguments: parsedArgs,
			});

			if (tool.requiresConfirmation && !autoMode) {
				const confirmed = await callbacks.onConfirmationRequired({
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					arguments: parsedArgs,
					description: tool.description,
				});

				if (!confirmed) {
					const skipResult: AgentToolResult = {
						success: false,
						message:
							"User skipped this operation. Please continue with alternative approaches or ask the user for guidance.",
					};
					conversationMessages.push({
						id: generateUUID(),
						role: "tool",
						content: JSON.stringify(skipResult),
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						timestamp: Date.now(),
					});
					callbacks.onMessagesUpdated(conversationMessages);
					callbacks.onToolCallResult({
						id: toolCall.id,
						name: toolCall.name,
						result: skipResult,
					});
					continue;
				}
			}

			try {
				const toolResult = await tool.execute(parsedArgs);
				conversationMessages.push({
					id: generateUUID(),
					role: "tool",
					content: JSON.stringify(toolResult),
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					timestamp: Date.now(),
				});
				callbacks.onMessagesUpdated(conversationMessages);
				callbacks.onToolCallResult({
					id: toolCall.id,
					name: toolCall.name,
					result: toolResult,
				});
			} catch (error) {
				const errorResult: AgentToolResult = {
					success: false,
					message:
						error instanceof Error
							? error.message
							: "Tool execution failed",
				};
				conversationMessages.push({
					id: generateUUID(),
					role: "tool",
					content: JSON.stringify(errorResult),
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					timestamp: Date.now(),
				});
				callbacks.onMessagesUpdated(conversationMessages);
				callbacks.onToolCallResult({
					id: toolCall.id,
					name: toolCall.name,
					result: errorResult,
				});
			}
		}
	}

	callbacks.onDone();
	return conversationMessages;
}
