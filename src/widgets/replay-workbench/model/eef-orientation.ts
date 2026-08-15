export type QuaternionTuple = [number, number, number, number];

export function rotationVectorQuaternion(
  rotationVector: number[] | undefined,
): QuaternionTuple | null {
  if (rotationVector?.length !== 3 || rotationVector.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [x, y, z] = rotationVector as [number, number, number];
  const angle = Math.hypot(x, y, z);
  if (angle < 1e-12) return [0, 0, 0, 1];
  const scale = Math.sin(angle / 2) / angle;
  return [x * scale, y * scale, z * scale, Math.cos(angle / 2)];
}
