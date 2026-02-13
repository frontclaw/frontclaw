export function parseRouteSpec(route: string): { path: string; methods?: string[] } {
  const trimmed = route.trim();
  const match = trimmed.match(/^([A-Za-z,]+)\s+(.+)$/);
  if (!match) {
    return { path: trimmed };
  }

  const methodsPart = match[1] ?? "";
  const pathPart = match[2] ?? trimmed;
  const methods = methodsPart
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);

  return {
    path: pathPart.trim(),
    methods: methods.length > 0 ? methods : undefined,
  };
}

export function routeMatches(path: string, routePath: string): boolean {
  const normalize = (value: string) => {
    if (value.length > 1 && value.endsWith("/")) {
      return value.slice(0, -1);
    }
    return value;
  };

  const normalizedPath = normalize(path);
  const normalizedRoute = normalize(routePath);

  if (normalizedRoute.endsWith("/*")) {
    const prefix = normalizedRoute.slice(0, -2);
    return normalizedPath.startsWith(prefix);
  }

  return normalizedPath === normalizedRoute;
}
