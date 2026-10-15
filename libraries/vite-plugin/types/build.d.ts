/** Which build of a game's code runs, as `@egonitida/vite-plugin`'s `Build.plugin` names it. */
declare module 'virtual:egonitida/build' {
  /** The id of the build: one for each production build, and a new one with every change to the game's code while serving. */
  export const build: string;
}
