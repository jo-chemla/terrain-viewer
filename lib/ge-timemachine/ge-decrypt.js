/*
 * ge-decrypt.js — the XOR keystream Google applies to dbRoot, quadtree packets
 * and image tiles. XOR is symmetric, so this both encrypts and decrypts.
 *
 * This is the *byte-wise* form from GEHistoricalImagery (LibGoogleEarth/
 * DbRoot.cs `Encode`) — the reference proven against Google's live servers.
 *
 * Note on CesiumJS: its uint64-block variant (decodeGoogleEarthEnterpriseData.js)
 * produces an IDENTICAL keystream to this for every buffer >= 8 bytes (verified
 * by brute force over many key/data lengths). It only diverges for whole buffers
 * SMALLER than 8 bytes. Since dbRoot, packets and JPEG tiles are all far larger,
 * either form decodes them correctly — so the earlier "image could not be
 * decoded" crash was NOT a decrypt problem (it was an unguarded createImageBitmap
 * on a non-image HTTP response). We use the byte-wise form anyway: it's simpler,
 * dependency-free, and also correct on tiny buffers.
 *
 * @param {ArrayBuffer|Uint8Array} key   key from the dbRoot (EncryptionData)
 * @param {ArrayBuffer} dataBuffer        buffer to decode IN PLACE
 */
const COMPRESS_MAGIC = 0x7468dead;
const COMPRESS_MAGIC_SWAP = 0xadde6874;

export default function geDecrypt(key, dataBuffer) {
  const k = key instanceof Uint8Array ? key : new Uint8Array(key);
  const keyLength = k.length;
  if (keyLength === 0) throw new Error("ge-decrypt: empty key");

  const data = new Uint8Array(dataBuffer);

  // Occasionally assets come back already decoded (start with the zlib magic).
  if (data.length >= 4) {
    const magic = new DataView(dataBuffer).getUint32(0, true);
    if (magic === COMPRESS_MAGIC || magic === COMPRESS_MAGIC_SWAP) return dataBuffer;
  }

  let off = 16;
  for (let j = 0; j < data.length; j++) {
    data[j] ^= k[off++];
    if ((off & 7) === 0) off += 16;       // skip 16 bytes every 8
    if (off >= keyLength) off = (off + 8) % 24; // rotate base 16,0,8,...
  }
  return dataBuffer;
}
