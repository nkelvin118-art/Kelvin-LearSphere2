const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("core project files exist", () => {
  for (const file of ["server.js", "db.js", "package.json", ".env.example", "public/index.html", "public/styles.css", "public/app.js"]) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", file)), `Missing ${file}`);
  }
});

test("package defines start and test scripts", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(pkg.scripts.start, "node server.js");
  assert.equal(pkg.scripts.test, "node --test");
});
