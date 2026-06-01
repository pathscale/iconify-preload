# RSBuild Plugin Iconify

A RSBuild plugin that automatically generates optimized CSS with embedded SVG icons from Iconify.

## Features

- 🚀 Automatically scan your code for icon usage
- 🎯 Generate optimized SVG data URIs for icons
- 🔄 Include complete icon sets or only used icons
- 📦 Compress and optimize the final CSS
- 🔌 Seamless integration with RSBuild

## Installation

```bash
npm install @pathscale/rsbuild-plugin-iconify --save-dev
# or
yarn add @pathscale/rsbuild-plugin-iconify -D
# or
bun add -D @pathscale/rsbuild-plugin-iconify
```

## Usage

Add the plugin to your RSBuild configuration:

```js
// rsbuild.config.js
import { pluginIconify } from '@pathscale/rsbuild-plugin-iconify'

export default {
	plugins: [
		pluginIconify({
			// Options (all optional)
			targetDir: 'src/styles/icons', // Directory to save generated CSS
			includeSets: ['mdi-light', 'material-symbols'], // Icon sets to include completely
			maxIconsPerSet: 200, // Max icons per included set
			maxTotalIcons: 1000, // Max total icons
			compress: true, // Apply compression
		}),
	],
}
```

Import the generated CSS in your main CSS file:

```css
@import './styles/icons/generated-icons.css';
```

Use the icons in your components:

```jsx
// With CSS classes
<span className="icon-[mdi-light--home] iconify"/>

// For colored icons
<span className="icon-[material-symbols--edit] iconify-color"/>
```

## Options

| Option           | Type       | Default                             | Description                     |
| ---------------- | ---------- | ----------------------------------- | ------------------------------- |
| `targetDir`      | `string`   | `'src/styles/icons'`                | Directory to save generated CSS |
| `includeSets`    | `string[]` | `['mdi-light', 'material-symbols']` | Icon sets to include completely |
| `maxIconsPerSet` | `number`   | `200`                               | Maximum icons per included set  |
| `maxTotalIcons`  | `number`   | `1000`                              | Maximum total icons             |
| `compress`       | `boolean`  | `true`                              | Apply compression to CSS        |

## License

MIT
