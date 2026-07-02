export type EntryRoute = "viewer" | "catalog";

export function routeForPathname(pathname: string): EntryRoute {
  if (pathname.startsWith("/ui_catalog")) {
    return "catalog";
  }
  return "viewer";
}
