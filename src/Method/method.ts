import { normalizePath, goToFile, log, showToast } from "../utils";
import { fromRange, toRange } from "@/linters/type-converters/lsp/lsp-converters";
import UIMethodPage from "../ui/ui";
import type { LSP } from "../main";
import * as lsp from "vscode-languageserver-protocol";
import type { LanguageProvider } from "@/linters/language-provider";
import { Range } from "vscode-languageserver-types";
import { isAfterOrEqual, isBeforeOrEqual, isInside, comparePosition } from "../utils";
import MethodListener from "./MethodListener";

const { editor } = editorManager;
const select = acode.require("select");
const prompt = acode.require("prompt");

type Method = {
	[M in keyof lsp.ServerCapabilities]: unknown;
};

export type Params = {
	client: LanguageProvider,
	serviceName: string,
	uri: string,
	selectionRange: Range;
};

type MethodName = keyof Method;

export default class LSPMethod implements Method {
	lsp: LSP;
	ui: UIMethodPage;
	currentMethod: MethodName | "" = "";
	listener: MethodListener;

	constructor(lsp: LSP) {
		this.lsp = lsp;
		this.listener = new MethodListener(lsp.listener, this);
		this.ui = new UIMethodPage(this, lsp.listener);
		const selectionMenu = acode.require("selectionMenu");

		selectionMenu.add(async () => {
			if (!lsp.client) return showToast("Start LSP first");
			const { serviceName, clientConfig } = lsp.service;
			if (!serviceName || !clientConfig) return showToast("This file extension not supported");

			let options: (Acode.SelectItem & {
				value: MethodName;
			})[] = [
					{ text: "Go To Document Link", value: "documentLinkProvider" },
					{ text: "Go To Definition", value: "definitionProvider" },
					{ text: "Go To Declaration", value: "declarationProvider" },
					{ text: "Go To TypeDefinition", value: "typeDefinitionProvider" },
					{ text: "Go To Implementation", value: "implementationProvider" },
					{ text: "Call Hierarchy", value: "callHierarchyProvider" },
					{ text: "Find References", value: "referencesProvider" },
					{ text: "Show Code Actions", value: "codeActionProvider" },
					{ text: "Rename Symbol", value: "renameProvider" },
					{ text: "Document Symbol", value: "documentSymbolProvider" },
					{ text: "Range Formatting", value: "documentRangeFormattingProvider" },
				];
			options = options.filter((select) => {
				return this.isSupportedMethod(select.value);
			});

			const input: MethodName = await select("Select Command", options);
			if (input) {
				this.currentMethod = input;
				((this as any)[input] as (params: Params) => void)({
					client: lsp.client,
					serviceName,
					uri: this.getFileUri(),
					selectionRange: this.getSelectionRange()
				});
			}
		}, "LSP", "selected");
	}
	get workspaceUri() {
		return this.lsp.currentWorkspace;
	}
	getServiceName(): string | undefined {
		return this.lsp.service.serviceName;
	}
	isSupportedMethod(methodName: MethodName): boolean {
		const serviceName = this.getServiceName();
		if (!serviceName) return false;
		return this.lsp.serviceCapabilities?.[serviceName]?.[methodName] ? true : false;
	}
	getSelectionRange(): Range {
		return fromRange(editor.getSelectionRange());
	}
	getFileUri(): string {
		return normalizePath(editorManager.activeFile.uri, "file");
	}

	documentFormattingProvider(params: Params): void {
		this.execFormat(params, lsp.DocumentFormattingRequest.method);
	}
	documentRangeFormattingProvider(params: Params): void {
		this.execFormat(params, lsp.DocumentRangeFormattingRequest.method, {
			range: this.getSelectionRange()
		});
	}
	private execFormat({ client, serviceName, uri }: Params, methodName: string, moreParams: Partial<lsp.DocumentRangeFormattingParams> = {}, options: Partial<lsp.DocumentFormattingParams["options"]> = {}) {
		const settings = acode.require("settings");
		const defaultOptions = {
			tabSize: settings.value.tabSize,
			insertSpaces: settings.value.softTab,
			trimTrailingWhitespace: true,
			insertFinalNewline: true,
			trimFinalNewlines: true
		};
		client.sendRequest(serviceName, methodName, {
			textDocument: { uri },
			options: {
				...defaultOptions,
				...options
			},
			...moreParams
		} satisfies lsp.DocumentFormattingParams,
			async (response: Promise<lsp.TextEdit[] | null>) => {
				const data = await response;
				log("info", `Method ${methodName} ${serviceName}:`, data);
				if (!data) return;
				data.sort((a, b) =>
					b.range.start.line - a.range.start.line ||
					b.range.start.character - a.range.start.character
				).forEach(edit => editor.session.replace(toRange(edit.range), edit.newText));
			});
	}
	documentLinkProvider({ client, uri, serviceName, selectionRange }: Params): void {
		client.sendRequest(serviceName, lsp.DocumentLinkRequest.method, {
			textDocument: { uri }
		} satisfies lsp.DocumentLinkParams,
			async (reponse: Promise<lsp.DocumentLink[] | null>) => {
				const data = await reponse;
				log("info", `Method ${lsp.DocumentLinkRequest.method} ${serviceName}:`, data);
				if (!data) return;
				for (let location of data) {
					if (
						isAfterOrEqual(selectionRange.start, location.range.start) &&
						isBeforeOrEqual(selectionRange.end, location.range.end)
					) {
						if (!location.target) return;
						log("info", "To Location", location);

						if (location.target.startsWith("file:")) {
							goToFile(location.target, { column: 0, row: 0 });
						} else {
							acode.exec("open-inapp-browser", location.target);
						}
						break;
					}
				}
			});
	}
	codeActionProvider({ client, serviceName }: Params): void {
		client.getCodeActions(async (codeActions) => {
			log("info", `Method ${lsp.CodeActionRequest.method} ${serviceName}:`, codeActions);

			const actionByService = codeActions.find(action => action.service === serviceName);
			if (!actionByService?.codeActions || actionByService.codeActions.length === 0) return;

			const options = actionByService.codeActions.map(action => {
				return {
					text: action.title,
					value: action
				};
			});
			if (options.length === 0) return;

			const action = await select("Select Code Actions", options) as typeof options[number]["value"];
			if (typeof action.command === "string") {
				client.executeCommand(action.command, serviceName, (action as any)["arguments"]);
			} else {
				if (action.command) {
					client.executeCommand(action.command.command, serviceName, action.command.arguments);
				}
				if ("edit" in action) {
					client.applyEdit(action.edit!, serviceName);
				}
			}
		});
	}
	renameProvider({ client, serviceName, uri, selectionRange }: Params): void {
		prompt("Rename Symbol", editor.getSelectedText()).then((input) => {
			if (input == null) return;

			client.sendRequest(serviceName, lsp.RenameRequest.method, {
				textDocument: { uri },
				position: selectionRange.end,
				newName: input
			} satisfies lsp.RenameParams,
				async (response: Promise<lsp.WorkspaceEdit | null>) => {
					const data = await response;
					log("info", `Method ${lsp.RenameRequest.method} ${serviceName}:`, data);
					if (!data) return;

					data.changes![uri].sort((a, b) =>
						b.range.start.line - a.range.start.line ||
						b.range.start.character - a.range.start.character
					).forEach(edit => editor.session.replace(toRange(edit.range), edit.newText));
				});
		});
	}
	callHierarchyProvider({ client, serviceName, uri, selectionRange }: Params): void {
		client.sendRequest(serviceName, lsp.CallHierarchyPrepareRequest.method, {
			textDocument: { uri },
			position: selectionRange.end,
		} satisfies lsp.CallHierarchyPrepareParams,
			async (response: Promise<lsp.TypeHierarchyItem[] | null>) => {
				const data = await response;
				log("info", `Method ${lsp.CallHierarchyPrepareRequest.method} ${serviceName}:`, data);
				if (!data) return;
				const normalizeData = data.filter(item => item.uri.startsWith(this.workspaceUri));
				if (normalizeData.length === 0) return;

				this.ui.callhierarchy(normalizeData, (item) => this.hierarchySelect(client, item, serviceName, uri));
			});
	}
	private hierarchySelect(client: LanguageProvider, item: lsp.CallHierarchyItem, serviceName: string, originUri: string): void {
		select("Select Method", [
			{ text: "Incoming Calls", value: lsp.CallHierarchyIncomingCallsRequest.method },
			{ text: "outgoingCalls", value: lsp.CallHierarchyOutgoingCallsRequest.method },
		]).then((methodName) => {
			this.ui.page.hide();

			client.sendRequest(serviceName, methodName, { item },
				async (response: Promise<(lsp.CallHierarchyIncomingCall | lsp.CallHierarchyOutgoingCall)[] | null>) => {
					const data = await response;
					log("info", `Method ${methodName} ${serviceName}:`, data);
					if (!data) return;

					const normalizeData = data.filter(item => {
						if ("from" in item) return item.from.uri.startsWith(this.workspaceUri);
						return item.to.uri.startsWith(this.workspaceUri);
					});
					if (normalizeData.length === 0) return;

					if (normalizeData.every(item => "from" in item)) {
						this.ui.hierarchyIncomingCalls(normalizeData);
					} else if (normalizeData.every(item => "to" in item)) {
						this.ui.hierarchyOutGoingCalls(normalizeData, originUri);
					}
				}
			);
		});
	};
	documentSymbolProvider({ client, serviceName, uri }: Params): void {
		client.sendRequest(serviceName, lsp.DocumentSymbolRequest.method, {
			textDocument: { uri },
		} satisfies lsp.DocumentSymbolParams,
			async (response: Promise<(lsp.DocumentSymbol | lsp.SymbolInformation)[] | null>) => {
				const data = await response;
				log("info", `Method ${lsp.DocumentSymbolRequest.method} ${serviceName}:`, data);
				if (!data) return;
                if (data.every(sym => "range" in sym)) {
                    log("info", data)
                }
                else if (data.every(sym => "location" in sym)) {
                    interface Symbols extends lsp.SymbolInformation {
                        children: Symbols[]
                    }
                    
                    const syms: Symbols[] = data.sort((a, b) => comparePosition(a.location.range.start, b.location.range.start))
                                    .map(sym => ({ ...sym, children: [] }))
                    const roots = [];
                    
                    for (const item of syms) {
                        let parent = null;
                        for (const candidate of syms) {
                            if (candidate === item || !isInside(item.location.range, candidate.location.range)) continue;
                            
                            if (parent === null || comparePosition(candidate.location.range.end, parent.location.range.end) < 0) {
                                parent = candidate;
                            }
                        }
                        if (parent) {
                            parent.children.push(item);
                        } else {
                            roots.push(item);
                        }
                    }
                    log("info", roots);
                }
			});
	};

	declarationProvider(params: Params): void {
		this.goToLocation(params, lsp.DeclarationRequest.method);
	};
	definitionProvider(params: Params): void {
		this.goToLocation(params, lsp.DefinitionRequest.method);
	};
	typeDefinitionProvider(params: Params): void {
		this.goToLocation(params, lsp.TypeDefinitionRequest.method);
	};
	implementationProvider(params: Params): void {
		this.goToLocation(params, lsp.ImplementationRequest.method);
	};
	referencesProvider(params: Params): void {
		this.goToLocation(params, lsp.ReferencesRequest.method, {
			context: {
				includeDeclaration: true
			},
		});
	}

	private goToLocation({ client, serviceName, uri, selectionRange }: Params, methodName: string, moreParams: Partial<lsp.ReferenceParams> = {}) {
		client.sendRequest(serviceName, methodName,
			{
				textDocument: { uri },
				position: selectionRange.end,
				...moreParams
			} satisfies lsp.DefinitionParams,
			async (response: Promise<lsp.Location | lsp.Location[] | null>) => {
				const result = await response;
				log("info", `Method ${methodName} ${serviceName}:`, result);
				if (!result) return;
				const data = Array.isArray(result) ? result : [result];
				const normalizeData = data.filter(loc => loc.uri.startsWith(this.workspaceUri));
				if (normalizeData.length === 0) return;

				this.ui.destination(normalizeData, methodName);
			}
		);
	}
}