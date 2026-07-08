import { createFileCard, createListCard, createNameText, createPage, createPositionText } from "./ui-template";
import type { Hierarchy, Location, OutgoingCalls } from "../method";
import { delay, goToFile, log } from "../utils";
import { toPoint } from "@/linters/type-converters/lsp/lsp-converters";

const sidebutton = acode.require("sidebutton");
export const page = createPage("LSP Method");
const delayMs = 1000;

const sideBtn = sidebutton({
	text: "Prev Method",
	backgroundColor: "cyan",
	textColor: "black",
	onclick: () => page.show()
});
sideBtn.show();

export async function destinationUI(data: Location[], workspaceUri: string, methodName: string) {
	const normalizeData = data.filter((d) => d.uri.startsWith(workspaceUri));
	if (normalizeData.length === 0) return;

	const group = Object.groupBy(normalizeData, (item) => item.uri);
	log("info", "Normalized Data for DestinationUI", group);

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
		const filenameCard = createFileCard(uri.replace(workspaceUri, ""), locationList);
		container.append(filenameCard);
	};
	page.appendBody(container);
	await delay(delayMs);
	page.show();
}

export async function callHierarchyUI(data: Hierarchy[], workspaceUri: string, callback: (hierachyData: Hierarchy) => void) {
	const normalizeData = data.filter((d) => d.uri.startsWith(workspaceUri));
	if (normalizeData.length === 0) return;

	const group = Object.groupBy(normalizeData, (item) => item.uri);
	log("info", "Normalized Data for callHierarchyUI", group);
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
	for (const [uri, hierarchyData] of Object.entries(group)) {
		if (hierarchyData == null) continue;
		const hierarcyList = createListCard(hierarchyData.length, (i) => createNameText(hierarchyData[i].name, hierarchyData[i].detail),
			(i) => callback(hierarchyData[i])
		)
		const filenameCard = createFileCard(uri.replace(workspaceUri, ""), hierarcyList);
		container.append(filenameCard);
	};
	page.appendBody(container);
	await delay(delayMs);
	page.show();
}

export async function callHierarchySelectUI(data: OutgoingCalls[], workspaceUri: string, input: string, originUri: string) {
	const group = Object.groupBy(data, (item) => item.to.uri);
	log("info", `Normalized Data for callHierarchyUI ${input}`, group);
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
							goToFile((input === "outgoingCalls" ? originUri : uri), toPoint(ranges.start))
						}
					});
					item.append(createPositionText(ranges.start));
					listRange.append(item);
				}

				div.append(nameText, listRange);
				return div;
			}
		)
		const filenameCard = createFileCard(uri.replace(workspaceUri, ""), hierarchyDataList);
		container.append(filenameCard);
	};
	page.appendBody(container);
	await delay(delayMs);
	page.show();
}