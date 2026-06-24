const urlModule = acode.require("url");
const openFolder = acode.require("openFolder");

function normalizePath(path: string, prefix?: "file" | "content") {
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

function getActiveFolderPath() {
	const fileUri = editorManager.activeFile?.uri;
	const folder = fileUri ? openFolder.find(fileUri) : undefined;
	if (!folder?.url) return;
	return normalizePath(folder.url, "file");
}