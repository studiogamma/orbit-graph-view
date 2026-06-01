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

import { GraphNode, OrbitalState, ViewTransform, ParsedGraph, OrbitPluginSettings, OrbitThemeType } from './types';

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
		if (theme === 'light') {
			return '#7856FF'; // Elegant deep purple for light theme
		}
		return '#A259FF'; // Vibrant neon purple for dark/celestial themes
	}
	if (theme === 'light') {
		return '#808080'; // Grey
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
				'#2271B3', // 1st Node (Earth blue)
				'#E3BB76', // 2nd Node (Venus yellowish-white)
				'#D39C7E', // 3rd Node (Jupiter wood/tan)
				'#C5AB6E', // 4th Node (Saturn sandy yellow)
				'#BBE1E4', // 5th Node (Uranus pale cyan)
				'#6081FF', // 6th Node (Neptune deep blue)
			];
			if (siblingIndex >= 0) {
				return planetColors[siblingIndex % planetColors.length]!;
			}
			return '#2271B3';
		}
	}

	// -- Standard depth colors fallback --
	if (maxDepth === 0) {
		return '#FF3B30'; // Root = Red
	}
	if (maxDepth === 1) {
		if (depth === 0) return '#FFCC00'; // Root = Yellow
		return '#2271B3'; // 1st Gen = Blue
	}
	if (maxDepth === 2) {
		if (depth === 0) return '#FFCC00'; // Root = Yellow
		if (depth === 1) return '#2271B3'; // 1st Gen = Blue
		return '#8E8E93'; // 2nd Gen = Grey
	}
	if (maxDepth === 3) {
		if (depth === 0) return '#FFFFFF'; // Root = White
		if (depth === 1) return '#FFCC00'; // 1st Gen = Yellow
		if (depth === 2) return '#2271B3'; // 2nd Gen = Blue
		return '#8E8E93'; // 3rd Gen = Grey
	}
	// maxDepth >= 4
	if (depth === 0) return '#C4E9F7'; // Root = Skyblue (Type 1)
	if (depth === 1) return '#FFFFFF'; // 1st Gen = White
	if (depth === 2) return '#FFCC00'; // 2nd Gen = Yellow
	if (depth === 3) return '#2271B3'; // 3rd Gen = Blue
	return '#8E8E93'; // 4th+ Gen = Grey
}

/**
 * Returns a semi-transparent glow color matching the base node color.
 */
function getNodeGlowColor(baseColor: string, theme: OrbitThemeType): string {
	if (baseColor.toUpperCase() === '#7856FF' || baseColor.toUpperCase() === '#A259FF') {
		if (theme === 'light') {
			return 'rgba(120, 86, 255, 0.15)';
		}
		return 'rgba(162, 89, 255, 0.4)';
	}
	if (theme === 'light') {
		return 'rgba(128, 128, 128, 0.15)';
	}
	switch (baseColor.toUpperCase()) {
		case '#FF3B30': return 'rgba(255, 59, 48, 0.3)';
		case '#FFCC00': return 'rgba(255, 204, 0, 0.3)';
		case '#2271B3': return 'rgba(34, 113, 179, 0.3)';
		case '#8E8E93': return 'rgba(142, 142, 147, 0.25)';
		case '#FFFFFF': return 'rgba(255, 255, 255, 0.3)';
		case '#5AC8FA':
		case '#C4E9F7': return 'rgba(90, 200, 250, 0.3)';
		// Celestial 2 Theme Planet Colors
		case '#A5A5A5': return 'rgba(165, 165, 165, 0.3)';
		case '#E3BB76': return 'rgba(227, 187, 118, 0.3)';
		case '#B24522': return 'rgba(178, 69, 34, 0.3)';
		case '#D39C7E': return 'rgba(211, 156, 126, 0.3)';
		case '#C5AB6E': return 'rgba(197, 171, 110, 0.3)';
		case '#BBE1E4': return 'rgba(187, 225, 228, 0.3)';
		case '#6081FF': return 'rgba(96, 129, 255, 0.3)';
		default: return 'rgba(255, 255, 255, 0.2)';
	}
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
	): void {
		const ctx = this.ctx;
		const w = this.canvas.getBoundingClientRect().width;
		const h = this.canvas.getBoundingClientRect().height;

		const theme = settings.theme || 'celestial';
		const colors = THEMES[theme] || THEMES.celestial;

		// Compute the maximum depth of the graph dynamically
		let maxDepth = 0;
		for (const node of graph.nodes.values()) {
			if (node.depth > maxDepth) {
				maxDepth = node.depth;
			}
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

		// -- Layer 1: Orbit paths ------------------------------------------------
		if (!settings.hideOrbitTrace) {
			this.drawOrbitPaths(ctx, graph, states, isVisible, colors.orbit, theme, maxDepth);
		}

		// -- Layer 2: Connection lines -------------------------------------------
		if (!settings.hideLink) {
			this.drawConnections(ctx, graph, states, isVisible, colors.connectionStart, colors.connectionEnd);
		}

		// -- Layer 3: Nodes + Labels ---------------------------------------------
		this.drawNodes(ctx, graph, states, transform, isVisible, theme, maxDepth, colors.label, settings.hideLoneStars);

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
	): void {
		ctx.lineWidth = 1;

		for (const [nodeId, state] of states) {
			if (state.radius <= 0) continue; // root nodes have no orbit path

			const node = graph.nodes.get(nodeId);
			if (!node) continue;

			// Determine center of orbit.
			let cx: number;
			let cy: number;

			if (node.parents.length >= 2) {
				let sumX = 0;
				let sumY = 0;
				let count = 0;
				for (const pid of node.parents) {
					const ps = states.get(pid);
					if (ps) { sumX += ps.x; sumY += ps.y; count++; }
				}
				cx = count > 0 ? sumX / count : 0;
				cy = count > 0 ? sumY / count : 0;
			} else if (node.parents.length === 1) {
				const ps = states.get(node.parents[0]!);
				cx = ps?.x ?? 0;
				cy = ps?.y ?? 0;
			} else {
				continue;
			}

			if (!isVisible(cx, cy, state.radius)) continue;

			// Get the unified theme orbit color and derive stops
			const rgbaHead = getRgbaColor(orbitColor, 0.30);
			const rgbaTail = getRgbaColor(orbitColor, 0.0);

			// Create conic gradient around orbit center (cx, cy)
			// starting at the node's current angular position (state.theta)
			const grad = ctx.createConicGradient(state.theta, cx, cy);

			// Align the fading tail based on the rotation direction (clockwise vs counterclockwise)
			const isClockwise = state.omega > 0;
			if (isClockwise) {
				// Clockwise rotation -> opposite behavior: direction of motion is fully transparent, opposite direction is 30% opaque
				grad.addColorStop(0, rgbaTail);
				grad.addColorStop(1, rgbaHead);
			} else {
				// Counterclockwise rotation -> opposite behavior: direction of motion is fully transparent, opposite direction is 30% opaque
				grad.addColorStop(0, rgbaHead);
				grad.addColorStop(1, rgbaTail);
			}

			ctx.strokeStyle = grad;
			ctx.beginPath();
			ctx.arc(cx, cy, state.radius, 0, Math.PI * 2);
			ctx.stroke();
		}

		ctx.setLineDash([]);
	}

	private drawConnections(
		ctx: CanvasRenderingContext2D,
		graph: ParsedGraph,
		states: ReadonlyMap<string, OrbitalState>,
		isVisible: (x: number, y: number, r: number) => boolean,
		startColor: string,
		endColor: string,
	): void {
		ctx.lineWidth = 1;

		for (const [nodeId, state] of states) {
			const node = graph.nodes.get(nodeId);
			if (!node) continue;

			for (const parentId of node.parents) {
				const parentState = states.get(parentId);
				if (!parentState) continue;

				// Only draw if either end is visible.
				if (
					!isVisible(state.x, state.y, state.renderRadius) &&
					!isVisible(parentState.x, parentState.y, parentState.renderRadius)
				) {
					continue;
				}

				const grad = ctx.createLinearGradient(
					parentState.x, parentState.y,
					state.x, state.y,
				);
				grad.addColorStop(0, startColor);
				grad.addColorStop(1, endColor);
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
		hideLoneStars: boolean,
	): void {
		const invScale = 1 / transform.scale;
		const fontSize = Math.max(8, Math.min(LABEL_FONT_BASE * invScale, 24));

		for (const [nodeId, state] of states) {
			if (!isVisible(state.x, state.y, state.renderRadius)) continue;

			const node = graph.nodes.get(nodeId);
			if (!node) continue;

			if (hideLoneStars && node.parents.length === 0 && node.children.length === 0) {
				continue;
			}

			const r = state.renderRadius;
			const systemMaxDepth = state.systemMaxDepth ?? maxDepth;
			const color = getNodeColor(nodeId, node.depth, theme, systemMaxDepth, state.siblingIndex ?? 0);
			const glow = getNodeGlowColor(color, theme);

			// Outer glow.
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

			// Solid core.
			ctx.beginPath();
			ctx.arc(state.x, state.y, r, 0, Math.PI * 2);
			ctx.fillStyle = color;
			ctx.fill();

			// Label.
			ctx.fillStyle = labelColor;
			ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			ctx.fillText(node.label, state.x, state.y + r + 4 * invScale);
		}
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

			if (settings.hideLoneStars && node.parents.length === 0 && node.children.length === 0) {
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
