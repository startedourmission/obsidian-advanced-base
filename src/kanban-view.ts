import {
	BasesView,
	BasesEntry,
	BasesEntryGroup,
	BasesPropertyId,
	BasesViewConfig,
	QueryController,
	TFile,
	Menu,
	setIcon,
} from "obsidian";
import type BaseKanbanPlugin from "./main";

type LayoutMode = "compact" | "default" | "detailed";

interface CardData {
	entry: BasesEntry;
	file: TFile;
	values: Map<string, string>;
}

export class KanbanView extends BasesView {
	type = "kanban";

	private toolbarEl: HTMLElement;
	private boardEl: HTMLElement;
	private plugin: BaseKanbanPlugin;
	private draggedCard: HTMLElement | null = null;
	private draggedEntry: BasesEntry | null = null;
	private dropIndicator: HTMLElement | null = null;

	constructor(
		controller: QueryController,
		containerEl: HTMLElement,
		plugin: BaseKanbanPlugin,
	) {
		super(controller);
		this.plugin = plugin;
		this.toolbarEl = containerEl.createDiv({ cls: "base-kanban-toolbar" });
		this.boardEl = containerEl.createDiv({ cls: "base-kanban-board" });
		this.renderToolbar();
	}

	private getLayoutMode(): LayoutMode {
		return (this.config.get("layout") as LayoutMode) || "default";
	}

	private setLayoutMode(mode: LayoutMode): void {
		this.config.set("layout", mode);
		this.applyLayoutClass();
		this.renderToolbar();
		this.onDataUpdated();
	}

	private applyLayoutClass(): void {
		const mode = this.getLayoutMode();
		this.boardEl.removeClass(
			"base-kanban-layout-compact",
			"base-kanban-layout-default",
			"base-kanban-layout-detailed",
		);
		this.boardEl.addClass(`base-kanban-layout-${mode}`);
	}

	private renderToolbar(): void {
		this.toolbarEl.empty();
		const mode = this.getLayoutMode();
		const iconMap: Record<LayoutMode, string> = {
			compact: "list",
			default: "layout-list",
			detailed: "file-text",
		};
		const labelMap: Record<LayoutMode, string> = {
			compact: "Compact",
			default: "Default",
			detailed: "Detailed",
		};
		const btn = this.toolbarEl.createEl("button", {
			cls: "base-kanban-toolbar-btn clickable-icon",
			attr: { "aria-label": `Layout: ${labelMap[mode]}` },
		});
		setIcon(btn, iconMap[mode]);
		btn.addEventListener("click", () => {
			const order: LayoutMode[] = ["compact", "default", "detailed"];
			const next = order[(order.indexOf(this.getLayoutMode()) + 1) % order.length];
			this.setLayoutMode(next);
		});
	}

	onload(): void {
		this.registerEvent(
			this.app.workspace.on("css-change", () => this.onDataUpdated()),
		);
	}

	onunload(): void {
		this.toolbarEl.empty();
		this.boardEl.empty();
	}

	onDataUpdated(): void {
		this.boardEl.empty();
		this.applyLayoutClass();

		const statusProp = this.config.getAsPropertyId("statusProperty");
		if (!statusProp) {
			this.renderEmptyState();
			return;
		}

		const sortProp = this.config.getAsPropertyId("sortProperty");
		const lanes = this.buildLanes(statusProp, sortProp);
		this.renderBoard(lanes, statusProp, sortProp);
	}

	private renderEmptyState(): void {
		const emptyEl = this.boardEl.createDiv({
			cls: "base-kanban-empty",
		});
		emptyEl.createEl("p", {
			text: "Select a status property in the view options to create lanes.",
		});
	}

	private buildLanes(
		statusProp: BasesPropertyId,
		sortProp: BasesPropertyId | null,
	): Map<string, BasesEntry[]> {
		const lanes = new Map<string, BasesEntry[]>();

		for (const entry of this.data.data) {
			const val = entry.getValue(statusProp);
			const key = val ? String(val) : "(No value)";

			if (!lanes.has(key)) {
				lanes.set(key, []);
			}
			lanes.get(key)!.push(entry);
		}

		// Sort entries within each lane by the sort property if configured
		if (sortProp) {
			for (const [, entries] of lanes) {
				entries.sort((a, b) => {
					const aVal = a.getValue(sortProp);
					const bVal = b.getValue(sortProp);
					const aNum = aVal != null ? Number(aVal) : Infinity;
					const bNum = bVal != null ? Number(bVal) : Infinity;
					return aNum - bNum;
				});
			}
		}

		return lanes;
	}

	private renderBoard(
		lanes: Map<string, BasesEntry[]>,
		statusProp: BasesPropertyId,
		sortProp: BasesPropertyId | null,
	): void {
		const mode = this.getLayoutMode();
		let displayProps: BasesPropertyId[];
		if (mode === "compact") {
			displayProps = [];
		} else if (mode === "detailed") {
			// Show ALL available properties, excluding the status property
			displayProps = this.allProperties.filter((p) => p !== statusProp);
		} else {
			displayProps = this.config
				.getOrder()
				.filter((p) => p !== statusProp);
		}

		for (const [laneTitle, entries] of lanes) {
			this.renderLane(laneTitle, entries, displayProps, statusProp, sortProp);
		}
	}

	private renderLane(
		title: string,
		entries: BasesEntry[],
		displayProps: BasesPropertyId[],
		statusProp: BasesPropertyId,
		sortProp: BasesPropertyId | null,
	): void {
		const laneEl = this.boardEl.createDiv({ cls: "base-kanban-lane" });

		// Lane header
		const headerEl = laneEl.createDiv({ cls: "base-kanban-lane-header" });
		headerEl.createEl("span", {
			cls: "base-kanban-lane-title",
			text: title,
		});
		headerEl.createEl("span", {
			cls: "base-kanban-lane-count",
			text: String(entries.length),
		});

		// Add card button
		const addBtn = headerEl.createEl("button", {
			cls: "base-kanban-add-btn clickable-icon",
		});
		setIcon(addBtn, "plus");
		addBtn.addEventListener("click", () => {
			this.createCardInLane(title, statusProp);
		});

		// Lane body (drop zone)
		const bodyEl = laneEl.createDiv({ cls: "base-kanban-lane-body" });
		bodyEl.dataset.lane = title;

		bodyEl.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = "move";
			}
			this.updateDropIndicator(bodyEl, e.clientY);
		});

		bodyEl.addEventListener("dragleave", (e) => {
			// Only remove if actually leaving the body element
			const relatedTarget = e.relatedTarget as HTMLElement | null;
			if (!relatedTarget || !bodyEl.contains(relatedTarget)) {
				this.removeDropIndicator();
			}
		});

		bodyEl.addEventListener("drop", (e) => {
			e.preventDefault();
			const insertIndex = this.getDropIndex(bodyEl, e.clientY);
			this.removeDropIndicator();

			if (this.draggedEntry) {
				this.moveCardToLane(
					this.draggedEntry,
					title,
					statusProp,
					sortProp,
					bodyEl,
					insertIndex,
				);
			}
		});

		// Cards
		for (const entry of entries) {
			this.renderCard(bodyEl, entry, displayProps);
		}
	}

	private renderCard(
		parentEl: HTMLElement,
		entry: BasesEntry,
		displayProps: BasesPropertyId[],
	): void {
		const cardEl = parentEl.createDiv({ cls: "base-kanban-card" });
		// Dragging is initiated from the handle only
		cardEl.setAttribute("draggable", "false");
		cardEl.dataset.filePath = entry.file.path;

		// Context menu (right-click)
		cardEl.addEventListener("contextmenu", (event) => {
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle("Delete note")
					.setIcon("trash")
					.setWarning(true)
					.onClick(async () => {
						await this.app.vault.trash(entry.file, true);
					});
			});
			menu.showAtMouseEvent(event);
		});

		// Drag handle
		const handleEl = cardEl.createDiv({ cls: "base-kanban-card-handle" });
		setIcon(handleEl, "grip-vertical");
		handleEl.addEventListener("mousedown", () => {
			cardEl.setAttribute("draggable", "true");
		});

		// Card title (file name)
		const titleEl = cardEl.createDiv({ cls: "base-kanban-card-title" });
		titleEl.createEl("a", {
			text: entry.file.basename,
			cls: "base-kanban-card-link",
		});
		titleEl.addEventListener("click", () => {
			this.app.workspace.getLeaf(false).openFile(entry.file);
		});

		// Card properties
		if (displayProps.length > 0) {
			const propsEl = cardEl.createDiv({
				cls: "base-kanban-card-props",
			});
			for (const prop of displayProps) {
				const val = entry.getValue(prop);
				if (val == null) continue;
				const propEl = propsEl.createDiv({
					cls: "base-kanban-card-prop",
				});
				propEl.createEl("span", {
					cls: "base-kanban-card-prop-label",
					text: this.config.getDisplayName(prop),
				});
				const valueEl = propEl.createEl("span", {
					cls: "base-kanban-card-prop-value",
				});
				this.renderPropertyValue(valueEl, String(val), entry);
			}
		}

		// Drag events
		cardEl.addEventListener("dragstart", (e) => {
			this.draggedCard = cardEl;
			this.draggedEntry = entry;
			cardEl.addClass("base-kanban-card-dragging");
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
			}
		});

		cardEl.addEventListener("dragend", () => {
			cardEl.removeClass("base-kanban-card-dragging");
			cardEl.setAttribute("draggable", "false");
			this.draggedCard = null;
			this.draggedEntry = null;
			this.removeDropIndicator();

			// Clean up all dragover states
			this.boardEl
				.querySelectorAll(".base-kanban-lane-dragover")
				.forEach((el) => el.removeClass("base-kanban-lane-dragover"));
		});

		// Prevent card-level dragover from interfering
		cardEl.addEventListener("dragover", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = "move";
			}
			const bodyEl = cardEl.parentElement;
			if (bodyEl) {
				this.updateDropIndicator(bodyEl, e.clientY);
			}
		});

		cardEl.addEventListener("drop", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const bodyEl = cardEl.parentElement;
			if (bodyEl && this.draggedEntry) {
				const laneName = bodyEl.dataset.lane ?? "";
				const statusProp = this.config.getAsPropertyId("statusProperty");
				const sortProp = this.config.getAsPropertyId("sortProperty");
				if (statusProp) {
					const insertIndex = this.getDropIndex(bodyEl, e.clientY);
					this.removeDropIndicator();
					this.moveCardToLane(
						this.draggedEntry,
						laneName,
						statusProp,
						sortProp,
						bodyEl,
						insertIndex,
					);
				}
			}
		});
	}

	/** Render a property value with wikilinks and URLs as clickable links */
	private renderPropertyValue(
		containerEl: HTMLElement,
		value: string,
		entry: BasesEntry,
	): void {
		// Pattern to match [[wikilinks]] or [[target|display]] or http(s) URLs
		const linkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|(https?:\/\/[^\s<>\]]+)/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = linkPattern.exec(value)) !== null) {
			// Add plain text before this match
			if (match.index > lastIndex) {
				containerEl.appendText(value.slice(lastIndex, match.index));
			}

			if (match[1] !== undefined) {
				// Wikilink: match[1] = target, match[2] = display text (optional)
				const linkTarget = match[1];
				const displayText = match[2] || match[1];
				const linkEl = containerEl.createEl("a", {
					cls: "internal-link base-kanban-card-internal-link",
					text: displayText,
				});
				linkEl.addEventListener("click", (e) => {
					e.stopPropagation();
					this.app.workspace.openLinkText(linkTarget, entry.file.path);
				});
			} else if (match[3] !== undefined) {
				// URL
				const url = match[3];
				containerEl.createEl("a", {
					cls: "external-link base-kanban-card-external-link",
					text: url,
					href: url,
					attr: { target: "_blank", rel: "noopener" },
				});
			}

			lastIndex = match.index + match[0].length;
		}

		// Remaining plain text
		if (lastIndex < value.length) {
			containerEl.appendText(value.slice(lastIndex));
		}

		// If nothing was matched, the text was already appended as plain text above.
		// But if the value was empty or had no links, ensure we show something.
		if (lastIndex === 0 && value.length === 0) {
			containerEl.appendText("");
		}
	}

	/** Determine the insertion index based on cursor Y position among cards */
	private getDropIndex(bodyEl: HTMLElement, clientY: number): number {
		const cards = Array.from(
			bodyEl.querySelectorAll(
				".base-kanban-card:not(.base-kanban-card-dragging)",
			),
		);

		for (let i = 0; i < cards.length; i++) {
			const rect = cards[i].getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			if (clientY < midY) {
				return i;
			}
		}
		return cards.length;
	}

	/** Show a drop indicator line between cards */
	private updateDropIndicator(bodyEl: HTMLElement, clientY: number): void {
		this.removeDropIndicator();

		const indicator = document.createElement("div");
		indicator.className = "base-kanban-drop-indicator";
		this.dropIndicator = indicator;

		const cards = Array.from(
			bodyEl.querySelectorAll(
				".base-kanban-card:not(.base-kanban-card-dragging)",
			),
		);

		const insertIndex = this.getDropIndex(bodyEl, clientY);

		if (cards.length === 0) {
			bodyEl.appendChild(indicator);
		} else if (insertIndex >= cards.length) {
			bodyEl.appendChild(indicator);
		} else {
			bodyEl.insertBefore(indicator, cards[insertIndex]);
		}
	}

	/** Remove the drop indicator from the DOM */
	private removeDropIndicator(): void {
		if (this.dropIndicator) {
			this.dropIndicator.remove();
			this.dropIndicator = null;
		}
	}

	private async moveCardToLane(
		entry: BasesEntry,
		laneValue: string,
		statusProp: BasesPropertyId,
		sortProp: BasesPropertyId | null,
		bodyEl: HTMLElement,
		insertIndex: number,
	): Promise<void> {
		// Extract the property name from the BasesPropertyId (e.g. "note.status" -> "status")
		const propName = statusProp.replace(/^note\./, "");
		const newValue = laneValue === "(No value)" ? null : laneValue;

		await this.app.fileManager.processFrontMatter(
			entry.file,
			(frontmatter) => {
				if (newValue === null) {
					delete frontmatter[propName];
				} else {
					frontmatter[propName] = newValue;
				}
			},
		);

		// Update sort values if a sort property is configured
		if (sortProp) {
			await this.updateSortValues(sortProp, bodyEl, entry, insertIndex);
		}
	}

	/** Recalculate sort values for all cards in the lane after a reorder */
	private async updateSortValues(
		sortProp: BasesPropertyId,
		bodyEl: HTMLElement,
		movedEntry: BasesEntry,
		insertIndex: number,
	): Promise<void> {
		const sortPropName = sortProp.replace(/^note\./, "");

		// Collect current entries in the lane (excluding the moved card)
		const cardEls = Array.from(
			bodyEl.querySelectorAll(".base-kanban-card"),
		) as HTMLElement[];

		const laneEntries: BasesEntry[] = [];
		for (const cardEl of cardEls) {
			const filePath = cardEl.dataset.filePath;
			if (!filePath) continue;
			const found = this.data.data.find((e) => e.file.path === filePath);
			if (found && found !== movedEntry) {
				laneEntries.push(found);
			}
		}

		// Insert the moved entry at the target index
		laneEntries.splice(insertIndex, 0, movedEntry);

		// Assign sequential sort values
		const promises: Promise<void>[] = [];
		for (let i = 0; i < laneEntries.length; i++) {
			const e = laneEntries[i];
			const sortVal = (i + 1) * 10;
			promises.push(
				this.app.fileManager.processFrontMatter(
					e.file,
					(frontmatter) => {
						frontmatter[sortPropName] = sortVal;
					},
				),
			);
		}
		await Promise.all(promises);
	}

	private async createCardInLane(
		laneValue: string,
		statusProp: BasesPropertyId,
	): Promise<void> {
		const propName = statusProp.replace(/^note\./, "");
		const value = laneValue === "(No value)" ? undefined : laneValue;

		await this.createFileForView("", (frontmatter) => {
			if (value !== undefined) {
				frontmatter[propName] = value;
			}
		});
	}

	static getViewOptions(config: BasesViewConfig): any[] {
		return [
			{
				displayName: "Status property",
				type: "property",
				key: "statusProperty",
				filter: (prop: string) => !prop.startsWith("file."),
				placeholder: "Select a property for lanes",
			},
			{
				displayName: "Sort property",
				type: "property",
				key: "sortProperty",
				filter: (prop: string) => !prop.startsWith("file."),
				placeholder: "Select a number property for ordering",
			},
			{
				displayName: "Layout",
				type: "dropdown",
				key: "layout",
				options: [
					{ label: "Compact", value: "compact" },
					{ label: "Default", value: "default" },
					{ label: "Detailed", value: "detailed" },
				],
				defaultValue: "default",
			},
		];
	}

	public getEphemeralState(): unknown {
		return {
			scrollLeft: this.boardEl.scrollLeft,
		};
	}

	public setEphemeralState(state: unknown): void {
		if (state && typeof state === "object" && "scrollLeft" in state) {
			this.boardEl.scrollLeft = (state as { scrollLeft: number }).scrollLeft;
		}
	}
}
