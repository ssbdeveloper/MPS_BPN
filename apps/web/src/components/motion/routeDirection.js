export const ENTER_PX = 24;

// Diekspor terpisah supaya bisa diuji tanpa merender animasi.
export function directionOffset(prevDepth, nextDepth) {
  if (nextDepth > prevDepth) return ENTER_PX;   // maju: masuk dari kanan
  if (nextDepth < prevDepth) return -ENTER_PX;  // mundur: masuk dari kiri
  return 0;
}

export function motionOffset(offset, reduced) {
  return reduced ? 0 : offset;
}
