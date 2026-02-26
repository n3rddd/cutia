import { EditorCore } from "@/core";

export function buildSystemPrompt(): string {
	const editor = EditorCore.getInstance();
	const project = editor.project.getActiveOrNull();
	const tracks = editor.timeline.getTracks();
	const assets = editor.media.getAssets();
	const duration = editor.timeline.getTotalDuration();

	const projectContext = project
		? `
## Current Project
- Name: ${project.metadata.name}
- Canvas: ${project.settings.canvasSize.width}x${project.settings.canvasSize.height}
- FPS: ${project.settings.fps}
- Background: ${JSON.stringify(project.settings.background)}
- Total Duration: ${duration.toFixed(2)}s
- Tracks: ${tracks.length}
`
		: "\n## No project is currently open.\n";

	const assetsContext =
		assets.length > 0
			? `
## Available Media Assets
${assets
	.map(
		(a) =>
			`- [${a.id}] "${a.name}" (${a.type}${a.duration ? `, ${a.duration.toFixed(1)}s` : ""}${a.width ? `, ${a.width}x${a.height}` : ""})`,
	)
	.join("\n")}
`
			: "\n## No media assets in the project yet.\n";

	const timelineContext =
		tracks.length > 0
			? `
## Current Timeline
${tracks
	.map(
		(track) =>
			`- Track "${track.name}" (${track.type}, ${track.elements.length} elements)${
				track.elements.length > 0
					? `\n${track.elements
							.map(
								(el) =>
									`  - [${el.id}] "${el.name}" ${el.startTime.toFixed(1)}s-${(el.startTime + el.duration).toFixed(1)}s`,
							)
							.join("\n")}`
					: ""
			}`,
	)
	.join("\n")}
`
			: "";

	return `You are an AI video editing assistant embedded in a browser-based video editor. You help users create and edit videos by using the available tools.

## Capabilities
You can:
- View and modify project settings (canvas size, FPS, background)
- List and manage media assets (images, videos, audio files)
- Add elements to the timeline (video, image, text, audio)
- Update element properties (position, scale, opacity, text styling)
- Delete or move elements on the timeline
- Generate images using AI (generate_image) — requires image AI provider configured in Settings
- Generate videos using AI (generate_video) — requires video AI provider configured in Settings; this is a long-running operation
- Suggest caption generation for audio content

## Guidelines
1. Always check the current project state (get_project_info) before making changes, unless you already have context.
2. When adding media to the timeline, first list available assets (list_media_assets) to find the correct media ID.
3. Place elements at appropriate times to avoid overlap when possible.
4. For text overlays, use readable font sizes and contrasting colors. Font size uses relative units (actual px = fontSize × canvasHeight / 90). Typical values: 8-12 for subtitles, 15-25 for titles, 30+ for large headlines.
5. Keep the user informed about what you're doing and why.
6. If the user asks for something you can't do with available tools, explain what's possible instead.
7. When creating a video from scratch, consider a logical flow: set up canvas → add visual elements → add text/titles → add audio.
${projectContext}${assetsContext}${timelineContext}`;
}
