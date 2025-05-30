import fs from 'node:fs';
import path from 'node:path';
export function findUsedIcons() {
    const icons = new Set();
    const iconPattern = /icon-\[([\w-]+)]/g;
    const solidIconPattern = /name="([\w-]+)"/g;
    function searchInDirectory(dir) {
        try {
            const files = fs.readdirSync(dir, { withFileTypes: true });
            for (const file of files) {
                const fullPath = path.join(dir, file.name);
                if (file.isDirectory()) {
                    searchInDirectory(fullPath);
                }
                else if (/\.(jsx?|tsx?|css|scss)$/.test(file.name)) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    let match;
                    while ((match = iconPattern.exec(content)) !== null) {
                        icons.add(`icon-[${match[1]}]`);
                    }
                    iconPattern.lastIndex = 0;
                    while ((match = solidIconPattern.exec(content)) !== null) {
                        icons.add(match[1]);
                    }
                }
            }
        }
        catch (error) {
            console.warn(`[iconify] Error reading directory ${dir}:`, error);
        }
    }
    searchInDirectory('src');
    return icons;
}
export function hasIconsWithPrefix(icons, prefix) {
    for (const icon of icons) {
        if (icon.includes(prefix)) {
            return true;
        }
    }
    return false;
}
