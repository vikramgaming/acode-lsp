import plugin from "../plugin.json";
import { AceLanguageClient } from "./ace-linters/src/ace-language-client";
import { LanguageClient } from "./ace-linters/src/services/language-client";
import {
	getActiveFolderPath,
	getCurrentFilePath,
	normalizeShortcutKeys,
	getPluginSettings,
	setPluginSettings,
	PluginSettings,
	log,
	showToast
} from "./utils";
import lspMethod from "./method"

const settings = acode.require("settings");
const confirm = acode.require("confirm");
const select = acode.require("select");
const multiPrompt = acode.require("multiPrompt");
const selectionMenu = acode.require("selectionMenu");

import type { LanguageClientConfig } from "./ace-linters/src/types/language-service";
import type { LanguageProvider } from "./ace-linters/src/language-provider";
import type { EditSession } from "ace-code/src/edit_session";

type Method = Parameters<typeof lspMethod>[0]
export interface Session extends EditSession {
	$modeId: string
}
interface SocketClients {
	modes: string[],
	serviceName: string,
	args: string[],
	features: LanguageClientConfig["features"],
}

const socketClients = {
	typescript: {
		modes: ["javascript", "typescript", "jsx", "tsx"],
		serviceName: "typescript",
		args: ["typescript-language-server", "--stdio"],
		features: {},
	},
	css: {
		modes: ["css", "scss", "less"],
		serviceName: "css",
		args: ["vscode-css-language-server", "--stdio"],
		features: {
			signatureHelp: false
		},
	},
	html: {
		modes: ["html"],
		serviceName: "html",
		args: ["vscode-html-language-server", "--stdio"],
		features: {
			signatureHelp: false,
			documentHighlight: false
		},
	},
	json: {
		modes: ["json", "json5"],
		serviceName: "json",
		args: ["vscode-json-language-server", "--stdio"],
		features: {
			signatureHelp: false
		},
	}
} satisfies Record<string, SocketClients>

class LSP {
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
	createLSP(workspacePath: string) {
		const { socketUrl } = getPluginSettings();

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
			
		log("info", "Initialize LSP", serverConfig);
		log("info", "socket", this.socket);
		log("info", "registered language service name", [...this.registeredLanguage.entries()])

		this.currentWorkspace = workspacePath

		return AceLanguageClient.for(serverConfig, {
			manualSessionControl: true,
			workspacePath,
			functionality: {
			    codeActions: false,
			    inlineCompletion: false,
			}
		});
	}
	startLSP(workspacePath: string) {
		if (this.client) {
			log("warn", "LSP already running");
			return;
		}
		log("info", "workspacePath :", workspacePath);

		this.client = this.createLSP(workspacePath);

		log("info", "Client", this.client);

		const editor = editorManager.editor;
		this.client.registerEditor(editor, {
			filePath: getCurrentFilePath(),
			joinWorkspaceURI: true
		});
		this.currentEditor = editor;
	}
	stopLSP() {
		if (!this.client) return;
		
		log("info", "LSP Stopped");

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
				log("info", "switching to file", session);
			}
			if (this.registeredLanguage.has(modeId.OLD)) {
				this.client.closeDocument(oldSession, () => {
					log("info", "closing file", oldSession)
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
		
		selectionMenu.add(async () => {
            if (!this.client) return showToast("Start LSP first");
            const mode = (editorManager.editor.session as Session).$modeId.replace("ace/mode/", "");
            const serviceName = this.registeredLanguage.get(mode);
            if (!serviceName) return showToast("This file extension not supported");
            
            let options: (Acode.SelectItem & {
                value: Method
            })[] = [
                { text: "Go To Document Link", value: "goToDocumentLink" },
                { text: "Go To Definition", value: "goToDefinition" },
                { text: "Go To Declaration", value: "goToDeclaration" },
                { text: "Go To TypeDefinition", value: "goToTypeDefinition" },
                { text: "Go To Implementation", value: "goToImplementation" },
                { text: "Find References", value: "findReferences" },
                { text: "Show Code Actions", value: "codeActions" },
                { text: "Rename Symbol", value: "renameSymbol" },
            ]
            
            const input: Method = await select("Select Command", options);
            if (input) {
                lspMethod(input, this.client, serviceName);
            }
        }, "LSP", "selected");
		
		acode.registerFormatter(plugin.id, languageFormatter, async () => {
			if (!this.client) return showToast("start LSP first");

			this.client.format()
		})
		log("info", "Registered Formatter for language", languageFormatter);
	}
	initAllCommands() {
	    const shortcutKeys: Record<string, ReturnType<typeof normalizeShortcutKeys>> = {};
	    for (let [name, key] of Object.entries(getPluginSettings().shortcut)) {
	        shortcutKeys[name] = normalizeShortcutKeys(key);
	    }
	    log("info", "shortcutKeys:", shortcutKeys)
	    
		editorManager.editor.commands.addCommand({
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
				    log("error", "Cannot find the client");
				    return showToast("Start LSP first");
				}
			    this.client.format();
			}
		})
	    editorManager.editor.commands.addCommand({
	        name: "LSP Dev Test",
	        bindKey: shortcutKeys.devTest,
	        exec: async () => {
	            if (!getPluginSettings().debug) return;
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
	    const { shortcut, ...pluginSettings } = getPluginSettings();
	    
		return {
			list: [
				{
					text: "Stop LSP",
					key: "stopLSP",
				},
				{
					text: "Debug mode",
					key: "debug",
					checkbox: pluginSettings.debug
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
			cb: (key: string, value) => {
			    if (key === "stopLSP") {
			        if (!this.client) return showToast("LSP not activated");
			    	confirm("Stop LSP", "Are you sure?").then(i => {
			    	    if (i) {
			    	        this[key]();
			    	    }
			    	});
			    } else if (key.startsWith("shortcut.")) {
			    	const shortcut = key.replace("shortcut.", "");
			    	setPluginSettings((settings): Partial<PluginSettings> => {
			    		return {
			    			shortcut: {
			    				...settings.shortcut,
			    				[shortcut]: value
			    			}
			    		}
			    	})
			    } else {
			        setPluginSettings(() => {
			            return {
			                [key]: value as string
			            }
			        });
			        this.removeAllCommands();
			        this.initAllCommands();
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
