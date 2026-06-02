# Orbit

**Orbit** is an interactive Obsidian plugin that visualizes your vault as a recursive and organized planetary system. Unlike standard graph view, Orbit can model your notes as orbiting nodes and transform your vault into a dynamic living cosmos.


https://github.com/user-attachments/assets/e0af8fb8-a452-4c5b-987f-e62942bc2b92


---

## ✨ Features

* **Recursive Solar Systems:** Visualize hierarchical relationships in your notes. Child notes dynamically orbit around their parent notes, forming multi-layered planetary systems.
* **Celestial Theme:** A theme featuring realistic Solar System colors.
* **Dark Theme & Light Theme:** Minimal black-and-white styles.
* **Overlay Setting Panel:** A collapsible settings panel floats over the orbit view.

---

## 🪐 Multiple Relation Sources

Orbit supports **four** distinct ways to model parent-child links in your vault, customizable directly inside the settings panel:

1. **Frontmatter Metadata:** Specify `gravity_parent: Parent Note` in your note's YAML frontmatter.
2. **Tags:** Turn any tag (e.g., `#ideas`, `#projects`) into a central star! Notes sharing a tag will dynamically orbit around a beautifully rendered. If no notes exist for a specific tag, virtual tag nodes will take its place.
3. **Outlinks:** Automatically model links inside a note (`[[Parent Note]]`) as outbound parental paths.
4. **Backlinks:** Model backlinks from other notes as inbound child pathways.

* While a single node having multiple parent nodes is technically allowed, it is not recommended. 
* If a parent-child relationship forms a cycle, arbitrary edges will be ignored in the orbit view

---

## ⚙️ Settings & Customizability

* **Kepler Speed (BASE_OMEGA):** Control the velocity of your planets. Uses realistic distance-dependent orbital physics—notes closer to the center orbit faster, while outer planets glide gracefully at a slower speed.
* **Sibling Sort Order:** Choose how sibling planets in the same orbit layer are sorted (File Size, Created Time, Modified Time, or Alphabetical).
* **Concentric Orbit Paths:** Sibling nodes are intelligently distributed on separate, non-overlapping concentric rings (from $0.5\text{x}$ to $1.5\text{x}$ scale) to prevent visual overlapping.
* **Custom Sizing Sliders:**
  * **Orbit Radius Scale:** Scale the radius of all orbit paths ($0.5\text{x} - 2.0\text{x}$).
  * **Node Size Scale:** Adjust the sizing of stars and planets ($0.5\text{x} - 2.0\text{x}$).
* **Seamless Visual Toggles:**
  * **Hide Lone Stars:** Toggle whether isolated nodes (with no parents or children) are filtered out, processed instantly in the draw loop without resets.
  * **Hide Orbit Trace:** Hide or show the circular path trails.
  * **Hide Line to Parent:** Hide or show the parent-child gravitational connection lines.

---

## 🚀 Installation

### Option 1: Via Community Plugins (Pending Store Approval)
1. Open Obsidian **Settings** > **Community Plugins**.
2. Turn on community plugins.
3. Search for **Orbit** and click **Install**.
4. Enable the plugin in your settings.

### Option 2: Manual Installation
1. Go to the [Releases](https://github.com/studiogamma/orbit-graph-view/releases) page of this repository.
2. Download the three files from the latest release: `main.js`, `manifest.json`, and `styles.css`.
3. Open your vault's plugin directory: `<your-vault>/.obsidian/plugins/` (create the `plugins` folder if it doesn't exist).
4. Create a folder named `orbit` and paste the three files inside it.
5. Restart Obsidian, go to **Community Plugins**, and turn on **Orbit**.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.

*Crafted with by [studiogamma](https://github.com/studiogamma).*

## ☕ Support

If you find this plugin helpful, consider [supporting the developer](https://ko-fi.com/studiogamma).
