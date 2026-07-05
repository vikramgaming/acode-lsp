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
	showToast,
	delay
} from "./utils";
import lspMethod from "./method";

const settings = acode.require("settings");
const confirm = acode.require("confirm");
const select = acode.require("select");
const multiPrompt = acode.require("multiPrompt");
const selectionMenu = acode.require("selectionMenu");
const { editor } = editorManager

import type { LanguageClientConfig } from "./ace-linters/src/types/language-service";
import type { LanguageProvider } from "./ace-linters/src/language-provider";
import type { EditSession } from "ace-code/src/edit_session";

type Method = Parameters<typeof lspMethod>[0]
export interface Session extends EditSession {
	$modeId: string
}
export interface SocketClients {
	modes: string[],
	serviceName: string,
	args: string[],
	features?: LanguageClientConfig["features"],
	extension: string[],
	supportedMethod?: Partial<Record<Method, boolean>>;
}

const socketClients: Record<string, SocketClients> = {
	typescript: {
		modes: ["javascript", "typescript", "jsx", "tsx"],
		serviceName: "typescript",
		args: ["typescript-language-server", "--stdio"],
		extension: ["js", "ts", "jsx", "tsx"],
		supportedMethod: {
			goToDeclaration: false,
		},
	},
	css: {
		modes: ["css", "scss", "less"],
		serviceName: "css",
		args: ["vscode-css-language-server", "--stdio"],
		features: {
			signatureHelp: false,
		},
		extension: ["css", "scss", "less"],
		supportedMethod: {
			goToDeclaration: false,
			goToTypeDefinition: false,
			goToImplementation: false,
			callHierarchy: false,
		}
	},
	html: {
		modes: ["html"],
		serviceName: "html",
		args: ["vscode-html-language-server", "--stdio"],
		features: {
			signatureHelp: false,
			documentHighlight: false
		},
		extension: ["html"],
		supportedMethod: {
			goToDeclaration: false,
			goToTypeDefinition: false,
			goToImplementation: false,
			findReferences: false,
			renameSymbol: false,
			callHierarchy: false,
		}
	},
	json: {
		modes: ["json", "json5"],
		serviceName: "json",
		args: ["vscode-json-language-server", "--stdio"],
		features: {
			signatureHelp: false,
			documentHighlight: false
		},
		extension: ["json", "json5"],
		supportedMethod: {
			goToDefinition: false,
			goToDeclaration: false,
			goToTypeDefinition: false,
			goToImplementation: false
		},
	},
}

class LSP {
	baseUrl: string | undefined;
	currentWorkspace: string = "";
	currentEditor!: import("ace-code/src/editor").Editor;
	registeredLanguage = new Map<string, string>();

	private client: LanguageProvider | null = null;
	private socket: WebSocket[] = [];
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
				},
				semanticTokens: false
			} satisfies PluginSettings
			settings.update();
		}
	}
	get service() {
		const mode = (editor.session as Session).$modeId.replace("ace/mode/", "");
		const serviceName = this.registeredLanguage.get(mode);
		const clientConfig = Object.values(socketClients).find(c => c.serviceName === serviceName);
		return { serviceName, clientConfig }
	}
	createLSP(workspacePath: string) {
		const { socketUrl } = getPluginSettings();

		const serverConfig: LanguageClientConfig[] = [];

		for (const config of Object.values(socketClients)) {
			const url = `${socketUrl.replace(/\/?$/, "/")}${config.serviceName}-${workspacePath}?args=${config.args.join(",")}&type=stdio`
			const socket = new WebSocket(url);
			socket.onopen = () => {
				log("info", `Socket Connected for "${config.serviceName}" to: ${url}`);
			};
			socket.onclose = (e) => {
				log("warn", `Socket closed for ${config.serviceName}`, e);
				this.stopLSP();
			};
			socket.onerror = (e) => {
				log("error", `Socket unexpected error for ${config.serviceName}`, e);
				this.stopLSP();
			};
			this.socket.push(socket);

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
		const registeredLanguage: Record<string, string[]> = {};
		for (let [lang, serviceName] of this.registeredLanguage.entries()) {
			if (!registeredLanguage[serviceName]) {
				registeredLanguage[serviceName] = [];
			}
			registeredLanguage[serviceName].push(lang);
		}
		log("info", "Registered language serviceName:", registeredLanguage)

		this.currentWorkspace = workspacePath;

		const providerOptions: Parameters<typeof AceLanguageClient.for>[1] = {
			manualSessionControl: true,
			workspacePath,
			functionality: {
				// sudah bikin sendiri, matikan saja untuk menambah performance
				codeActions: false,
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
		}
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

		log("info", "Client", this.client);

		this.client.registerEditor(editor, {
			filePath: getCurrentFilePath(),
			joinWorkspaceURI: true
		});
		this.currentEditor = editor;
		editor.completers = editor.completers.filter(c => c.id != null && c.id !== "keywordCompleter");
	}
	stopLSP() {
		if (!this.client) return;

		for (const id in this.socket) {
			this.socket[id].close();
			delete this.socket[id];
		}
		this.client?.unregisterEditor(this.currentEditor, true);
		this.client?.closeConnection?.();
		this.client = null;
		this.registeredLanguage.clear();
		log("info", "LSP Stopped");
	}
	restartLSP(workspacePath = this.currentWorkspace) {
		log("info", "Restarting LSP");
		this.stopLSP();
		delay(3000).then(() => {
			this.startLSP(workspacePath);
		});
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
				log("info", "Switched to file", session);
			}
			if (this.registeredLanguage.has(modeId.OLD)) {
				this.client.closeDocument(oldSession, () => {
					log("info", "Slosing file", oldSession)
				})
			}
		} else {
			confirm("Workspace Changed", "Want to restart LSP?").then(i => {
				if (i) {
					this.restartLSP(workspace);
				}
			})
		}
	}

	async init(
		_$page: Acode.WCPage,
		_cacheFile: Acode.FileSystem,
		_cacheFileUrl: string,
	): Promise<void> {
		editor.on("changeSession", (this.boundSwitchFile));
		this.initAllCommands();

		const languageFormatter: string[] = [];

		for (const config of Object.values(socketClients)) {
			config.extension.forEach(lang => languageFormatter.push(lang));
		}

		selectionMenu.add(async () => {
			if (!this.client) return showToast("Start LSP first");
			const { serviceName, clientConfig } = this.service
			if (!serviceName || !clientConfig) return showToast("This file extension not supported");

			let options: (Acode.SelectItem & {
				value: Method
			})[] = [
					{ text: "Go To Document Link", value: "goToDocumentLink" },
					{ text: "Go To Definition", value: "goToDefinition" },
					{ text: "Go To Declaration", value: "goToDeclaration" },
					{ text: "Go To TypeDefinition", value: "goToTypeDefinition" },
					{ text: "Go To Implementation", value: "goToImplementation" },
					{ text: "Call Hierarchy", value: "callHierarchy" },
					{ text: "Find References", value: "findReferences" },
					{ text: "Show Code Actions", value: "codeActions" },
					{ text: "Rename Symbol", value: "renameSymbol" },
					{ text: "Document Symbol", value: "documentSymbol" },
				]
			if (typeof clientConfig.supportedMethod === "object" && clientConfig.supportedMethod != null) {
				options = options.filter(({ value }: { value: Method }) => {
					const v = clientConfig.supportedMethod?.[value]
					return v === true || v === undefined;
				})
			}

			const input: Method = await select("Select Command", options);
			if (input) {
				lspMethod(input, this.client, serviceName);
			}
		}, "LSP", "selected");

		acode.registerFormatter(plugin.id, languageFormatter, async () => {
			if (!this.client) return showToast("start LSP first");

			this.client.format();
			await delay(1000);
		});
		log("info", "Registered Formatter for language", languageFormatter);
	}
	initAllCommands() {
		const shortcutKeys: Record<string, ReturnType<typeof normalizeShortcutKeys>> = {};
		for (let [name, key] of Object.entries(getPluginSettings().shortcut)) {
			shortcutKeys[name] = normalizeShortcutKeys(key);
		}
		log("info", "shortcutKeys:", shortcutKeys)

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
				], "").then(({ workspacePath }: { workspacePath: string }) => {
					if (workspacePath) {
						this.startLSP(workspacePath)
					}
				})
			}
		})
		editor.commands.addCommand({
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
		editor.commands.addCommand({
			name: "LSP Dev Test",
			bindKey: shortcutKeys.devTest,
			exec: async () => {
				if (!getPluginSettings().debug || !this.client) return;
				this.client.doComplete(editor, editor.session, (completionList) => {
					log("info", "<dev>", "completions: ", completionList)
				})
			}
		})
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
		editor.off("changeSession", this.boundSwitchFile);
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
						log("info", `Shortcut changed for [${shortcut}] from "${(settings as any)[shortcut]}" to "${value}"`)
						return {
							shortcut: {
								...settings.shortcut,
								[shortcut]: value
							}
						}
					})
					this.removeAllCommands();
					this.initAllCommands();
				} else {
					setPluginSettings((settings) => {
						log("info", `Settings changed for [${key}] from "${(settings as any)[key]}" to "${value}"`)
						return {
							[key]: value
						}
					});
					showToast("Maybe need to Restart LSP");
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
