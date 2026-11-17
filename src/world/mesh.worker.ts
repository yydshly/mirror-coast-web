import { meshChunk, type MeshInput, type MeshResult } from './mesher';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MeshInput>) => void) | null;
  postMessage: (result: MeshResult, transfer: ArrayBuffer[]) => void;
};

workerScope.onmessage = (event) => {
  const result = meshChunk(event.data);
  workerScope.postMessage(result, [
    result.positions.buffer as ArrayBuffer, result.normals.buffer as ArrayBuffer,
    result.colors.buffer as ArrayBuffer, result.glow.buffer as ArrayBuffer,
    result.surfaceId.buffer as ArrayBuffer,
    result.indices.buffer as ArrayBuffer,
  ]);
};
