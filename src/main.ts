import plugin from "../plugin.json";
import { AceLanguageClient } from "./ace-linters/src/ace-language-client";
import { LanguageClient } from "./ace-linters/src/services/language-client";
import {
	getActiveFolderPath,
	getCurrentFilePath,
	normalizeShortcutKeys
} from "./utils";
import lspMethod from "./method"

const settings = acode.require("settings");
const multiPrompt = acode.require("multiPrompt");
const confirm = acode.require("confirm");
const select = acode.require("select");

import type { LanguageClientConfig } from "./ace-linters/src/types/language-service";
import type { LanguageProvider } from "./ace-linters/src/language-provider";
import type { EditSession } from "ace-code/src/edit_session";

export interface Session extends EditSession {
	$modeId: string
}

interface PluginSettings {
	socketUrl: string,
	debug: boolean,
	shortcut: {
		startLSP: string,
		format: string,
		devTest: string
	}
}

interface SocketClients {
	modes: string[],
	serviceName: string,
	args: string[],
	features: LanguageClientConfig["features"]
}

const socketClients = {
	typescript: {
		modes: ["javascript", "typescript", "jsx", "tsx"],
		serviceName: "typescript",
		args: ["typescript-language-server", "--stdio"],
		features: {}
	},
	css: {
		modes: ["css", "scss", "less"],
		serviceName: "css",
		args: ["vscode-css-language-server", "--stdio"],
		features: {
			signatureHelp: false
		}
	},
	html: {
		modes: ["html"],
		serviceName: "html",
		args: ["vscode-html-language-server", "--stdio"],
		features: {
			signatureHelp: false
		}
	},
	json: {
		modes: ["json", "json5"],
		serviceName: "json",
		args: ["vscode-json-language-server", "--stdio"],
		features: {
			signatureHelp: false
		}
	}
} satisfies Record<string, SocketClients>

class LSP {
	debugName = "[LSP]:"

	baseUrl: string | undefined;
	client: LanguageProvider | null = null;
	socket: Record<string, WebSocket> = {};
	currentWorkspace: string = "";
	currentEditor!: import("ace-code/src/editor").Editor;
	registeredLanguage = new Map<string, string>();
	pluginCommands: Record<string, import("ace-code/src/commands/command_manager").CommandManager> = {}

	private boundSwitchFile = this.switchFile.bind(this);

	constructor() {
		if (!settings.value[plugin.id]) {
			settings.value[plugin.id] = {
				socketUrl: "ws://localhost:3030/",
				debug: true,
				shortcut: {
					startLSP: "Ctrl-Alt-L",
					format: "Ctrl-Shift-F",
					devTest: "Ctrl-Alt-T"
				}
			} satisfies PluginSettings
			settings.update();
		}
	}
	log(type: "error" | "info" | "warn", ...message: any) {
		if (this.getPluginSettings().debug && typeof console[type] === "function") {
			setTimeout(() => console[type]?.(this.debugName, ...message), 200);
		}
	}
	showToast(...message: any) {
		window.toast(message.filter(Boolean).join(" "), 1000);
	}
	getPluginSettings(): PluginSettings {
		return settings.value[plugin.id];
	}
	setPluginSettings(pluginSettings: (settings: PluginSettings) => Partial<PluginSettings>): void {
		settings.value[plugin.id] = {
			...settings.value[plugin.id], ...pluginSettings(settings.value[plugin.id])
		}
		settings.update();
	}
	createLSP(workspacePath: string) {
		const { socketUrl } = this.getPluginSettings();

		const serverConfig: LanguageClientConfig[] = [];
		
		for (const [id, config] of Object.entries(socketClients)) {
			const socket = new WebSocket(`${socketUrl.replace(/\/?$/, "/")}${config.serviceName}-${workspacePath}?args=${config.args.join(",")}&type=stdio`)
			this.socket[id] = socket;
			
			config.modes.forEach(mode => this.registeredLanguage.set(mode.toLowerCase(), config.serviceName));

			const result: LanguageClientConfig = {
				modes: config.modes.join("|"),
				serviceName: config.serviceName,
				features: config.features,
				type: "socket",
				module: () => ({ LanguageClient }),
				socket
			}
			serverConfig.push(result);
		}
			
		this.log("info", "Initialize LSP", serverConfig);
		this.log("info", "socket", this.socket)

		this.currentWorkspace = workspacePath

		return AceLanguageClient.for(serverConfig, {
			manualSessionControl: true,
			workspacePath,
			functionality: {
			    completion: {
			        overwriteCompleters: true
			    }
			}
		});
	}
	startLSP(workspacePath: string) {
		if (this.client) {
			this.log("warn", "LSP already running");
			return;
		}
		this.log("info", "workspacePath :", workspacePath);

		this.client = this.createLSP(workspacePath);

		this.log("info", "Client", this.client);

		const editor = editorManager.editor;
		this.client.registerEditor(editor, {
			filePath: getCurrentFilePath(),
			joinWorkspaceURI: true
		});
		this.currentEditor = editor;
	}
	stopLSP() {
		if (!this.client) return;
		
		this.log("info", "Stopping LSP");

		for (const id in this.socket) {
			this.socket[id].close();
			delete this.socket[id]
		}
		this.client?.unregisterEditor(this.currentEditor, true);
		this.client?.closeConnection?.();
		this.client = null;
		this.registeredLanguage.clear();
	}
	switchFile({ oldSession, session }: { oldSession: EditSession, session: EditSession }) {
		if (!this.client) return
		const workspace = getActiveFolderPath();
		if (workspace == null) return;
		
		if (this.currentWorkspace === workspace) {
			const modeId = {
				NEW: (session as Session).$modeId.replace("ace/mode/", ""),
				OLD: (oldSession as Session).$modeId.replace("ace/mode/", ""),
			}
			if (this.registeredLanguage.has(modeId.NEW)) {
				this.client.registerSession(session, this.currentEditor, {
					filePath: getCurrentFilePath(),
					joinWorkspaceURI: true
				});
				this.log("info", "switching to file", session);
			}
			if (this.registeredLanguage.has(modeId.OLD)) {
				this.client.closeDocument(oldSession, () => {
					this.log("info", "closing file", oldSession)
				})
			}
		} else {
		    confirm("Workspace Changed", "Want to restart LSP?").then(i => {
		        if (i) {
		            this.stopLSP();
		            this.startLSP(workspace);
		        }
		    })
		}
	}

	async init(
		_$page: Acode.WCPage,
		_cacheFile: Acode.FileSystem,
		_cacheFileUrl: string,
	): Promise<void> {
		editorManager.editor.on("changeSession", (this.boundSwitchFile));
		this.initAllCommands();
		
		const languageFormatter: string[] = [];
		
		for (const config of Object.values(socketClients)) {
		    config.modes.forEach(lang => {
		        const result = lang === "javascript" ? "js" : (lang === "typescript" ? "ts" : lang);
		        languageFormatter.push(result);
		    })
		}
		
		acode.registerFormatter(plugin.id, languageFormatter, () => {
			if (!this.client) return this.showToast("start LSP first");

			this.client.format()
		})
		this.log("info", "Registered Formatter for language", languageFormatter);
	}
	initAllCommands() {
	    const shortcutKeys: Record<string, ReturnType<typeof normalizeShortcutKeys>> = {};
	    for (let [name, key] of Object.entries(this.getPluginSettings().shortcut)) {
	        shortcutKeys[name] = normalizeShortcutKeys(key);
	    }
	    this.log("info", "shortcutKeys:", shortcutKeys)
	    
		editorManager.editor.commands.addCommand({
			name: "LSP Init",
			bindKey: shortcutKeys.startLSP,
			exec: () => {
			    if (this.client) {
				    return this.log("warn", "LSP already started");
				}
				
				const folder = getActiveFolderPath();
				if (!folder) {
				    this.log("error", "Cannot find the workspace, Please open a folder first");
				    return this.showToast("Please open a folder first");
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
				], "").then(({ workspacePath }: { workspacePath: string }) => {
					if (workspacePath) {
						this.startLSP(workspacePath)
					}
				})
			}
		})
		editorManager.editor.commands.addCommand({
			name: "LSP Format",
			bindKey: shortcutKeys.format,
			exec: () => {
				if (!this.client) {
				    this.log("error", "Cannot find the client");
				    return this.showToast("Start LSP first");
				}
			    this.client.format();
			}
		})
	    editorManager.editor.commands.addCommand({
	        name: "LSP Dev Test",
	        bindKey: shortcutKeys.devTest,
	        exec: async () => {
	            if (!this.getPluginSettings().debug) return;
	            if (!this.client) return this.showToast("Start LSP first");
	            
	            const input = await select("Select Command", [
	                { text: "Go To Definition", value: "Method-goToDefinition" },
	                { text: "Go To Declaration", value: "Method-goToDeclaration" },
	                { text: "Go To TypeDefinition", value: "Method-goToTypeDefinition" },
	                { text: "Go To Implementation", value: "Method-goToImplementation" },
                ]);
                if (input.startsWith("Method-")) {
                    lspMethod(input.replace("Method-", ""), this.client, this.registeredLanguage, this.log.bind(this));
                }
	        }
	    })
	}
	removeAllCommands() {
	    editorManager.editor.commands.removeCommand("LSP Init");
	    editorManager.editor.commands.removeCommand("LSP Format");
	    editorManager.editor.commands.removeCommand("LSP Dev Test");
	}
	async destroy() {
		if (this.client) {
			this.stopLSP();
		}
		editorManager.editor.off("changeSession", this.boundSwitchFile);
		this.removeAllCommands();
		delete settings.value[plugin.id];
		settings.update();
	}
	settings(): Acode.PluginSettings {
	    const shortcut = this.getPluginSettings().shortcut;
	    
		return {
			list: [
				{
					text: "Stop LSP",
					key: "stopLSP"
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
			],
			cb: (key: string, value) => {
			    if (key === "stopLSP") {
			        if (!this.client) this.showToast("LSP has not been activated");
			    	confirm("Stop LSP", "Are you sure?").then(i => {
			    	    if (i) {
			    	        this[key]();
			    	    }
			    	});
			    } else if (key.startsWith("shortcut.")) {
			    	const shortcut = key.split(".")[1];
			    	this.setPluginSettings((settings): Partial<PluginSettings> => {
			    		return {
			    			shortcut: {
			    				...settings.shortcut,
			    				[shortcut]: value as string
			    			}
			    		}
			    	})
			    }
			},
		}
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
