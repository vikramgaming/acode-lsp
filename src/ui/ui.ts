import plugin from "../../plugin.json";
import type * as lsp from "vscode-languageserver-protocol";
import { delay, goToFile } from "../utils";

export default class UIPage {
	workspaceUri!: string;
	page: Acode.WCPage;
	sideBtn;

	constructor() {
		this.page = createPage("LSP Method");
		const sidebutton = acode.require("sidebutton");

		this.sideBtn = sidebutton({
			text: "Prev Method",
			backgroundColor: "cyan",
			textColor: "black",
			onclick: () => this.page.show()
		});
		this.sideBtn.show();
	}
	private showUI(el: HTMLElement, title = "LSP Method") {
		this.page.hide();
		this.page.innerHTML = "";
		this.page.settitle(title);
		this.page.appendBody(el);
		delay(1000).then(() => this.page.show());
	}
	private goToFile(uri: string, pos: lsp.Position, mark: lsp.Range) {
		goToFile(uri, pos, mark);
		this.page.hide();
	}

	destination(data: lsp.Location[], methodName: string) {
		const normalizeData = data.filter(loc => loc.uri.startsWith(this.workspaceUri));
		if (normalizeData.length === 0) return;

		const container = createContainer();
		const group = Object.groupBy(normalizeData, item => item.uri);

		for (const uri in group) {
			const div = tag("div");
			const filecard = createfilecard(uri.replace(this.workspaceUri, ""));
			const list = createList(filecard);

			group[uri]?.forEach(location => {
				const posCard = createPosCard(location.range.start);
				posCard.onclick = () => this.goToFile(location.uri, location.range.start, location.range);
				list.append(posCard);
			});
			div.append(filecard, list);
			container.append(div);
		}
		this.showUI(container, methodName);
	}
	callhierarchy(data: lsp.CallHierarchyItem[], onClick: (item: lsp.CallHierarchyItem) => void) {
		const normalizeData = data.filter(item => item.uri.startsWith(this.workspaceUri));
		if (normalizeData.length === 0) return;

		const container = createContainer();
		const group = Object.groupBy(normalizeData, item => item.uri);

		for (const uri in group) {
			const div = tag("div");
			const filecard = createfilecard(uri.replace(this.workspaceUri, ""));
			const list = createList(filecard);
			group[uri]?.forEach(item => {
				const li = tag("div");
				const nameCard = createNameCardBtn(item, 
					() => onClick(item),
					() => this.goToFile(item.uri, item.range.start, item.range)
				)
				li.append(nameCard);
				list.append(li);
			});

			div.append(filecard, list);
			container.append(div);
		}
		this.showUI(container, "prepareCallHierarchy");
	}
	hierarchyIncomingCalls(data: lsp.CallHierarchyIncomingCall[]) {
		const normalizeData = data.filter(item => item.from.uri.startsWith(this.workspaceUri));
		if (normalizeData.length === 0) return;

		const container = createContainer();
		const group = Object.groupBy(normalizeData, item => item.from.uri);

		for (const uri in group) {
			const div = tag("div");
			const filecard = createfilecard(uri.replace(this.workspaceUri, ""));
			const list = createList(filecard);
			group[uri]?.forEach(item => {
				const div2 = tag("div");
				const listPos = createList();
				const nameCard = createNameCardBtn(item.from,
					() => listPos.style.display = listPos.style.display === "none" ? "block" : "none",
					() => this.goToFile(item.from.uri, item.from.range.start, item.from.range)
				);
				item.fromRanges.forEach(range => {
					const posCard = createPosCard(range.start);
					posCard.onclick = () => this.goToFile(item.from.uri, range.start, range);
					listPos.append(posCard);
				});
				div2.append(nameCard, listPos);
				list.append(div2);
			});
			div.append(filecard, list);
			container.append(div);
		}
		this.showUI(container, "incomingCalls");
	}
	hierarchyOutGoingCalls(data: lsp.CallHierarchyOutgoingCall[], originUri: string) {
		const normalizeData = data.filter(data => data.to.uri.startsWith(this.workspaceUri));
		if (normalizeData.length === 0) return;

		const container = createContainer();
		const group = Object.groupBy(normalizeData, item => item.to.uri);

		for (const uri in group) {
			const div = tag("div");
			const filecard = createfilecard(uri.replace(this.workspaceUri, ""));
			const list = createList(filecard);
			group[uri]?.forEach(item => {
				const div2 = tag("div");
				const listPos = createList();
				const nameCard = createNameCardBtn(item.to,
					() => listPos.style.display = listPos.style.display === "none" ? "block" : "none",
					() => this.goToFile(item.to.uri, item.to.range.start, item.to.range)
				);
				item.fromRanges.forEach(range => {
					const posCard = createPosCard(range.start);
					posCard.onclick = () => this.goToFile(originUri, range.start, range);
					listPos.append(posCard);
				});
				div2.append(nameCard, listPos);
				list.append(div2);
			});
			div.append(filecard, list);
			container.append(div);
		}

		this.showUI(container, "outgoingCalls");
	}
}

function createContainer() {
	return tag("div", {
		className: "container"
	});
}

function createPage(title: string) {
	const page = acode.require('page');
	const backButton = tag('span', {
		className: 'icon arrow_back',
		dataset: { action: 'back-btn' },
		onclick: () => settingsPage.hide(),
	});

	const settingsPage = page(title, { lead: backButton });
	settingsPage.className = `${plugin.className} page`;

	settingsPage.show = () => {
		app.append(settingsPage);
	};
	return settingsPage;
}

function createfilecard(uri: string) {
	const helpers = acode.require("helpers");
	const filename = uri.split("/").pop()!;

	const container = tag("div", {
		className: "filecard"
	});
	const icon = tag("span", {
		className: `icon ${helpers.getIconForFile(filename)}`
	});
	const div = tag("div");
	const fileTitle = tag("h2", {
		className: "filename",
		textContent: filename
	});
	const path = tag("p", {
		className: "path",
		textContent: uri
	});
	div.append(fileTitle, path);
	container.append(icon, div);
	return container;
}

function createPosCard(pos: lsp.Position) {
	return tag("div", {
		className: "poscard",
		textContent: `line: ${pos.line + 1}\ncharacter: ${pos.character}`
	});
}
function createNameCardBtn({ name, detail }: { name: string, detail?:string }, onclickText: () => void, onclickBtn: () => void) {
	const container = tag("div", {
		className: "namecard",
	});
	const text = tag("span", {
		className: "text",
		textContent: `Name: ${name}\n${detail && `Detail: ${detail}`}`,
		onclick: () => onclickText()
	});
	const btn = tag("span", {
		className: "btn icon logout",
		onclick: () => onclickBtn()
	});
	container.append(text, btn);
	return container;
}

function createList(toggleEl?: HTMLElement) {
	const list = tag("div", {
		className: "list",
		style: {
			display: "none"
		}
	});
	if (toggleEl) toggleEl.onclick = () => {
		list.style.display = list.style.display === "none" ? "block" : "none";
	};
	return list;
}
