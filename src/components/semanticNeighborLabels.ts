export const getSemanticProximityTerm = (distance: number): string => {
  if (distance < 0.20) return 'twin';
  if (distance < 0.24) return 'echo';
  if (distance < 0.28) return 'kin';
  if (distance < 0.32) return 'avuncular';
  if (distance < 0.36) return 'acquaintance';
  if (distance < 0.42) return 'familiar stranger';
  if (distance < 0.50) return 'stranger';
  return 'antipode';
};
