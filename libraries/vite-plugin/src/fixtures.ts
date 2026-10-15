/**
 * What the plugin's tests are built of: a model's file, made byte by byte.
 */

/** A binary glTF of `json`, and `bin` as its binary chunk, each padded to whole words. */
export const glb = (json: unknown, bin: ReadonlyArray<number> = []) => {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = bin.length * 4;
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
    bin.forEach((value, index) => view.setFloat32(at + 8 + index * 4, value, true));
  }
  return bytes;
};
