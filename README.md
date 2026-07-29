# Orbit

**Orbit** is an Obsidian plugin that visualizes your vault as an organized orbital cosmos, modeling your notes as orbiting nodes.


https://github.com/user-attachments/assets/e0af8fb8-a452-4c5b-987f-e62942bc2b92


---

## Features

* **An Organized Orbital Cosmos:** Visualize hierarchical relationships in your vault. Child notds orbit around their parent nodes, forming multi-layered recursive planetary systems.
* **Customization:** Customize the orbit graph's theme, rotation speed, orbit radius, node size and more in the settings panel.
* **Node Focus:** Right-click a node to focus on it. The camera will follow the focused node while dimming unrelated nodes.

---

## Orbit Methods(Sources)

Orbit supports **four** distinct ways to model parent-child links in your vault, customizable directly inside the settings panel:

1. **Frontmatter Metadata:** Specify `gravity_parent: Parent Note` in your note's YAML frontmatter.
2. **Tags:** Turn any tag (e.g., `#ideas`, `#projects`) into a central star! Notes sharing a tag will dynamically orbit around a beautifully rendered. If no notes exist for a specific tag, virtual tag nodes will take its place.
3. **Outlinks:** Automatically model links inside a note (`[[Parent Note]]`) as outbound parental paths.
4. **Backlinks:** Model backlinks from other notes as inbound child pathways.

* If a parent-child relationship forms a cycle, arbitrary edges will be ignored in the orbit view

---

## Settings & Customization

* **Theme:** Select light(white-and-gray like obsidian graph view), dark(black-and-white) and celestial(realistic solar system colors).
* **Sibling Sort Order:** Choose how same-level nodes are arranged (File Size, Created Time, Modified Time, or Alphabetical).
* **Orbit Speed:** Control the velocity of nodes. Uses realistic orbital physics (nodes closer to the center orbit faster).
* **Orbit Radius Scale:** Scale the radius of all orbit ($0.5\text{x} - 2.0\text{x}$).
* **Node Size Scale:** Adjust the sizing of nodes ($0.5\text{x} - 2.0\text{x}$).
* **Galactic Rotation**: Rotate top-level nodes around their centroid so the entire graph resembles one galaxy.
* **Many Seamless Toggles**:
  * Orbit traces
  * parent-child lines
  * lone nodes
  * single-parent nodes
  * multi-parent nodes
  * oval/circle orbit for dual-parent nodes

---

## License

This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.

*Crafted with by [studiogamma](https://github.com/studiogamma).*

## Support

If you find this plugin helpful, consider [supporting the developer](https://ko-fi.com/studiogamma).
