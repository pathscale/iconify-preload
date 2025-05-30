import fs from 'node:fs';
import path from 'node:path';

export function findUsedIcons(targetDir = 'src/styles/icons'): Set<string> {
	const icons = new Set<string>();
	const debugInfo: Record<string, { pattern: string, file: string, matches: string[]; }[]> = {};

	const generatedIconsPath = path.resolve(targetDir, 'generated-icons.css');

	const patterns = [
		/icon-\[([\w-]+)--([^\]]+)\]/g,
		/name="icon-\[([\w-]+)--([^\]]+)\]"/g,
		/name='icon-\[([\w-]+)--([^\]]+)\]'/g,
		/name="([\w-]+)--([\w-]+)"/g,
		/name='([\w-]+)--([\w-]+)'/g,
		/className="[^"]*icon-\[([\w-]+)--([^\]]+)\][^"]*"/g,
		/className='[^']*icon-\[([\w-]+)--([^\]]+)\][^']*'/g,
		/class="[^"]*icon-\[([\w-]+)--([^\]]+)\][^"]*"/g,
		/class='[^']*icon-\[([\w-]+)--([^\]]+)\][^']*'/g,
		/'icon-\[([\w-]+)--([^\]]+)\]'/g,
		/"icon-\[([\w-]+)--([^\]]+)\]"/g,
	];

	function processIcon(prefix: string, name: string, patternIdx: number, file: string) {
		const fullIconName = `${prefix}--${name}`;
		const cssIconName = `icon-[${prefix}--${name}]`;

		if (!debugInfo[prefix]) {
			debugInfo[prefix] = [];
		}
		debugInfo[prefix].push({
			pattern: patterns[patternIdx].toString(),
			file,
			matches: [fullIconName, cssIconName]
		});

		icons.add(cssIconName);
		icons.add(fullIconName);
	}

	function searchInDirectory(dir: string) {
		try {
			const files = fs.readdirSync(dir, { withFileTypes: true });

			for (const file of files) {
				const fullPath = path.join(dir, file.name);

				if (path.resolve(fullPath) === generatedIconsPath) {
					console.log(`[iconify] Skipping generated icons file: ${fullPath}`);
					continue;
				}

				if (file.isDirectory()) {
					if (file.name === 'node_modules' || file.name === 'dist') {
						continue;
					}
					searchInDirectory(fullPath);
				} else if (/\.(jsx?|tsx?|css|scss)$/.test(file.name)) {
					try {
						const content = fs.readFileSync(fullPath, 'utf8');

						for (let i = 0; i < patterns.length; i++) {
							const pattern = patterns[i];
							let match;
							while ((match = pattern.exec(content)) !== null) {
								if (match.length >= 3) {
									processIcon(match[1], match[2], i, fullPath);
								}
								else if (match.length >= 2) {
									const fullMatch = match[1];
									const parts = fullMatch.match(/([\w-]+)--([\w-]+)/);
									if (parts && parts.length >= 3) {
										processIcon(parts[1], parts[2], i, fullPath);
									} else {
										icons.add(fullMatch);

										const prefix = "unknown";
										if (!debugInfo[prefix]) {
											debugInfo[prefix] = [];
										}
										debugInfo[prefix].push({
											pattern: pattern.toString(),
											file: fullPath,
											matches: [fullMatch]
										});
									}
								}
							}
							pattern.lastIndex = 0;
						}
					} catch (error) {
						console.warn(`[iconify] Error reading file ${fullPath}:`, error);
					}
				}
			}
		} catch (error) {
			console.warn(`[iconify] Error reading directory ${dir}:`, error);
		}
	}

	if (fs.existsSync('src')) {
		searchInDirectory('src');
	}

	console.log('[iconify] Debug info for icon sets:');
	for (const [prefix, matches] of Object.entries(debugInfo)) {
		console.log(`[iconify] Set ${prefix} found in ${matches.length} places`);

		const examples = matches.slice(0, 5);
		for (const example of examples) {
			console.log(`[iconify]   - File: ${example.file}`);
			console.log(`[iconify]     Pattern: ${example.pattern}`);
			console.log(`[iconify]     Matches: ${example.matches.join(', ')}`);
		}
	}

	return icons;
}

export function hasIconsWithPrefix(icons: Set<string>, prefix: string): boolean {
	for (const icon of icons) {
		if (icon.includes(`${prefix}--`) || icon.includes(`${prefix}-`)) {
			return true;
		}
	}
	return false;
}