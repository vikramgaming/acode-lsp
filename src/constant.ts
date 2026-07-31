import { LanguageClientConfig } from "@/linters/types/language-service"

export interface SocketClients {
	modes: string[],
	serviceName: string,
	args: string[],
	features?: LanguageClientConfig["features"],
	extension: string[],
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
		initializationOptions: {
			typescript: {
				format: {
					semicolons: "insert"
				}
			},
			javascript: {
				format: {
					semicolons: "insert"
				}
			},
		}
	},
	css: {
		modes: ["css", "scss", "less"],
		serviceName: "css",
		args: ["vscode-css-language-server", "--stdio"],
		features: {
			semanticTokens: false,
		},
		extension: ["css", "scss", "less"],
	},
	html: {
		modes: ["html"],
		serviceName: "html",
		args: ["vscode-html-language-server", "--stdio"],
		features: {
			semanticTokens: false,
		},
		extension: ["html"],
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
		initializationOptions: {
			json: {
	            schemas: [
	                {
	                    fileMatch: ["*tsconfig.json", "tsconfig.json", "tsconfig*.json"],
	                    url: "https://json.schemastore.org/tsconfig",
	                },
	                {
	                    fileMatch: ["package.json"],
	                    url: "https://json.schemastore.org/package",
	                },
	            ],
	        }
		}
	},
} satisfies Record<string, SocketClients>;