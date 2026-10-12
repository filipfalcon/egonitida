import { Schema } from 'effect';

/** The live views a page of the documentation may place among its prose, by the directive that places them, with the attributes each takes: read by the markdown plugin, which fails the build on any other, and by the pages that draw them. */
export const islandAttributes = {
  FirstThingsFirst: Schema.Struct({}),
  StatePress: Schema.Struct({}),
};
