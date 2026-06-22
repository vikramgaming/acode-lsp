import plugin from "../plugin.json"

const urlModule = acode.require("url");
const openFolder = acode.require("openFolder");
const EditorFile = acode.require("editorfile") as any;
const settings = acode.require("settings");

export interface PluginSettings {
	socketUrl: string,
	debug: boolean,
	shortcut: {
		startLSP: string,
		format: string,
		devTest: string
	}
}

export function getPluginSettings(): PluginSettings {
	return settings.value[plugin.id];
}

export function setPluginSettings(pluginSettings: (settings: PluginSettings) => Partial<PluginSettings>): void {
	settings.value[plugin.id] = {
		...settings.value[plugin.id], ...pluginSettings(settings.value[plugin.id])
	}
	settings.update();
}

export function log(type: "error" | "info" | "warn", ...message: any) {
	if (getPluginSettings().debug && typeof console[type] === "function") {
	    const debugName = "[LSP]:"
	    
		setTimeout(() => console[type]?.(debugName, ...message), 200);
	}
}
export function showToast(...message: any) {
	window.toast(message.filter(Boolean).join(" "), 1000);
}

export function normalizePath(path: string, prefix?: "file" | "content") {
	let normalized = urlModule.pathname(path);
	normalized = normalized.replace(/^\/+/, '/');
	
	if (prefix === "file") {
		return `file://${normalized}`;
	}
	if (prefix === "content") {
		const root = editorManager.activeFile.uri.split("::").shift();
		
		return `${root}::${normalized}`;
	}
	return normalized;
}
export function getActiveFolderPath() {
	const fileUri = editorManager.activeFile?.uri;
	const folder = fileUri ? openFolder.find(fileUri) : undefined;
	if (!folder?.url) return;
	return normalizePath(folder.url, "file");
}
export function getCurrentFilePath() {
	const fileUri = editorManager.activeFile?.uri;
	const folder = fileUri ? openFolder.find(fileUri) : undefined;
	if (!folder?.url) return fileUri;
	return fileUri.replace(folder.url, "").replace(/^\/+/, '');
}
export function goToFile(fileUri: string, { row, column }: import("ace-code").Ace.Point) {
	const uri = normalizePath(fileUri, "content");
	
	function updateCursor() {
		editorManager.editor.clearSelection();
		editorManager.activeFile.session.selection.moveCursorTo(row, column);
		editorManager.editor.focus();
	}
	if (uri === editorManager.activeFile.uri) return updateCursor();
	
	const file = editorManager.getFile(uri, "uri");
	if (file) {
		file.makeActive();
		updateCursor();
		return;
	}
	const fileName = (uri.split("/").pop()) as string;
	const openedFile = new EditorFile(fileName, { uri });
	openedFile.onloadend = updateCursor;
}
export function normalizeShortcutKeys(shortcut: string): { win: string, mac: string } {
	const keys = shortcut.split("-").filter(Boolean);

	if (keys.length === 0) {
		return { win: "", mac: "" };
	}

	const capitalize = (str: string) =>
		str[0].toUpperCase() + str.slice(1).toLowerCase();

	function addKey(keys: string[]) {
		const win: string[] = [];
		const mac: string[] = [];

		keys.forEach((key) => {
			if (key.toLowerCase() === "ctrl" || key.toLowerCase() === "cmd") {
				win.push("Ctrl");
				mac.push("Cmd");
			} else {
				win.push(capitalize(key));
				mac.push(capitalize(key));
			}
		});

		return {
			win: win.join("-"),
			mac: mac.join("-"),
		};
	}

	return addKey(keys);
}