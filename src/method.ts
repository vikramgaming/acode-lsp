import { normalizePath, goToFile, log } from "./utils";
import { fromRange, toRange } from "@/linters/type-converters/lsp/lsp-converters";
import type { LSP } from "./main";
import { callHierarchySelectUI, callHierarchyUI, destinationUI, page } from "./ui/ui";

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
	currentMethod: MethodName | "" = "";

	constructor(lsp: LSP) {
		this.lsp = lsp;
	}
	private get client() {
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
	private execFormat(methodName: string, moreParams: object = {}, options: object = {}) {
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
		}, async (response: Promise<TextEdit[] | null>) => {
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
		}, async (reponse: Promise<DocumentLink[] | null>) => {
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
			log("info", `Method Code Actions ${serviceName}:`, codeActions);
			if (!this.client) return;

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
			}, async (response: Promise<RenameSymbol | null>) => {
				const data = await response;
				log("info", "Method Rename Symbol: ", serviceName, data);
				if (!data) return;

				data.changes[uri].sort((a, b) =>
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
		const workspaceUri = this.client.workspaceUri;

		this.client.sendRequest(serviceName, "textDocument/prepareCallHierarchy", {
			textDocument: { uri },
			position: selectionRange.end,
		}, async (response: Promise<Hierarchy[] | null>) => {
			const data = await response;
			log("info", `Method Call Hierarchy ${serviceName}:`, data);
			if (!data || !this.client) return;
			callHierarchyUI(data, workspaceUri, (hierarchyData) => {
				this.hierarchySelect(hierarchyData, serviceName, uri);
			});
		});
	}
	private hierarchySelect(item: Hierarchy, serviceName: string, originUri: string): void {
		select("Select Method", [
			{ text: "Incoming Calls", value: "incomingCalls" },
			{ text: "outgoingCalls", value: "outgoingCalls" },
		]).then((input) => {
			if (!input || !this.client) return;
			const workspaceUri = this.client.workspaceUri;
			page.hide();

			this.client.sendRequest(serviceName, `callHierarchy/${input}`, { item },
				async (response: Promise<(IncomingCalls | OutgoingCalls)[] | null>) => {
					const data = await response;
					log("info", `Method ${input} ${serviceName}:`, data);
					if (!data) return;

					const normalizeData: OutgoingCalls[] = [];
					for (const d of data) {
						const result: any = {};
						result.to = "to" in d ? d.to : d.from;
						if (!result.to.uri.startsWith(workspaceUri)) continue;

						result.fromRanges = [...new Set(d.fromRanges.map(range => JSON.stringify(range)))].map(range => JSON.parse(range));
						normalizeData.push(result);
					};
					callHierarchySelectUI(normalizeData, workspaceUri, input, originUri);
				}
			);
		});
	}
	documentSymbol(): void {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;
		const uri = this.getFileUri();

		this.client.sendRequest(serviceName, "textDocument/documentSymbol", {
			textDocument: { uri }
		}, async (response) => {
			const data = await response;
			log("info", `Method Document Symbol ${serviceName}:`, data);

		});
	}

	goToDeclaration(): void {
		this.goToLocation("declaration");
	}
	goToDefinition(): void {
		this.goToLocation("definition");
	}
	goToTypeDefinition(): void {
		this.goToLocation("typeDefinition");
	}
	goToImplementation(): void {
		this.goToLocation("implementation");
	}
	findReferences(): void {
		this.goToLocation("references", {
			context: {
				includeDeclaration: true
			}
		});
	}

	private goToLocation(methodName: goToLocationMethod, moreParams: object = {}) {
		const serviceName = this.getServiceName();
		if (!this.client || !serviceName) return;
		const uri = this.getFileUri();
		const selectionRange = this.getSelectionRange();
		const workspaceUri = this.client.workspaceUri;

		this.client.sendRequest(serviceName, `textDocument/${methodName}`,
			{
				textDocument: { uri },
				position: selectionRange.end,
				...moreParams
			}, async (response: Promise<Location[] | null>) => {
				const result = await response;
				const data = (Array.isArray(result) ? result : [result].filter(Boolean)) as Location[];
				log("info", `Method ${methodName} ${serviceName}:`, data);
				await destinationUI(data, workspaceUri, this.currentMethod);
			}
		);
	}
}

type TextEdit = {
	range: Range,
	newText: string;
};
type Position = {
	character: number,
	line: number;
};
type Range = {
	end: Position,
	start: Position;
};
export type DocumentLink = {
	range: Range,
	target: string;
};
type goToLocationMethod = "declaration" | "definition" | "typeDefinition" | "implementation" | "references";
export type Location = {
	uri: string,
	range: Range;
};
type RenameSymbol = {
	changes: {
		[x: string]: TextEdit[];
	};
};
export type Hierarchy = {
	detail: string,
	kind: number,
	name: string,
	range: Range,
	selectionRange: Range,
	uri: string;
};
type IncomingCalls = {
	from: Hierarchy,
	fromRanges: Range[];
};
export type OutgoingCalls = {
	to: Hierarchy,
	fromRanges: Range[];
};