import { test } from "node:test";
import assert from "node:assert/strict";
import { findRoutesInFile } from "../src/analyzers/routes.js";

test("routes: express/fastify JS registrations", () => {
  const src = `import express from "express";
const app = express();
app.get("/users/:id", (req, res) => res.json({ ok: true }));
router.post("/charge", handler);
app.use(express.json());`;
  const routes = findRoutesInFile(src, ".js");
  assert.deepEqual(
    routes.map((r) => [r.method, r.path]),
    [
      ["GET", "/users/:id"],
      ["POST", "/charge"],
    ],
  );
  assert.equal(routes[0].line, 3);
});

test("routes: python flask + django urlpatterns", () => {
  const py = `@app.route("/webhook")
def webhook(): pass

@app.post("/payments")
def pay(): pass`;
  const routes = findRoutesInFile(py, ".py");
  assert.deepEqual(
    routes.map((r) => [r.method, r.path]),
    [
      ["POST", "/webhook"],
      ["POST", "/payments"],
    ],
  );

  const django = `urlpatterns = [
    path("admin/", admin.site.urls),
    path("charge/", views.charge),
]`;
  const djangoRoutes = findRoutesInFile(django, ".py");
  assert.deepEqual(
    djangoRoutes.map((r) => [r.method, r.path]),
    [["POST", "charge/"]],
  );
});

test("routes: go gin/echo/net-http registrations", () => {
  const go = `r := gin.Default()
r.GET("/payments", h.List)
e := echo.New()
e.POST("/charge", h.Charge)
http.HandleFunc("/health", h.Health)
r.Handle("/metrics", h.Metrics)`;
  const routes = findRoutesInFile(go, ".go");
  assert.deepEqual(
    routes.map((r) => [r.method, r.path]),
    [
      ["GET", "/payments"],
      ["POST", "/charge"],
      ["GET", "/health"],
      ["GET", "/metrics"],
    ],
  );
});

test("routes: rust axum route + actix get macro", () => {
  const axum = `let app = Router::new()
    .route("/payments", get(list_payments))
    .route("/charge", post(create_charge));`;
  const routes = findRoutesInFile(axum, ".rs");
  assert.deepEqual(
    routes.map((r) => [r.method, r.path]),
    [
      ["GET", "/payments"],
      ["POST", "/charge"],
    ],
  );

  const actix = `#[get("/orders")]
async fn list_orders() -> impl Responder { "ok" }`;
  const actixRoutes = findRoutesInFile(actix, ".rs");
  assert.deepEqual(
    actixRoutes.map((r) => [r.method, r.path]),
    [["GET", "/orders"]],
  );
});

test("routes: java spring annotations", () => {
  const java = `@GetMapping("/payments")
public List<Payment> payments() { ... }

@PostMapping(path = "/charge")
public Charge charge() { ... }`;
  const routes = findRoutesInFile(java, ".java");
  assert.deepEqual(
    routes.map((r) => [r.method, r.path]),
    [
      ["GET", "/payments"],
      ["POST", "/charge"],
    ],
  );
});

test("routes: C# ASP.NET attributes", () => {
  const cs = `[HttpGet("/payments")]
public IActionResult Payments() { ... }

[HttpPost("charges")]
public IActionResult Charge() { ... }

[Route("api/orders")]
public IActionResult Orders() { ... }`;
  const routes = findRoutesInFile(cs, ".cs");
  assert.deepEqual(
    routes.map((r) => [r.method, r.path]),
    [
      ["GET", "/payments"],
      ["POST", "charges"],
      ["GET", "api/orders"],
    ],
  );
});

test("routes: dart shelf router", () => {
  const dart = `router.get('/payments', (req) => ok(req));
router.post('/charge', (req) => ok(req));`;
  const routes = findRoutesInFile(dart, ".dart");
  assert.deepEqual(
    routes.map((r) => [r.method, r.path]),
    [
      ["GET", "/payments"],
      ["POST", "/charge"],
    ],
  );
});
