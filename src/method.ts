import { normalizePath, goToFile, log } from "./utils";
import { fromRange, toPoint } from "./ace-linters/src/type-converters/lsp/lsp-converters";

const select = acode.require("select");
const prompt = acode.require("prompt");
const Range = ace.require("ace/range").Range;

import type { LanguageProvider } from "./ace-linters/src/language-provider";

type Range = {
    end: {
        character: number,
        line: number
    },
    start: {
        character: number,
        line: number
    },
}
type Location = {
    uri: string,
    range: Range
}
type DocumentLink = {
    range: Range,
    target: string
}
type RenameSymbol = {
    changes: {
        [x: string]: {
            newText: string,
            range: Range
        }[]
    }
}

type Param = { selectionRange: ReturnType<typeof fromRange>, uri: string }

const method = {
    goToDocumentLink: async (client, serviceName, { selectionRange, uri }) => {
        client.sendRequest(serviceName, "textDocument/documentLink", {
            textDocument: { uri }
        }, async (reponse: Promise<DocumentLink[]>) => {
            const data = await reponse;
            log("info", "Method Document Link", data);
            for (let location of data) {
                if (
                    selectionRange.end.character <= location.range.end.character &&
                    selectionRange.end.line <= location.range.end.line &&
                    selectionRange.start.character >= location.range.start.character &&
                    selectionRange.start.line >= location.range.start.line
                ) {
                    if (location.target.startsWith("http")) {
                        acode.exec("open-inapp-browser", location.target);
                    } else {
                        goToFile(location.target, { column: 0, row: 0 });
                    }
                    break;
                }
            }
        })
    },
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
            log("info", "Method Code Actions", codeActions);

            const actionByService = codeActions.find(action => action.service === serviceName);
            if (!actionByService?.codeActions || actionByService.codeActions.length === 0) return;

            const options = actionByService.codeActions.map(action => {
                return {
                    text: action.title,
                    value: action
                }
            }).filter(action => action != null);
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
        const input = await prompt("Rename Symbol", editorManager.editor.getSelectedText());
        if (input == null) return;

        client.sendRequest(serviceName, "textDocument/rename", {
            textDocument: { uri },
            position: selectionRange.end,
            newName: input
        }, async (response: Promise<RenameSymbol>) => {
            const data = await response;
            log("info", "Method Rename Symbol", data);
            
            data.changes[uri].forEach(edit => {
                const range = new Range(
                    edit.range.start.line,
					edit.range.start.character,
					edit.range.end.line,
					edit.range.end.character
                );
                editorManager.editor.session.replace(range, edit.newText);
            })
        })
    }
} satisfies {
    [x: string]: (client: LanguageProvider, serviceName: string, { selectionRange, uri }: Param) => Promise<void>
}

async function goToLocation(methodName: string, client: LanguageProvider, serviceName: string, { selectionRange, uri }: Param, moreParam: object = {}) {
    client.sendRequest(serviceName, `textDocument/${methodName}`,
        {
            textDocument: { uri },
            position: selectionRange.end,
            ...moreParam
        }, async (response: Promise<Location[] | null>) => {
            const result = await response;
            const data = (Array.isArray(result) ? result : [result].filter(Boolean)) as Location[];
            log("info", `Method ${methodName}:`, data);

            const options = data.map((location) => {
                if (!location.uri.startsWith(client.workspaceUri)) return null;
                let nUri = location.uri.replace(client.workspaceUri, "");
                const pos = `[${location.range.start.line + 1}, ${location.range.start.character}]: `

                if ((nUri.length + pos.length) > 30) {
                    nUri = "..." + nUri.slice(-27 + pos.length);
                }

                const mode = (nUri.split(".").pop() as string)
                const modeName = mode === "js" ? "javascript" : (mode === "ts" ? "typescript" : mode)

                return {
                    text: pos + nUri,
                    icon: `icon file file_type_default file_type_${modeName} file_type_${mode}`,
                    value: location as any
                }
            }).filter(loc => loc != null);
            if (options.length === 0) return;

            const input = await select("select location", options) as Location

            if (input) {
                goToFile(input.uri, toPoint(input.range.start))
            };
        }
    )
}

export default async function lspMethod(name: keyof typeof method, client: LanguageProvider, serviceName: string) {
    const selectionRange = fromRange(editorManager.editor.getSelectionRange());
    const uri = normalizePath(editorManager.activeFile.uri, "file");

    if (method[name]) {
        method[name](client, serviceName, { selectionRange, uri });
    }
}
