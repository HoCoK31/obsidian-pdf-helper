import { Plugin } from "obsidian";
import { getAPI } from "obsidian-dataview";

const majorPattern = new RegExp(/:(pdf-[^:]+):([^:]+):(?:([0-9]*):(?:([0-9]+):)?)?/);
const minorPattern = new RegExp(/(\[[^]]*[^[]*\])(\([^)]*[^(]*\))/);


export default class PdfHelper extends Plugin {
	async onload() {
		const dataviewPromise = new Promise(resolve => {
			// @ts-ignore
			this.app.metadataCache.on("dataview:index-ready", () => {
				resolve("Ok");
			});
		});

		this.registerMarkdownPostProcessor(async (element, context) => {
			const pElements = element.querySelectorAll("p, td, th");
			for (let index = 0; index < pElements.length; index++) {

				const pElement = pElements.item(index);
				const text = pElement.innerHTML.trim();
				const majorMatch = majorPattern.exec(text);

				if (!majorMatch?.length)
					continue;

				let url = majorMatch[2];
				if (context.frontmatter != undefined)
					url = context.frontmatter[url] ?? url;

				if (url.startsWith("[["))
					url = url?.substring(2, url.length - 2);
				else {
					if (!url.startsWith("[")) {
						await dataviewPromise;
						url = getAPI(this.app).page(context.sourcePath)[url];
					}
					const minorMatch = minorPattern.exec(url);
					if (minorMatch?.length != 3)
						continue;
					url = minorMatch[2];
					url = url?.substring(1, url.length - 1);
				}
				url = url.replaceAll("%20", " ");
				if (!url.match(/.pdf$/))
					continue;
				url = this.app.metadataCache.getFirstLinkpathDest(url, "")?.path || "";

				if (!url)
					continue;

				const obsidian = require("obsidian");
				const pdfjs = await (0, obsidian.loadPdfJs)();

				const arrayBuffer = await this.app.vault.adapter.readBinary(url);
				const buffer = new Uint8Array(arrayBuffer);
				const pdf = await pdfjs.getDocument(buffer).promise;

				switch (majorMatch[1]) {
					case "pdf-thumbnail":
						let pageNumber: number = parseInt(majorMatch[3]) || 1;
						if (pageNumber > pdf.numPages)
							pageNumber = 1;

						const page = await pdf.getPage(pageNumber);

						context.addChild(new pdfThumbnail(pElement as HTMLElement, page, parseInt(majorMatch[4])));
						break;
					case "pdf-page-count":
						context.addChild(new pdfPageCount(pElement as HTMLElement, pdf.numPages));
						break;
					default:
						break;
				}

			}
		});
	}
}

import { MarkdownRenderChild } from "obsidian";

export class pdfThumbnail extends MarkdownRenderChild {
	page: any;
	renderTask: any;
	fixedWidth: number | undefined;
	timeoutId: number | undefined;

	constructor(containerEl: HTMLElement, page: any, size?: number) {
		super(containerEl);
		this.page = page;
		this.fixedWidth = size;
	}

	async onload() {
		const paragraph = document.createElement("p");
		this.containerEl.replaceWith(paragraph);
		let mainCanvas = document.createElement("canvas");

		async function resizeCanvas() {
			if (!paragraph.clientWidth)
				return;

			const canvas = document.createElement("canvas");
			const context = canvas.getContext("2d");
			const baseViewportWidth = this.page.getViewport({ scale: 1 }).width;

			const scale = (this.fixedWidth || paragraph.clientWidth) / baseViewportWidth;
			const viewport = this.page.getViewport({ scale: scale * window.devicePixelRatio || 1 });

			mainCanvas.style.width = Math.floor(viewport.width) / (window.devicePixelRatio || 1) + "px";
			mainCanvas.style.height = Math.floor(viewport.height) / (window.devicePixelRatio || 1) + "px";

			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			canvas.style.width = Math.floor(viewport.width) / (window.devicePixelRatio || 1) + "px";
			canvas.style.height = Math.floor(viewport.height) / (window.devicePixelRatio || 1) + "px";

			clearTimeout(this.timeoutId);

			this.timeoutId = setTimeout(async () => {
				const renderContext = { canvasContext: context, viewport: viewport };

				this.renderTask = this.page.render(renderContext);
				await this.renderTask.promise;

				mainCanvas.replaceWith(canvas);
				mainCanvas = canvas;
			}, this.timeoutId === undefined ? 0 : 100)

		}

		paragraph.appendChild(mainCanvas);

		if (this.fixedWidth)
			resizeCanvas.call(this);
		else
			new ResizeObserver(_ => { resizeCanvas.call(this) }).observe(paragraph);
	}
}

export class pdfPageCount extends MarkdownRenderChild {
	pageNum: number;

	constructor(containerEl: HTMLElement, pageNum: number) {
		super(containerEl);
		this.pageNum = pageNum;
	}

	async onload() {
		this.containerEl.innerText = this.containerEl.innerText.replace(majorPattern, this.pageNum.toString());
	}
}