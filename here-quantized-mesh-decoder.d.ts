// @here/quantized-mesh-decoder ships no types — minimal ambient declaration
// covering what lib/wmesh-protocol.ts uses (spec fields:
// https://github.com/CesiumGS/quantized-mesh).
declare module "@here/quantized-mesh-decoder" {
  export interface QuantizedMeshHeader {
    minHeight: number
    maxHeight: number
    centerX: number
    centerY: number
    centerZ: number
    boundingSphereCenterX: number
    boundingSphereCenterY: number
    boundingSphereCenterZ: number
    boundingSphereRadius: number
    horizonOcclusionPointX: number
    horizonOcclusionPointY: number
    horizonOcclusionPointZ: number
  }
  export interface DecodedQuantizedMesh {
    header: QuantizedMeshHeader
    /** u[], v[], height[] as three consecutive runs, each 0..32767. */
    vertexData: Uint16Array
    triangleIndices: Uint16Array | Uint32Array
    westIndices: Uint16Array | Uint32Array
    southIndices: Uint16Array | Uint32Array
    eastIndices: Uint16Array | Uint32Array
    northIndices: Uint16Array | Uint32Array
    extensions?: Record<string, unknown>
  }
  export interface DecoderOptions {
    maxDecodingStep?: number
  }
  export default function decode(buffer: ArrayBuffer, options?: DecoderOptions): DecodedQuantizedMesh
}
