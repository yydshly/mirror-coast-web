import {defineConfig} from 'vitest/config';

// Region scenarios each generate a full 1024 × 768 voxel map. Bound concurrent
// copies so test setup does not exhaust memory while the live game is open.
export default defineConfig({test:{maxWorkers:2,testTimeout:15000,hookTimeout:30000}});
