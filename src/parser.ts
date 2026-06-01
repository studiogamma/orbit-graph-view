// ============================================================================
// Orbit — Vault Metadata Parser
// ============================================================================
//
// Scans every markdown file in the vault, extracts `gravity_parent` and
// `gravity_mass` from YAML frontmatter, resolves parent references, detects
// cycles via DFS, and outputs a clean ParsedGraph ready for the physics engine.
// ============================================================================

import { App, TFile } from 'obsidian';
import { GraphNode, ParsedGraph, OrbitPluginSettings } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the entire vault and build a directed graph from frontmatter metadata.
 *
 * Resolution rules for `gravity_parent`:
 * - Values are matched against file **basenames** (case-insensitive, ".md" optional).
 * - If multiple files share the same basename, the first match wins and a
 *   warning is emitted.
 * - Unresolved parent references are silently dropped with a warning.
 *
 * @param app - The Obsidian App instance (used for vault + metadataCache access).
 * @returns A fully resolved {@link ParsedGraph}.
 */
export function parseVault(app: App, settings: OrbitPluginSettings): ParsedGraph {
	const warnings: string[] = [];
	const files = app.vault.getMarkdownFiles();

	// -- Step 1: Build a basename → filePath lookup for parent resolution ----
	const basenameLookup = buildBasenameLookup(files, warnings);

	// -- Step 2: Create raw GraphNode for every markdown file ----------------
	const nodes = new Map<string, GraphNode>();

	for (const file of files) {
		const node = buildNode(app, file, basenameLookup, warnings, settings);
		nodes.set(node.id, node);
	}

	// Add virtual nodes for any parent IDs starting with 'virtual-tag:'
	for (const node of [...nodes.values()]) {
		for (const parentId of node.parents) {
			if (parentId.startsWith('virtual-tag:') && !nodes.has(parentId)) {
				const tagName = parentId.substring('virtual-tag:'.length);
				nodes.set(parentId, {
					id: parentId,
					label: `#${tagName}`,
					parents: [],
					children: [],
					mass: 15, // Make virtual tags slightly more massive so they act like central stars
					depth: -1,
					fileSize: 0,
					createdTime: Date.now(),
					modifiedTime: Date.now(),
				});
			}
		}
	}

	// -- Step 3: Wire up children (reverse links) ---------------------------
	for (const node of nodes.values()) {
		for (const parentId of node.parents) {
			const parent = nodes.get(parentId);
			if (parent && !parent.children.includes(node.id)) {
				parent.children.push(node.id);
			}
		}
	}
	// -- Step 4: Detect and break cycles (DFS) ------------------------------
	removeCycles(nodes, warnings);

	// -- Step 5: Compute depths (BFS from roots) ----------------------------
	const roots = computeDepths(nodes);

	return { nodes, roots, warnings };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Build a case-insensitive basename → file-path index.
 * If two files share a basename we keep the first and warn.
 */
function buildBasenameLookup(
	files: TFile[],
	warnings: string[],
): Map<string, string> {
	const lookup = new Map<string, string>();

	for (const file of files) {
		const key = file.basename.toLowerCase();
		if (lookup.has(key)) {
			warnings.push(
				`[Orbit] Duplicate basename "${file.basename}": ` +
				`"${lookup.get(key)!}" takes precedence over "${file.path}".`,
			);
		} else {
			lookup.set(key, file.path);
		}
	}

	return lookup;
}

/**
 * Extract frontmatter from a single file and produce a GraphNode.
 */
function buildNode(
	app: App,
	file: TFile,
	basenameLookup: Map<string, string>,
	warnings: string[],
	settings: OrbitPluginSettings,
): GraphNode {
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter;

	// -- gravity_mass -------------------------------------------------------
	let mass = 10;
	if (fm && typeof fm['gravity_mass'] === 'number' && fm['gravity_mass'] > 0) {
		mass = fm['gravity_mass'];
	}

	// -- gravity_parent / tag / outlink / backlink ---------------------------
	const rawParents: string[] = [];
	const source = settings.parentSource || 'frontmatter';

	if (source === 'frontmatter') {
		const fmParents = normalizeToStringArray(fm?.['gravity_parent']);
		rawParents.push(...fmParents);
	} else if (source === 'tag') {
		const tags: string[] = [];
		if (cache?.tags) {
			for (const t of cache.tags) {
				const cleanTag = t.tag.replace(/^#/, '');
				if (cleanTag && !tags.includes(cleanTag)) {
					tags.push(cleanTag);
				}
			}
		}
		if (fm) {
			const fmTags = normalizeToStringArray(fm.tags).concat(normalizeToStringArray(fm.tag));
			for (const t of fmTags) {
				const cleanTag = t.replace(/^#/, '');
				if (cleanTag && !tags.includes(cleanTag)) {
					tags.push(cleanTag);
				}
			}
		}

		for (const tag of tags) {
			if (basenameLookup.has(tag.toLowerCase())) {
				rawParents.push(tag);
			} else {
				// Resolve directly to virtual-tag ID without warning!
				const virtualId = `virtual-tag:${tag.toLowerCase()}`;
				if (!rawParents.includes(virtualId)) {
					rawParents.push(virtualId);
				}
			}
		}
	} else if (source === 'outlink') {
		const targetPaths = Object.keys(app.metadataCache.resolvedLinks[file.path] ?? {});
		for (const targetPath of targetPaths) {
			const basename = targetPath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
			if (basename && !rawParents.includes(basename)) {
				rawParents.push(basename);
			}
		}
	} else if (source === 'backlink') {
		const resolvedLinks = app.metadataCache.resolvedLinks;
		for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
			if (targets[file.path] !== undefined) {
				const basename = sourcePath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
				if (basename && !rawParents.includes(basename)) {
					rawParents.push(basename);
				}
			}
		}
	}

	// Filter out virtual tags before resolveParents, then add them back to resolvedParents!
	const virtualParents = rawParents.filter(p => p.startsWith('virtual-tag:'));
	const standardRawParents = rawParents.filter(p => !p.startsWith('virtual-tag:'));

	const resolvedParents = resolveParents(
		standardRawParents,
		file.path,
		basenameLookup,
		warnings,
	);

	resolvedParents.push(...virtualParents);

	return {
		id: file.path,
		label: file.basename,
		parents: resolvedParents,
		children: [],
		mass,
		depth: -1,
		fileSize: file.stat.size,
		createdTime: file.stat.ctime,
		modifiedTime: file.stat.mtime,
	};
}

/**
 * Normalize a frontmatter value to a string array.
 * Handles: undefined, string, string[], or other (ignored).
 */
function normalizeToStringArray(value: unknown): string[] {
	if (value == null) return [];
	if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
	if (Array.isArray(value)) {
		return value
			.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
			.map((v) => v.trim());
	}
	return [];
}

/**
 * Resolve raw parent name strings to file paths using the basename lookup.
 * Returns only IDs that actually exist in the vault.
 */
function resolveParents(
	rawNames: string[],
	selfPath: string,
	lookup: Map<string, string>,
	warnings: string[],
): string[] {
	const resolved: string[] = [];

	for (const raw of rawNames) {
		// Strip trailing ".md" if present, then lowercase for lookup.
		const key = raw.replace(/\.md$/i, '').toLowerCase();
		const parentPath = lookup.get(key);

		if (!parentPath) {
			warnings.push(
				`[Orbit] "${selfPath}": parent "${raw}" not found in vault.`,
			);
			continue;
		}

		if (parentPath === selfPath) {
			warnings.push(
				`[Orbit] "${selfPath}": self-reference in gravity_parent ignored.`,
			);
			continue;
		}

		if (!resolved.includes(parentPath)) {
			resolved.push(parentPath);
		}
	}

	return resolved;
}

// ---------------------------------------------------------------------------
// Cycle Detection (DFS with 3-coloring)
// ---------------------------------------------------------------------------

const enum Color {
	White = 0, // unvisited
	Gray = 1,  // currently in the DFS stack (visiting)
	Black = 2, // fully processed
}

/**
 * Detect cycles via DFS. When a back-edge is found (Gray → Gray), the edge
 * is removed from both `node.parents` and `parent.children`, and a warning
 * is logged. This guarantees the resulting graph is a DAG.
 */
function removeCycles(
	nodes: Map<string, GraphNode>,
	warnings: string[],
): void {
	const color = new Map<string, Color>();

	for (const id of nodes.keys()) {
		color.set(id, Color.White);
	}

	for (const id of nodes.keys()) {
		if (color.get(id) === Color.White) {
			dfsCycleDetect(id, nodes, color, warnings);
		}
	}
}

/**
 * Recursive DFS traversal following **parent → child** edges.
 * When we encounter a Gray node, it means we've found a cycle.
 */
function dfsCycleDetect(
	nodeId: string,
	nodes: Map<string, GraphNode>,
	color: Map<string, Color>,
	warnings: string[],
): void {
	color.set(nodeId, Color.Gray);
	const node = nodes.get(nodeId);
	if (!node) return;

	// Traverse children (i.e. nodes that list `nodeId` as a parent).
	// We iterate over a copy because we may mutate the array.
	const childrenSnapshot = [...node.children];

	for (const childId of childrenSnapshot) {
		const childColor = color.get(childId);

		if (childColor === Color.Gray) {
			// Back-edge detected → break the cycle by removing this link.
			warnings.push(
				`[Orbit] Cycle detected: "${nodeId}" ↔ "${childId}". ` +
				`Removing "${childId}" → "${nodeId}" parent link.`,
			);
			removeEdge(nodes, childId, nodeId);
		} else if (childColor === Color.White) {
			dfsCycleDetect(childId, nodes, color, warnings);
		}
		// Black nodes are fully processed — skip.
	}

	color.set(nodeId, Color.Black);
}

/**
 * Remove the directed edge: `childId` → `parentId`.
 * Updates both the child's `parents` array and the parent's `children` array.
 */
function removeEdge(
	nodes: Map<string, GraphNode>,
	childId: string,
	parentId: string,
): void {
	const child = nodes.get(childId);
	const parent = nodes.get(parentId);

	if (child) {
		child.parents = child.parents.filter((p) => p !== parentId);
	}
	if (parent) {
		parent.children = parent.children.filter((c) => c !== childId);
	}
}

// ---------------------------------------------------------------------------
// Depth Computation (BFS)
// ---------------------------------------------------------------------------

/**
 * Compute graph depth for every node via BFS starting from root nodes
 * (nodes with no parents after cycle removal).
 *
 * Multi-parent nodes receive the **minimum** depth among their parents + 1.
 *
 * @returns Array of root node IDs.
 */
function computeDepths(nodes: Map<string, GraphNode>): string[] {
	const roots: string[] = [];

	// Identify roots.
	for (const [id, node] of nodes) {
		if (node.parents.length === 0) {
			node.depth = 0;
			roots.push(id);
		}
	}

	// BFS queue seeded with roots.
	const queue: string[] = [...roots];

	while (queue.length > 0) {
		const currentId = queue.shift()!;
		const current = nodes.get(currentId);
		if (!current) continue;

		for (const childId of current.children) {
			const child = nodes.get(childId);
			if (!child) continue;

			const proposedDepth = current.depth + 1;

			if (child.depth === -1 || proposedDepth < child.depth) {
				child.depth = proposedDepth;
				queue.push(childId);
			}
		}
	}

	// Safety: any node still at depth -1 is unreachable (orphaned after cycle
	// breaking). Treat them as roots at depth 0.
	for (const node of nodes.values()) {
		if (node.depth === -1) {
			node.depth = 0;
			roots.push(node.id);
		}
	}

	return roots;
}
