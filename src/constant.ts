import { LanguageClientConfig } from "@/linters/types/language-service"
import type { MethodName } from "./method";

export interface SocketClients {
	modes: string[],
	serviceName: string,
	args: string[],
	features?: LanguageClientConfig["features"],
	extension: string[],
	supportedMethod?: Partial<Record<MethodName, boolean>>,
	initializationOptions?: LanguageClientConfig["initializationOptions"],
	serviceInstance?: LanguageClientConfig["serviceInstance"],
	options?: LanguageClientConfig["options"]
}
export const socketClients = {
	typescript: {
		modes: ["javascript", "typescript", "jsx", "tsx"],
		serviceName: "typescript",
		args: ["typescript-language-server", "--stdio"],
		extension: ["js", "ts", "jsx", "tsx"],
		supportedMethod: {
			goToDocumentLink: false,
			goToDeclaration: false,
		},
	},
	css: {
		modes: ["css", "scss", "less"],
		serviceName: "css",
		args: ["vscode-css-language-server", "--stdio"],
		features: {
			semanticTokens: false,
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
			semanticTokens: false,
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
			documentHighlight: false,
			semanticTokens: false,
		},
		extension: ["json", "json5"],
		supportedMethod: {
			goToDefinition: false,
			goToDeclaration: false,
			goToTypeDefinition: false,
			goToImplementation: false,
			callHierarchy: false
		},
	},
} satisfies Record<string, SocketClients>