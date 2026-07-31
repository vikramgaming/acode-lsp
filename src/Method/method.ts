import { normalizePath, goToFile, log, showToast } from "../utils";
import { fromRange, toRange } from "@/linters/type-converters/lsp/lsp-converters";
import UIMethodPage from "../ui/ui";
import type { LSP } from "../main";
import type * as lsp from "vscode-languageserver-protocol";

const { editor } = editorManager;
const select = acode.require("select");
const prompt = acode.require("prompt");

type Method = {
	[M in keyof lsp.ServerCapabilities]: (...args: any) => any
};

type MethodName = keyof Method;

export default class LSPMethod implements Method {
	private lsp: LSP;
	ui: UIMethodPage;
	currentMethod: MethodName | "" = "";
	methodListener: MethodListener;

	constructor(lsp: LSP) {
		this.lsp = lsp;
		this.ui = new UIMethodPage(this);
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
				(this as any)[input]();
			}
		}, "LSP", "selected");
	}
	get client() {
		return this.lsp.client;
	}
	get workspaceUri() {
		return this.lsp.client!.workspaceUri;
	}
	getServiceName(): string | undefined {
		return this.lsp.service.serviceName;
	}
	isSupportedMethod(methodName: MethodName): boolean {
		const serviceName = this.getServiceName();
		if (!serviceName) return false;
		return this.lsp.serviceCapabilities?.[serviceName]?.[methodName] ? true : false;
	}
	getSelectionRange(): import("vscode-languageserver-types").Range {
		return fromRange(editor.getSelectionRange());
	}
	getFileUri(): string {
		return normalizePath(editorManager.activeFile.uri, "file");
	}

	documentFormattingProvider(): void {
		this.execFormat("formatting");
	}
	documentRangeFormattingProvider(): void {
		this.execFormat("rangeFormatting", {
			range: this.getSelectionRange()
		});
	}
	private execFormat(methodName: string, moreParams: Partial<lsp.DocumentRangeFormattingParams> = {}, options: Partial<lsp.DocumentFormattingParams["options"]> = {}) {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;
		const uri = this.getFileUri();
		const settings = acode.require("settings");
		const defaultOptions = {
			tabSize: settings.value.tabSize,
			insertSpaces: settings.value.softTab,
			trimTrailingWhitespace: true,
			insertFinalNewline: true,
			trimFinalNewlines: true
		};
		this.client.sendRequest(serviceName, `textDocument/${methodName}`, {
			textDocument: { uri },
			options: {
				...defaultOptions,
				...options
			},
			...moreParams
		} satisfies lsp.DocumentFormattingParams,
			async (response: Promise<lsp.TextEdit[] | null>) => {
				const data = await response;
				log("info", `Method ${methodName} ${serviceName}`, data);
				if (!data) return;
				data.sort((a, b) =>
					b.range.start.line - a.range.start.line ||
					b.range.start.character - a.range.start.character
				).forEach(edit => editor.session.replace(toRange(edit.range), edit.newText));
			});
	}
	documentLinkProvider(): void {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;
		const uri = this.getFileUri();
		const selectionRange = this.getSelectionRange();

		this.client.sendRequest(serviceName, "textDocument/documentLink", {
			textDocument: { uri }
		} satisfies lsp.DocumentLinkParams,
			async (reponse: Promise<lsp.DocumentLink[] | null>) => {
				const data = await reponse;
				log("info", `Method Document Link ${serviceName}:`, data);
				if (!data) return;
				for (let location of data) {
					if (
						selectionRange.end.character <= location.range.end.character &&
						selectionRange.end.line <= location.range.end.line &&
						selectionRange.start.character >= location.range.start.character &&
						selectionRange.start.line >= location.range.start.line
					) {
						if (!location.target) return;
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
	codeActionProvider(): void {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;

		this.client.getCodeActions(async (codeActions) => {
			if (!this.client) return;
			log("info", `Method Code Actions ${serviceName}:`, codeActions);

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
				this.client.executeCommand(action.command, serviceName, (action as any)["arguments"]);
			} else {
				if (action.command) {
					this.client.executeCommand(action.command.command, serviceName, action.command.arguments);
				}
				if ("edit" in action) {
					this.client.applyEdit(action.edit!, serviceName);
				}
			}
		});
	}
	renameProvider(): void {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;
		prompt("Rename Symbol", editor.getSelectedText()).then((input) => {
			if (input == null || !this.client) return;
			const uri = this.getFileUri();
			const selectionRange = this.getSelectionRange();

			this.client.sendRequest(serviceName, "textDocument/rename", {
				textDocument: { uri },
				position: selectionRange.end,
				newName: input
			} satisfies lsp.RenameParams,
				async (response: Promise<lsp.WorkspaceEdit | null>) => {
					const data = await response;
					log("info", "Method Rename Symbol: ", serviceName, data);
					if (!data) return;

					data.changes![uri].sort((a, b) =>
						b.range.start.line - a.range.start.line ||
						b.range.start.character - a.range.start.character
					).forEach(edit => editor.session.replace(toRange(edit.range), edit.newText));
				});
		});
	}
	callHierarchyProvider(): void {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;
		const uri = this.getFileUri();
		const selectionRange = this.getSelectionRange();

		this.client.sendRequest(serviceName, "textDocument/prepareCallHierarchy", {
			textDocument: { uri },
			position: selectionRange.end,
		} satisfies lsp.CallHierarchyPrepareParams,
			async (response: Promise<lsp.TypeHierarchyItem[] | null>) => {
				const data = await response;
				log("info", `Method Call Hierarchy ${serviceName}:`, data);
				if (!data) return;
				const normalizeData = data.filter(item => item.uri.startsWith(this.workspaceUri));
				if (normalizeData.length === 0) return;
				
				this.ui.callhierarchy(normalizeData, (item) => this.hierarchySelect(item, serviceName, uri));
			});
	}
	private hierarchySelect(item: lsp.CallHierarchyItem, serviceName: string, originUri: string): void {
		select("Select Method", [
			{ text: "Incoming Calls", value: "incomingCalls" },
			{ text: "outgoingCalls", value: "outgoingCalls" },
		]).then((input) => {
			if (!this.client || !input) return;
			this.ui.page.hide();

			this.client.sendRequest(serviceName, `callHierarchy/${input}`, { item },
				async (response: Promise<(lsp.CallHierarchyIncomingCall | lsp.CallHierarchyOutgoingCall)[] | null>) => {
					const data = await response;
					log("info", `Method ${input} ${serviceName}:`, data);
					if (!data) return;
					
					const normalizeData = data.filter(item => {
						if ("from" in item) return item.from.uri.startsWith(this.workspaceUri)
						return item.to.uri.startsWith(this.workspaceUri)
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
	documentSymbolProvider(): void {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;
		const uri = this.getFileUri();

		this.client.sendRequest(serviceName, "textDocument/documentSymbol", {
			textDocument: { uri },
		} satisfies lsp.DocumentSymbolParams,
			async (response: Promise<(lsp.DocumentSymbol)[] | null>) => {
				const data = await response;
				log("info", `Method Document Symbol ${serviceName}:`, data);

			});
	};

	declarationProvider(): void {
		this.goToLocation("declaration");
	};
	definitionProvider(): void {
		this.goToLocation("definition");
	};
	typeDefinitionProvider(): void {
		this.goToLocation("typeDefinition");
	};
	implementationProvider(): void {
		this.goToLocation("implementation");
	};
	referencesProvider(): void {
		this.goToLocation("references", {
			context: {
				includeDeclaration: true
			},
		});
	}

	private goToLocation(methodName: goToLocationMethod, moreParams: Partial<lsp.ReferenceParams> = {}) {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;
		const uri = this.getFileUri();
		const selectionRange = this.getSelectionRange();

		this.client.sendRequest(serviceName, `textDocument/${methodName}`,
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

type goToLocationMethod = "declaration" | "definition" | "typeDefinition" | "implementation" | "references";