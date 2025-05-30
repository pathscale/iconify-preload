import type { DtsEntry } from './index';
export type BundleOptions = {
    name: string;
    cwd: string;
    distPath: string;
    dtsExtension: string;
    banner?: string;
    footer?: string;
    dtsEntry: DtsEntry[];
    tsconfigPath?: string;
    bundledPackages?: string[];
};
export declare function bundleDts(options: BundleOptions): Promise<void>;
