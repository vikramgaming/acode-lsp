import type { SocketClients } from "./main";
import type { LanguageProvider } from "./ace-linters/src/language-provider";
import { delay, normalizePath } from "./utils";

export type DocumentLink = {
	range: Range,
	target: string
}

export default class HandlerMethod {
	client!: LanguageProvider | null;
	serviceName!: string | undefined;
	clientConfig!: SocketClients | undefined;
	
	registerClient(client: LanguageProvider) {
		this.client = client;
		delay(15000).then(() => {
			this.registerDocumentLink();
		})
	}
	unregisterClient() {
		this.client = null;
	}
	switchService({ serviceName, clientConfig }: { serviceName: string, clientConfig: SocketClients }) {
		this.serviceName = serviceName;
		this.clientConfig = clientConfig;
	}
	
	private registerDocumentLink() {
		if (!this.client || !this.serviceName) return;
		const uri = normalizePath(editorManager.activeFile.uri, "file");
		
		this.client.sendRequest(this.serviceName, "textDocument/documentLink", {
			textDocument: { uri }
		}, async (response: Promise<DocumentLink>) => {
			const data = await response;
			
			if (this.client) {
				await delay(3000);
				this.registerDocumentLink();
			}
		})
	}
}