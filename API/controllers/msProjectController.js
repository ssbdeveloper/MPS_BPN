const service = require("../services/msProjectService");

function success(res, data = {}, status = 200, summary = {}, warnings = []) {
  res.status(status).json({
    success: true,
    data,
    summary,
    warnings,
  });
}

function error(res, err) {
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  const response = {
    success: false,
    code,
    message: status === 500 ? "Internal Server Error" : err.message,
    details: Array.isArray(err.details) ? err.details : err.details ? [err.details] : [],
  };

  if (code === "PROJECT_REVISION_CONFLICT" && err.details && err.details.current_revision_no !== undefined) {
    response.current_revision_no = err.details.current_revision_no;
  }

  if (status >= 500) {
    console.error("[ms-project]", code, err.message);
  }

  res.status(status).json(response);
}

function route(handler) {
  return async (req, res) => {
    const startedAt = Date.now();
    try {
      const result = await handler(req);
      const durationMs = Date.now() - startedAt;
      console.log("[ms-project]", req.method, req.originalUrl, 200, `${durationMs}ms`);
      return result(res);
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      console.log("[ms-project]", req.method, req.originalUrl, err.status || 500, err.code || "ERROR", `${durationMs}ms`);
      return error(res, err);
    }
  };
}

exports.health = route(async () => {
  const data = await service.health();
  return (res) => success(res, data);
});

exports.listProjects = route(async (req) => {
  const result = await service.listProjects(req.query);
  return (res) => success(res, result.rows, 200, { limit: result.limit, offset: result.offset });
});

exports.getProjectPackage = route(async (req) => {
  const data = await service.getProjectPackage(req.params.project_id);
  return (res) => success(res, data);
});

exports.bulkLoadProjects = route(async (req) => {
  const data = await service.bulkLoadProjectPackages(req.body.project_ids);
  return (res) => success(res, data, 200, { count: data.length });
});

exports.publishProject = route(async (req) => {
  const data = await service.publishProject(req.body);
  return (res) => success(res, data, 201, data.summary || {});
});

exports.syncProject = route(async (req) => {
  const data = await service.syncProject(req.params.project_id, req.body);
  return (res) => success(res, data, 200, data.summary || {});
});

exports.searchResources = route(async (req) => {
  const result = await service.searchResources(req.query);
  return (res) => success(res, result.rows, 200, { limit: result.limit, offset: result.offset });
});

exports.refreshResources = route(async (req) => {
  const summary = await service.refreshResources(req.body || {});
  return (res) => success(res, {}, 200, summary, summary.warnings || []);
});

exports.getProjectResources = route(async (req) => {
  const data = await service.getProjectResources(req.params.project_id);
  return (res) => success(res, data);
});

exports.addProjectResources = route(async (req) => {
  const data = await service.addProjectResources(req.params.project_id, req.body.resource_ids || []);
  return (res) => success(res, data.rows, 200, {
    project_resources_created: data.created,
    project_resources_updated: data.updated,
  });
});

exports.deactivateProjectResource = route(async (req) => {
  const data = await service.deactivateProjectResource(req.params.project_id, req.params.resource_id);
  return (res) => success(res, data);
});

exports.getConflicts = route(async (req) => {
  const warnings = await service.getConflicts(req.query);
  return (res) => success(res, {}, 200, { warnings: warnings.length }, warnings);
});
