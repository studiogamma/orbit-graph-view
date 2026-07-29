// ============================================================================
// Orbit — Core Type Definitions
// ============================================================================

/**
 * Sort mode for ordering sibling nodes within the same orbital layer.
 * The sort rank determines the orbital radius multiplier:
 * lower rank → inner orbit, higher rank → outer orbit.
 */
export type SiblingSortMode =
	| 'fileSize'      // Longer notes → inner orbits
	| 'createdTime'   // Older notes → inner orbits
	| 'modifiedTime'  // Recently modified → inner orbits
	| 'alphabetical'; // A-Z → inner-to-outer

export type OrbitThemeType = 'light' | 'dark' | 'celestial';
export type OrbitDirectionType = 'clockwise' | 'counterclockwise' | 'cross';
export type OrbitParentSourceType = 'frontmatter' | 'tag' | 'outlink' | 'backlink';
export type LineToParentStyle = 'hidden' | 'translucent' | 'solid';
export type OrbitTraceStyle = 'hidden' | 'translucent' | 'solid';

/**
 * Plugin settings persisted to data.json.
 */
export interface OrbitPluginSettings {
	siblingSortMode: SiblingSortMode;
	keplerBaseOmega: number;
	theme: OrbitThemeType;
	orbitDirection: OrbitDirectionType;
	parentSource: OrbitParentSourceType;
	hideLoneNodes: boolean;
	hideLoneStars?: boolean;
	hideSingleParentNodes: boolean;
	hideMultiParentNodes: boolean;
	fadeOtherNodes?: boolean;
	hideOtherNodes?: boolean;
	dualParentOvalOrbit: boolean;
	orbitTraceStyle: OrbitTraceStyle;
	lineToParentStyle: LineToParentStyle;
	orbitRadiusScale: number;
	galaxySize: number;
	gravity?: number;
	galacticRotation: boolean;
	nodeSizeScale: number;
}

export const DEFAULT_SETTINGS: OrbitPluginSettings = {
	siblingSortMode: 'createdTime',
	keplerBaseOmega: 5,
	theme: 'light',
	orbitDirection: 'counterclockwise',
	parentSource: 'frontmatter',
	hideLoneNodes: false,
	hideSingleParentNodes: false,
	hideMultiParentNodes: false,
	fadeOtherNodes: true,
	dualParentOvalOrbit: true,
	orbitTraceStyle: 'translucent',
	lineToParentStyle: 'translucent',
	orbitRadiusScale: 1.5,
	galaxySize: 1.5,
	gravity: 1.0,
	galacticRotation: false,
	nodeSizeScale: 1.0,
};

// ---------------------------------------------------------------------------
// Graph Data Layer
// ---------------------------------------------------------------------------

/**
 * A parsed node derived from a single markdown file's frontmatter.
 *
 * `id` is the file path (unique within the vault) and serves as the primary
 * key throughout the graph. `parents` and `children` store IDs.
 */
export interface GraphNode {
	/** Vault-relative file path (e.g. "folder/My Note.md"). */
	id: string;

	/** File basename without extension — used as the display label. */
	label: string;

	/** Resolved parent node IDs (from `gravity_parent` frontmatter). */
	parents: string[];

	/** Back-reference: IDs of nodes that list this node as a parent. */
	children: string[];

	/** Visual mass from `gravity_mass` frontmatter (default 10). */
	mass: number;

	/** Graph depth — shortest distance from any root. -1 if uncomputed. */
	depth: number;

	// -- File metadata used for sibling sorting --

	/** File size in bytes. */
	fileSize: number;

	/** File creation timestamp (epoch ms). */
	createdTime: number;

	/** File last-modified timestamp (epoch ms). */
	modifiedTime: number;
}

// ---------------------------------------------------------------------------
// Physics / Animation Layer
// ---------------------------------------------------------------------------

/**
 * Per-node runtime state managed by the physics engine.
 * Recalculated every animation frame.
 */
export interface OrbitalState {
	nodeId: string;

	/** Current orbital angle in radians. */
	theta: number;

	/** Angular velocity (radians per second). */
	omega: number;

	/** Orbital radius (distance from parent / centroid). */
	radius: number;

	/** Computed absolute X position in world space. */
	x: number;

	/** Computed absolute Y position in world space. */
	y: number;

	/** Visual radius for rendering (proportional to √mass). */
	renderRadius: number;

	/** Sibling sort index (closeness to parent). */
	siblingIndex?: number;

	/** Maximum depth of this node's solar system. */
	systemMaxDepth?: number;

	/** Recent world position history queue for real-time trajectory trails. */
	trail?: { x: number; y: number }[];
}

// ---------------------------------------------------------------------------
// Camera / Viewport
// ---------------------------------------------------------------------------

/**
 * 2D affine camera transform applied to the canvas.
 * World coordinates are mapped to screen coordinates via:
 *   screenX = (worldX + offsetX) * scale
 *   screenY = (worldY + offsetY) * scale
 */
export interface ViewTransform {
	offsetX: number;
	offsetY: number;
	scale: number;
}

// ---------------------------------------------------------------------------
// Parser Output
// ---------------------------------------------------------------------------

/**
 * The result of parsing the entire vault's frontmatter into a directed graph.
 */
export interface ParsedGraph {
	/** All parsed nodes keyed by their file path. */
	nodes: Map<string, GraphNode>;

	/** IDs of root nodes (nodes with no parents). */
	roots: string[];

	/** Human-readable warnings (cycle detections, missing parents, etc.). */
	warnings: string[];
}
