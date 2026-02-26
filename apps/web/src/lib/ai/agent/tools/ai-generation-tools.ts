import { EditorCore } from "@/core";
import { getImageProvider, getVideoProvider } from "@/lib/ai/providers";
import type { AIVideoProvider } from "@/lib/ai/providers/types";
import { pollVideoTask } from "@/lib/ai/providers/seedance";
import { processMediaAssets } from "@/lib/media/processing";
import { fetchWithProxyFallback } from "@/lib/media/url-import";
import {
	createThumbnailDataUrl,
	storeHistoryImage,
	useAIGenerationHistoryStore,
} from "@/stores/ai-generation-history-store";
import { useAISettingsStore } from "@/stores/ai-settings-store";
import { generateUUID } from "@/utils/id";
import type { AgentTool } from "./types";

function getConfiguredImageProvider() {
	const { imageProviderId, imageApiKey } = useAISettingsStore.getState();
	if (!imageProviderId || !imageApiKey) return null;
	const provider = getImageProvider({ id: imageProviderId });
	if (!provider) return null;
	return { provider, apiKey: imageApiKey };
}

function getConfiguredVideoProvider() {
	const { videoProviderId, videoApiKey } = useAISettingsStore.getState();
	if (!videoProviderId || !videoApiKey) return null;
	const provider = getVideoProvider({ id: videoProviderId });
	if (!provider) return null;
	return { provider, apiKey: videoApiKey };
}

async function urlToFile({
	url,
	filename,
	mimeType,
}: {
	url: string;
	filename: string;
	mimeType: string;
}): Promise<File> {
	if (url.startsWith("data:")) {
		const [header, base64Data] = url.split(",");
		const detectedMime = header.match(/:(.*?);/)?.[1] || mimeType;
		const binaryString = atob(base64Data);
		const bytes = new Uint8Array(binaryString.length);
		for (let index = 0; index < binaryString.length; index++) {
			bytes[index] = binaryString.charCodeAt(index);
		}
		return new File([bytes], filename, { type: detectedMime });
	}

	const blob = await fetchWithProxyFallback({ url });
	return new File([blob], filename, { type: blob.type || mimeType });
}

async function addFileToProject({
	file,
}: {
	file: File;
}): Promise<{ name: string; previewUrl: string }> {
	const editor = EditorCore.getInstance();
	const project = editor.project.getActiveOrNull();
	if (!project) {
		throw new Error("No active project");
	}

	const processedAssets = await processMediaAssets({ files: [file] });
	if (processedAssets.length === 0) {
		throw new Error("Failed to process media file");
	}

	const asset = processedAssets[0];
	await editor.media.addMediaAsset({
		projectId: project.metadata.id,
		asset,
	});

	const previewUrl = asset.thumbnailUrl ?? URL.createObjectURL(file);
	return { name: asset.name, previewUrl };
}

async function addImageToHistory({
	imageUrl,
	prompt,
	providerName,
}: {
	imageUrl: string;
	prompt: string;
	providerName: string;
}): Promise<void> {
	const entryId = generateUUID();
	const createdAt = new Date().toISOString();

	let thumbnailUrl: string | undefined;
	try {
		thumbnailUrl = await createThumbnailDataUrl({ imageUrl });
	} catch {
		// proceed without thumbnail
	}

	try {
		const blob = await fetchWithProxyFallback({ url: imageUrl });
		await storeHistoryImage({ id: entryId, blob, createdAt });
	} catch {
		// proceed without storing blob
	}

	const isDataUrl = imageUrl.startsWith("data:");
	useAIGenerationHistoryStore.getState().addEntry({
		id: entryId,
		type: "image",
		prompt,
		url: isDataUrl ? "" : imageUrl,
		thumbnailUrl,
		provider: providerName,
	});
}

export const generateImageTool: AgentTool = {
	name: "generate_image",
	description:
		"Generate an image using AI based on a text prompt. The generated image will be automatically added to the project's media library. Requires an image AI provider to be configured in Settings.",
	parameters: {
		type: "object",
		properties: {
			prompt: {
				type: "string",
				description:
					"Detailed text description of the image to generate. Be specific about style, content, colors, composition, etc.",
			},
			aspectRatio: {
				type: "string",
				description:
					"Aspect ratio of the generated image (e.g. '16:9', '1:1', '9:16', '4:3'). Defaults to auto.",
			},
		},
		required: ["prompt"],
	},
	requiresConfirmation: true,
	async execute(args) {
		const configured = getConfiguredImageProvider();
		if (!configured) {
			return {
				success: false,
				message:
					"No image AI provider configured. Please set up an image provider and API key in Settings.",
			};
		}

		const { provider, apiKey } = configured;
		const prompt = args.prompt as string;
		const aspectRatio = args.aspectRatio as string | undefined;

		try {
			const results = await provider.generateImage({
				request: {
					prompt,
					aspectRatio,
				},
				apiKey,
			});

			if (results.length === 0) {
				return { success: false, message: "No images were generated" };
			}

			const addedAssets: Array<{ name: string; previewUrl: string }> = [];

			for (const result of results) {
				const id = generateUUID().slice(0, 8);
				const file = await urlToFile({
					url: result.url,
					filename: `ai-image-${id}.png`,
					mimeType: "image/png",
				});

				const added = await addFileToProject({ file });
				addedAssets.push(added);

				void addImageToHistory({
					imageUrl: result.url,
					prompt,
					providerName: provider.name,
				});
			}

			return {
				success: true,
				message: `Generated ${addedAssets.length} image(s) and added to media library`,
				data: {
					mediaType: "image",
					previewUrls: addedAssets.map((a) => a.previewUrl),
					assets: addedAssets.map((a) => ({ name: a.name })),
					provider: provider.name,
				},
			};
		} catch (error) {
			return {
				success: false,
				message:
					error instanceof Error
						? error.message
						: "Image generation failed",
			};
		}
	},
};

export const generateVideoTool: AgentTool = {
	name: "generate_video",
	description:
		"Generate a video using AI based on a text prompt. This is a long-running operation that submits a task and polls for completion. The generated video will be automatically added to the project's media library. Requires a video AI provider to be configured in Settings.",
	parameters: {
		type: "object",
		properties: {
			prompt: {
				type: "string",
				description:
					"Detailed text description of the video to generate. Describe the scene, action, style, camera movement, etc.",
			},
			duration: {
				type: "number",
				description: "Video duration in seconds (default: 5)",
			},
			aspectRatio: {
				type: "string",
				description:
					"Aspect ratio of the video (e.g. '16:9', '1:1', '9:16'). Default: '16:9'.",
			},
			resolution: {
				type: "string",
				description:
					"Video resolution (e.g. '720p', '1080p'). Default: '720p'.",
			},
		},
		required: ["prompt"],
	},
	requiresConfirmation: true,
	async execute(args) {
		const configured = getConfiguredVideoProvider();
		if (!configured) {
			return {
				success: false,
				message:
					"No video AI provider configured. Please set up a video provider and API key in Settings.",
			};
		}

		const { provider, apiKey } = configured;
		const prompt = args.prompt as string;
		const duration = (args.duration as number) ?? 5;
		const aspectRatio = (args.aspectRatio as string) ?? "16:9";
		const resolution = (args.resolution as string) ?? "720p";

		try {
			const submitResult = await provider.submitVideoTask({
				request: { prompt, duration, aspectRatio, resolution },
				apiKey,
			});

			if (submitResult.status === "failed") {
				return {
					success: false,
					message: submitResult.error ?? "Video task submission failed",
				};
			}

			const finalResult = await pollVideoTask({
				provider: provider as AIVideoProvider,
				taskId: submitResult.taskId,
				apiKey,
			});

			if (finalResult.status !== "succeeded" || !finalResult.videoUrl) {
				return {
					success: false,
					message: finalResult.error ?? "Video generation failed or timed out",
				};
			}

			const id = generateUUID().slice(0, 8);
			const file = await urlToFile({
				url: finalResult.videoUrl,
				filename: `ai-video-${id}.mp4`,
				mimeType: "video/mp4",
			});

			const added = await addFileToProject({ file });

			useAIGenerationHistoryStore.getState().addEntry({
				id: generateUUID(),
				type: "video",
				prompt,
				url: finalResult.videoUrl,
				provider: provider.name,
			});

			return {
				success: true,
				message: `Video generated and added to media library as '${added.name}'`,
				data: {
					mediaType: "video",
					previewUrls: [added.previewUrl],
					name: added.name,
					provider: provider.name,
				},
			};
		} catch (error) {
			return {
				success: false,
				message:
					error instanceof Error
						? error.message
						: "Video generation failed",
			};
		}
	},
};

export const aiGenerationTools: AgentTool[] = [
	generateImageTool,
	generateVideoTool,
];
