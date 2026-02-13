export function parseNamespacedName(value: string): {
  pluginId: string;
  localName: string;
} | null {
  const [pluginId, ...rest] = value.split("__");
  if (!pluginId) {
    return null;
  }

  return {
    pluginId,
    localName: rest.join("__"),
  };
}
