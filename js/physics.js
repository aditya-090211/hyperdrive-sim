import RAPIER from '../lib/rapier.es.js';

export { RAPIER };
export * from './physics-core.js';

export async function createWorld() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 240;
  if ('numSolverIterations' in world) world.numSolverIterations = 4;
  const events = new RAPIER.EventQueue(true);
  return { world, events };
}
