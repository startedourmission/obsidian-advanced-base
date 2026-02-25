import { Plugin } from "obsidian";
import { KanbanView } from "./kanban-view";

export default class BaseKanbanPlugin extends Plugin {
	async onload() {
		this.registerBasesView("kanban", {
			name: "Kanban",
			icon: "columns-3",
			factory: (controller, containerEl) =>
				new KanbanView(controller, containerEl, this),
			options: (config) => KanbanView.getViewOptions(config),
		});
	}
}
