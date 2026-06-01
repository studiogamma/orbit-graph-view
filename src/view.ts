// ============================================================================
// Orbit — Solar System Graph ItemView
// ============================================================================
//
// Orchestrates the parser, physics engine, and canvas renderer within an
// Obsidian ItemView. Manages the animation loop, pan/zoom interaction,
// click-to-open, and debounced vault re-parsing.
// ============================================================================

import { ItemView, WorkspaceLeaf, TFile, debounce, setIcon } from 'obsidian';
import { parseVault } from './parser';
import { PhysicsEngine } from './physics';
import { CanvasRenderer } from './renderer';
import { ParsedGraph, ViewTransform, OrbitPluginSettings, DEFAULT_SETTINGS, SiblingSortMode, OrbitThemeType, OrbitDirectionType, OrbitParentSourceType } from './types';

export const VIEW_TYPE_ORBIT = 'orbit-graph-view';

export class OrbitGraphView extends ItemView {
	// -- Dependencies --------------------------------------------------------
	private settings: OrbitPluginSettings;
	private saveSettingsCallback?: (settings: OrbitPluginSettings) => Promise<void>;

	// -- Settings Panel UI ---------------------------------------------------
	private settingsPanelEl: HTMLDivElement | null = null;
	private toggleBtnEl: HTMLDivElement | null = null;
	private collapsedSections: Set<string> = new Set(['Organization', 'Display']);
	private firstFrameAligned = false;

	// -- Core systems --------------------------------------------------------
	private physics: PhysicsEngine = new PhysicsEngine();
	private renderer: CanvasRenderer | null = null;
	private graph: ParsedGraph | null = null;

	// -- Animation -----------------------------------------------------------
	private animFrameId: number | null = null;
	private lastFrameTime = 0;

	// -- Camera / Interaction ------------------------------------------------
	private transform: ViewTransform = { offsetX: 0, offsetY: 0, scale: 1 };
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private dragStartOffsetX = 0;
	private dragStartOffsetY = 0;

	// -- Canvas element ------------------------------------------------------
	private canvasEl: HTMLCanvasElement | null = null;
	private containerDiv: HTMLDivElement | null = null;

	// -- Resize observer -----------------------------------------------------
	private resizeObserver: ResizeObserver | null = null;

	// -- Bound event handlers (for cleanup) ----------------------------------
	private boundOnWheel: (e: WheelEvent) => void;
	private boundOnMouseDown: (e: MouseEvent) => void;
	private boundOnMouseMove: (e: MouseEvent) => void;
	private boundOnMouseUp: (e: MouseEvent) => void;
	private boundOnClick: (e: MouseEvent) => void;

	constructor(
		leaf: WorkspaceLeaf,
		settings?: OrbitPluginSettings,
		saveSettingsCallback?: (settings: OrbitPluginSettings) => Promise<void>
	) {
		super(leaf);
		this.settings = settings ?? { ...DEFAULT_SETTINGS };
		this.saveSettingsCallback = saveSettingsCallback;

		// Bind handlers once so we can remove them later.
		this.boundOnWheel = this.onWheel.bind(this);
		this.boundOnMouseDown = this.onMouseDown.bind(this);
		this.boundOnMouseMove = this.onMouseMove.bind(this);
		this.boundOnMouseUp = this.onMouseUp.bind(this);
		this.boundOnClick = this.onClick.bind(this);
	}

	// -----------------------------------------------------------------------
	// ItemView overrides
	// -----------------------------------------------------------------------

	getViewType(): string {
		return VIEW_TYPE_ORBIT;
	}

	getDisplayText(): string {
		return 'Orbit Graph';
	}

	getIcon(): string {
		return 'orbit';
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();

		// Create wrapper div.
		this.containerDiv = container.createDiv({ cls: 'orbit-graph-container' });

		// Create canvas.
		this.canvasEl = this.containerDiv.createEl('canvas');
		this.renderer = new CanvasRenderer(this.canvasEl);

		// Initial sizing.
		this.renderer.resize();

		// Create settings panel.
		this.createSettingsPanel();

		// Watch for container resizes.
		this.resizeObserver = new ResizeObserver(() => {
			this.renderer?.resize();
		});
		this.resizeObserver.observe(this.containerDiv);

		// Attach interaction listeners.
		this.canvasEl.addEventListener('wheel', this.boundOnWheel, { passive: false });
		this.canvasEl.addEventListener('mousedown', this.boundOnMouseDown);
		window.addEventListener('mousemove', this.boundOnMouseMove);
		window.addEventListener('mouseup', this.boundOnMouseUp);
		this.canvasEl.addEventListener('click', this.boundOnClick);

		// Parse vault and start.
		this.rebuildGraph();

		// Listen for metadata changes (debounced).
		this.registerEvent(
			this.app.metadataCache.on('changed', this.debouncedRebuild),
		);
		// Also listen for file creation / deletion / rename.
		this.registerEvent(this.app.vault.on('create', this.debouncedRebuild));
		this.registerEvent(this.app.vault.on('delete', this.debouncedRebuild));
		this.registerEvent(this.app.vault.on('rename', this.debouncedRebuild));

		// Start render loop.
		this.lastFrameTime = performance.now();
		this.tick(this.lastFrameTime);
	}

	async onClose(): Promise<void> {
		// Stop animation.
		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}

		// Remove interaction listeners.
		this.canvasEl?.removeEventListener('wheel', this.boundOnWheel);
		this.canvasEl?.removeEventListener('mousedown', this.boundOnMouseDown);
		window.removeEventListener('mousemove', this.boundOnMouseMove);
		window.removeEventListener('mouseup', this.boundOnMouseUp);
		this.canvasEl?.removeEventListener('click', this.boundOnClick);

		// Disconnect resize observer.
		this.resizeObserver?.disconnect();

		// Clear DOM.
		this.settingsPanelEl = null;
		this.toggleBtnEl = null;
		this.containerDiv = null;
		this.canvasEl = null;
		this.renderer = null;
	}

	// -----------------------------------------------------------------------
	// Public API (called by the plugin when settings change)
	// -----------------------------------------------------------------------

	updateSettings(settings: OrbitPluginSettings): void {
		const needsRebuild =
			this.settings.parentSource !== settings.parentSource ||
			this.settings.siblingSortMode !== settings.siblingSortMode;

		const needsPhysicsUpdate =
			this.settings.orbitDirection !== settings.orbitDirection ||
			this.settings.keplerBaseOmega !== settings.keplerBaseOmega ||
			this.settings.orbitRadiusScale !== settings.orbitRadiusScale ||
			this.settings.nodeSizeScale !== settings.nodeSizeScale;

		this.settings = settings;

		if (needsRebuild) {
			this.rebuildGraph();
		} else if (needsPhysicsUpdate) {
			this.physics.updatePhysicsParameters(this.settings);
		}

		this.renderSettingsContent();
	}

	// -----------------------------------------------------------------------
	// Graph Rebuild
	// -----------------------------------------------------------------------

	private rebuildGraph(): void {
		this.graph = parseVault(this.app, this.settings);

		// Log any warnings to console.
		for (const w of this.graph.warnings) {
			console.warn(w);
		}

		// Show/hide empty state.
		if (this.graph.roots.length === 0) {
			this.showEmptyState();
		} else {
			this.hideEmptyState();
		}

		this.physics.initialize(this.graph, this.settings);
	}

	private debouncedRebuild = debounce(
		() => this.rebuildGraph(),
		500,
		true,
	);

	// -----------------------------------------------------------------------
	// Empty State
	// -----------------------------------------------------------------------

	private emptyStateEl: HTMLDivElement | null = null;

	private showEmptyState(): void {
		if (this.emptyStateEl || !this.containerDiv) return;
		this.emptyStateEl = this.containerDiv.createDiv({ cls: 'orbit-graph-empty' });

		let instruction = '';
		const source = this.settings.parentSource || 'frontmatter';
		if (source === 'frontmatter') {
			instruction = 'Add <code>gravity_parent</code> to your note frontmatter to get started.';
		} else if (source === 'tag') {
			instruction = 'Add tags (e.g. <code>#parent-note-name</code>) to your notes to get started.';
		} else if (source === 'outlink') {
			instruction = 'Add outlinks (e.g. <code>[[Parent Note]]</code>) to your notes to get started.';
		} else if (source === 'backlink') {
			instruction = 'Add backlinks from other notes to get started.';
		}

		this.emptyStateEl.innerHTML =
			'No orbital data found.<br>' + instruction;
	}

	private hideEmptyState(): void {
		this.emptyStateEl?.remove();
		this.emptyStateEl = null;
	}

	// -----------------------------------------------------------------------
	// Animation Loop
	// -----------------------------------------------------------------------

	private tick = (now: number): void => {
		const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1); // cap at 100ms
		this.lastFrameTime = now;

		if (this.graph && this.renderer) {
			this.physics.update(dt);

			if (!this.firstFrameAligned) {
				const targetId = this.getTargetRootId();
				if (targetId) {
					this.alignCameraToTarget(targetId);
					this.firstFrameAligned = true;
				}
			}

			this.renderer.draw(this.graph, this.physics.getStates(), this.transform, this.settings);
		}

		this.animFrameId = requestAnimationFrame(this.tick);
	};

	// -----------------------------------------------------------------------
	// Interaction: Pan & Zoom
	// -----------------------------------------------------------------------

	private onWheel(e: WheelEvent): void {
		e.preventDefault();

		const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
		const newScale = this.transform.scale * zoomFactor;

		// Clamp zoom.
		if (newScale < 0.02 || newScale > 10) return;

		// Zoom toward the cursor position.
		const rect = this.canvasEl!.getBoundingClientRect();
		const mouseX = e.clientX - rect.left - rect.width / 2;
		const mouseY = e.clientY - rect.top - rect.height / 2;

		const worldXBefore = mouseX / this.transform.scale - this.transform.offsetX;
		const worldYBefore = mouseY / this.transform.scale - this.transform.offsetY;

		this.transform.scale = newScale;

		const worldXAfter = mouseX / this.transform.scale - this.transform.offsetX;
		const worldYAfter = mouseY / this.transform.scale - this.transform.offsetY;

		this.transform.offsetX += worldXAfter - worldXBefore;
		this.transform.offsetY += worldYAfter - worldYBefore;
	}

	private onMouseDown(e: MouseEvent): void {
		if (e.button !== 0) return; // left click only
		this.isDragging = true;
		this.dragStartX = e.clientX;
		this.dragStartY = e.clientY;
		this.dragStartOffsetX = this.transform.offsetX;
		this.dragStartOffsetY = this.transform.offsetY;
	}

	private onMouseMove(e: MouseEvent): void {
		if (!this.isDragging) return;
		const dx = e.clientX - this.dragStartX;
		const dy = e.clientY - this.dragStartY;
		this.transform.offsetX = this.dragStartOffsetX + dx / this.transform.scale;
		this.transform.offsetY = this.dragStartOffsetY + dy / this.transform.scale;
	}

	private onMouseUp(_e: MouseEvent): void {
		this.isDragging = false;
	}

	// -----------------------------------------------------------------------
	// Interaction: Click to Open
	// -----------------------------------------------------------------------

	private onClick(e: MouseEvent): void {
		// Ignore if the user was dragging.
		const dx = Math.abs(e.clientX - this.dragStartX);
		const dy = Math.abs(e.clientY - this.dragStartY);
		if (dx > 4 || dy > 4) return;

		if (!this.renderer || !this.canvasEl) return;

		// Convert screen → world coordinates.
		const rect = this.canvasEl.getBoundingClientRect();
		const screenX = e.clientX - rect.left - rect.width / 2;
		const screenY = e.clientY - rect.top - rect.height / 2;
		const worldX = screenX / this.transform.scale - this.transform.offsetX;
		const worldY = screenY / this.transform.scale - this.transform.offsetY;

		const hitId = this.renderer.hitTest(worldX, worldY, this.physics.getStates(), this.graph, this.settings);

		if (hitId) {
			if (hitId.startsWith('virtual-tag:')) {
				return;
			}
			// Open the file in the most recent leaf (avoid replacing this view).
			const leaf = this.app.workspace.getLeaf('tab');
			this.app.workspace.openLinkText(hitId, '', false, { active: true });
		}
	}

	// -----------------------------------------------------------------------
	// Settings Panel UI Builder
	// -----------------------------------------------------------------------

	private createSettingsPanel(): void {
		if (!this.containerDiv) return;

		// 1. Toggle Button
		this.toggleBtnEl = this.containerDiv.createDiv({ cls: 'orbit-graph-settings-toggle' });
		setIcon(this.toggleBtnEl, 'settings');
		this.toggleBtnEl.addEventListener('click', () => {
			this.settingsPanelEl?.classList.toggle('is-hidden');
		});

		// 2. Settings Panel
		this.settingsPanelEl = this.containerDiv.createDiv({ cls: 'orbit-graph-settings-panel is-hidden' });

		// Header
		const header = this.settingsPanelEl.createDiv({ cls: 'orbit-graph-settings-header' });
		header.createDiv({ cls: 'orbit-graph-settings-title', text: 'Orbit Settings' });

		const actions = header.createDiv({ cls: 'orbit-graph-settings-actions' });

		// Reset button
		const resetBtn = actions.createEl('button', { cls: 'orbit-graph-settings-action-btn' });
		setIcon(resetBtn, 'refresh-cw');
		resetBtn.setAttribute('title', 'Reset to default');
		resetBtn.addEventListener('click', async () => {
			this.settings = { ...DEFAULT_SETTINGS };
			this.firstFrameAligned = false; // Reset camera alignment
			this.rebuildGraph();
			if (this.saveSettingsCallback) {
				await this.saveSettingsCallback(this.settings);
			}
			this.renderSettingsContent();
		});

		// Close button
		const closeBtn = actions.createEl('button', { cls: 'orbit-graph-settings-action-btn' });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => {
			this.settingsPanelEl?.classList.add('is-hidden');
		});

		// Panel Content Container
		const content = this.settingsPanelEl.createDiv({ cls: 'orbit-graph-settings-content' });

		this.renderSettingsContent(content);
	}

	private renderSettingsContent(container?: HTMLElement): void {
		const parent = container ?? (this.settingsPanelEl?.querySelector('.orbit-graph-settings-content') as HTMLElement);
		if (!parent) return;
		parent.empty();

		// --- SECTION 1: Organization ---
		this.createCollapsibleSection(parent, 'Organization', (secBody) => {
			// Relation Source
			this.createDropdownSetting(
				secBody,
				'Orbit Relation Source',
				'Parent-child relation source',
				this.settings.parentSource,
				[
					{ value: 'frontmatter', label: 'Frontmatter' },
					{ value: 'tag', label: 'Tags' },
					{ value: 'outlink', label: 'Outlinks' },
					{ value: 'backlink', label: 'Backlinks' }
				],
				async (val) => {
					this.settings.parentSource = val as OrbitParentSourceType;
					this.firstFrameAligned = false; // Recenter camera on rebuild
					this.rebuildGraph();
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Sibling Sort Order
			this.createDropdownSetting(
				secBody,
				'Sibling Sort Order',
				'How to order sibling nodes',
				this.settings.siblingSortMode,
				[
					{ value: 'fileSize', label: 'File Size' },
					{ value: 'createdTime', label: 'Created Time' },
					{ value: 'modifiedTime', label: 'Modified Time' },
					{ value: 'alphabetical', label: 'Alphabetical' }
				],
				async (val) => {
					this.settings.siblingSortMode = val as SiblingSortMode;
					this.firstFrameAligned = false; // Recenter camera on rebuild
					this.rebuildGraph();
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);
		});

		// --- SECTION 2: Display ---
		this.createCollapsibleSection(parent, 'Display', (secBody) => {
			// Kepler Speed Slider
			this.createSliderSetting(
				secBody,
				'Kepler Speed',
				'Higher is faster',
				this.settings.keplerBaseOmega,
				0, 15, 0.5,
				async (val) => {
					this.settings.keplerBaseOmega = val;
					// Dynamically update parameters in-place without resetting graph
					this.physics.updatePhysicsParameters(this.settings);
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Theme
			this.createDropdownSetting(
				secBody,
				'Orbit Theme',
				'Visual color scheme',
				this.settings.theme,
				[
					{ value: 'celestial', label: 'Celestial' },
					{ value: 'light', label: 'Light' },
					{ value: 'dark', label: 'Dark' }
				],
				async (val) => {
					this.settings.theme = val as OrbitThemeType;
					// Theme is purely visual, no rebuild/update required!
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Direction
			this.createDropdownSetting(
				secBody,
				'Orbit Direction',
				'Rotation direction',
				this.settings.orbitDirection,
				[
					{ value: 'cross', label: 'Cross Path' },
					{ value: 'clockwise', label: 'Clockwise' },
					{ value: 'counterclockwise', label: 'Counterclockwise' }
				],
				async (val) => {
					this.settings.orbitDirection = val as OrbitDirectionType;
					// Dynamically update parameters in-place without resetting graph
					this.physics.updatePhysicsParameters(this.settings);
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Orbit Radius Scale
			this.createSliderSetting(
				secBody,
				'Orbit Radius Scale',
				'Scale factor for orbit radius (0.5x - 2.0x)',
				this.settings.orbitRadiusScale,
				0.5, 2.0, 0.1,
				async (val) => {
					this.settings.orbitRadiusScale = val;
					// Dynamically update parameters in-place without resetting graph
					this.physics.updatePhysicsParameters(this.settings);
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Node Size Scale
			this.createSliderSetting(
				secBody,
				'Node Size Scale',
				'Scale factor for node size (0.5x - 2.0x)',
				this.settings.nodeSizeScale,
				0.5, 2.0, 0.1,
				async (val) => {
					this.settings.nodeSizeScale = val;
					// Dynamically update parameters in-place without resetting graph
					this.physics.updatePhysicsParameters(this.settings);
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Hide Lone Stars
			this.createCheckboxSetting(
				secBody,
				'Hide Lone Stars',
				'',
				this.settings.hideLoneStars,
				async (val) => {
					this.settings.hideLoneStars = val;
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Hide Orbit Trace
			this.createCheckboxSetting(
				secBody,
				'Hide Orbit Trace',
				'',
				this.settings.hideOrbitTrace,
				async (val) => {
					this.settings.hideOrbitTrace = val;
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Hide Link to Parent
			this.createCheckboxSetting(
				secBody,
				'Hide Line to Parent',
				'',
				this.settings.hideLink,
				async (val) => {
					this.settings.hideLink = val;
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);
		});
	}

	private createCollapsibleSection(
		parent: HTMLElement,
		title: string,
		builder: (body: HTMLElement) => void
	): void {
		const sec = parent.createDiv({ cls: 'orbit-settings-section' });

		const header = sec.createDiv({ cls: 'orbit-settings-section-header' });
		header.createSpan({ text: title });

		const iconSpan = header.createSpan({ cls: 'orbit-settings-section-header-icon' });
		setIcon(iconSpan, 'chevron-down');

		const body = sec.createDiv({ cls: 'orbit-settings-section-content' });

		const isCollapsed = this.collapsedSections.has(title);
		if (isCollapsed) {
			body.classList.add('is-collapsed');
			iconSpan.classList.add('is-collapsed');
		}

		header.addEventListener('click', () => {
			const currentlyCollapsed = body.classList.toggle('is-collapsed');
			iconSpan.classList.toggle('is-collapsed', currentlyCollapsed);

			if (currentlyCollapsed) {
				this.collapsedSections.add(title);
			} else {
				this.collapsedSections.delete(title);
			}
		});

		builder(body);
	}

	private createDropdownSetting(
		parent: HTMLElement,
		name: string,
		desc: string,
		currentValue: string,
		options: { value: string; label: string }[],
		onChange: (value: string) => Promise<void>
	): void {
		const item = parent.createDiv({ cls: 'orbit-setting-item' });

		const header = item.createDiv({ cls: 'orbit-setting-item-header' });
		header.createDiv({ cls: 'orbit-setting-item-name', text: name });
		header.createDiv({ cls: 'orbit-setting-item-desc', text: desc });

		const control = item.createDiv({ cls: 'orbit-setting-item-control' });
		const select = control.createEl('select');

		for (const opt of options) {
			select.createEl('option', { value: opt.value, text: opt.label });
		}

		select.value = currentValue;

		select.addEventListener('change', async () => {
			await onChange(select.value);
		});
	}

	private createSliderSetting(
		parent: HTMLElement,
		name: string,
		desc: string,
		currentValue: number,
		min: number,
		max: number,
		step: number,
		onChange: (value: number) => Promise<void>
	): void {
		const item = parent.createDiv({ cls: 'orbit-setting-item' });

		const header = item.createDiv({ cls: 'orbit-setting-item-header' });
		header.createDiv({ cls: 'orbit-setting-item-name', text: name });
		header.createDiv({ cls: 'orbit-setting-item-desc', text: desc });

		const control = item.createDiv({ cls: 'orbit-setting-item-control' });
		const container = control.createDiv({ cls: 'orbit-setting-slider-container' });

		const slider = container.createEl('input', { type: 'range' });
		slider.min = String(min);
		slider.max = String(max);
		slider.step = String(step);
		slider.value = String(currentValue);

		const valueEl = container.createSpan({ cls: 'orbit-setting-slider-value', text: String(currentValue) });

		slider.addEventListener('input', () => {
			valueEl.setText(slider.value);
		});

		slider.addEventListener('change', async () => {
			const val = parseFloat(slider.value);
			if (!isNaN(val)) {
				await onChange(val);
			}
		});
	}

	private getTargetRootId(): string | null {
		if (!this.graph || this.graph.roots.length === 0) return null;

		let roots = [...this.graph.roots];

		// If hideLoneStars is active, ignore lone stars when selecting the primary target system
		if (this.settings.hideLoneStars) {
			const filteredRoots = roots.filter(rootId => {
				const node = this.graph!.nodes.get(rootId);
				return node ? (node.children.length > 0 || node.parents.length > 0) : false;
			});
			if (filteredRoots.length > 0) {
				roots = filteredRoots;
			}
		}

		// Map to store precalculated system sizes (BFS subtree size)
		const systemSizes = new Map<string, number>();

		for (const rootId of roots) {
			const visited = new Set<string>();
			const queue = [rootId];
			visited.add(rootId);

			while (queue.length > 0) {
				const curr = queue.shift()!;
				const node = this.graph.nodes.get(curr);
				if (node) {
					for (const cid of node.children) {
						if (!visited.has(cid)) {
							visited.add(cid);
							queue.push(cid);
						}
					}
				}
			}
			systemSizes.set(rootId, visited.size);
		}

		roots.sort((a, b) => {
			const na = this.graph!.nodes.get(a);
			const nb = this.graph!.nodes.get(b);
			if (!na || !nb) return 0;

			// 1번째 조건: 가장 크거나 (fileSize 내림차순, 같으면 mass 내림차순)
			const sizeDiff = nb.fileSize - na.fileSize;
			if (sizeDiff !== 0) return sizeDiff;

			const massDiff = nb.mass - na.mass;
			if (massDiff !== 0) return massDiff;

			// 2번째 조건: 가장 자식 노드가 많거나 (System 전체 크기 내림차순)
			const sizeA = systemSizes.get(a) ?? 0;
			const sizeB = systemSizes.get(b) ?? 0;
			const systemSizeDiff = sizeB - sizeA;
			if (systemSizeDiff !== 0) return systemSizeDiff;

			// 3번째 조건: 가장 알파벳 순으로 앞선 (label 오름차순)
			return na.label.localeCompare(nb.label);
		});

		return roots[0]!;
	}

	private alignCameraToTarget(targetId: string): void {
		if (!this.graph || !this.canvasEl) return;
		const targetNode = this.graph.nodes.get(targetId);
		const targetState = this.physics.getStates().get(targetId);
		if (!targetNode || !targetState) return;

		const w = this.canvasEl.getBoundingClientRect().width;
		const h = this.canvasEl.getBoundingClientRect().height;
		if (w <= 0 || h <= 0) return;

		const systemRadius = this.physics.estimateSystemRadius(targetNode, this.graph);

		// Center the camera on the target root node's position in world space
		this.transform.offsetX = -targetState.x;
		this.transform.offsetY = -targetState.y;

		// Calculate scale to fit the entire system with 15% padding
		if (systemRadius > 0) {
			const targetScale = (Math.min(w, h) * 0.85) / (2 * systemRadius);
			// Clamp zoom to readable level (not too zoomed in for single nodes)
			this.transform.scale = Math.max(0.05, Math.min(targetScale, 1.2));
		} else {
			this.transform.scale = 1.0;
		}
	}

	private createCheckboxSetting(
		parent: HTMLElement,
		name: string,
		desc: string,
		currentValue: boolean,
		onChange: (value: boolean) => Promise<void>
	): void {
		const item = parent.createDiv({ cls: 'orbit-setting-item' });

		const container = item.createDiv({ cls: 'orbit-setting-checkbox-container' });

		const checkbox = container.createEl('input', { type: 'checkbox' });
		checkbox.checked = currentValue;
		checkbox.id = 'orbit-settings-' + name.replace(/\s+/g, '-').toLowerCase();

		const label = container.createEl('label', { cls: 'orbit-setting-checkbox-label' });
		label.setAttribute('for', checkbox.id);

		const nameSpan = label.createSpan({ cls: 'orbit-setting-item-name', text: ' ' + name });
		if (desc) {
			label.createEl('br');
			label.createSpan({ cls: 'orbit-setting-item-desc', text: desc });
		}

		checkbox.addEventListener('change', async () => {
			await onChange(checkbox.checked);
		});
	}
}
