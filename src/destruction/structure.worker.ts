/// <reference lib="webworker" />
import { analyzeStructure, type StructureInput } from './structure';

const scope = self as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<StructureInput>) => {
  scope.postMessage(analyzeStructure(event.data));
};
