interface IconifyPluginOptions {
    targetDir?: string;
    includeSets?: string[];
    forceIncludeSets?: boolean;
    maxIconsPerSet?: number;
    maxTotalIcons?: number;
    compress?: boolean;
}
export declare const pluginIconify: (options?: IconifyPluginOptions) => {
    name: string;
    setup(api: any): void;
};
export default pluginIconify;
