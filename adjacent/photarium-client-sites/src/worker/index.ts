import { Hono } from 'hono';
import { handleCreateLocalDemo } from './routes/dev/create-demo';
import { handleLocalDevStatus } from './routes/dev/status';
import { handleCreateProject } from './routes/admin/create-project';
import { handlePublishProject } from './routes/admin/publish-project';
import { handleAddAssets } from './routes/admin/add-assets';
import { handleRemoveAssets } from './routes/admin/remove-assets';
import { handleUpdateStatus } from './routes/admin/update-status';
import { handleProjectShell } from './routes/public/project-shell';
import { handleRootState } from './routes/public/root-state';
import { handleProjectData } from './routes/public/project-data';
import { handleProjectAssets } from './routes/public/project-assets';
import { handleCreateSession } from './routes/public/session';
import { handleSubmitShortlist } from './routes/public/submit-shortlist';
import { handleViewAsset } from './routes/public/view-asset';
import { handleDownloadAsset } from './routes/public/download-asset';
import { handleRootEntry } from './routes/public/root';
import { ensureDatabaseSchema } from './lib/database-schema';
import { jsonError } from './lib/json';
import { withNoIndex } from './lib/http';
import { logError } from './observability/logger';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (context, next) => {
  await ensureDatabaseSchema(context.env.DB);
  await next();
});

app.get('/', handleRootEntry);
app.get('/health', (context) =>
  Response.json({
    ok: true,
    service: context.env.PUBLIC_SITE_NAME,
  })
);
app.get('/api/root', handleRootState);

app.get('/api/dev/status', handleLocalDevStatus);
app.post('/api/dev/demo', handleCreateLocalDemo);

app.post('/api/admin/projects', handleCreateProject);
app.post('/api/admin/projects/:id/publish', handlePublishProject);
app.post('/api/admin/projects/:id/assets:add', handleAddAssets);
app.post('/api/admin/projects/:id/assets:remove', handleRemoveAssets);
app.post('/api/admin/projects/:id/status', handleUpdateStatus);

app.get('/p/:slug', handleProjectShell);
app.post('/api/p/:slug/session', handleCreateSession);
app.get('/api/p/:slug', handleProjectData);
app.get('/api/p/:slug/assets', handleProjectAssets);
app.post('/api/p/:slug/shortlists', handleSubmitShortlist);
app.get('/a/:publicAssetId/:preset', handleViewAsset);
app.get('/d/:publicAssetId/:downloadPreset.:format', handleDownloadAsset);

app.onError((error) => {
  logError('worker.unhandled', { message: error.message, stack: error.stack });
  return jsonError(500, 'Internal server error');
});

app.notFound(async (context) => {
  const pathname = new URL(context.req.url).pathname;
  if (pathname.startsWith('/api/')) {
    return jsonError(404, 'Not found');
  }

  const response = await context.env.ASSETS.fetch(context.req.raw);
  if (response.status === 404) return jsonError(404, 'Not found');
  return withNoIndex(response);
});

export default app;
