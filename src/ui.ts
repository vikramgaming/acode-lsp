const page = acode.require('page');

export function createPage(
	title: string,
	element: HTMLElement | ((appendBody: Acode.WCPage["appendBody"], hidePage: Acode.WCPage["hide"]) => void)
) {
	const backButton = tag('span', {
		className: 'icon arrow_back',
		dataset: { action: 'back-btn' },
		onclick: () => settingsPage.hide(),
	});

	const settingsPage = page(title, { lead: backButton });

	if (typeof element === "function") {
		element(settingsPage.appendBody.bind(settingsPage), settingsPage.hide.bind(settingsPage));
	} else {
		settingsPage.appendBody(element);
	}

	settingsPage.show = () => {
		app.append(settingsPage);
	};
	settingsPage.show();
}

export function createFileCard(
	uri: string,
	descriptionElement: HTMLElement | ((settingsPage: Acode.WCPage["append"]) => void),
	onClick?: (uri: string, name: string) => void
) {
	const helpers = acode.require("helpers");
	const filename = uri.split("/").pop()!;
	const container = tag("div");
	const head = tag("div", {
		style: `
		width: 92vw;
		min-height: 40px;
		border: 1px solid white;
		border-radius: 10px;
		display: grid;
		grid-template-columns: 30px 1fr;
		gap: 10px;
		padding: 3px;`,
		onclick: () => {
			cardDescription.style.display = cardDescription.style.display === "none" ? "block" : "none";
			onClick && onClick(uri, filename);
		}
	});
	const containerIcon = tag("div", {
		style: `
		display: flex;
		align-items: center;
		justify-content: center;`
	})
	const icon = tag("i", {
		className: helpers.getIconForFile(filename),
		style: `
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;`
	});
	containerIcon.append(icon);

	const title = tag("span", {
		style: `
		width: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-start;`
	});
	const titlename = tag("h2", {
		textContent: filename
	})
	const url = tag("p", {
		style: `
		width: 70%;
		word-wrap: break-word;`,
		textContent: uri
	});
	title.append(titlename, url);

	head.append(containerIcon, title);

	const cardDescription = tag("div", {
		style: `
		display: none`
	});
	if (typeof descriptionElement === "function") {
		descriptionElement(cardDescription.append.bind(cardDescription));
	} else {
		cardDescription.append(descriptionElement);
	}

	container.append(head, cardDescription);
	return container
}

export function createPositionText(position: { line: number, character: number }) {
	const text = tag("h5", {
		textContent: `line: ${position.line + 1}, char: ${position.character}`,
		style: `
		text-align: center;`
	});
	return text;
}

export function createListCard(
	length: number, 
	createElement: (index: number) => HTMLElement, 
	onClick?: (index: number) => void
) {
	const listPos = tag("li", {
		style: `
		list-style: none;`
	})

	for (let i = 0; i < length; i++) {
		const card = tag("li", {
			style: `
			border: 1px solid purple;
			border-radius: 10px;
			padding: 10px;
			white-space: pre-line;`,
			onclick: () => {
				onClick && onClick(i);
			}
		});
		card.append(createElement(i));
		listPos.append(card);
	};
	return listPos
}
