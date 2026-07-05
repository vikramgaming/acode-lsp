import { normalizePath, goToFile, log, delay } from "./utils";
import { fromRange, toPoint } from "./ace-linters/src/type-converters/lsp/lsp-converters";
import { createPage, createFileCard, createListCard, createPositionText, createNameText } from "./ui"
import type { DocumentLink } from "./handler"

const select = acode.require("select");
const prompt = acode.require("prompt");
const Range = ace.require("ace/range").Range;
const { editor } = editorManager;
const sidebutton = acode.require("sidebutton");
const page = createPage("LSP Method");

const sideBtn = sidebutton({
	text: "Prev Page Method",
	backgroundColor: "cyan",
	textColor: "black",
	onclick: () => page.show()
});
sideBtn.show();

import type { LanguageProvider } from "./ace-linters/src/language-provider";

type Position = {
	character: number,
	line: number
}

type Range = {
	end: Position,
	start: Position
}

type Hierarchy = {
	detail: string,
	kind: number,
	name: string,
	range: Range,
	selectionRange: Range,
	uri: string
}

type Param = { selectionRange: ReturnType<typeof fromRange>, uri: string }

const method = {
	goToDefinition: async (client, serviceName, { selectionRange, uri }) => {
		await goToLocation("definition", client, serviceName, { selectionRange, uri });
	},
	goToDeclaration: async (client, serviceName, { selectionRange, uri }) => {
		await goToLocation("declaration", client, serviceName, { selectionRange, uri });
	},
	goToTypeDefinition: async (client, serviceName, { selectionRange, uri }) => {
		await goToLocation("typeDefinition", client, serviceName, { selectionRange, uri });
	},
	goToImplementation: async (client, serviceName, { selectionRange, uri }) => {
		await goToLocation("implementation", client, serviceName, { selectionRange, uri });
	},
	findReferences: async (client, serviceName, { selectionRange, uri }) => {
		await goToLocation("references", client, serviceName, { selectionRange, uri }, {
			context: {
				includeDeclaration: true
			}
		});
	},
	codeActions: async (client, serviceName) => {
		client.getCodeActions(async (codeActions) => {
			log("info", `Method Code Actions ${serviceName}:`, codeActions);

			const actionByService = codeActions.find(action => action.service === serviceName);
			if (!actionByService?.codeActions || actionByService.codeActions.length === 0) return;

			const options = actionByService.codeActions.map(action => {
				return {
					text: action.title,
					value: action
				}
			});
			if (options.length === 0) return;

			const action = await select("Select Code Actions", options) as typeof options[number]["value"];
			if (typeof action.command === "string") {
				client.executeCommand(action.command, serviceName, (action as any)["arguments"])
			} else {
				if (action.command) {
					client.executeCommand(action.command.command, serviceName, action.command.arguments);
				}
				if ("edit" in action) {
					client.applyEdit(action.edit!, serviceName)
				}
			}
		});
	},
	renameSymbol: async (client, serviceName, { selectionRange, uri }) => {
		const input = await prompt("Rename Symbol", editor.getSelectedText());
		if (input == null) return;
		type RenameSymbol = {
			changes: {
				[x: string]: {
					newText: string,
					range: Range
				}[]
			}
		}

		client.sendRequest(serviceName, "textDocument/rename", {
			textDocument: { uri },
			position: selectionRange.end,
			newName: input
		}, async (response: Promise<RenameSymbol>) => {
			const data = await response;
			log("info", "Method Rename Symbol: ", serviceName, data);
			if (!data) return

			data.changes[uri].forEach(edit => {
				const range = new Range(
					edit.range.start.line,
					edit.range.start.character,
					edit.range.end.line,
					edit.range.end.character
				);
				editor.session.replace(range, edit.newText);
			})
		})
	},
	goToDocumentLink: async (client, serviceName, { selectionRange, uri }) => {
		

		client.sendRequest(serviceName, "textDocument/documentLink", {
			textDocument: { uri }
		}, async (reponse: Promise<DocumentLink[]>) => {
			const data = await reponse;
			log("info", `Method Document Link ${serviceName}:`, data);
			if (!data) return
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
		})
	},
	callHierarchy: async (client, serviceName, { selectionRange, uri }) => {
		client.sendRequest(serviceName, "textDocument/prepareCallHierarchy", {
			textDocument: { uri },
			position: selectionRange.end,
		}, async (response: Promise<Hierarchy[] | null>) => {
			const data = await response;
			log("info", `Method Call Hierarchy ${serviceName}:`, data);
			if (!data) return;
			const normalizeData = data.filter((d) => d.uri.startsWith(client.workspaceUri));
			if (normalizeData.length === 0) return;
	
			const group = Object.groupBy(normalizeData, (item) => item.uri);
			page.innerHTML = "";
			const container = tag("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "10px"
				}
			});
			const title = tag("h2", {
				textContent: "callHierarchy"
			});
			container.append(title);
			for (const [uri, hierarcyData] of Object.entries(group)) {
				if (hierarcyData == null) continue;
				const hierarcyList = createListCard(hierarcyData.length, (i) => createNameText(hierarcyData[i].name, hierarcyData[i].detail),
					(i) => {
						hierachySelect(client, serviceName, hierarcyData[i])
					}
				)
				const filenameCard = createFileCard(uri.replace(client.workspaceUri, ""), hierarcyList);
				container.append(filenameCard);
			};
			page.appendBody(container);
			await delay(1000);
			page.show();
		})
	},
	documentSymbol: async (client, serviceName, { uri }) => {
		client.sendRequest(serviceName, "textDocument/documentSymbol", {
			textDocument: { uri }
		}, async (response) => {
			const data = await response;
			log("info", `Method Document Symbol ${serviceName}:`, data)

		})
	}
} satisfies {
	[x: string]: (client: LanguageProvider, serviceName: string, { selectionRange, uri }: Param) => Promise<void>
}

async function goToLocation(methodName: string, client: LanguageProvider, serviceName: string, { selectionRange, uri }: Param, moreParam: object = {}) {
	type Location = {
		uri: string,
		range: Range
	}
	client.sendRequest(serviceName, `textDocument/${methodName}`,
		{
			textDocument: { uri },
			position: selectionRange.end,
			...moreParam
		}, async (response: Promise<Location[] | null>) => {
			const result = await response;
			const data = (Array.isArray(result) ? result : [result].filter(Boolean)) as Location[];
			log("info", `Method ${methodName} ${serviceName}:`, data);

			const normalizeData = data.filter((d) => d.uri.startsWith(client.workspaceUri));
			if (normalizeData.length === 0) return;

			const group = Object.groupBy(normalizeData, (item) => item.uri);

			page.innerHTML = "";
			const container = tag("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "10px"
				}
			});
			const title = tag("h2", {
				textContent: methodName
			});
			container.append(title);
			for (const [uri, location] of Object.entries(group)) {
				if (location == null) continue;
				const locationList = createListCard(location.length, (i) => createPositionText(location[i].range.start),
					(i) => {
						page.hide();
						goToFile(uri, toPoint(location[i].range.start));
					}
				)
				const filenameCard = createFileCard(uri.replace(client.workspaceUri, ""), locationList);
				container.append(filenameCard);
			};
			page.appendBody(container);
			await delay(1000);
			page.show();
		}
	)
}

async function hierachySelect(client: LanguageProvider, serviceName: string, item: Hierarchy) {
	const input: string | null = await select("Select Method", [
		{ text: "Incoming Calls", value: "incomingCalls" },
		{ text: "outgoingCalls", value: "outgoingCalls" },
	]);
	if (!input) return;
	page.hide();

	type IncomingCalls = {
		from: Hierarchy,
		fromRanges: Range[]
	}
	type OutgoingCalls = {
		to: Hierarchy,
		fromRanges: Range[]
	}

	client.sendRequest(serviceName, `callHierarchy/${input}`, { item },
		async (response: Promise<(IncomingCalls | OutgoingCalls)[] | null>) => {
			const data = await response;
			log("info", `Method ${input} ${serviceName}:`, data);
			if (!data) return;
			// dijadikan type outgoing calls
			const normalizeData: OutgoingCalls[] = [];
			for (const d of data) {
				const result = {};
				result.to = "to" in d ? d.to : d.from;
				if (!result.to.uri.startsWith(client.workspaceUri)) continue;

				result.fromRanges = d.fromRanges;
				normalizeData.push(result as OutgoingCalls);
			};
			const group = Object.groupBy(normalizeData, (item) => item.to.uri);
			page.innerHTML = "";
			const container = tag("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "10px"
				}
			});
			const title = tag("h2", {
				textContent: input
			});
			container.append(title);
			for (const [uri, hierarchyData] of Object.entries(group)) {
				if (hierarchyData == null) continue;
				const hierarchyDataList = createListCard(hierarchyData.length,
					(i) => {
						const div = tag("div");
						const nameText = createNameText(hierarchyData[i].to.name, hierarchyData[i].to.detail);

						const listRange = tag("ul", {
							style: {
								listStyle: "none",
								display: "none",
								marginTop: "3px",
								flexDirection: "column",
								gap: "5px"
							}
						});
						nameText.onclick = () => {
							listRange.style.display = listRange.style.display === "none" ? "flex" : "none"
						}
						for (const ranges of hierarchyData[i].fromRanges) {
							const item = tag("li", {
								style: {
									border: "1px solid lime",
									borderRadius: "5px",
									padding: "4px"
								},
								onclick: () => {
									page.hide();
									goToFile((input === "outgoingCalls" ? editorManager.activeFile.uri : uri), toPoint(ranges.start))
								}
							});
							item.append(createPositionText(ranges.start));
							listRange.append(item);
						}

						div.append(nameText, listRange);
						return div;
					}
				)
				const filenameCard = createFileCard(uri.replace(client.workspaceUri, ""), hierarchyDataList);
				container.append(filenameCard);
			};
			page.appendBody(container);
			await delay(1000);
			page.show();
		}
	)
}

export default async function lspMethod(name: keyof typeof method, client: LanguageProvider, serviceName: string) {
	const selectionRange = fromRange(editor.getSelectionRange());
	const uri = normalizePath(editorManager.activeFile.uri, "file");

	if (method[name]) {
		method[name](client, serviceName, { selectionRange, uri });
	}
}
