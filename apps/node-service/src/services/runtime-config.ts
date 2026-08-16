export function configuredValue(
  environmentValue: string | undefined,
  persistedValue: string | undefined
) {
  return environmentValue?.trim() || persistedValue;
}
