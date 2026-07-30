// ============================================================================
// Orbit — Plugin Entry Point
// ============================================================================

import { Plugin, WorkspaceLeaf, PluginSettingTab, Setting, App, SettingDefinitionItem } from 'obsidian';
import { OrbitGraphView, VIEW_TYPE_ORBIT } from './view';
import { OrbitPluginSettings, DEFAULT_SETTINGS, SiblingSortMode, OrbitThemeType, OrbitParentSourceType } from './types';

export default class OrbitPlugin extends Plugin {
	settings: OrbitPluginSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the custom view.
		this.registerView(VIEW_TYPE_ORBIT, (leaf: WorkspaceLeaf) => {
			return new OrbitGraphView(leaf, this.settings, async (newSettings) => {
				this.settings = newSettings;
				await this.saveSettings();
			});
		});

		// Register settings tab
		this.addSettingTab(new OrbitSettingTab(this.app, this));

		// Ribbon icon (planet emoji mapped to Lucide "orbit" icon).
		this.addRibbonIcon('orbit', 'Open Orbit Graph View', () => {
			void this.activateView();
		});

		// Command palette entry.
		this.addCommand({
			id: 'open-graph-view',
			name: 'Open graph view',
			callback: () => {
				void this.activateView();
			},
		});
	}

	onunload(): void {
		// Obsidian handles view de-registration automatically.
	}

	// -----------------------------------------------------------------------
	// View Activation
	// -----------------------------------------------------------------------

	/**
	 * Open (or reveal) the Orbit Graph view.
	 * If a leaf already exists, reveal it. Otherwise create a new one in the
	 * right split.
	 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_ORBIT)[0];

		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({
				type: VIEW_TYPE_ORBIT,
				active: true,
			});
		}

		if (leaf) {
			void workspace.revealLeaf(leaf);
		}
	}

	// -----------------------------------------------------------------------
	// Settings
	// -----------------------------------------------------------------------

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Record<string, unknown> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		// Synchronization/Migration for Orbit Scale setting
		if (data) {
			const grav = typeof data.gravity === 'number' ? data.gravity : 1.0;
			this.settings.gravity = grav;
			this.settings.orbitRadiusScale = grav + 0.5;
			this.settings.galaxySize = grav + 0.5;
		}

		// Migration from legacy hideOtherNodes setting
		if (data && typeof data.hideOtherNodes === 'boolean' && data.fadeOtherNodes === undefined) {
			this.settings.fadeOtherNodes = data.hideOtherNodes;
		}

		// Migration from legacy hideLoneStars setting
		if (data && typeof data.hideLoneStars === 'boolean' && data.hideLoneNodes === undefined) {
			this.settings.hideLoneNodes = data.hideLoneStars;
		}

		// Migration from legacy hideLink boolean setting
		if (data && typeof data.hideLink === 'boolean' && data.lineToParentStyle === undefined) {
			this.settings.lineToParentStyle = data.hideLink ? 'hidden' : 'translucent';
		}

		// Migration from legacy hideOrbitTrace boolean setting
		if (data && typeof data.hideOrbitTrace === 'boolean' && data.orbitTraceStyle === undefined) {
			this.settings.orbitTraceStyle = data.hideOrbitTrace ? 'hidden' : 'translucent';
		}

		// Convert legacy string values ('hide' -> 'hidden', 'transparent' -> 'translucent')
		if ((this.settings.orbitTraceStyle as string) === 'hide') this.settings.orbitTraceStyle = 'hidden';
		if ((this.settings.orbitTraceStyle as string) === 'transparent') this.settings.orbitTraceStyle = 'translucent';
		if ((this.settings.lineToParentStyle as string) === 'hide') this.settings.lineToParentStyle = 'hidden';
		if ((this.settings.lineToParentStyle as string) === 'transparent') this.settings.lineToParentStyle = 'translucent';
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);

		// Propagate to any active views.
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ORBIT)) {
			const view = leaf.view;
			if (view instanceof OrbitGraphView) {
				view.updateSettings(this.settings);
			}
		}
	}
}

class OrbitSettingTab extends PluginSettingTab {
	plugin: OrbitPlugin;

	constructor(app: App, plugin: OrbitPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('p', {
			text: 'You can open the Orbit Graph View using the orbit icon in the left sidebar.',
			cls: 'setting-item-description'
		});

		// 1. Theme
		new Setting(containerEl)
			.setName('Theme')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('light', 'Light Theme (White and Grey)')
					.addOption('dark', 'Dark Theme (Black and White)')
					.addOption('celestial', 'Celestial Theme (Stars and Planets)')
					.setValue(this.plugin.settings.theme)
					.onChange(async (value) => {
						this.plugin.settings.theme = value as OrbitThemeType;
						await this.plugin.saveSettings();
					})
			);

		// 2. Orbit Method
		new Setting(containerEl)
			.setName('Orbit Method')
			.setDesc('How nodes orbit')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('frontmatter', 'Frontmatter metadata (gravity_parent)')
					.addOption('tag', 'Tags (#parent-note-name)')
					.addOption('outlink', 'Outlinks ([[Parent Note]])')
					.addOption('backlink', 'Backlinks (Child Note)')
					.setValue(this.plugin.settings.parentSource)
					.onChange(async (value) => {
						this.plugin.settings.parentSource = value as OrbitParentSourceType;
						await this.plugin.saveSettings();
					})
			);

		// 3. Sibling Sort Order
		new Setting(containerEl)
			.setName('Sibling Sort Order')
			.setDesc('Same-level node arrangement')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('fileSize', 'File Size')
					.addOption('createdTime', 'Created Time')
					.addOption('modifiedTime', 'Modified Time')
					.addOption('alphabetical', 'Alphabetical')
					.setValue(this.plugin.settings.siblingSortMode)
					.onChange(async (value) => {
						this.plugin.settings.siblingSortMode = value as SiblingSortMode;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl('p', {
			text: 'More display settings are available in the Orbit Graph View settings panel.',
			cls: 'setting-item-description'
		});
	}
}
