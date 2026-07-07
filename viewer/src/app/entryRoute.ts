export type EntryRoute = "viewer" | "catalog" | "newton";

export function routeForPathname(pathname: string): EntryRoute {
  if (pathname.startsWith("/newton")) {
    return "newton";
  }
  if (pathname.startsWith("/ui_catalog")) {
    return "catalog";
  }
  return "viewer";
}
