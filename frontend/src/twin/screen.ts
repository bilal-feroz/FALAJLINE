/**
 * Where a point of the twin is on screen, for interface layers outside the canvas (the guided tour).
 * The label projector installs the function every frame with the live camera; until the twin has rendered
 * it returns null. Kept free of three.js so importing it costs nothing.
 */
export const screen: { project: (x: number, y: number, z: number) => [number, number] | null } = {
  project: () => null,
};
