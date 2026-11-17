import {expect,it} from 'vitest';
import {ChunkDependents} from '../src/world/chunk-dependents';

it('invalidates shared support once across chunk seams, including negative terrain and upper headroom',()=>{
  const index=new ChunkDependents<object>(),bridge={},road={},other={};
  index.add(bridge,[{x:-1,y:31,z:31},{x:0,y:32,z:32},{x:0,y:32,z:32}]);
  index.add(road,[{x:0,y:30,z:32},{x:0,y:33,z:32}]);index.add(other,[{x:200,y:15,z:200}]);
  expect([...index.affected(['-1,0,0','0,1,1','0,1,1'])]).toEqual([bridge,road]);
  expect(index.affected(['8,0,8'])).toHaveLength(0);
});
