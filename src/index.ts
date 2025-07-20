import fs from "node:fs";
import path from "node:path";
import { locate, lookupCollections } from "@iconify/json";
import { getIconData, iconToHTML, iconToSVG } from "@iconify/utils";
import { compressCSS } from "./utils/compress";
import { findUsedIcons, hasIconsWithPrefix } from "./utils/find";
import { optimizeSVG } from "./utils/optimize";

interface IconifyPluginOptions {
	targetDir?: string;
	includeSets?: string[];
	forceIncludeSets?: boolean;
	maxIconsPerSet?: number;
	maxTotalIcons?: number;
	compress?: boolean;
}

export const pluginIconify = (options: IconifyPluginOptions = {}) => {
	const {
		targetDir = "src/styles/icons",
		includeSets = ["mdi-light", "material-symbols"],
		forceIncludeSets = false,
		maxIconsPerSet = 200,
		maxTotalIcons = 1000,
		compress = true,
	} = options;

	return {
		name: "rsbuild-plugin-iconify",

		setup(api: any) {
			if (!fs.existsSync(targetDir)) {
				fs.mkdirSync(targetDir, { recursive: true });
			}

			api.onBeforeBuild(async () => {
				console.log("[iconify] Starting icon generation...");
				await generateIcons();
			});

			api.modifyRspackConfig((config: any) => {
				if (fs.existsSync(path.join(targetDir, "generated-icons.css"))) {
					if (!config.entry) {
						config.entry = {};
					}

					const cssFile = path.resolve(
						process.cwd(),
						targetDir,
						"generated-icons.css",
					);
					if (!fs.existsSync("dist/styles/icons")) {
						fs.mkdirSync("dist/styles/icons", { recursive: true });
					}
					fs.copyFileSync(cssFile, "dist/styles/icons/generated-icons.css");
				}

				return config;
			});

			async function generateIcons() {
				let iconCSS = `
.iconify {
  display: inline-block;
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}

.iconify-color {
  display: inline-block;
  width: 1em;
  height: 1em;
  background-repeat: no-repeat;
  background-size: 100% 100%;
}
`;
				const usedIcons = findUsedIcons(targetDir);
				console.log(`[iconify] Found ${usedIcons.size} unique icons in code`);

				const usedSets = new Map<string, string[]>();
				for (const iconName of usedIcons) {
					const match = iconName.match(/icon-\[([\w-]+)--([\w-]+)\]/);
					if (match) {
						const setName = match[1];
						const icon = match[2];
						if (!usedSets.has(setName)) {
							usedSets.set(setName, []);
						}
						usedSets.get(setName)?.push(icon);
					}
				}

				console.log(
					`[iconify] Used icon sets: ${Array.from(usedSets.keys()).join(", ")}`,
				);
				for (const [setName, icons] of usedSets.entries()) {
					console.log(`[iconify] Set ${setName} uses ${icons.length} icons`);
				}

				const iconSets = await lookupCollections();
				const prefixes = Object.keys(iconSets);
				console.log(
					`[iconify] Found ${prefixes.length} icon sets in @iconify/json`,
				);

				let totalProcessedSets = 0;
				let totalProcessedIcons = 0;

				for (const iconSet of prefixes) {
					try {
						const includeFullSet =
							forceIncludeSets && includeSets.includes(iconSet);

						const hasUsedIcons = hasIconsWithPrefix(usedIcons, iconSet);

						if (!includeFullSet && !hasUsedIcons) {
							continue;
						}

						const jsonPath = locate(iconSet);
						if (!jsonPath) {
							console.warn(
								`[iconify] Icon set ${iconSet} not found. Skipping.`,
							);
							continue;
						}

						const iconSetData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
						let setProcessedIcons = 0;

						const iconNames = Object.keys(iconSetData.icons);
						const iconsToProcess = includeFullSet
							? iconNames.slice(0, maxIconsPerSet)
							: iconNames;

						for (const iconName of iconsToProcess) {
							const fullIconName = `${iconSet}--${iconName}`;
							const cssIconName = `icon-[${iconSet}--${iconName}]`;

							if (
								!includeFullSet &&
								!usedIcons.has(cssIconName) &&
								!usedIcons.has(fullIconName)
							) {
								continue;
							}

							const iconData = getIconData(iconSetData, iconName);
							if (!iconData) continue;

							const { attributes, body } = iconToSVG(iconData, {
								height: "auto",
							});
							let svg = iconToHTML(body, attributes);

							svg = optimizeSVG(svg);
							const dataURI = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

							iconCSS += `
.icon-[${iconSet}--${iconName}] {
  --svg: ${dataURI};
}
.icon-[${iconSet}--${iconName}].iconify {
  -webkit-mask-image: var(--svg);
  mask-image: var(--svg);
}
.icon-[${iconSet}--${iconName}].iconify-color {
  background-image: var(--svg);
}
`;
							setProcessedIcons++;
							totalProcessedIcons++;

							if (totalProcessedIcons >= maxTotalIcons) {
								console.warn(
									`[iconify] Icon limit (${maxTotalIcons}) reached. Other icons will be skipped.`,
								);
								break;
							}
						}

						if (setProcessedIcons > 0) {
							console.log(
								`[iconify] Processed icon set ${iconSet}: ${setProcessedIcons} icons`,
							);
							totalProcessedSets++;
						}

						if (totalProcessedIcons >= maxTotalIcons) {
							break;
						}
					} catch (error) {
						console.error(
							`[iconify] Error processing icon set ${iconSet}:`,
							error,
						);
					}
				}

				console.log(
					`[iconify] Total: processed ${totalProcessedIcons} icons from ${totalProcessedSets} sets`,
				);

				const rawCSSFile = path.join(targetDir, "generated-icons.css");
				fs.writeFileSync(rawCSSFile, iconCSS);
				console.log(`[iconify] CSS file with icons saved in ${rawCSSFile}`);

				if (compress) {
					const optimizedCSSFile = path.join(
						targetDir,
						"generated-icons.min.css",
					);
					await compressCSS(rawCSSFile, optimizedCSSFile);
					fs.copyFileSync(optimizedCSSFile, rawCSSFile);
					fs.unlinkSync(optimizedCSSFile);
					console.log(`[iconify] Compressed CSS file saved as ${rawCSSFile}`);
				}
			}
		},
	};
};

export default pluginIconify;
