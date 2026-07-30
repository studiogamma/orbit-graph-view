// ============================================================================
// Orbit — Physics & Layout Engine (stub — Phase 2)
// ============================================================================

import { GraphNode, OrbitalState, ParsedGraph, OrbitPluginSettings, DEFAULT_SETTINGS } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_PADDING = 200;

const BASE_NODE_SCALE = 30;
const BASE_ORBIT_SCALE = 240;

// ---------------------------------------------------------------------------
// PhysicsEngine
// ---------------------------------------------------------------------------

export class PhysicsEngine {
	private states: Map<string, OrbitalState> = new Map();
	private graph: ParsedGraph | null = null;
	private settings: OrbitPluginSettings = DEFAULT_SETTINGS;
	private maxDepth: number = 0;
	private systemMaxDepths: Map<string, number> = new Map();
	private orderedNonRootNodeIds: string[] = [];
	private baseRootPositions: Map<string, { x: number; y: number }> = new Map();
	private rootAngles: Map<string, number> = new Map();

	/**
	 * Initialize the engine with a parsed graph.
	 * Computes initial orbital radii, angular velocities, and root positions.
	 */
	initialize(graph: ParsedGraph, settings: OrbitPluginSettings): void {
		this.graph = graph;
		this.settings = settings;
		this.states.clear();
		this.systemMaxDepths.clear();
		this.orderedNonRootNodeIds = [];
		this.rootAngles.clear();

		if (graph.roots.length === 0) return;

		// Calculate maxDepth once
		let maxDepth = 0;
		for (const node of graph.nodes.values()) {
			if (node.depth > maxDepth) {
				maxDepth = node.depth;
			}
		}
		this.maxDepth = maxDepth;

		// Calculate subtree max depth for each root system
		for (const rootId of graph.roots) {
			const subtreeNodes = new Set<string>();
			const queue = [rootId];
			subtreeNodes.add(rootId);

			while (queue.length > 0) {
				const currId = queue.shift()!;
				const currNode = graph.nodes.get(currId);
				if (currNode) {
					for (const childId of currNode.children) {
						if (!subtreeNodes.has(childId)) {
							subtreeNodes.add(childId);
							queue.push(childId);
						}
					}
				}
			}

			let rootMaxDepth = 0;
			for (const nodeId of subtreeNodes) {
				const node = graph.nodes.get(nodeId);
				if (node && node.depth > rootMaxDepth) {
					rootMaxDepth = node.depth;
				}
			}

			for (const nodeId of subtreeNodes) {
				const existing = this.systemMaxDepths.get(nodeId) ?? 0;
				this.systemMaxDepths.set(nodeId, Math.max(existing, rootMaxDepth));
			}
		}

		// -- Place root nodes randomly with overlap prevention ----------------
		this.placeRoots(graph);

		// -- Initialize orbital states for all non-root nodes (BFS order) -----
		this.initializeOrbits(graph);

		// Build ordered list of non-root nodes by depth ascending
		this.orderedNonRootNodeIds = Array.from(graph.nodes.values())
			.filter((node) => node.parents.length > 0)
			.sort((a, b) => a.depth - b.depth)
			.map((node) => node.id);

		// Initial position calculation for all non-root nodes
		for (const nodeId of this.orderedNonRootNodeIds) {
			this.updateNodePosition(nodeId);
		}
	}

	/**
	 * Advance the simulation by `dt` seconds.
	 * Updates θ for every node, then recomputes absolute (x, y) positions.
	 */
	update(dt: number): void {
		if (!this.graph) return;

		if (this.settings.galacticRotation && this.settings.keplerBaseOmega > 0) {
			this.applyGalaxySizeToRoots(dt);
		}

		for (const state of this.states.values()) {
			state.theta += state.omega * dt;
		}

		// Recompute absolute positions in depth order (parents before children)
		for (const nodeId of this.orderedNonRootNodeIds) {
			this.updateNodePosition(nodeId);
		}
	}

	/** Get the current state map (read-only access for the renderer). */
	getStates(): ReadonlyMap<string, OrbitalState> {
		return this.states;
	}

	/**
	 * Update speed, model, orbit radius scale, and node size scale dynamically without resetting root positions or node angles.
	 */
	updatePhysicsParameters(settings: OrbitPluginSettings): void {
		this.settings = settings;
		if (!this.graph) return;

		this.applyGalaxySizeToRoots(0);

		for (const [nodeId, state] of this.states) {
			const node = this.graph.nodes.get(nodeId);
			if (!node) continue;

			const systemMaxDepth = this.systemMaxDepths.get(nodeId) ?? 0;
			const { nodeRadius: relNodeRadius, orbitRadius: relOrbitRadius } = this.getNodeRelativeSizes(node.depth, systemMaxDepth);

			// Update node render size in place
			state.renderRadius = relNodeRadius * BASE_NODE_SCALE * settings.nodeSizeScale;

			if (state.radius <= 0) {
				// Root node, no orbit radius
				continue;
			}

			// Update orbit radius in place
			let baseRadius = relOrbitRadius * BASE_ORBIT_SCALE * settings.orbitRadiusScale;
			const parentId = node.parents[0];
			if (parentId) {
				const parentNode = this.graph.nodes.get(parentId);
				if (parentNode) {
					const siblings = this.sortSiblings(parentNode.children, this.graph);
					const idx = siblings.indexOf(nodeId);
					const N = siblings.length;
					if (N > 1 && idx >= 0) {
						const scale = 0.5 + 1.0 * (idx / (N - 1));
						baseRadius = baseRadius * scale;
					}
				}
			}
			state.radius = baseRadius;

			// Update omega
			let direction = 1;
			if (settings.orbitDirection === 'clockwise') {
				direction = 1;
			} else if (settings.orbitDirection === 'counterclockwise') {
				direction = -1;
			} else {
				// 'cross'
				direction = node.depth % 2 === 0 ? 1 : -1;
			}

			const baseOmega = settings.keplerBaseOmega >= 0 ? settings.keplerBaseOmega : 5;
			state.omega = (state.radius > 0 ? (baseOmega / Math.sqrt(state.radius)) : 0) * direction;
		}

		for (const nodeId of this.orderedNonRootNodeIds) {
			this.updateNodePosition(nodeId);
		}
	}

	// -----------------------------------------------------------------------
	// Root Placement
	// -----------------------------------------------------------------------

	/**
	 * Adjust root node positions based on Galaxy Size scale factor and Keplerian Galactic Rotation.
	 */
	private applyGalaxySizeToRoots(dt: number = 0): void {
		if (this.baseRootPositions.size === 0) return;

		let sumX = 0;
		let sumY = 0;
		for (const pos of this.baseRootPositions.values()) {
			sumX += pos.x;
			sumY += pos.y;
		}
		const centroidX = sumX / this.baseRootPositions.size;
		const centroidY = sumY / this.baseRootPositions.size;

		let galacticDirection = -1;
		if (this.settings.orbitDirection === 'clockwise') {
			galacticDirection = 1;
		} else if (this.settings.orbitDirection === 'counterclockwise') {
			galacticDirection = -1;
		} else {
			// 'cross'
			galacticDirection = -1;
		}

		const scale = this.settings.galaxySize ?? 1.0;

		for (const [rootId, basePos] of this.baseRootPositions) {
			const relX = (basePos.x - centroidX) * scale;
			const relY = (basePos.y - centroidY) * scale;
			const distFromCentroid = Math.hypot(relX, relY);
			const initialAngle = Math.atan2(relY, relX);

			if (dt > 0 && this.settings.galacticRotation && this.settings.keplerBaseOmega > 0) {
				// Kepler's Law for Galactic Rotation: omega is inversely proportional to sqrt(distance)
				const effectiveDist = Math.max(distFromCentroid, 50);
				const baseOmega = this.settings.keplerBaseOmega;
				const rootOmega = (baseOmega / Math.sqrt(effectiveDist)) * galacticDirection;

				let currentAngle = this.rootAngles.get(rootId) ?? 0;
				currentAngle += rootOmega * dt;
				this.rootAngles.set(rootId, currentAngle);
			}

			const rotAngle = this.settings.galacticRotation ? (this.rootAngles.get(rootId) ?? 0) : 0;
			const finalAngle = initialAngle + rotAngle;

			const state = this.states.get(rootId);
			if (state) {
				state.x = centroidX + distFromCentroid * Math.cos(finalAngle);
				state.y = centroidY + distFromCentroid * Math.sin(finalAngle);
			}
		}
	}

	/**
	 * Place root nodes ensuring system roots occupy the inner area and
	 * lone star roots are pushed to the outer edges.
	 */
	private placeRoots(graph: ParsedGraph): void {
		const placed: { x: number; y: number; systemRadius: number }[] = [];
		this.baseRootPositions.clear();

		// Separate roots into system roots (has children) and lone roots (no children)
		const systemRoots: string[] = [];
		const loneRoots: string[] = [];

		for (const rootId of graph.roots) {
			const rootNode = graph.nodes.get(rootId);
			if (!rootNode) continue;
			if (rootNode.children.length > 0) {
				systemRoots.push(rootId);
			} else {
				loneRoots.push(rootId);
			}
		}

		// 1. Place system roots near the center
		for (const rootId of systemRoots) {
			const rootNode = graph.nodes.get(rootId)!;
			const systemRadius = this.estimateSystemRadius(rootNode, graph);
			const systemMaxDepth = this.systemMaxDepths.get(rootId) ?? 0;
			const { nodeRadius: rootRelNodeRadius } = this.getNodeRelativeSizes(rootNode.depth, systemMaxDepth);
			const renderRadius = rootRelNodeRadius * BASE_NODE_SCALE * this.settings.nodeSizeScale;

			let x = 0;
			let y = 0;
			let attempts = 0;
			const maxAttempts = 500;

			let spiralAngle = Math.random() * Math.PI * 2;
			let spiralRadius = 0;

			do {
				if (attempts === 0 && placed.length === 0) {
					x = 0;
					y = 0;
				} else {
					spiralAngle += 0.8;
					spiralRadius += (systemRadius + ROOT_PADDING) * 0.3;
					x = Math.cos(spiralAngle) * spiralRadius;
					y = Math.sin(spiralAngle) * spiralRadius;
				}
				attempts++;
			} while (
				attempts < maxAttempts &&
				this.overlapsAny(x, y, systemRadius, placed)
			);

			placed.push({ x, y, systemRadius });
			this.baseRootPositions.set(rootId, { x, y });

			this.states.set(rootId, {
				nodeId: rootId,
				theta: 0,
				omega: 0,
				radius: 0,
				x,
				y,
				renderRadius,
				siblingIndex: 0,
				systemMaxDepth,
			});
		}

		// Calculate outer boundary for lone roots if system roots were placed
		let outerStartRadius = 0;
		if (placed.length > 0) {
			let maxExtent = 0;
			for (const p of placed) {
				const extent = Math.hypot(p.x, p.y) + p.systemRadius;
				if (extent > maxExtent) maxExtent = extent;
			}
			outerStartRadius = maxExtent + ROOT_PADDING;
		}

		// 2. Place lone star roots along the outer edges
		for (const rootId of loneRoots) {
			const rootNode = graph.nodes.get(rootId)!;
			const systemRadius = this.estimateSystemRadius(rootNode, graph);
			const systemMaxDepth = this.systemMaxDepths.get(rootId) ?? 0;
			const { nodeRadius: rootRelNodeRadius } = this.getNodeRelativeSizes(rootNode.depth, systemMaxDepth);
			const renderRadius = rootRelNodeRadius * BASE_NODE_SCALE * this.settings.nodeSizeScale;

			let x = 0;
			let y = 0;
			let attempts = 0;
			const maxAttempts = 500;

			let spiralAngle = Math.random() * Math.PI * 2;
			let spiralRadius = outerStartRadius;

			do {
				if (attempts === 0 && placed.length === 0) {
					x = 0;
					y = 0;
				} else {
					spiralAngle += 0.6;
					spiralRadius += (systemRadius + ROOT_PADDING * 0.5) * 0.2;
					x = Math.cos(spiralAngle) * spiralRadius;
					y = Math.sin(spiralAngle) * spiralRadius;
				}
				attempts++;
			} while (
				attempts < maxAttempts &&
				this.overlapsAny(x, y, systemRadius, placed)
			);

			placed.push({ x, y, systemRadius });
			this.baseRootPositions.set(rootId, { x, y });

			this.states.set(rootId, {
				nodeId: rootId,
				theta: 0,
				omega: 0,
				radius: 0,
				x,
				y,
				renderRadius,
				siblingIndex: 0,
				systemMaxDepth,
			});
		}

		this.applyGalaxySizeToRoots();
	}

	/**
	 * Check if a circle at (x, y) with the given radius overlaps any
	 * previously placed systems.
	 */
	private overlapsAny(
		x: number,
		y: number,
		radius: number,
		placed: { x: number; y: number; systemRadius: number }[],
	): boolean {
		for (const p of placed) {
			const dx = x - p.x;
			const dy = y - p.y;
			const minDist = radius + p.systemRadius + ROOT_PADDING;
			if (dx * dx + dy * dy < minDist * minDist) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Estimate the maximum orbital radius of a root's entire subtree.
	 */
	public estimateSystemRadius(
		rootNode: GraphNode,
		graph: ParsedGraph,
	): number {
		const systemMaxDepth = this.systemMaxDepths.get(rootNode.id) ?? 0;
		const { nodeRadius: rootRelNodeRadius } = this.getNodeRelativeSizes(rootNode.depth, systemMaxDepth);
		let maxRadius = rootRelNodeRadius * BASE_NODE_SCALE * this.settings.nodeSizeScale;

		const visit = (nodeId: string, accumulatedRadius: number): void => {
			const node = graph.nodes.get(nodeId);
			if (!node) return;

			const childCount = node.children.length;
			for (let i = 0; i < childCount; i++) {
				const childId = node.children[i]!;
				const childNode = graph.nodes.get(childId);
				if (!childNode) continue;

				const { orbitRadius: childRelOrbitRadius } = this.getNodeRelativeSizes(childNode.depth, systemMaxDepth);
				let childRadius = childRelOrbitRadius * BASE_ORBIT_SCALE * this.settings.orbitRadiusScale;
				if (childCount > 1) {
					childRadius = childRadius * 1.5; // Estimate maximum possible expanded radius (max sibling scale)
				}
				const total = accumulatedRadius + childRadius;
				if (total > maxRadius) maxRadius = total;

				visit(childId, total);
			}
		};

		visit(rootNode.id, 0);
		return maxRadius;
	}

	// -----------------------------------------------------------------------
	// Orbital Initialization
	// -----------------------------------------------------------------------

	/**
	 * Initialize orbital state for every non-root node in BFS order.
	 * Siblings are sorted according to the current sortMode.
	 */
	private initializeOrbits(graph: ParsedGraph): void {
		const queue = [...graph.roots];
		const visited = new Set<string>(graph.roots);

		while (queue.length > 0) {
			const parentId = queue.shift()!;
			const parentNode = graph.nodes.get(parentId);
			if (!parentNode) continue;

			// Sort children according to the current mode.
			const sortedChildren = this.sortSiblings(parentNode.children, graph);

			for (let i = 0; i < sortedChildren.length; i++) {
				const childId = sortedChildren[i]!;
				if (visited.has(childId)) continue;
				visited.add(childId);

				const childNode = graph.nodes.get(childId);
				if (!childNode) continue;

				const systemMaxDepth = this.systemMaxDepths.get(childId) ?? 0;
				const { nodeRadius: childRelNodeRadius, orbitRadius: childRelOrbitRadius } = this.getNodeRelativeSizes(childNode.depth, systemMaxDepth);
				
				let radius = childRelOrbitRadius * BASE_ORBIT_SCALE * this.settings.orbitRadiusScale;
				const N = sortedChildren.length;
				if (N > 1) {
					const scale = 0.5 + 1.0 * (i / (N - 1));
					radius = radius * scale;
				}
				let direction = 1;
				if (this.settings.orbitDirection === 'clockwise') {
					direction = 1;
				} else if (this.settings.orbitDirection === 'counterclockwise') {
					direction = -1;
				} else {
					// 'cross'
					direction = childNode.depth % 2 === 0 ? 1 : -1;
				}

				const baseOmega = this.settings.keplerBaseOmega >= 0 ? this.settings.keplerBaseOmega : 5;
				const omega = (radius > 0 ? (baseOmega / Math.sqrt(radius)) : 0) * direction;

				const theta = Math.random() * Math.PI * 2;
				const renderRadius = childRelNodeRadius * BASE_NODE_SCALE * this.settings.nodeSizeScale;

				this.states.set(childId, {
					nodeId: childId,
					theta,
					omega,
					radius,
					x: 0,
					y: 0,
					renderRadius,
					siblingIndex: i,
					systemMaxDepth,
				});

				queue.push(childId);
			}
		}
	}

	/**
	 * Sort a list of sibling node IDs based on the active sort mode.
	 * Returns a new sorted array (does not mutate the original).
	 */
	private sortSiblings(childIds: string[], graph: ParsedGraph): string[] {
		const sorted = [...childIds];
		sorted.sort((a, b) => {
			const na = graph.nodes.get(a);
			const nb = graph.nodes.get(b);
			if (!na || !nb) return 0;

			switch (this.settings.siblingSortMode) {
				case 'fileSize':
					// Larger files → inner orbit (sort descending).
					return nb.fileSize - na.fileSize;
				case 'createdTime':
					// Older files → inner orbit (sort ascending by ctime).
					return na.createdTime - nb.createdTime;
				case 'modifiedTime':
					// Recently modified → inner orbit (sort descending by mtime).
					return nb.modifiedTime - na.modifiedTime;
				case 'alphabetical':
					// A-Z → inner-to-outer (sort ascending).
					return na.label.localeCompare(nb.label);
				default:
					return 0;
			}
		});
		return sorted;
	}

	/**
	 * Compute relative node radius and orbit radius based on the graph's maximum depth
	 * and the node's depth/generation.
	 */
	private getNodeRelativeSizes(depth: number, maxDepth: number, nodeId?: string): { nodeRadius: number; orbitRadius: number } {
		if (nodeId && nodeId.startsWith('virtual-tag:')) {
			return { nodeRadius: 1.0, orbitRadius: 0 };
		}

		const d = Math.max(0, depth);

		if (maxDepth === 0) {
			// [maxDepth = 0]
			// Depth 0 노드 - Type 3-A (독립 노드), 노드 반지름: 0.7, 궤도 반지름: 0
			return { nodeRadius: 0.7, orbitRadius: 0 };
		} else if (maxDepth === 1) {
			// [maxDepth = 1]
			// Depth 0 노드 - Type 3, 노드 반지름: 1, 궤도 반지름: 0
			// Depth 1 노드 - Type 4, 노드 반지름: 1/2 (0.5), 궤도 반지름: 1
			if (d === 0) return { nodeRadius: 1, orbitRadius: 0 };
			return { nodeRadius: 0.5, orbitRadius: 1 };
		} else if (maxDepth === 2) {
			// [maxDepth = 2]
			// Depth 0 노드 - Type 3, 노드 반지름: 1, 궤도 반지름: 0
			// Depth 1 노드 - Type 4, 노드 반지름: 1/2 (0.5), 궤도 반지름: 1
			// Depth 2 노드 - Type 5, 노드 반지름: 1/4 (0.25), 궤도 반지름: 1/3
			if (d === 0) return { nodeRadius: 1, orbitRadius: 0 };
			if (d === 1) return { nodeRadius: 0.5, orbitRadius: 1 };
			return { nodeRadius: 0.25, orbitRadius: 1 / 3 };
		} else if (maxDepth === 3) {
			// [maxDepth = 3]
			// Depth 0 노드 - Type 2, 노드 반지름: 2, 궤도 반지름: 0
			// Depth 1 노드 - Type 3, 노드 반지름: 1, 궤도 반지름: 3
			// Depth 2 노드 - Type 4, 노드 반지름: 1/2 (0.5), 궤도 반지름: 1
			// Depth 3 노드 - Type 5, 노드 반지름: 1/4 (0.25), 궤도 반지름: 1/3
			if (d === 0) return { nodeRadius: 2, orbitRadius: 0 };
			if (d === 1) return { nodeRadius: 1, orbitRadius: 3 };
			if (d === 2) return { nodeRadius: 0.5, orbitRadius: 1 };
			return { nodeRadius: 0.25, orbitRadius: 1 / 3 };
		} else {
			// [maxDepth >= 4]
			// Depth 0 노드 - Type 1, 노드 반지름: 4, 궤도 반지름: 0
			// Depth 1 노드 - Type 2, 노드 반지름: 2, 궤도 반지름: 9
			// Depth 2 노드 - Type 3, 노드 반지름: 1, 궤도 반지름: 3
			// Depth 3 노드 - Type 4, 노드 반지름: 1/2 (0.5), 궤도 반지름: 1
			// Depth 4 이상 노드 - Type 5, 노드 반지름: 1/4 (0.25), 궤도 반지름: 1/3 (d가 증가할수록 노드반지름 1/2, 궤도반지름 1/3)
			if (d === 0) return { nodeRadius: 4, orbitRadius: 0 };
			const nodeRadius = 4 * Math.pow(0.5, d);
			const orbitRadius = 9 * Math.pow(1 / 3, d - 1);
			return { nodeRadius, orbitRadius };
		}
	}

	// -----------------------------------------------------------------------
	// Position Update (N=1, N=2 Ellipse, N>=3 Centroid)
	// -----------------------------------------------------------------------

	/**
	 * Compute absolute (x, y) position for a single node based on parent count:
	 * - N=1: Circle around parent node
	 * - N=2: Rotated ellipse around midpoint of P1 & P2
	 * - N>=3: Circle around centroid of P1..Pn extending past farthest parent
	 */
	private updateNodePosition(nodeId: string): void {
		const node = this.graph?.nodes.get(nodeId);
		const state = this.states.get(nodeId);
		if (!node || !state) return;

		const numParents = node.parents.length;
		if (numParents === 0) return; // Root node position is fixed in place

		if (numParents === 1) {
			const parentState = this.states.get(node.parents[0]!);
			if (parentState) {
				state.x = parentState.x + state.radius * Math.cos(state.theta);
				state.y = parentState.y + state.radius * Math.sin(state.theta);
			}
		} else if (numParents === 2) {
			const ps1 = this.states.get(node.parents[0]!);
			const ps2 = this.states.get(node.parents[1]!);
			if (ps1 && ps2) {
				const cx = (ps1.x + ps2.x) / 2;
				const cy = (ps1.y + ps2.y) / 2;
				const dx = ps2.x - ps1.x;
				const dy = ps2.y - ps1.y;
				const d = Math.sqrt(dx * dx + dy * dy);

				if (this.settings.dualParentOvalOrbit ?? true) {
					const phi = Math.atan2(dy, dx);
					const a = d / 2 + state.radius;
					const b = a * 0.6;

					const xUnrotated = a * Math.cos(state.theta);
					const yUnrotated = b * Math.sin(state.theta);

					state.x = cx + xUnrotated * Math.cos(phi) - yUnrotated * Math.sin(phi);
					state.y = cy + xUnrotated * Math.sin(phi) + yUnrotated * Math.cos(phi);
				} else {
					const orbitRadius = d / 2 + state.radius;
					state.x = cx + orbitRadius * Math.cos(state.theta);
					state.y = cy + orbitRadius * Math.sin(state.theta);
				}
			} else {
				const ps = ps1 || ps2;
				if (ps) {
					state.x = ps.x + state.radius * Math.cos(state.theta);
					state.y = ps.y + state.radius * Math.sin(state.theta);
				}
			}
		} else {
			// numParents >= 3
			let sumX = 0;
			let sumY = 0;
			const validParents: OrbitalState[] = [];
			for (const pid of node.parents) {
				const ps = this.states.get(pid);
				if (ps) {
					sumX += ps.x;
					sumY += ps.y;
					validParents.push(ps);
				}
			}

			if (validParents.length > 0) {
				const cx = sumX / validParents.length;
				const cy = sumY / validParents.length;

				let maxDist = 0;
				for (const ps of validParents) {
					const dist = Math.hypot(ps.x - cx, ps.y - cy);
					if (dist > maxDist) maxDist = dist;
				}

				const orbitRadius = maxDist + state.radius;
				state.x = cx + orbitRadius * Math.cos(state.theta);
				state.y = cy + orbitRadius * Math.sin(state.theta);
			}
		}
	}
}
