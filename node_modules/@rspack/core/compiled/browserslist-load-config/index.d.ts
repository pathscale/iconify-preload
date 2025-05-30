declare function findConfig(from: string): Record<string, string[]> | undefined;
type LoadConfigOptions = {
    config?: string;
    path?: string;
    env?: string;
};
declare function loadConfig(opts: LoadConfigOptions): string[] | undefined;

export { findConfig, loadConfig };
export type { LoadConfigOptions };
