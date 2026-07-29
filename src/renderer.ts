// ============================================================================
// Orbit — Canvas Renderer
// ============================================================================
//
// High-performance 2D Canvas renderer with:
// - Depth-based HSL color scheme with radial gradient glow
// - Semi-transparent dashed orbit paths
// - Gradient connection lines from children to parents
// - Viewport culling for off-screen nodes
// - Inverse-zoom text scaling for readable labels at any zoom level
// ============================================================================

import { GraphNode, OrbitalState, ViewTransform, ParsedGraph, OrbitPluginSettings, OrbitThemeType, OrbitTraceStyle, OrbitDirectionType, LineToParentStyle } from './types';

// ---------------------------------------------------------------------------
// Color Themes & Palettes
// ---------------------------------------------------------------------------

interface ThemeColors {
	bg: string;
	orbit: string;
	connectionStart: string;
	connectionEnd: string;
	label: string;
}

const THEMES: Record<OrbitThemeType, ThemeColors> = {
	light: {
		bg: '#ffffff',
		orbit: 'rgba(0, 0, 0, 0.30)',
		connectionStart: 'rgba(0, 0, 0, 0.10)',
		connectionEnd: 'rgba(0, 0, 0, 0.10)',
		label: 'rgba(0, 0, 0, 0.75)',
	},
	dark: {
		bg: '#000000',
		orbit: 'rgba(255, 255, 255, 0.30)',
		connectionStart: 'rgba(255, 255, 255, 0.10)',
		connectionEnd: 'rgba(255, 255, 255, 0.02)',
		label: 'rgba(255, 255, 255, 0.75)',
	},
	celestial: {
		bg: '#0a0a1a', // Classic dark space background
		orbit: 'rgba(255, 255, 255, 0.30)',
		connectionStart: 'rgba(255, 255, 255, 0.10)',
		connectionEnd: 'rgba(255, 255, 255, 0.02)',
		label: 'rgba(255, 255, 255, 0.75)',
	},
};

/**
 * Dynamic node color solver for the Celestial Theme based on the maximum depth
 * of the graph and the specific node's depth.
 */
function getNodeColor(
	nodeId: string,
	depth: number,
	theme: OrbitThemeType,
	maxDepth: number,
	siblingIndex: number = 0
): string {
	if (nodeId.startsWith('virtual-tag:')) {
		return '#0CB04E';
	}
	if (theme === 'light') {
		return '#5C5C5C'; // Grey
	}
	if (theme === 'dark') {
		return '#ffffff'; // White
	}

	// -- Celestial Theme planet override (Solar System planet colors for Type 4 nodes) --
	if (theme === 'celestial') {
		// Check if this node is Type 4
		let isType4 = false;
		if (maxDepth === 1 && depth === 1) isType4 = true;
		else if (maxDepth === 2 && depth === 1) isType4 = true;
		else if (maxDepth === 3 && depth === 2) isType4 = true;
		else if (maxDepth >= 4 && depth === 3) isType4 = true;

		if (isType4) {
			const planetColors = [
				'#0051C2',  // 1st Node (Earth blue)
				'#D39C7E',  // 2nd Node (Jupiter tan)
				'#C5AB6E',  // 3rd Node (Saturn sandy yellow)
				'#5BCEE4',  // 4th Node (Neptune deep blue)
			];
			if (siblingIndex >= 0) {
				return planetColors[siblingIndex % planetColors.length]!;
			}
			return '#0051C2';
		}
	}

	// -- Standard depth colors fallback for Celestial Theme --
	const type1Colors = ['#FF969D', '#FF6880', '#FF5350'];
	const type2Colors = ['#D8FFFF', '#BDFFFF', '#93FFFF'];
	const type3Colors = ['#FFC84B', '#FFE267', '#FFB86F'];

	const getType1Color = () => getRandomPaletteColor(type1Colors, nodeId, siblingIndex);
	const getType2Color = () => getRandomPaletteColor(type2Colors, nodeId, siblingIndex);
	const getType3Color = () => getRandomPaletteColor(type3Colors, nodeId, siblingIndex);

	if (maxDepth === 0) {
		return getType3Color(); // Type 3-A
	}
	if (maxDepth === 1) {
		if (depth === 0) return getType3Color(); // Type 3
		return '#0051C2'; // Type 4
	}
	if (maxDepth === 2) {
		if (depth === 0) return getType3Color(); // Type 3
		if (depth === 1) return '#0051C2'; // Type 4
		return '#BFBFBF'; // Type 5 (Grey)
	}
	if (maxDepth === 3) {
		if (depth === 0) return getType2Color(); // Type 2 (Skyblue)
		if (depth === 1) return getType3Color(); // Type 3
		if (depth === 2) return '#0051C2'; // Type 4
		return '#BFBFBF'; // Type 5 (Grey)
	}
	// maxDepth >= 4
	if (depth === 0) return getType1Color(); // Type 1 (Red)
	if (depth === 1) return getType2Color(); // Type 2 (Skyblue)
	if (depth === 2) return getType3Color(); // Type 3
	if (depth === 3) return '#0051C2'; // Type 4
	return '#BFBFBF'; // Type 5 (Grey)
}

function getRandomPaletteColor(palette: string[], nodeId: string, offset: number = 0): string {
	let hash = 0;
	for (let i = 0; i < nodeId.length; i++) {
		hash = (hash << 5) - hash + nodeId.charCodeAt(i);
		hash |= 0;
	}
	const idx = Math.abs(hash + offset) % palette.length;
	return palette[idx]!;
}

/**
 * Returns a semi-transparent glow (halo) color matching the base node color (20% opacity).
 */
function getNodeGlowColor(baseColor: string, _theme: OrbitThemeType): string {
	return getRgbaColor(baseColor, 0.2);
}

/**
 * Helper to convert color strings (hex or rgb) to rgba with a specified alpha transparency.
 */
function getRgbaColor(baseColor: string, alpha: number): string {
	if (baseColor.startsWith('rgba')) {
		return baseColor.replace(/[\d\.]+\)$/, `${alpha})`);
	}
	if (baseColor.startsWith('#')) {
		const r = parseInt(baseColor.slice(1, 3), 16);
		const g = parseInt(baseColor.slice(3, 5), 16);
		const b = parseInt(baseColor.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	return baseColor;
}

const LABEL_FONT_BASE = 12;
const CULL_MARGIN = 200; // px beyond viewport before a node is culled

// ---------------------------------------------------------------------------
// CanvasRenderer
// ---------------------------------------------------------------------------

export class CanvasRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Failed to get 2d context');
		this.ctx = ctx;
	}

	/** Resize the canvas to match its container's CSS size (retina-aware). */
	resize(): void {
		const dpr = window.devicePixelRatio || 1;
		const rect = this.canvas.getBoundingClientRect();
		this.canvas.width = rect.width * dpr;
		this.canvas.height = rect.height * dpr;
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	/**
	 * Draw a full frame.
	 *
	 * @param graph    - The parsed graph (for node metadata).
	 * @param states   - The current orbital states from the physics engine.
	 * @param transform - The camera pan/zoom transform.
	 * @param settings  - The current plugin settings (for theme properties).
	 */
	draw(
		graph: ParsedGraph,
		states: ReadonlyMap<string, OrbitalState>,
		transform: ViewTransform,
		settings: OrbitPluginSettings,
		focusedNodeId: string | null = null,
	): void {
		const ctx = this.ctx;
		const w = this.canvas.getBoundingClientRect().width;
		const h = this.canvas.getBoundingClientRect().height;

		const theme = settings.theme || 'light';
		const colors = THEMES[theme] || THEMES.light;

		// Compute the maximum depth of the graph dynamically
		let maxDepth = 0;
		for (const node of graph.nodes.values()) {
			if (node.depth > maxDepth) {
				maxDepth = node.depth;
			}
		}

		let relevantSet: Set<string> | null = null;
		if (focusedNodeId && graph.nodes.has(focusedNodeId)) {
			relevantSet = this.getRelevantNodeSet(graph, focusedNodeId);
		}

		// -- Clear ---------------------------------------------------------------
		ctx.save();
		ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
		ctx.fillStyle = colors.bg;
		ctx.fillRect(0, 0, w, h);
		ctx.restore();

		// -- Apply camera transform ----------------------------------------------
		ctx.save();
		const dpr = window.devicePixelRatio || 1;
		ctx.setTransform(
			transform.scale * dpr,
			0,
			0,
			transform.scale * dpr,
			(transform.offsetX * transform.scale + w / 2) * dpr,
			(transform.offsetY * transform.scale + h / 2) * dpr,
		);

		// Compute viewport bounds in world space for culling.
		const invScale = 1 / transform.scale;
		const vpLeft = -transform.offsetX - (w / 2) * invScale - CULL_MARGIN * invScale;
		const vpRight = -transform.offsetX + (w / 2) * invScale + CULL_MARGIN * invScale;
		const vpTop = -transform.offsetY - (h / 2) * invScale - CULL_MARGIN * invScale;
		const vpBottom = -transform.offsetY + (h / 2) * invScale + CULL_MARGIN * invScale;

		const isVisible = (x: number, y: number, r: number): boolean =>
			x + r > vpLeft && x - r < vpRight && y + r > vpTop && y - r < vpBottom;

		const fadeOtherNodes = settings.fadeOtherNodes ?? settings.hideOtherNodes ?? true;

		// -- Layer 1: Orbit paths ------------------------------------------------
		const traceStyle = settings.orbitTraceStyle ?? 'translucent';
		if (traceStyle !== 'hidden') {
			this.drawOrbitPaths(
				ctx, graph, states, isVisible, colors.orbit, theme, maxDepth, traceStyle,
				settings.dualParentOvalOrbit ?? true, settings.orbitDirection,
				settings.hideSingleParentNodes ?? false, settings.hideMultiParentNodes ?? false,
				relevantSet, fadeOtherNodes
			);
		}

		// -- Layer 2: Connection lines -------------------------------------------
		const lineStyle = settings.lineToParentStyle ?? 'translucent';
		if (lineStyle !== 'hidden') {
			this.drawConnections(
				ctx, graph, states, isVisible, colors.connectionStart, lineStyle,
				settings.hideSingleParentNodes ?? false, settings.hideMultiParentNodes ?? false,
				relevantSet, fadeOtherNodes
			);
		}

		// -- Layer 3: Nodes + Labels ---------------------------------------------
		this.drawNodes(
			ctx, graph, states, transform, isVisible, theme, maxDepth, colors.label,
			settings.hideLoneNodes, settings.hideSingleParentNodes ?? false, settings.hideMultiParentNodes ?? false,
			relevantSet, fadeOtherNodes
		);

		ctx.restore();
	}

	// -----------------------------------------------------------------------
	// Drawing Helpers
	// -----------------------------------------------------------------------

	private drawOrbitPaths(
		ctx: CanvasRenderingContext2D,
		graph: ParsedGraph,
		states: ReadonlyMap<string, OrbitalState>,
		isVisible: (x: number, y: number, r: number) => boolean,
		orbitColor: string,
		theme: OrbitThemeType,
		maxDepth: number,
		traceStyle: OrbitTraceStyle = 'translucent',
		dualParentOvalOrbit: boolean = true,
		orbitDirection: OrbitDirectionType = 'counterclockwise',
		hideSingleParentNodes: boolean = false,
		hideMultiParentNodes: boolean = false,
		relevantSet: Set<string> | null = null,
		fadeOtherNodes: boolean = true,
	): void {
		ctx.lineWidth = 1;

		for (const [nodeId, state] of states) {
			if (state.radius <= 0) continue; // root nodes have no orbit path

			if (fadeOtherNodes && relevantSet && !relevantSet.has(nodeId)) {
				continue; // Hide orbit trace for unrelated nodes when focused
			}

			const node = graph.nodes.get(nodeId);
			if (!node || node.parents.length === 0) continue;
			if (hideSingleParentNodes && node.parents.length === 1) continue;
			if (hideMultiParentNodes && node.parents.length > 1) continue;

			let cx = 0;
			let cy = 0;
			let isEllipse = false;
			let semiMajor = 0;
			let semiMinor = 0;
			let rotation = 0;
			let orbitRadius = 0;

			if (node.parents.length === 1) {
				const ps = states.get(node.parents[0]!);
				if (!ps) continue;
				cx = ps.x;
				cy = ps.y;
				orbitRadius = state.radius;
			} else if (node.parents.length === 2) {
				const ps1 = states.get(node.parents[0]!);
				const ps2 = states.get(node.parents[1]!);
				if (!ps1 || !ps2) {
					const ps = ps1 || ps2;
					if (!ps) continue;
					cx = ps.x;
					cy = ps.y;
					orbitRadius = state.radius;
				} else {
					cx = (ps1.x + ps2.x) / 2;
					cy = (ps1.y + ps2.y) / 2;
					const dx = ps2.x - ps1.x;
					const dy = ps2.y - ps1.y;
					const d = Math.sqrt(dx * dx + dy * dy);
					const useOval = dualParentOvalOrbit;
					if (useOval) {
						rotation = Math.atan2(dy, dx);
						semiMajor = d / 2 + state.radius;
						semiMinor = semiMajor * 0.6;
						isEllipse = true;
						orbitRadius = semiMajor;
					} else {
						isEllipse = false;
						orbitRadius = d / 2 + state.radius;
					}
				}
			} else {
				// parents.length >= 3
				let sumX = 0;
				let sumY = 0;
				const validParents: OrbitalState[] = [];
				for (const pid of node.parents) {
					const ps = states.get(pid);
					if (ps) {
						sumX += ps.x;
						sumY += ps.y;
						validParents.push(ps);
					}
				}
				if (validParents.length === 0) continue;
				cx = sumX / validParents.length;
				cy = sumY / validParents.length;

				let maxDist = 0;
				for (const ps of validParents) {
					const dist = Math.hypot(ps.x - cx, ps.y - cy);
					if (dist > maxDist) maxDist = dist;
				}
				orbitRadius = maxDist + state.radius;
			}

			if (!isVisible(cx, cy, orbitRadius)) continue;

			if (traceStyle === 'translucent') {
				// Parametric Fading Trail on Orbit
				const N = 30; // Number of trail segments
				const totalSpan = Math.PI * 1; // Tail arc length (180 degrees)
				const deltaTheta = totalSpan / N;

				// Tail direction: opposite of movement (if moving counterclockwise, tail is at +theta)
				let isCounterClockwise = false;
				if (state.omega !== 0) {
					isCounterClockwise = state.omega < 0;
				} else if (orbitDirection === 'counterclockwise') {
					isCounterClockwise = true;
				} else if (orbitDirection === 'clockwise') {
					isCounterClockwise = false;
				} else {
					// 'cross' path
					isCounterClockwise = node.depth % 2 !== 0;
				}
				const tailDir = isCounterClockwise ? 1 : -1;

				const cosRot = Math.cos(rotation);
				const sinRot = Math.sin(rotation);

				ctx.lineWidth = 1.5;

				let prevX = 0;
				let prevY = 0;

				for (let k = 0; k <= N; k++) {
					const theta_k = state.theta + k * deltaTheta * tailDir;
					let x = 0;
					let y = 0;

					if (isEllipse) {
						const lx = semiMajor * Math.cos(theta_k);
						const ly = semiMinor * Math.sin(theta_k);
						x = cx + lx * cosRot - ly * sinRot;
						y = cy + lx * sinRot + ly * cosRot;
					} else {
						x = cx + orbitRadius * Math.cos(theta_k);
						y = cy + orbitRadius * Math.sin(theta_k);
					}

					if (k > 0) {
						// Alpha decays from 0.5 at k=0 (current node position) down to 0.0 at tail
						const ratio = 1 - k / N;
						const alpha = 0.5 * Math.pow(ratio, 1.2);
						ctx.strokeStyle = getRgbaColor(orbitColor, alpha);
						ctx.beginPath();
						ctx.moveTo(prevX, prevY);
						ctx.lineTo(x, y);
						ctx.stroke();
					}

					prevX = x;
					prevY = y;
				}

				ctx.lineWidth = 1;
				continue;
			}

			if (traceStyle === 'solid') {
				ctx.lineWidth = 1.5;
				ctx.strokeStyle = getRgbaColor(orbitColor, 0.8);
			} else {
				ctx.lineWidth = 1;
				ctx.strokeStyle = getRgbaColor(orbitColor, 0.35);
			}

			ctx.beginPath();
			if (isEllipse) {
				ctx.ellipse(cx, cy, semiMajor, semiMinor, rotation, 0, Math.PI * 2);
			} else {
				ctx.arc(cx, cy, orbitRadius, 0, Math.PI * 2);
			}
			ctx.stroke();
		}

		ctx.setLineDash([]);
	}

	private drawConnections(
		ctx: CanvasRenderingContext2D,
		graph: ParsedGraph,
		states: ReadonlyMap<string, OrbitalState>,
		isVisible: (x: number, y: number, r: number) => boolean,
		baseColor: string,
		lineStyle: LineToParentStyle,
		hideSingleParentNodes: boolean = false,
		hideMultiParentNodes: boolean = false,
		relevantSet: Set<string> | null = null,
		fadeOtherNodes: boolean = true,
	): void {
		ctx.lineWidth = 1;

		for (const [nodeId, state] of states) {
			const node = graph.nodes.get(nodeId);
			if (!node) continue;

			if (hideSingleParentNodes && node.parents.length === 1) continue;
			if (hideMultiParentNodes && node.parents.length > 1) continue;

			for (const parentId of node.parents) {
				const parentState = states.get(parentId);
				if (!parentState) continue;

				const parentNode = graph.nodes.get(parentId);
				if (hideSingleParentNodes && parentNode && parentNode.parents.length === 1) continue;
				if (hideMultiParentNodes && parentNode && parentNode.parents.length > 1) continue;

				// Only draw if either end is visible.
				if (
					!isVisible(state.x, state.y, state.renderRadius) &&
					!isVisible(parentState.x, parentState.y, parentState.renderRadius)
				) {
					continue;
				}

				if (fadeOtherNodes && relevantSet && (!relevantSet.has(nodeId) || !relevantSet.has(parentId))) {
					continue; // Hide connection line for unrelated nodes when focused
				}

				const grad = ctx.createLinearGradient(
					parentState.x, parentState.y,
					state.x, state.y,
				);

				if (lineStyle === 'solid') {
					const solidColor = getRgbaColor(baseColor, 0.8);
					grad.addColorStop(0, solidColor);
					grad.addColorStop(1, solidColor);
				} else {
					// Translucent: Parent node (40%) -> Middle of line (20%) -> Child node (40%)
					const edgeColor = getRgbaColor(baseColor, 0.4);
					const midColor = getRgbaColor(baseColor, 0.2);
					grad.addColorStop(0, edgeColor);
					grad.addColorStop(0.5, midColor);
					grad.addColorStop(1, edgeColor);
				}

				ctx.strokeStyle = grad;

				ctx.beginPath();
				ctx.moveTo(parentState.x, parentState.y);
				ctx.lineTo(state.x, state.y);
				ctx.stroke();
			}
		}
	}

	private drawNodes(
		ctx: CanvasRenderingContext2D,
		graph: ParsedGraph,
		states: ReadonlyMap<string, OrbitalState>,
		transform: ViewTransform,
		isVisible: (x: number, y: number, r: number) => boolean,
		theme: OrbitThemeType,
		maxDepth: number,
		labelColor: string,
		hideLoneNodes: boolean,
		hideSingleParentNodes: boolean = false,
		hideMultiParentNodes: boolean = false,
		relevantSet: Set<string> | null = null,
		fadeOtherNodes: boolean = true,
	): void {
		const invScale = 1 / transform.scale;
		const fontSize = Math.max(8, Math.min(LABEL_FONT_BASE * invScale, 24));

		// Calculate zoom-based text alpha multiplier (smooth fade out when zooming out, fade in when zooming in)
		const FADE_IN_SCALE = 0.45;
		const FADE_OUT_SCALE = 0.20;
		const rawT = Math.max(0, Math.min(1, (transform.scale - FADE_OUT_SCALE) / (FADE_IN_SCALE - FADE_OUT_SCALE)));
		const textZoomAlpha = rawT * rawT * (3 - 2 * rawT);

		for (const [nodeId, state] of states) {
			if (!isVisible(state.x, state.y, state.renderRadius)) continue;

			const node = graph.nodes.get(nodeId);
			if (!node) continue;

			if (hideLoneNodes && node.parents.length === 0 && node.children.length === 0) {
				continue;
			}
			if (hideSingleParentNodes && node.parents.length === 1) {
				continue;
			}
			if (hideMultiParentNodes && node.parents.length > 1) {
				continue;
			}

			const isRelevant = !fadeOtherNodes || !relevantSet || relevantSet.has(nodeId);

			const r = state.renderRadius;
			const systemMaxDepth = state.systemMaxDepth ?? maxDepth;
			let color = getNodeColor(nodeId, node.depth, theme, systemMaxDepth, state.siblingIndex ?? 0);
			const baseLabelAlpha = isRelevant ? 0.75 : 0.075;
			const finalLabelAlpha = baseLabelAlpha * textZoomAlpha;

			if (isRelevant) {
				// Outer glow (20% opacity halo for relevant nodes).
				const glow = getNodeGlowColor(color, theme);
				const gradient = ctx.createRadialGradient(
					state.x, state.y, r * 0.3,
					state.x, state.y, r * 1.8,
				);
				gradient.addColorStop(0, color);
				gradient.addColorStop(0.4, glow);
				gradient.addColorStop(1, 'transparent');

				ctx.beginPath();
				ctx.arc(state.x, state.y, r * 1.8, 0, Math.PI * 2);
				ctx.fillStyle = gradient;
				ctx.fill();
			} else {
				// Fade state: node core is 10% opacity, halo is OFF
				color = getRgbaColor(color, 0.1);
			}

			// Solid core.
			ctx.beginPath();
			ctx.arc(state.x, state.y, r, 0, Math.PI * 2);
			ctx.fillStyle = color;
			ctx.fill();

			// Label (smoothly fades with zoom level).
			if (finalLabelAlpha > 0.001) {
				ctx.fillStyle = getRgbaColor(labelColor, finalLabelAlpha);
				ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				ctx.fillText(node.label, state.x, state.y + r + 4 * invScale);
			}
		}
	}

	/**
	 * Build a Set containing the focused node ID, all its ancestors, and all its descendants.
	 */
	private getRelevantNodeSet(graph: ParsedGraph, focusId: string): Set<string> {
		const relevant = new Set<string>();
		relevant.add(focusId);

		// 1. Traverse Ancestors (Upward)
		const queueUp = [focusId];
		const visitedUp = new Set<string>([focusId]);
		while (queueUp.length > 0) {
			const currId = queueUp.shift()!;
			const currNode = graph.nodes.get(currId);
			if (currNode) {
				for (const pId of currNode.parents) {
					if (!visitedUp.has(pId)) {
						visitedUp.add(pId);
						relevant.add(pId);
						queueUp.push(pId);
					}
				}
			}
		}

		// 2. Traverse Descendants (Downward)
		const queueDown = [focusId];
		const visitedDown = new Set<string>([focusId]);
		while (queueDown.length > 0) {
			const currId = queueDown.shift()!;
			const currNode = graph.nodes.get(currId);
			if (currNode) {
				for (const cId of currNode.children) {
					if (!visitedDown.has(cId)) {
						visitedDown.add(cId);
						relevant.add(cId);
						queueDown.push(cId);
					}
				}
			}
		}

		return relevant;
	}

	// -----------------------------------------------------------------------
	// Hit Testing
	// -----------------------------------------------------------------------

	/**
	 * Find the node under the given world-space coordinates, if any.
	 * Returns the node ID or null.
	 */
	hitTest(
		worldX: number,
		worldY: number,
		states: ReadonlyMap<string, OrbitalState>,
		graph: ParsedGraph | null,
		settings: OrbitPluginSettings,
	): string | null {
		if (!graph) return null;
		// Iterate in reverse so topmost-drawn nodes are tested first.
		const entries = [...states.entries()].reverse();
		for (const [nodeId, state] of entries) {
			const node = graph.nodes.get(nodeId);
			if (!node) continue;

			if (settings.hideLoneNodes && node.parents.length === 0 && node.children.length === 0) {
				continue;
			}
			if (settings.hideSingleParentNodes && node.parents.length === 1) {
				continue;
			}
			if (settings.hideMultiParentNodes && node.parents.length > 1) {
				continue;
			}

			const dx = worldX - state.x;
			const dy = worldY - state.y;
			// Use a slightly larger hit area for usability.
			const hitRadius = Math.max(state.renderRadius, 8);
			if (dx * dx + dy * dy <= hitRadius * hitRadius) {
				return nodeId;
			}
		}
		return null;
	}
}
