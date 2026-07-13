import type * as lsp from "vscode-languageserver-protocol"
import plugin from "../plugin.json";
import { AceRangeData } from "@/linters/types/language-service";
import { fromRange } from "@/linters/type-converters/lsp/lsp-converters";

const urlModule = acode.require("url");
const openFolder = acode.require("openFolder");
const EditorFile = acode.require("editorfile");
const settings = acode.require("settings");
const { editor } = editorManager;

export interface PluginSettings {
	socketUrl: string,
	debug: boolean,
	shortcut: {
		startLSP: string,
		format: string,
		devTest: string;
	},
	semanticTokens: boolean;
}

export function getPluginSettings(): PluginSettings {
	return settings.value[plugin.id];
}

export function setPluginSettings(pluginSettings: (settings: PluginSettings) => Partial<PluginSettings>): void {
	settings.value[plugin.id] = {
		...settings.value[plugin.id], ...pluginSettings(settings.value[plugin.id])
	};
	settings.update();
}

export function log(type: "error" | "info" | "warn", ...message: any) {
	if (getPluginSettings().debug && typeof console[type] === "function") {
		const debugName = "[LSP]:";

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
export function getActiveFolderPath(fileUri = editorManager.activeFile.uri) {
	const folder = openFolder.find(fileUri);
	if (!folder?.url) return;
	return normalizePath(folder.url, "file");
}
export function getCurrentFilePath(fileUri = editorManager.activeFile.uri) {
	const folder = openFolder.find(fileUri);
	if (!folder?.url) return fileUri;
	return fileUri.replace(folder.url, "").replace(/^\/+/, '');
}
export function goToFile(fileUri: string, pos: Ace.Point | lsp.Position, mark?: lsp.Range | AceRangeData) {
	const uri = normalizePath(fileUri, "content");

	function updateCursor(session = editorManager.activeFile.session) {
		editor.clearSelection();
		if ("row" in pos) {
			session.selection.moveCursorTo(pos.row, pos.column);
		} else {
			session.selection.moveCursorTo(pos.line, pos.character);
		}
		editor.focus();
		if (mark) {
			const markerId = session.addMarker(aceRange(mark), `${plugin.className} highlight`, "text", true);
			editor.once("changeSelection", () => session.removeMarker(markerId));
		}
	}
	if (uri === editorManager.activeFile.uri) return updateCursor();

	const file = editorManager.getFile(uri, "uri");
	if (file) {
		file.makeActive();
		updateCursor(file.session);
		return;
	}
	const fileName = (uri.split("/").pop()) as string;
	const openedFile = new EditorFile(fileName, { uri });
	openedFile.onloadend = () => updateCursor(openedFile.session);
}
export function normalizeShortcutKeys(shortcut: string): { win: string, mac: string; } {
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

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(() => { resolve() ;}, ms);
	});
}

export function debouncePromise<T extends (...args: any[]) => Promise<any>>(
	fn: T,
	delay: number
) {
	let timer: ReturnType<typeof setTimeout>;

	return (...args: Parameters<T>): Promise<ReturnType<T>> => new Promise((resolve) => {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			resolve(await fn(...args));
		}, delay);
	});
}

export function aceRange(range: lsp.Range | AceRangeData) {
	let r: lsp.Range;
	if ("line" in range.start) {
		r = range as lsp.Range;
	} else {
		r = fromRange(range as AceRangeData);
	};
	const Range = ace.require("ace/range").Range;
	return new Range(
		r.start.line,
		r.start.character,
		r.end.line,
		r.end.character
	) as Ace.Range
}