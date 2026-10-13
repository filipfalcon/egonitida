import { randomUUID } from 'node:crypto';

/**
 * Which build of a game's code runs, for what is recorded of it to say: the module `virtual:lightocean/build` exports `build`, an id the game's host is given explicitly (`Host.Options.build`). A production build has an id of its own; while serving, the id changes with every change to a module the importer of `build` runs, such as the game's code in its worker, and only then, so a recording begins a segment with every new build of the game and none for a change to the page alone.
 */

/** The module a game imports its build from. */
export const MODULE = 'virtual:lightocean/build';

const RESOLVED = `\0${MODULE}`;

// One id for a whole production build, the page's and its workers' alike, each given a plugin of its own from this one module.
const started = randomUUID();

/** A module as the graph of a served app has it: what imports it. */
export interface Imported {
  readonly importers: ReadonlySet<Imported>;
}

/** Whether `changed` is run by one of `importers`: whether, through what imports it, it reaches one. */
export const runBy = (changed: Imported, importers: ReadonlySet<Imported>): boolean => {
  const seen = new Set<Imported>();
  const reaching = (module: Imported): boolean => {
    if (importers.has(module)) {
      return true;
    }
    if (seen.has(module)) {
      return false;
    }
    seen.add(module);
    return [...module.importers].some(reaching);
  };
  return reaching(changed);
};

/** The source of the module that names the build `id`. */
export const sourceOf = (id: string): string =>
  `/** Which build of the game's code this is. */\nexport const build = ${JSON.stringify(id)};\n`;

/** What a served app's graph of modules lets this plugin do, of the module type `M` of whichever copy of Vite serves it. */
export interface HotUpdate<M extends Imported> {
  readonly server: {
    readonly moduleGraph: {
      getModuleById(id: string): M | undefined;
      invalidateModule(module: M): void;
    };
  };
  readonly modules: ReadonlyArray<M>;
}

/** The parts of a Vite plugin this one has, typed by themselves, so a game whose Vite is another copy, as a game linking LightOcean from its own repository, takes it as a plugin of its own. */
export interface Plugin {
  readonly name: string;
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
  handleHotUpdate<M extends Imported>(context: HotUpdate<M>): Array<M> | undefined;
}

/** The plugin that names each build; given to a game's Vite config, and to its workers' (`worker.plugins`), which are built on their own. */
export const plugin = (): Plugin => {
  const build = { id: started };
  return {
    name: 'lightocean:build',
    resolveId: (id) => (id === MODULE ? RESOLVED : undefined),
    load: (id) => (id === RESOLVED ? sourceOf(build.id) : undefined),
    handleHotUpdate: <M extends Imported>({ server, modules }: HotUpdate<M>) => {
      const named = server.moduleGraph.getModuleById(RESOLVED);
      if (named === undefined || !modules.some((changed) => runBy(changed, named.importers))) {
        return;
      }
      build.id = randomUUID();
      server.moduleGraph.invalidateModule(named);
      return [...modules, named];
    },
  };
};
