/**
 * What the plugin's tests are built of: a model's file, made byte by byte.
 */

/** A binary glTF of `json`, and `bin` as its binary chunk, floats or bytes as they are, each padded to whole words. */
export const glb = (json: unknown, bin: ReadonlyArray<number> | Uint8Array = []) => {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = bin instanceof Uint8Array ? Math.ceil(bin.length / 4) * 4 : bin.length * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(text, 20);
  if (binLength > 0) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, 0x004e4942, true);
    if (bin instanceof Uint8Array) {
      bytes.set(bin, at + 8);
    } else {
      bin.forEach((value, index) => view.setFloat32(at + 8 + index * 4, value, true));
    }
  }
  return bytes;
};

/** An accessor's elements, as a model's file stores them: floats, or unsigned bytes such as the bones that carry a point. */
export interface Stored {
  readonly type: 'SCALAR' | 'VEC3' | 'VEC4';
  readonly componentType: 5126 | 5121;
  readonly values: ReadonlyArray<number>;
}

/** How many numbers each element of an accessor of `type` holds. */
const WIDTH = { SCALAR: 1, VEC3: 3, VEC4: 4 };

/** `stored` laid out one after another in a binary chunk, each in a buffer view of its own padded to whole words: their accessors, their buffer views, and the chunk's bytes. */
export const binary = (stored: ReadonlyArray<Stored>) => {
  const sizes = stored.map(
    ({ componentType, values }) =>
      Math.ceil((values.length * (componentType === 5126 ? 4 : 1)) / 4) * 4,
  );
  const bytes = new Uint8Array(sizes.reduce((sum, size) => sum + size, 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const bufferViews = stored.map(({ componentType, values }, at) => {
    values.forEach((value, index) =>
      componentType === 5126
        ? view.setFloat32(offset + index * 4, value, true)
        : view.setUint8(offset + index, value),
    );
    const placed = { byteOffset: offset, byteLength: sizes[at] ?? 0 };
    offset += sizes[at] ?? 0;
    return placed;
  });
  const accessors = stored.map(({ type, componentType, values }, at) => ({
    bufferView: at,
    componentType,
    count: values.length / WIDTH[type],
    type,
  }));
  return { accessors, bufferViews, bytes };
};
