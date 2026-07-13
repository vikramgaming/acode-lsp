import { normalizePath, goToFile, log, showToast } from "./utils";
import { fromRange, toRange } from "@/linters/type-converters/lsp/lsp-converters";
import UIPage from "./ui/ui";
import type { LSP } from "./main";
import type * as lsp from "vscode-languageserver-protocol";

const { editor } = editorManager;
const select = acode.require("select");
const prompt = acode.require("prompt");

interface Method {
	goToDocumentLink(): void;
	goToDefinition(): void;
	goToDeclaration(): void;
	goToTypeDefinition(): void;
	goToImplementation(): void;
	findReferences(): void;
	codeActions(): void;
	renameSymbol(): void;
	callHierarchy(): void;
	documentSymbol(): void;
	rangeFormat(): void;
}

export type MethodName = keyof Method;

export default class LSPMethod implements Method {
	private lsp: LSP;
	ui: UIPage;
	currentMethod: MethodName | "" = "";

	constructor(lsp: LSP) {
		this.lsp = lsp;
		this.ui = new UIPage();
		const selectionMenu = acode.require("selectionMenu");

		selectionMenu.add(async () => {
			if (!lsp.client) return showToast("Start LSP first");
			const { serviceName, clientConfig } = lsp.service;
			if (!serviceName || !clientConfig) return showToast("This file extension not supported");

			let options: (Acode.SelectItem & {
				value: MethodName;
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
					{ text: "Range Formatting", value: "rangeFormat" },
				];
			if (clientConfig.supportedMethod != null) {
				options = options.filter(({ value }: { value: MethodName; }) => {
					const v = clientConfig.supportedMethod?.[value];
					return v === true || v === undefined;
				});
			}

			const input: MethodName = await select("Select Command", options);
			if (input) {
				this.callMethod(input);
			}
		}, "LSP", "selected");
	}
	get client() {
		return this.lsp.client;
	}
	getServiceName(): string | undefined {
		return this.lsp.service.serviceName;
	}
	getSelectionRange(): import("vscode-languageserver-types").Range {
		return fromRange(editor.getSelectionRange());
	}
	getFileUri(): string {
		return normalizePath(editorManager.activeFile.uri, "file");
	}
	callMethod(name: MethodName): void {
		this.currentMethod = name;
		this[name]();
	}
	format(): void {
		this.execFormat("formatting");
	}
	rangeFormat(): void {
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
	goToDocumentLink(): void {
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
	codeActions(): void {
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
	renameSymbol(): void {
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
	callHierarchy(): void {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;
		const uri = this.getFileUri();
		const selectionRange = this.getSelectionRange();

		this.client.sendRequest(serviceName, "textDocument/prepareCallHierarchy", {
			textDocument: { uri },
			position: selectionRange.end,
		} satisfies lsp.CallHierarchyPrepareParams,
			async (response: Promise<lsp.CallHierarchyItem[] | null>) => {
				const data = await response;
				log("info", `Method Call Hierarchy ${serviceName}:`, data);
				if (!data) return;
				this.ui.callhierarchy(data, (item) => this.hierarchySelect(item, serviceName, uri));
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
					if (data.every(item => "from" in item)) {
						this.ui.hierarchyIncomingCalls(data);
					} else if (data.every(item => "to" in item)) {
						this.ui.hierarchyOutGoingCalls(data, originUri);
					}
				}
			);
		});
	};
	documentSymbol(): void {
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

	goToDeclaration(): void {
		this.goToLocation("declaration");
	};
	goToDefinition(): void {
		this.goToLocation("definition");
	};
	goToTypeDefinition(): void {
		this.goToLocation("typeDefinition");
	};
	goToImplementation(): void {
		this.goToLocation("implementation");
	};
	findReferences(): void {
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
				this.ui.destination(data, methodName);
			}
		);
	}
}


type goToLocationMethod = "declaration" | "definition" | "typeDefinition" | "implementation" | "references";