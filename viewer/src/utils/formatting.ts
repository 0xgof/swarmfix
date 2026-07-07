export function formatMeters(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "unavailable";
  }

  const formattedValue = `${value.toFixed(3)} m`;
  return formattedValue;
}

export function formatVector(position: number[] | null): string {
  if (position === null) {
    return "unavailable";
  }

  const formattedVector = position.map((component) => component.toFixed(3))
    .join(", ");
  return formattedVector;
}
