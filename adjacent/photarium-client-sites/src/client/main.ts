import { startLocalDevLanding } from '@client/bootstrap/dev-landing';
import { startProjectRoute } from '@client/bootstrap/project-route';
import { getRouteMode } from '@client/bootstrap/route-mode';
import { requireShellElements } from '@client/bootstrap/shell-elements';

const shell = requireShellElements();
const routeMode = getRouteMode(window.location);

if (routeMode.kind === 'root') {
  void startLocalDevLanding(shell);
} else {
  void startProjectRoute(shell, routeMode);
}
