import { optimize } from "svgo";

export function optimizeSVG(svgString: string): string {
	try {
		const result = optimize(svgString, {
			plugins: [
				{
					name: "preset-default",
					params: {
						overrides: {
							removeViewBox: false,
							removeUselessStrokeAndFill: false,
							inlineStyles: false,
						},
					},
				},
				"removeXMLNS",
				{ name: "collapseGroups" },
				{ name: "removeEmptyAttrs" },
				{ name: "removeEmptyContainers" },
				{ name: "mergePaths" },
				{ name: "convertPathData" },
				{ name: "cleanupNumericValues" },
				{ name: "sortAttrs" },
			],
		});
		return result.data;
	} catch (error) {
		console.warn("[iconify] Error optimizing SVG:", error);
		return svgString;
	}
}
