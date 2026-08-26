import type { Listener } from "src/eventListener";
import * as lsp from "vscode-languageserver-protocol";
import LSPMethod, { Params } from "./method";
import { setMark } from "../utils";

export default class MethodListener {
    private markerMap = new Map<string, number[]>()
    
	constructor(listener: Listener, method: LSPMethod) {
	    function getParams(): Params | null {
	        const serviceName = method.getServiceName();
	        if (!method.lsp.client || !serviceName) return null;
	        
	        return {
	            client: method.lsp.client,
	            serviceName,
	            selectionRange: method.getSelectionRange(),
	            uri: method.getFileUri()
	        }
	    }
	    
	    listener.addEventListener("change", (emitter) => {
	        const params = getParams();
	        if (!params) return;
	        if (method.isSupportedMethod("documentLinkProvider")) this.documentLinkMark(params, emitter.session);
	    })
	    listener.addEventListener("removeSession", (info) => {
	        this.markerMap.delete(info.id);
	    })
	    listener.addEventListener("stopLSP", () => {
	        this.clearMarkers();
	    })
	}
	documentLinkMark({ client, serviceName, uri }: Params, session: Ace.EditSession) {
	    client.sendRequest(serviceName, lsp.DocumentLinkRequest.method, {
	        textDocument: { uri }
	    } satisfies lsp.DocumentLinkParams,
    	    async (res: Promise<lsp.DocumentLink[] | null>) => {
    	        const data = await res;
    	        if (!data) return;
    	        this.removeMarkers(session);
    	        this.addMarkers(session, data);
    	    }
	    )
	}
	private addMarkers(session: Ace.EditSession, data: lsp.DocumentLink[]) {
	    this.markerMap.set(session.id, data.map(link => setMark(session, link.range, "link")))
	}
	private removeMarkers(session: Ace.EditSession) {
	    if (!this.markerMap.has(session.id)) return;
	    this.markerMap.get(session.id)!.forEach(mark => session.removeMarker(mark));
	}
	private clearMarkers() {
	    for (const [sessionId, markersId] of this.markerMap.entries()) {
	        const session = editorManager.files.find(file => file.session.id === sessionId)?.session;
	        if (!session) continue;
	        markersId.forEach(mark => session.removeMarker(mark));
	    }
	    this.markerMap.clear();
	}
}