import { startProjectRoute } from '@client/bootstrap/project-route';
import { startRootRoute } from '@client/bootstrap/root-route';
import { getRouteMode } from '@client/bootstrap/route-mode';
import { requireShellElements } from '@client/bootstrap/shell-elements';

const shell = requireShellElements();
const routeMode = getRouteMode(window.location);

if (routeMode.kind === 'root') {
  void startRootRoute(shell);
} else {
  void startProjectRoute(shell, routeMode);
}
