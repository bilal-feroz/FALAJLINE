/**
 * Animated simulation state read by the 3D scene every frame.
 *
 * React state holds the target (the forecast values for the selected day); these values ease toward it so
 * that scrubbing the timeline moves the water table and the flows smoothly instead of snapping.
 */
export const anim = {
  head: 1.0, // source head, metres above the tunnel invert (current, eased)
  head0: 1.0, // today's head, for the reference line
  flow: {} as Record<string, number>, // eased flow fraction per path key, relative to today's main flow
  target: { head: 1.0, flow: {} as Record<string, number> },
};

export function stepAnim(dt: number): void {
  const k = 1 - Math.exp(-dt * 4.5);
  anim.head += (anim.target.head - anim.head) * k;
  for (const key of Object.keys(anim.target.flow)) {
    const cur = anim.flow[key] ?? anim.target.flow[key];
    anim.flow[key] = cur + (anim.target.flow[key] - cur) * k;
  }
}
