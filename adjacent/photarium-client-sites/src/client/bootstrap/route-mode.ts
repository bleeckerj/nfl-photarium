export interface ProjectRouteMode {
  kind: 'project';
  projectSlug: string;
  sharedAccessKey: string | null;
  pageUrl: URL;
}

export interface RootRouteMode {
  kind: 'root';
}

export type RouteMode = ProjectRouteMode | RootRouteMode;

export const getRouteMode = (location: Location): RouteMode => {
  const pageUrl = new URL(location.href);
  const segments = location.pathname.split('/').filter(Boolean);

  if (segments[0] === 'p' && segments[1]) {
    return {
      kind: 'project',
      projectSlug: segments[1],
      sharedAccessKey: pageUrl.searchParams.get('k'),
      pageUrl,
    };
  }

  return { kind: 'root' };
};

