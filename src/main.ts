import plugin from "../plugin.json";
import { AceLanguageClient } from "@/linters/ace-language-client";
import { LanguageClient } from "@/linters/services/language-client";
import {
	getActiveFolderPath,
	getCurrentFilePath,
	normalizeShortcutKeys,
	getPluginSettings,
	setPluginSettings,
	PluginSettings,
	log,
	showToast,
	delay,
	normalizePath
} from "./utils";
import LSPMethod from "./Method/method";
import { socketClients, SocketClients } from "./constant";

const settings = acode.require("settings");
const confirm = acode.require("confirm");
const multiPrompt = acode.require("multiPrompt");
const { editor } = editorManager;

import type * as lsp from "vscode-languageserver-protocol";
import type { LanguageClientConfig } from "@/linters/types/language-service";
import type { LanguageProvider } from "@/linters/language-provider";

export interface Session extends Ace.EditSession {
	$modeId: string;
}

interface SessionInfo {
	id: string;
	fileId: string;
	mode: string;
	name: string;
	uri: string;
}

export class LSP {
	baseUrl!: string;
	currentWorkspace: string = "";
	currentEditor!: import("ace-code/src/editor").Editor;
	registeredLanguage = new Map<string, string>();
	sessionListId = new Map<string, SessionInfo>();
	serviceCapabilities: Record<string, lsp.InitializeResult["capabilities"]> = {};
	
	method: LSPMethod;
	client: LanguageProvider | null = null;
	private socket: WebSocket[] = [];
	private onStopFunctions: (() => void)[] = [];
	private onStartFunctions: (() => void)[] = [];

	constructor() {
		if (!settings.value[plugin.id]) {
			settings.value[plugin.id] = {
				socketUrl: "ws://localhost:3030/",
				debug: true,
				shortcut: {
					startLSP: "Ctrl-Alt-L",
					format: "Ctrl-Shift-F",
					devTest: "Ctrl-Alt-T"
				},
				semanticTokens: false
			} satisfies PluginSettings;
			settings.update();
		}
		this.method = new LSPMethod(this);
	}
	set onStop(fn: () => void) {
		this.onStopFunctions.push(fn);
	}
	set onStart(fn: () => void) {
		this.onStartFunctions.push(fn);
	}
	get service() {
		const mode = (editor.session as Session).$modeId.replace("ace/mode/", "");
		const serviceName = this.registeredLanguage.get(mode);
		const clientConfig = Object.values(socketClients).find(c => c.serviceName === serviceName) as SocketClients;
		return { serviceName, clientConfig };
	}
	createLSP(workspacePath: string) {
		const { socketUrl } = getPluginSettings();

		const serverConfig: LanguageClientConfig[] = [];

		for (const cfg of Object.values(socketClients)) {
			const config = cfg as SocketClients;
			const url = `${socketUrl.replace(/\/?$/, "/")}${config.serviceName}-${workspacePath}?args=${config.args.join(",")}`;
			const socket = new WebSocket(url);
			socket.addEventListener("open", () => {
				log("info", `Socket Connected for "${config.serviceName}" to: ${url}`);
			});
			socket.addEventListener("close", (e) => {
				log("warn", `Socket closed for ${config.serviceName}`, e);
				this.stopLSP();
			});
			socket.addEventListener("error", (e) => {
				log("error", `Socket unexpected error for ${config.serviceName}`, e);
				this.stopLSP();
			})
			
			this.socket.push(socket);

			config.modes.forEach(mode => this.registeredLanguage.set(mode.toLowerCase(), config.serviceName));
			
			const result: LanguageClientConfig = {
				modes: config.modes.join("|"),
				serviceName: config.serviceName,
				features: config.features,
				type: "socket",
				module: () => ({ LanguageClient }),
				socket,
				initializationOptions: config.initializationOptions,
				serviceInstance: config.serviceInstance,
				options: config.options,
			};
			serverConfig.push(result);
		}

		log("info", "Initialize LSP", serverConfig);
		const registeredLanguage: Record<string, string[]> = {};
		for (let [lang, serviceName] of this.registeredLanguage.entries()) {
			if (!registeredLanguage[serviceName]) {
				registeredLanguage[serviceName] = [];
			}
			registeredLanguage[serviceName].push(lang);
		}
		log("info", "Registered language serviceName:", registeredLanguage);

		this.currentWorkspace = workspacePath;

		const providerOptions: Parameters<typeof AceLanguageClient.for>[1] = {
			manualSessionControl: true,
			workspacePath,
			functionality: {
				// sudah bikin sendiri, matikan saja
				codeActions: false,
				format: false,
				// inlineCompletion: {
				// 	overwriteCompleters: true
				// },
				completion: {
					overwriteCompleters: false
				},
			},
			// aceComponents: {
			// 	InlineAutocomplete: ace.require("ace/ext/inline_autocomplete").InlineAutocomplete,
			// 	CompletionProvider: ace.require("ace/autocomplete").CompletionProvider,
			// 	CommandBarTooltip: ace.require("ace/ext/command_bar").CommandBarTooltip
			// }
		};
		if (getPluginSettings().semanticTokens) {
			providerOptions.functionality!.semanticTokens = true;
		}

		return AceLanguageClient.for(serverConfig, providerOptions);
	}
	startLSP(workspacePath: string) {
		if (this.client) {
			log("warn", "LSP already running");
			return;
		}
		log("info", "Initializing for WorkspacePath :", workspacePath);

		this.client = this.createLSP(workspacePath);
		this.client.registerEditor(editor, {
			filePath: getCurrentFilePath(),
			joinWorkspaceURI: true
		});
		log("info", "Client", this.client);
		log("info", "Socket", this.socket);

		this.currentEditor = editor;
		editor.completers = editor.completers.filter(c => c.id != null && c.id !== "keywordCompleter");
		this.onStartFunctions.forEach(fn => fn());
	}
	stopLSP() {
		if (!this.client) return;

		for (const id in this.socket) {
			this.socket[id].close();
		}
		this.socket = [];
		this.client?.unregisterEditor(this.currentEditor, true);
		this.client?.closeConnection?.();
		this.client = null;
		this.registeredLanguage.clear();
		this.sessionListId.clear();
		this.onStopFunctions.forEach(fn => fn());
		log("info", "LSP Stopped");
	}
	restartLSP(workspacePath = this.currentWorkspace) {
		log("info", "Restarting LSP");
		this.stopLSP();
		delay(3000).then(() => {
			this.startLSP(workspacePath);
		});
	}
	setSessionHandler() {
		const addSession = (file: Acode.EditorFile) => {
			if (
				!file.uri ||
				!normalizePath(file.uri, "file").startsWith(this.currentWorkspace)
			) return;

			delay(500).then(() => {
				if (!this.client) return;
				const session = (file.session) as Session;
				const modeId = session.$modeId.split("/").pop()!;
				if (!this.registeredLanguage.has(modeId)) return;
				const sessionData: SessionInfo = {
					id: session.id,
					fileId: file.id,
					mode: modeId,
					name: file.name,
					uri: file.uri
				};
				this.sessionListId.set(file.id, sessionData);
				this.sessionListId.set(session.id, sessionData);

				this.client.registerSession(session, this.currentEditor, {
					filePath: getCurrentFilePath(file.uri),
					joinWorkspaceURI: true
				});
				log("info", "Register Session:", sessionData);
			});
		};
		let called = false;
		const renameSession = (file: Acode.EditorFile) => {
			if (
				called ||
				!file.uri ||
				!normalizePath(file.uri, "file").startsWith(this.currentWorkspace) ||
				!this.sessionListId.has(file.session.id) ||
				!this.client
			) return;
			called = true;
			
			const session = (file.session) as Session;
			const sessionData = this.sessionListId.get(session.id)!;
			
			const newSessionData = {
					...sessionData,
					fileId: file.id,
					name: file.name,
					uri: file.uri
				};
			this.sessionListId.delete(sessionData.fileId);
			this.sessionListId.set(file.id, newSessionData);
			this.sessionListId.set(session.id, newSessionData);
			
			this.client.registerSession(session, this.currentEditor, {
				filePath: getCurrentFilePath(file.uri),
				joinWorkspaceURI: true
			});
			log("info", "Session changed for:\n", sessionData, "\n\nto:\n", newSessionData);
			delay(500).then(() => {
				called = false;
			})
		};
		const removeSession = (file: Acode.EditorFile) => {
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
		};
		editorManager.files.forEach(addSession);
		
		this.onStart = () => {
			log("info", "Initialize Session handler");
			editorManager.on("new-file", addSession);
			editorManager.on("rename-file", renameSession);
			editorManager.on("remove-file", removeSession);
		}

		this.onStop = () => {
			log("info", "Removing Session handler");
			editorManager.off("new-file", addSession);
			editorManager.off("remove-file", renameSession);
			editorManager.off("remove-file", removeSession);
		};
	}
	initStyle(url: string) {
		const fs = acode.require("fs");
		const dir = fs(`${url}style.css`);
		
		dir.readFile("utf-8").then(data => {
			const style = document.createElement("style");
			style.id = plugin.id;
			style.textContent = data.replace(/\.plugin/g, `.${plugin.className}`);
			document.head.appendChild(style);
		});
	}

	async init(
		_$page: Acode.WCPage,
		_cacheFile: Acode.FileSystem,
		_cacheFileUrl: string,
	): Promise<void> {
		this.initAllCommands();
		this.initStyle(this.baseUrl);
		this.setSessionHandler();

		const languageFormatter: string[] = [];

		for (const config of Object.values(socketClients)) {
			config.extension.forEach(lang => languageFormatter.push(lang));
		}

		acode.registerFormatter(plugin.id, languageFormatter, async () => {
			if (!this.client) return showToast("start LSP first");

			this.method.documentFormattingProvider();
		});
		log("info", "Registered Formatter for language", languageFormatter);
		
		LanguageClient.initializeCallback = (result, serviceName) => {
			log("info", `Initialize for serviceName ${serviceName}`, result);
			this.serviceCapabilities[serviceName] = result.capabilities;
		}
	}
	initAllCommands() {
		const shortcutKeys: Record<string, ReturnType<typeof normalizeShortcutKeys>> = {};
		for (let [name, key] of Object.entries(getPluginSettings().shortcut)) {
			shortcutKeys[name] = normalizeShortcutKeys(key);
		}
		log("info", "shortcutKeys:", shortcutKeys);

		editor.commands.addCommand({
			name: "LSP Init",
			bindKey: shortcutKeys.startLSP,
			exec: () => {
				if (this.client) {
					return showToast("LSP already started");
				}

				const folder = getActiveFolderPath();
				if (!folder) {
					log("error", "Cannot find the workspace, Please open a folder first");
					return showToast("Please open a folder first");
				}
				multiPrompt("Start Websocket LSP?", [
					{
						type: "text",
						id: "workspacePath",
						value: folder,
						placeholder: "Workspace Path",
						required: true,
						readOnly: true
					}
				], "").then(({ workspacePath }: { workspacePath: string; }) => {
					if (workspacePath) {
						this.startLSP(workspacePath);
					}
				});
			}
		});
		editor.commands.addCommand({
			name: "LSP Format",
			bindKey: shortcutKeys.format,
			exec: () => {
				if (!this.client) {
					log("error", "Cannot find the client");
					return showToast("Start LSP first");
				}
				this.method.documentFormattingProvider();
			}
		});
		editor.commands.addCommand({
			name: "LSP Dev Test",
			bindKey: shortcutKeys.devTest,
			exec: async () => {
				if (!getPluginSettings().debug || !this.client) return;
				log("info", "Testing");
			}
		});
	}
	removeAllCommands() {
		editor.commands.removeCommand("LSP Init");
		editor.commands.removeCommand("LSP Format");
		editor.commands.removeCommand("LSP Dev Test");
	}
	async destroy() {
		if (this.client) {
			this.stopLSP();
		}
		this.removeAllCommands();
		delete settings.value[plugin.id];
		settings.update();
	}
	settings(): Acode.PluginSettings {
		const { shortcut, ...pluginSettings } = getPluginSettings();

		return {
			list: [
				{
					text: "Stop LSP",
					key: "stopLSP",
				},
				{
					text: "Restart LSP",
					key: "restartLSP",
				},
				{
					text: "Debug mode",
					key: "debug",
					checkbox: pluginSettings.debug
				},
				{
					text: "Semantic Tokens",
					key: "semanticTokens",
					checkbox: pluginSettings.semanticTokens
				},
				{
					text: "Start LSP Shortcut",
					key: "shortcut.startLSP",
					value: shortcut.startLSP,
					promptType: "text",
					prompt: "Insert new key shortcut"
				},
				{
					text: "LSP Format Shortcut",
					key: "shortcut.format",
					value: shortcut.format,
					promptType: "text",
					prompt: "Insert new key shortcut"
				},
				{
					text: "LSP Dev Test Shortcut",
					key: "shortcut.devTest",
					value: shortcut.devTest,
					promptType: "text",
					prompt: "Insert new key shortcut"
				},
				{
					text: "Socket Url",
					key: "socketUrl",
					value: pluginSettings.socketUrl,
					promptType: "text",
					prompt: "Insert new Socket URL"
				},
			],
			cb: (key: string, value: string | boolean) => {
				if (key === "stopLSP") {
					if (!this.client) return showToast("LSP not activated");
					confirm("Stop LSP", "Are you sure?").then(i => {
						if (i) {
							this[key]();
						}
					});
				} else if (key === "restartLSP") {
					if (!this.client) return showToast("LSP not activated");
					confirm("Restart LSP", "Are you sure?").then(i => {
						if (i) {
							this[key]();
						}
					});
				} else if (key.startsWith("shortcut.")) {
					const shortcut = key.replace("shortcut.", "");
					setPluginSettings((settings): Partial<PluginSettings> => {
						log("info", `Shortcut changed for [${shortcut}] from "${(settings as any)[shortcut]}" to "${value}"`);
						return {
							shortcut: {
								...settings.shortcut,
								[shortcut]: value
							}
						};
					});
					this.removeAllCommands();
					this.initAllCommands();
				} else {
					setPluginSettings((settings) => {
						log("info", `Settings changed for [${key}] from "${(settings as any)[key]}" to "${value}"`);
						return {
							[key]: value
						};
					});
					showToast("Maybe need to Restart LSP");
				}
			},
		};
	}
}

if (window.acode) {
	const lsp = new LSP();
	acode.setPluginInit(
		plugin.id,
		async (
			baseUrl: string,
			$page: Acode.WCPage,
			{ cacheFileUrl, cacheFile }: Acode.PluginInitOptions,
		) => {
			if (!baseUrl.endsWith("/")) {
				baseUrl += "/";
			}
			lsp.baseUrl = baseUrl;
			await lsp.init($page, cacheFile, cacheFileUrl);
		}, lsp.settings()
	);
	acode.setPluginUnmount(plugin.id, () => {
		lsp.destroy();
	});
}
