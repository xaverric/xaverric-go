const compile = (path) => {
  const segments = path.split("/").slice(1);
  return { segments, keys: segments.filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1)) };
};

const matchSegments = (segments, parts) => {
  if (segments.length !== parts.length) return null;
  const values = [];
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].startsWith(":")) {
      if (parts[i] === "") return null;
      values.push(parts[i]);
    } else if (segments[i] !== parts[i]) {
      return null;
    }
  }
  return values;
};

const decodeParams = (values) => {
  try {
    return values.map(decodeURIComponent);
  } catch {
    return null;
  }
};

const methodMatches = (routeMethod, method) => routeMethod === method || (method === "HEAD" && routeMethod === "GET");

export const createRouter = (routes) => {
  const compiled = routes.map((route) => ({ ...route, ...compile(route.path) }));
  return (method, pathname) => {
    if (!pathname.startsWith("/")) return { status: 404 };
    const parts = pathname.split("/").slice(1);
    const candidates = compiled.filter((route) => matchSegments(route.segments, parts) !== null);
    if (candidates.length === 0) return { status: 404 };
    const route = candidates.find((candidate) => methodMatches(candidate.method, method));
    if (!route) return { status: 405, allow: [...new Set(candidates.map((candidate) => candidate.method))].join(", ") };
    const values = decodeParams(matchSegments(route.segments, parts));
    if (!values) return { status: 404 };
    return { route, params: Object.fromEntries(route.keys.map((key, i) => [key, values[i]])) };
  };
};
