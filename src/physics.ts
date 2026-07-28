// ============================================================================
// Orbit — Physics & Layout Engine (stub — Phase 2)
// ============================================================================

import { GraphNode, OrbitalState, SiblingSortMode, ParsedGraph, OrbitPluginSettings, DEFAULT_SETTINGS } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_RADIUS = 80;
const MASS_SCALE = 5;
const SIBLING_SPACING = 40;
const BASE_OMEGA = 2;
const ROOT_PADDING = 200;
const NODE_RENDER_SCALE = 3;

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

	/**
	 * Initialize the engine with a parsed graph.
	 * Computes initial orbital radii, angular velocities, and root positions.
	 */
	initialize(graph: ParsedGraph, settings: OrbitPluginSettings): void {
		this.graph = graph;
		this.settings = settings;
		this.states.clear();
		this.systemMaxDepths.clear();

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
	}

	/**
	 * Advance the simulation by `dt` seconds.
	 * Updates θ for every node, then recomputes absolute (x, y) positions
	 * recursively from roots downward.
	 */
	update(dt: number): void {
		if (!this.graph) return;

		for (const state of this.states.values()) {
			state.theta += state.omega * dt;
		}

		// Recompute absolute positions starting from roots.
		for (const rootId of this.graph.roots) {
			this.updatePositionsRecursive(rootId);
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
	}

	// -----------------------------------------------------------------------
	// Root Placement
	// -----------------------------------------------------------------------

	/**
	 * Place root nodes at random positions ensuring no two solar systems
	 * overlap. Each root's "system radius" is estimated as the maximum
	 * orbital extent of its deepest descendants.
	 */
	private placeRoots(graph: ParsedGraph): void {
		const placed: { x: number; y: number; systemRadius: number }[] = [];

		for (const rootId of graph.roots) {
			const rootNode = graph.nodes.get(rootId);
			if (!rootNode) continue;

			const systemRadius = this.estimateSystemRadius(rootNode, graph);
			const systemMaxDepth = this.systemMaxDepths.get(rootId) ?? 0;
			const { nodeRadius: rootRelNodeRadius } = this.getNodeRelativeSizes(rootNode.depth, systemMaxDepth);
			const renderRadius = rootRelNodeRadius * BASE_NODE_SCALE * this.settings.nodeSizeScale;

			let x = 0;
			let y = 0;
			let attempts = 0;
			const maxAttempts = 500;

			// Spiral-out placement to guarantee convergence.
			let spiralAngle = Math.random() * Math.PI * 2;
			let spiralRadius = 0;

			do {
				if (attempts === 0 && placed.length === 0) {
					// First root at origin.
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
	private getNodeRelativeSizes(depth: number, maxDepth: number): { nodeRadius: number; orbitRadius: number } {
		const d = Math.max(0, depth);

		if (maxDepth === 0) {
			// [노드 1개]
			// 최상위 노드 - 노드 반지름: 45px (상대적 반지름 0.75)
			return { nodeRadius: 0.75, orbitRadius: 0 };
		} else if (maxDepth === 1) {
			// [노드 2개]
			// 최상위 노드 - Type 3, 노드 반지름: 1
			// 1세대 노드 - Type 4, 노드 반지름: 1/2, 궤도 반지름: 1
			if (d === 0) return { nodeRadius: 1, orbitRadius: 0 };
			return { nodeRadius: 0.5, orbitRadius: 1 };
		} else if (maxDepth === 2) {
			// [노드 3개]
			// 최상위 노드 - Type 3, 노드 반지름: 1
			// 1세대 노드 - Type 4, 노드 반지름: 1/2, 궤도 반지름: 1
			// 2세대 노드 - Type 5, 노드 반지름: 1/4, 궤도 반지름: 1/3
			if (d === 0) return { nodeRadius: 1, orbitRadius: 0 };
			if (d === 1) return { nodeRadius: 0.5, orbitRadius: 1 };
			return { nodeRadius: 0.25, orbitRadius: 1 / 3 };
		} else if (maxDepth === 3) {
			// [노드 4개]
			// 최상위 노드 - Type 2, 노드 반지름: 2
			// 1세대 노드 - Type 3, 노드 반지름: 1, 궤도 반지름: 3
			// 2세대 노드 - Type 4, 노드 반지름: 1/2, 궤도 반지름: 1
			// 3세대 노드 - Type 5, 노드 반지름: 1/4, 궤도 반지름: 1/3
			if (d === 0) return { nodeRadius: 2, orbitRadius: 0 };
			if (d === 1) return { nodeRadius: 1, orbitRadius: 3 };
			if (d === 2) return { nodeRadius: 0.5, orbitRadius: 1 };
			return { nodeRadius: 0.25, orbitRadius: 1 / 3 };
		} else {
			// [노드 5개 이상] (maxDepth >= 4)
			// 최상위 노드 - Type 1, 노드 반지름: 3 (예외적으로 3으로 축소)
			// 1세대 노드 - Type 2, 노드 반지름: 2, 궤도 반지름: 9
			// 2세대 노드 - Type 3, 노드 반지름: 1, 궤도 반지름: 3
			// 3세대 노드 - Type 4, 노드 반지름: 1/2, 궤도 반지름: 1
			// 4세대 노드 - Type 5, 노드 반지름: 1/4, 궤도 반지름: 1/3
			// (5세대 노드부터는 이전 세대 노드의 1/2 크기. 궤도 반지름 1/3으로 작아짐. 5세대는 Type 6 반지름 1/8 및 궤도 반지름 1/9...)
			if (d === 0) return { nodeRadius: 3, orbitRadius: 0 };
			const nodeRadius = 4 * Math.pow(0.5, d);
			const orbitRadius = 9 * Math.pow(1 / 3, d - 1);
			return { nodeRadius, orbitRadius };
		}
	}

	// -----------------------------------------------------------------------
	// Position Update (Recursive)
	// -----------------------------------------------------------------------

	/**
	 * Recursively compute absolute (x, y) positions for `nodeId` and all
	 * of its descendants.
	 */
	private updatePositionsRecursive(nodeId: string): void {
		const node = this.graph?.nodes.get(nodeId);
		const state = this.states.get(nodeId);
		if (!node || !state) return;

		for (const childId of node.children) {
			const childNode = this.graph?.nodes.get(childId);
			const childState = this.states.get(childId);
			if (!childNode || !childState) continue;

			// Determine the center of orbit.
			let cx: number;
			let cy: number;

			if (childNode.parents.length >= 2) {
				// Multi-parent centroid.
				let sumX = 0;
				let sumY = 0;
				let count = 0;
				for (const pid of childNode.parents) {
					const ps = this.states.get(pid);
					if (ps) {
						sumX += ps.x;
						sumY += ps.y;
						count++;
					}
				}
				cx = count > 0 ? sumX / count : state.x;
				cy = count > 0 ? sumY / count : state.y;
			} else {
				cx = state.x;
				cy = state.y;
			}

			childState.x = cx + childState.radius * Math.cos(childState.theta);
			childState.y = cy + childState.radius * Math.sin(childState.theta);

			// Recurse into this child's subtree.
			this.updatePositionsRecursive(childId);
		}
	}
}
