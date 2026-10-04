/** Set by scripts/build.mjs: the package version and the git commit the bundle was built from. */
declare const __KEEPER_VERSION__: string | undefined;

export const KEEPER_VERSION: string = typeof __KEEPER_VERSION__ === 'string' ? __KEEPER_VERSION__ : 'dev';
