# Orbit

**Orbit** is a premium, interactive Obsidian plugin that visualizes your vault as a dynamic, recursive planetary system. Unlike standard network graphs, Orbit models your notes as stars and orbiting planets based on parent-child relationships, transforming your knowledge base into an elegant personal cosmos.

---

## ✨ Features

* **Recursive Solar Systems:** Visualize hierarchical relationships in your notes. Child notes dynamically orbit around their parent notes, forming deep, multi-layered planetary systems.
* **Vibrant Cosmic Themes:**
  * **Celestial:** A premium default theme featuring realistic Solar System colors (Earth, Jupiter, Saturn, and Neptune palettes) that brings your workspace to life.
  * **Dark & Light:** Sleek, minimalist black-and-white or high-contrast grey styles that blend seamlessly with your native Obsidian setup.
* **Interactive Controls Overlay:** A glassmorphic, collapsible settings panel floats directly over the canvas, mirroring Obsidian's native UI look and feel.
* **Real-time Live Parameter Updating:** Tweak speed, spacing, sizing, or toggle filters instantly. Modifications are computed in-place without resetting note coordinates or causing jarring camera jumps.
* **Smart Camera Tracking:** Automatically ranks all systems by size, complexity, and file size to focus and scale perfectly on the most significant note constellation upon load.

---

## 🪐 Multiple Relation Sources

Orbit supports **four** distinct ways to model parent-child links in your vault, customizable directly inside the settings panel:

1. **Frontmatter Metadata:** Specify `gravity_parent: Parent Note` in your note's YAML frontmatter.
2. **Tags:** Turn any tag (e.g., `#ideas`, `#projects`) into a central star! Notes sharing a tag will dynamically orbit around a beautifully rendered, glowing **Virtual Tag Node** (`#A259FF` Neon Purple).
3. **Outlinks:** Automatically model links inside a note (`[[Parent Note]]`) as outbound parental paths.
4. **Backlinks:** Model backlinks from other notes as inbound child pathways.

---

## 🎛️ Settings & Customizability

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

## 🛠️ Development

If you want to build or contribute to Orbit locally:

1. Clone this repository:
   ```bash
   git clone https://github.com/studiogamma/orbit-graph-view.git
   cd orbit-graph-view
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the plugin in production mode:
   ```bash
   npm run build
   ```
4. For active development with hot-reloading:
   ```bash
   npm run dev
   ```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.

*Crafted with by [studiogamma](https://github.com/studiogamma).*
