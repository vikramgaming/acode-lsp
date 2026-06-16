import { normalizePath, goToFile } from "./utils";
import { fromPoint, toPoint } from "./ace-linters/src/type-converters/lsp/lsp-converters";

const select = acode.require("select");

import type { LanguageProvider } from "./ace-linters/src/language-provider";
import type { Session } from "./main";

interface Method {
    [x: string]: (client: LanguageProvider, serviceName: string, log: (type: "error" | "info" | "warn", ...message: any) => void) => Promise<void>
}

type GoTo = {
    uri: string,
    range: {
        end: {
            character: number,
            line: number
        },
        start: {
            character: number,
            line: number
        },
    }
}

const method: Method = {
    goToDefinition: async (client, serviceName, log) => {
        await goTo("definition", client, serviceName, log);
    },
    goToDeclaration: async (client, serviceName, log) => {
        await goTo("declaration", client, serviceName, log);
    },
    goToTypeDefinition: async (client, serviceName, log) => {
        await goTo("typeDefinition", client, serviceName, log);
    },
    goToImplementation: async (client, serviceName, log) => {
        await goTo("implementation", client, serviceName, log);
    },
}

async function goTo(methodName: string, client: LanguageProvider, serviceName: string, log: (type: "error" | "info" | "warn", ...message: any) => void) {
    const cursorPos = editorManager.editor.getCursorPosition();
    const uri = normalizePath(editorManager.activeFile.uri, "file");

    client.sendRequest(serviceName, `textDocument/${methodName}`,
        {
            textDocument: { uri },
            position: fromPoint(cursorPos),

        }, (result: Promise<any>) => {
            result.then(response => {
                const data = Array.isArray(response) ? response : [response].filter(Boolean);
                log("info", `Method ${methodName}:`, data);
                if (!data || data.length === 0) return;
                
                if (methodName !== "implementation") {
                    const location = data[0];
                    return goToFile(location.uri, toPoint(location.range.start))
                }

                const options = data.map((location: any) => {
                    let nUri = location.uri.replace(client.workspaceUri, "");
                    const pos = `[${location.range.start.line + 1}, ${location.range.start.character}]: `

                    if ((nUri.length + pos.length) > 55) {
                        nUri = "..." + nUri.slice(-52 + pos.length);
                    }

                    const mode1 = (nUri.split(".").pop() as string)
                    const mode2 = mode1 === "js" ? "javascript" : (mode1 === "ts" ? "typescript" : mode1)

                    return {
                        text: pos + nUri,
                        icon: `icon file file_type_default file_type_${mode2} file_type_${mode1}`,
                        value: location
                    }
                })
                select("select location", options).then((input: unknown) => {
                    if (input) {
                        const data = input as GoTo;
                        goToFile(data.uri, toPoint(data.range.start))
                    };
                })
            });
        }
    )
}

export default async function lspMethod(name: string, client: LanguageProvider, langserver: Map<string, string>, log: (type: "error" | "info" | "warn", ...message: any) => void) {
    const mode = (editorManager.editor.session as Session).$modeId.replace("ace/mode/", "");
    const serviceName = langserver.get(mode);
    if (!serviceName) return;
    if (method[name]) {
        method[name](client, serviceName, log);
    }
}
