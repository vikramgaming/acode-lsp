import { LSP, Session } from "./main";
import { delay, getCurrentFilePath, normalizePath, log, callbackOnce, debounce } from "./utils";

interface SessionInfo {
	id: string;
	fileId: string;
	mode: string;
	name: string;
	uri: string;
	path: string;
}

type Event = {
	createSession: (sessionInfo: SessionInfo, file: Acode.EditorFile) => void;
	renameSession: (sessionInfo: SessionInfo, file: Acode.EditorFile) => void;
	removeSession: (sessionInfo: SessionInfo, file: Acode.EditorFile) => void;
	change: (emitter: Ace.Editor, delta: Ace.Delta) => void;
	changeSelection: (emitter: Ace.Editor) => void;
};

export class Listener {
	private sessionListId = new Map<string, SessionInfo>();
	private eventMap: {
		[K in keyof Event]?: Set<Event[K]>;
	} = {};
	private lsp: LSP;

	constructor(lsp: LSP) {
		this.lsp = lsp;

		lsp.onStart = () => {
			log("info", "Initialize Session handler");
			editorManager.files.forEach(this.createSession);
			editorManager.on("new-file", this.createSession);
			editorManager.on("rename-file", this.renameSession);
			editorManager.on("remove-file", this.removeSession);
			// editorManager.editor.on("change", this.change);
			// editorManager.editor.on("changeSelection", this.changeSelection);
		};

		lsp.onStop = () => {
			log("info", "Removing Session handler");
			editorManager.off("new-file", this.createSession);
			editorManager.off("remove-file", this.renameSession);
			editorManager.off("remove-file", this.removeSession);
			// editorManager.editor.off("change", this.change);
			// editorManager.editor.off("changeSelection", this.changeSelection);
			this.sessionListId.clear();
		};
	}
	private get client() {
		return this.lsp.client;
	}
	private get registeredLanguage() {
		return this.lsp.registeredLanguage;
	}
	private get currentWorkspace() {
		return this.lsp.currentWorkspace;
	}
	private get currentEditor() {
		return this.lsp.currentEditor;
	}

	addEventListener<K extends keyof Event>(name: K, fn: Event[K]) {
		((this.eventMap[name] as Set<Event[K]>) ??= new Set()).add(fn);
	}

	removeEventListener<K extends keyof Event>(name: K, fn: Event[K]) {
		this.eventMap[name]?.delete(fn);
	}

	emit<K extends keyof Event>(
		name: K,
		...args: Parameters<Event[K]>
	) {
		this.eventMap[name]?.forEach(fn => {
			(fn as (...args: Parameters<Event[K]>) => void)(...args);
		});
	}
	
	// ===== Handler =====
	private createSession = (file: Acode.EditorFile) => {
		if (
			!file.uri ||
			!normalizePath(file.uri, "file").startsWith(this.currentWorkspace)
		) return;

		delay(500).then(() => {
			if (!this.client) return;
			const session = (file.session) as Session;
			const modeId = session.$modeId.split("/").pop()!;
			if (!this.registeredLanguage.has(modeId)) return;
			const filePath = getCurrentFilePath(file.uri);
			
			this.client.registerSession(session, this.currentEditor, {
				filePath,
				joinWorkspaceURI: true
			});
			
			const sessionData: SessionInfo = {
				id: session.id,
				fileId: file.id,
				mode: modeId,
				name: file.name,
				uri: file.uri,
				path: filePath
			};
			this.sessionListId.set(file.id, sessionData);
			this.sessionListId.set(session.id, sessionData);

			log("info", "Register Session:", sessionData);
			this.emit("createSession", sessionData, file);
		});
	};
	private renameSession = callbackOnce((file: Acode.EditorFile) => {
		if (
			!file.uri ||
			!normalizePath(file.uri, "file").startsWith(this.currentWorkspace) ||
			!this.sessionListId.has(file.session.id)
		) return;
		
		delay(500).then(() => {
			if (!this.client) return;
			const session = (file.session) as Session;
			const sessionData = this.sessionListId.get(session.id)!;
			const filePath = getCurrentFilePath(file.uri);
			
			this.client.registerSession(session, this.currentEditor, {
				filePath,
				joinWorkspaceURI: true
			});
			
			const newSessionData: SessionInfo = {
				id: session.id,
				fileId: file.id,
				name: file.name,
				mode: session.$modeId.split("/").pop()!,
				uri: file.uri,
				path: filePath
			};
			
			this.sessionListId.delete(sessionData.fileId);
			this.sessionListId.set(file.id, newSessionData);
			this.sessionListId.set(session.id, newSessionData);
	
			log("info", "Session changed for:\n", sessionData, "\n\nto:\n", newSessionData);
			this.emit("renameSession", newSessionData, file);
		})
	});

	private removeSession = (file: Acode.EditorFile) => {
		if (
			!file.uri ||
			!normalizePath(file.uri, "file").startsWith(this.currentWorkspace) ||
			!this.sessionListId.has(file.id) ||
			!this.client
		) return;

		const sessionData = this.sessionListId.get(file.id)!;
		const session = { id: sessionData.id } as Ace.EditSession;
		this.client.closeDocument(session, () => {
			log("info", "Session Closed for:", sessionData);
		});

		this.sessionListId.delete(file.id);
		this.sessionListId.delete(session.id);
		this.emit("removeSession", sessionData, file);
	};
	private change = debounce((delta: Ace.Delta, emitter: Ace.Editor) => {
		this.emit("change", emitter, delta);
	}, 500)
	private changeSelection = debounce((_e: undefined, emitter: Ace.Editor) => {
		this.emit("changeSelection", emitter);
	}, 500)
}