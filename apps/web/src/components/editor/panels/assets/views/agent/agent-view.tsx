"use client";

import { useTranslation } from "@i18next-toolkit/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/stores/agent-store";
import { AgentChat } from "./agent-chat";
import { AgentInput } from "./agent-input";
import { AgentSettings } from "./agent-settings";
import {
	Settings01Icon,
	ArrowLeft02Icon,
	Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function AgentView() {
	const { t } = useTranslation();
	const [showSettings, setShowSettings] = useState(false);
	const status = useAgentStore((s) => s.status);
	const config = useAgentStore((s) => s.config);
	const messages = useAgentStore((s) => s.messages);
	const sendMessage = useAgentStore((s) => s.sendMessage);
	const cancel = useAgentStore((s) => s.cancel);
	const clearMessages = useAgentStore((s) => s.clearMessages);

	const isConfigured = Boolean(config.apiKey);

	if (showSettings) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex items-center gap-2 border-b p-3">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => setShowSettings(false)}
						title={t("Back")}
					>
						<HugeiconsIcon
							icon={ArrowLeft02Icon}
							className="h-4 w-4"
						/>
					</Button>
					<span className="text-sm font-medium">
						{t("Agent Settings")}
					</span>
				</div>
				<div className="flex-1 overflow-auto p-4">
					<AgentSettings />
				</div>
			</div>
		);
	}

	if (!isConfigured) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
				<p className="text-muted-foreground text-sm">
					{t(
						"Configure an OpenAI-compatible API to start using the AI Agent.",
					)}
				</p>
				<Button
					type="button"
					variant="outline"
					onClick={() => setShowSettings(true)}
				>
					<HugeiconsIcon
						icon={Settings01Icon}
						className="mr-2 h-4 w-4"
					/>
					{t("Configure API")}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between border-b px-3 py-2">
				<span className="text-sm font-medium">{t("AI Agent")}</span>
				<div className="flex items-center gap-1">
					{messages.length > 0 && (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={clearMessages}
							title={t("Clear chat")}
							className="h-7 w-7"
						>
							<HugeiconsIcon
								icon={Delete02Icon}
								className="h-3.5 w-3.5"
							/>
						</Button>
					)}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => setShowSettings(true)}
						title={t("Settings")}
						className="h-7 w-7"
					>
						<HugeiconsIcon
							icon={Settings01Icon}
							className="h-3.5 w-3.5"
						/>
					</Button>
				</div>
			</div>

			<AgentChat />

			<AgentInput
				status={status}
				onSend={sendMessage}
				onCancel={cancel}
			/>
		</div>
	);
}
