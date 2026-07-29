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
import { ParsedGraph, ViewTransform, OrbitPluginSettings, DEFAULT_SETTINGS, SiblingSortMode, OrbitThemeType, OrbitDirectionType, OrbitParentSourceType, LineToParentStyle, OrbitTraceStyle } from './types';

export const VIEW_TYPE_ORBIT = 'orbit-graph-view';

export class OrbitGraphView extends ItemView {
	// -- Dependencies --------------------------------------------------------
	private settings: OrbitPluginSettings;
	private saveSettingsCallback?: (settings: OrbitPluginSettings) => Promise<void>;

	// -- Settings Panel UI ---------------------------------------------------
	private settingsPanelEl: HTMLDivElement | null = null;
	private toggleBtnEl: HTMLDivElement | null = null;
	private collapsedSections: Set<string> = new Set(['Theme', 'Organization', 'Display', 'Node Focus']);
	private firstFrameAligned = false;
	private focusedNodeId: string | null = null;
	private isCameraTracking = false;
	private searchInputEl: HTMLInputElement | null = null;

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
	private lastActiveSpeed = 5;
	private boundOnWheel: (e: WheelEvent) => void;
	private boundOnMouseDown: (e: MouseEvent) => void;
	private boundOnMouseMove: (e: MouseEvent) => void;
	private boundOnMouseUp: (e: MouseEvent) => void;
	private boundOnClick: (e: MouseEvent) => void;
	private boundOnContextMenu: (e: MouseEvent) => void;
	private boundOnKeyDown: (e: KeyboardEvent) => void;

	constructor(
		leaf: WorkspaceLeaf,
		settings?: OrbitPluginSettings,
		saveSettingsCallback?: (settings: OrbitPluginSettings) => Promise<void>
	) {
		super(leaf);
		this.settings = settings ?? { ...DEFAULT_SETTINGS };
		this.saveSettingsCallback = saveSettingsCallback;
		if (this.settings.keplerBaseOmega > 0) {
			this.lastActiveSpeed = this.settings.keplerBaseOmega;
		}

		// Bind handlers once so we can remove them later.
		this.boundOnWheel = this.onWheel.bind(this);
		this.boundOnMouseDown = this.onMouseDown.bind(this);
		this.boundOnMouseMove = this.onMouseMove.bind(this);
		this.boundOnMouseUp = this.onMouseUp.bind(this);
		this.boundOnClick = this.onClick.bind(this);
		this.boundOnContextMenu = this.onContextMenu.bind(this);
		this.boundOnKeyDown = this.onKeyDown.bind(this);
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
		this.canvasEl.addEventListener('contextmenu', this.boundOnContextMenu);
		window.addEventListener('keydown', this.boundOnKeyDown);

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
		this.canvasEl?.removeEventListener('contextmenu', this.boundOnContextMenu);
		window.removeEventListener('keydown', this.boundOnKeyDown);

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

		if (this.focusedNodeId && !this.graph.nodes.has(this.focusedNodeId)) {
			this.focusedNodeId = null;
			this.isCameraTracking = false;
		}
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

			if (this.focusedNodeId) {
				const focusedState = this.physics.getStates().get(this.focusedNodeId);
				if (focusedState) {
					if (this.isCameraTracking) {
						this.transform.offsetX = -focusedState.x;
						this.transform.offsetY = -focusedState.y;
					}
				} else {
					this.focusedNodeId = null;
					this.isCameraTracking = false;
				}
			} else if (!this.firstFrameAligned) {
				const targetId = this.getTargetRootId();
				if (targetId) {
					this.alignCameraToTarget(targetId);
					this.firstFrameAligned = true;
				}
			}

			this.renderer.draw(this.graph, this.physics.getStates(), this.transform, this.settings, this.focusedNodeId);
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

		if (this.isCameraTracking && this.focusedNodeId) {
			// Zoom around focused node center without unlocking camera tracking
			this.transform.scale = newScale;
			const focusedState = this.physics.getStates().get(this.focusedNodeId);
			if (focusedState) {
				this.transform.offsetX = -focusedState.x;
				this.transform.offsetY = -focusedState.y;
			}
		} else {
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

		// Unlock camera tracking on actual drag movement (> 3px), but keep Node Focus active
		if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
			this.isCameraTracking = false;
		}

		if (!this.isCameraTracking) {
			this.transform.offsetX = this.dragStartOffsetX + dx / this.transform.scale;
			this.transform.offsetY = this.dragStartOffsetY + dy / this.transform.scale;
		}
	}

	private onMouseUp(_e: MouseEvent): void {
		this.isDragging = false;
	}

	private clearFocus(): void {
		this.focusedNodeId = null;
		this.isCameraTracking = false;
		if (this.searchInputEl) {
			this.searchInputEl.value = '';
		}
	}

	// -----------------------------------------------------------------------
	// Interaction: Click to Open & Focus
	// -----------------------------------------------------------------------

	private onClick(e: MouseEvent): void {
		// Ignore if the user was dragging (threshold: 3px).
		const dx = Math.abs(e.clientX - this.dragStartX);
		const dy = Math.abs(e.clientY - this.dragStartY);
		if (dx > 3 || dy > 3) return;

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
		} else {
			// Left clicked empty space: clear node focus
			this.clearFocus();
		}
	}

	private onContextMenu(e: MouseEvent): void {
		if (!this.renderer || !this.canvasEl) return;

		// Convert screen → world coordinates.
		const rect = this.canvasEl.getBoundingClientRect();
		const screenX = e.clientX - rect.left - rect.width / 2;
		const screenY = e.clientY - rect.top - rect.height / 2;
		const worldX = screenX / this.transform.scale - this.transform.offsetX;
		const worldY = screenY / this.transform.scale - this.transform.offsetY;

		const hitId = this.renderer.hitTest(worldX, worldY, this.physics.getStates(), this.graph, this.settings);

		if (hitId) {
			e.preventDefault();
			this.focusedNodeId = hitId;
			this.isCameraTracking = true;
			if (this.graph) {
				const focusedNode = this.graph.nodes.get(hitId);
				if (focusedNode && this.searchInputEl) {
					this.searchInputEl.value = focusedNode.label;
				}
			}
		} else {
			// Right clicked empty space: clear node focus
			this.clearFocus();
		}
	}

	private async onKeyDown(e: KeyboardEvent): Promise<void> {
		if (e.code !== 'Space' && e.key !== ' ') return;

		// Only trigger when this OrbitGraphView is the active view in Obsidian
		const activeView = this.app.workspace.getActiveViewOfType(OrbitGraphView);
		if (activeView !== this) return;

		// Do not trigger if typing inside input / textarea / contenteditable elements
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
			return;
		}

		e.preventDefault();

		if (this.settings.keplerBaseOmega !== 0) {
			this.lastActiveSpeed = this.settings.keplerBaseOmega;
			this.settings.keplerBaseOmega = 0;
		} else {
			this.settings.keplerBaseOmega = this.lastActiveSpeed > 0 ? this.lastActiveSpeed : 5;
		}

		this.physics.updatePhysicsParameters(this.settings);
		if (this.saveSettingsCallback) {
			await this.saveSettingsCallback(this.settings);
		}
		this.renderSettingsContent();
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

		// Panel Content Container
		const content = this.settingsPanelEl.createDiv({ cls: 'orbit-graph-settings-content' });

		this.renderSettingsContent(content);
	}

	private renderSettingsContent(container?: HTMLElement): void {
		const parent = container ?? (this.settingsPanelEl?.querySelector('.orbit-graph-settings-content') as HTMLElement);
		if (!parent) return;
		parent.empty();

		// --- SECTION 1: Theme ---
		this.createCollapsibleSection(
			parent,
			'Theme',
			(secBody) => {
				this.createDropdownSetting(
					secBody,
					'Theme',
					'',
					this.settings.theme,
					[
						{ value: 'light', label: 'Light' },
						{ value: 'dark', label: 'Dark' },
						{ value: 'celestial', label: 'Celestial' }
					],
					async (val) => {
						this.settings.theme = val as OrbitThemeType;
						// Theme is purely visual, no rebuild/update required!
						if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
					}
				);
			},
			(actionEl) => {
				const closeBtn = actionEl.createEl('button', { cls: 'orbit-graph-settings-action-btn' });
				setIcon(closeBtn, 'x');
				closeBtn.setAttribute('title', 'Close settings panel');
				closeBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.settingsPanelEl?.classList.add('is-hidden');
				});
			}
		);

		// --- SECTION 2: Organization ---
		this.createCollapsibleSection(parent, 'Organization', (secBody) => {
			// Relation Source
			this.createDropdownSetting(
				secBody,
				'Orbit Method',
				'How nodes orbit',
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
				'Same-level node arrangement',
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

			// Hide Lone Nodes
			this.createCheckboxSetting(
				secBody,
				'Hide Lone Nodes',
				'',
				this.settings.hideLoneNodes ?? false,
				async (val) => {
					this.settings.hideLoneNodes = val;
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Hide Single-Parent Nodes
			this.createCheckboxSetting(
				secBody,
				'Hide Single-Parent Nodes',
				'',
				this.settings.hideSingleParentNodes ?? false,
				async (val) => {
					this.settings.hideSingleParentNodes = val;
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);

			// Hide Multi-Parent Nodes
			this.createCheckboxSetting(
				secBody,
				'Hide Multi-Parent Nodes',
				'',
				this.settings.hideMultiParentNodes ?? false,
				async (val) => {
					this.settings.hideMultiParentNodes = val;
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);
		});

		// --- SECTION 3: Display ---
		this.createCollapsibleSection(
			parent,
			'Display',
			(secBody) => {
				// 1. Orbit Speed
				this.createDropdownSetting(
					secBody,
					'Orbit Speed',
					'Press spacebar to pause/resume',
					String(this.settings.keplerBaseOmega),
					[
						{ value: '0', label: 'Stationary' },
						{ value: '2.5', label: 'Slow' },
						{ value: '5', label: 'Moderate' },
						{ value: '10', label: 'Fast' }
					],
					async (val) => {
						const speed = parseFloat(val);
						this.settings.keplerBaseOmega = speed;
						if (speed > 0) {
							this.lastActiveSpeed = speed;
						}
						// Dynamically update parameters in-place without resetting graph
						this.physics.updatePhysicsParameters(this.settings);
						if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
					}
				);

				// 2. Orbit Scale (controls Orbit Radius Scale and Galaxy Size together)
				this.createSliderSetting(
					secBody,
					'Orbit Scale',
					'',
					this.settings.gravity ?? 1.0,
					0.5, 2.0, 0.1,
					async (val) => {
						this.settings.gravity = val;
						this.settings.orbitRadiusScale = val + 0.5;
						this.settings.galaxySize = val + 0.5;
						// Dynamically update parameters in-place without resetting graph
						this.physics.updatePhysicsParameters(this.settings);
						if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
					}
				);

				// 3. Node Size
				this.createSliderSetting(
					secBody,
					'Node Size',
					'',
					this.settings.nodeSizeScale,
					0.5, 2.0, 0.1,
					async (val) => {
						this.settings.nodeSizeScale = val;
						// Dynamically update parameters in-place without resetting graph
						this.physics.updatePhysicsParameters(this.settings);
						if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
					}
				);

				// 4. Orbit Trace
				this.createDropdownSetting(
					secBody,
					'Orbit Trace',
					'',
					this.settings.orbitTraceStyle ?? 'translucent',
					[
						{ value: 'hidden', label: 'Hidden' },
						{ value: 'translucent', label: 'Translucent' },
						{ value: 'solid', label: 'Solid' },
					],
					async (val) => {
						this.settings.orbitTraceStyle = val as OrbitTraceStyle;
						if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
					}
				);

				// 5. Parent-Child Line
				this.createDropdownSetting(
					secBody,
					'Parent-Child Line',
					'',
					this.settings.lineToParentStyle ?? 'translucent',
					[
						{ value: 'hidden', label: 'Hidden' },
						{ value: 'translucent', label: 'Translucent' },
						{ value: 'solid', label: 'Solid' },
					],
					async (val) => {
						this.settings.lineToParentStyle = val as LineToParentStyle;
						if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
					}
				);

				// 6. Orbit CCW
				this.createCheckboxSetting(
					secBody,
					'Orbit CCW',
					'Toggle orbit direction',
					this.settings.orbitDirection !== 'clockwise',
					async (val) => {
						this.settings.orbitDirection = val ? 'counterclockwise' : 'clockwise';
						this.physics.updatePhysicsParameters(this.settings);
						if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
					}
				);

				// 7. Dual-Parent Oval Orbit
				this.createCheckboxSetting(
					secBody,
					'Dual-Parent Oval Orbit',
					'',
					this.settings.dualParentOvalOrbit ?? true,
					async (val) => {
						this.settings.dualParentOvalOrbit = val;
						this.physics.updatePhysicsParameters(this.settings);
						if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
					}
				);

				// 8. Galactic Rotation
				this.createCheckboxSetting(
					secBody,
					'Galactic Rotation',
					'Rotate top-level nodes',
					this.settings.galacticRotation ?? false,
					async (val) => {
						this.settings.galacticRotation = val;
						this.physics.updatePhysicsParameters(this.settings);
						if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
					}
				);
			},
			(actionEl) => {
				const resetBtn = actionEl.createEl('button', { cls: 'orbit-graph-settings-action-btn' });
				setIcon(resetBtn, 'refresh-cw');
				resetBtn.setAttribute('title', 'Reset display options to default');
				resetBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					this.settings.keplerBaseOmega = DEFAULT_SETTINGS.keplerBaseOmega;
					this.settings.orbitDirection = DEFAULT_SETTINGS.orbitDirection;
					this.settings.dualParentOvalOrbit = DEFAULT_SETTINGS.dualParentOvalOrbit;
					this.settings.galacticRotation = DEFAULT_SETTINGS.galacticRotation;
					this.settings.gravity = DEFAULT_SETTINGS.gravity ?? 1.0;
					this.settings.orbitRadiusScale = (DEFAULT_SETTINGS.gravity ?? 1.0) + 0.5;
					this.settings.galaxySize = (DEFAULT_SETTINGS.gravity ?? 1.0) + 0.5;
					this.settings.nodeSizeScale = DEFAULT_SETTINGS.nodeSizeScale;
					this.settings.orbitTraceStyle = DEFAULT_SETTINGS.orbitTraceStyle;
					this.settings.lineToParentStyle = DEFAULT_SETTINGS.lineToParentStyle;
					this.lastActiveSpeed = DEFAULT_SETTINGS.keplerBaseOmega;

					this.physics.updatePhysicsParameters(this.settings);
					if (this.saveSettingsCallback) {
						await this.saveSettingsCallback(this.settings);
					}
					this.renderSettingsContent();
				});
			}
		);

		// --- SECTION 4: Node Focus ---
		this.createCollapsibleSection(parent, 'Node Focus', (secBody) => {
			this.createNodeSearchSetting(secBody);
			this.createCheckboxSetting(
				secBody,
				'Fade Other Nodes',
				'',
				this.settings.fadeOtherNodes ?? true,
				async (val) => {
					this.settings.fadeOtherNodes = val;
					if (this.saveSettingsCallback) await this.saveSettingsCallback(this.settings);
				}
			);
		});
	}

	private createCollapsibleSection(
		parent: HTMLElement,
		title: string,
		builder: (body: HTMLElement) => void,
		actionBuilder?: (actionEl: HTMLElement) => void
	): void {
		const sec = parent.createDiv({ cls: 'orbit-settings-section' });

		const header = sec.createDiv({ cls: 'orbit-settings-section-header' });

		const titleContainer = header.createDiv({ cls: 'orbit-settings-section-title-container' });
		const iconSpan = titleContainer.createSpan({ cls: 'orbit-settings-section-header-icon' });
		setIcon(iconSpan, 'chevron-down');
		titleContainer.createSpan({ text: title });

		if (actionBuilder) {
			const actionEl = header.createDiv({ cls: 'orbit-settings-section-action' });
			actionBuilder(actionEl);
		}

		const wrapper = sec.createDiv({ cls: 'orbit-settings-section-wrapper' });
		const body = wrapper.createDiv({ cls: 'orbit-settings-section-content' });

		const isCollapsed = this.collapsedSections.has(title);
		if (isCollapsed) {
			wrapper.classList.add('is-collapsed');
			iconSpan.classList.add('is-collapsed');
		}

		header.addEventListener('click', () => {
			const currentlyCollapsed = wrapper.classList.toggle('is-collapsed');
			iconSpan.classList.toggle('is-collapsed', currentlyCollapsed);

			if (currentlyCollapsed) {
				this.collapsedSections.add(title);
			} else {
				this.collapsedSections.delete(title);
			}
		});

		builder(body);
	}

	private createNodeSearchSetting(parent: HTMLElement): void {
		const item = parent.createDiv({ cls: 'orbit-setting-item' });

		const header = item.createDiv({ cls: 'orbit-setting-item-header' });
		header.createDiv({ cls: 'orbit-setting-item-name', text: 'Node Focus' });
		header.createDiv({ cls: 'orbit-setting-item-desc', text: 'Right click to focus on' });

		const control = item.createDiv({ cls: 'orbit-setting-item-control' });
		const searchContainer = control.createDiv({ cls: 'orbit-search-container' });

		const input = searchContainer.createEl('input', {
			type: 'text',
			placeholder: 'Search node name...',
			cls: 'orbit-search-input',
		});
		this.searchInputEl = input;

		const clearBtn = searchContainer.createEl('button', {
			cls: 'orbit-search-clear-btn',
			text: '✕',
		});
		clearBtn.setAttribute('title', 'Clear Focus');

		// Autocomplete Dropdown Popup
		const dropdownEl = searchContainer.createDiv({ cls: 'orbit-autocomplete-dropdown is-hidden' });

		let currentMatches: { id: string; label: string }[] = [];
		let highlightedIndex = -1;

		if (this.focusedNodeId && this.graph) {
			const focusedNode = this.graph.nodes.get(this.focusedNodeId);
			if (focusedNode) {
				input.value = focusedNode.label;
			}
		}

		const updateHighlight = () => {
			const items = Array.from(dropdownEl.querySelectorAll('.orbit-autocomplete-item')) as HTMLElement[];
			items.forEach((itemEl, idx) => {
				if (idx === highlightedIndex) {
					itemEl.classList.add('is-highlighted');
					itemEl.scrollIntoView({ block: 'nearest' });
				} else {
					itemEl.classList.remove('is-highlighted');
				}
			});
		};

		const updateDropdown = () => {
			dropdownEl.empty();
			highlightedIndex = -1;
			currentMatches = [];

			if (!this.graph) {
				dropdownEl.classList.add('is-hidden');
				return;
			}

			const query = input.value.trim().toLowerCase();

			// Get nodes and filter hidden node types if settings are active
			let nodes = Array.from(this.graph.nodes.values());
			if (this.settings.hideLoneNodes) {
				nodes = nodes.filter(
					(node) => node.parents.length > 0 || node.children.length > 0
				);
			}
			if (this.settings.hideSingleParentNodes) {
				nodes = nodes.filter(
					(node) => node.parents.length !== 1
				);
			}
			if (this.settings.hideMultiParentNodes) {
				nodes = nodes.filter(
					(node) => node.parents.length <= 1
				);
			}

			// Sort nodes alphabetically by label
			nodes.sort((a, b) => a.label.localeCompare(b.label));

			// Prefix matching filter (or show all if query is empty)
			currentMatches = query
				? nodes.filter((node) => node.label.toLowerCase().startsWith(query))
				: nodes;

			if (currentMatches.length === 0) {
				dropdownEl.classList.add('is-hidden');
				return;
			}

			dropdownEl.classList.remove('is-hidden');

			currentMatches.forEach((node, idx) => {
				const optionEl = dropdownEl.createDiv({
					cls: 'orbit-autocomplete-item',
					text: node.label,
				});

				optionEl.addEventListener('mouseenter', () => {
					highlightedIndex = idx;
					updateHighlight();
				});

				optionEl.addEventListener('mousedown', (e) => {
					e.preventDefault(); // Prevent input blur before click registers
					this.focusedNodeId = node.id;
					this.isCameraTracking = true;
					input.value = node.label;
					dropdownEl.classList.add('is-hidden');
					highlightedIndex = -1;
				});
			});
		};

		input.addEventListener('focus', () => {
			updateDropdown();
		});

		input.addEventListener('input', () => {
			if (input.value.trim() === '') {
				this.focusedNodeId = null;
				this.isCameraTracking = false;
			}
			updateDropdown();
		});

		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (dropdownEl.classList.contains('is-hidden')) {
				if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
					updateDropdown();
				}
				return;
			}

			if (currentMatches.length === 0) return;

			if (e.key === 'ArrowDown') {
				e.preventDefault();
				highlightedIndex = (highlightedIndex + 1) % currentMatches.length;
				updateHighlight();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				if (highlightedIndex <= 0) {
					highlightedIndex = -1;
					updateHighlight();
				} else {
					highlightedIndex = highlightedIndex - 1;
					updateHighlight();
				}
			} else if (e.key === 'Enter') {
				if (highlightedIndex >= 0 && highlightedIndex < currentMatches.length) {
					e.preventDefault();
					const selectedNode = currentMatches[highlightedIndex];
					if (selectedNode) {
						this.focusedNodeId = selectedNode.id;
						this.isCameraTracking = true;
						input.value = selectedNode.label;
						dropdownEl.classList.add('is-hidden');
						highlightedIndex = -1;
					}
				}
			} else if (e.key === 'Escape') {
				dropdownEl.classList.add('is-hidden');
				highlightedIndex = -1;
			}
		});

		input.addEventListener('blur', () => {
			setTimeout(() => {
				dropdownEl.classList.add('is-hidden');
				highlightedIndex = -1;
			}, 150);
		});

		clearBtn.addEventListener('click', () => {
			this.focusedNodeId = null;
			this.isCameraTracking = false;
			input.value = '';
			dropdownEl.classList.add('is-hidden');
			highlightedIndex = -1;
		});
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
		if (desc) {
			header.createDiv({ cls: 'orbit-setting-item-desc', text: desc });
		}

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
		if (desc) {
			header.createDiv({ cls: 'orbit-setting-item-desc', text: desc });
		}

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

		// If hideLoneNodes is active, ignore lone stars when selecting the primary target system
		if (this.settings.hideLoneNodes) {
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
