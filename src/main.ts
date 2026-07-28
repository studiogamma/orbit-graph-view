// ============================================================================
// Orbit — Plugin Entry Point
// ============================================================================

import { Plugin, WorkspaceLeaf, PluginSettingTab, Setting, App } from 'obsidian';
import { OrbitGraphView, VIEW_TYPE_ORBIT } from './view';
import { OrbitPluginSettings, DEFAULT_SETTINGS, SiblingSortMode, OrbitThemeType, OrbitDirectionType, OrbitParentSourceType } from './types';

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
			this.activateView();
		});

		// Command palette entry.
		this.addCommand({
			id: 'open-orbit-graph-view',
			name: 'Open Orbit Graph View',
			callback: () => {
				this.activateView();
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
			workspace.revealLeaf(leaf);
		}
	}

	// -----------------------------------------------------------------------
	// Settings
	// -----------------------------------------------------------------------

	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Orbit Graph Settings' });

		new Setting(containerEl)
			.setName('Sibling Sort Order')
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

		new Setting(containerEl)
			.setName('Orbit Relation Source')
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

		new Setting(containerEl)
			.setName('Hide Lone Stars')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideLoneStars)
					.onChange(async (value) => {
						this.plugin.settings.hideLoneStars = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Hide Orbit Trace')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideOrbitTrace)
					.onChange(async (value) => {
						this.plugin.settings.hideOrbitTrace = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Hide Line to Parent')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideLink)
					.onChange(async (value) => {
						this.plugin.settings.hideLink = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Orbit Theme')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('celestial', 'Celestial Theme (Stars and Planets)')
					.addOption('light', 'Light Theme (White and Grey)')
					.addOption('dark', 'Dark Theme (Black and White)')
					.setValue(this.plugin.settings.theme)
					.onChange(async (value) => {
						this.plugin.settings.theme = value as OrbitThemeType;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Orbit Direction')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('cross', 'Cross Path (Alternating by depth)')
					.addOption('clockwise', 'Clockwise')
					.addOption('counterclockwise', 'Counterclockwise')
					.setValue(this.plugin.settings.orbitDirection)
					.onChange(async (value) => {
						this.plugin.settings.orbitDirection = value as OrbitDirectionType;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Kepler Speed')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('0', 'Stationary')
					.addOption('2.5', 'Slow')
					.addOption('5', 'Moderate')
					.addOption('10', 'Fast')
					.setValue(String(this.plugin.settings.keplerBaseOmega))
					.onChange(async (value) => {
						this.plugin.settings.keplerBaseOmega = parseFloat(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Orbit Radius Scale')
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 2.0, 0.1)
					.setValue(this.plugin.settings.orbitRadiusScale)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.orbitRadiusScale = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Node Size Scale')
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 2.0, 0.1)
					.setValue(this.plugin.settings.nodeSizeScale)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.nodeSizeScale = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
