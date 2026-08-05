import { execaSync } from "execa";
import { parse } from "@babel/parser";
import type { FileChange, IntegrityFinding } from "./types.js";

/**
 * exceptionSwallow — AST-scan added try/catch (JS/TS) or try/except (Python) blocks.
 *
 * SUSPICIOUS ONLY (never CONFIRMED — legitimate error handling is common):
 *   - the try/catch body is empty
 *   - the catch only logs (no re-raise / no real handling)
 *   - the catch unconditionally returns a default/success value
 */

const PY_SCRIPT = `
import ast, json, sys

code = sys.stdin.read()
try:
    tree = ast.parse(code)
except Exception:
    print(json.dumps([]))
    sys.exit(0)

LOG_NAMES = {"print", "logging", "logger", "log"}

def is_log(stmt):
    if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
        f = stmt.value.func
        name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else None)
        if name in LOG_NAMES or (isinstance(name, str) and name.startswith("log")):
            return True
    return False

def reason_for(body):
    if not body:
        return "empty catch swallows the error"
    if all(is_log(s) for s in body):
        return "catch only logs the error and does not re-raise or handle it"
    if len(body) == 1 and isinstance(body[0], ast.Return) and isinstance(body[0].value, ast.Constant):
        return "catch unconditionally returns a default/success value"
    return None

out = []
for node in ast.walk(tree):
    if isinstance(node, ast.Try):
        for h in node.handlers:
            r = reason_for(h.body)
            if r:
                out.append({"line": h.lineno, "reason": r})
                break
        else:
            if not node.body:
                out.append({"line": node.lineno, "reason": "empty try block"})
print(json.dumps(out))
`;

function isNewlyAdded(change: FileChange, line: number): boolean {
  if (change.status === "added") return true;
  return change.added.some((l) => l.line === line);
}

function isLogStatement(stmt: any): boolean {
  if (!stmt || stmt.type !== "ExpressionStatement") return false;
  const expr = stmt.expression;
  if (!expr || expr.type !== "CallExpression") return false;
  const callee = expr.callee;
  let name: string | null = null;
  if (callee.type === "Identifier") name = callee.name;
  else if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    name = callee.property.name;
  }
  if (!name) return false;
  if (/^(log|warn|error|info|debug)/i.test(name)) return true;
  if (["console", "logger", "log", "logging", "print"].includes(name)) return true;
  return false;
}

function classifyCatch(body: any[] | null): string | null {
  if (!body || body.length === 0) return "empty catch swallows the error";
  if (body.every(isLogStatement)) {
    return "catch only logs the error and does not re-raise or handle it";
  }
  if (body.length === 1 && body[0].type === "ReturnStatement") {
    const arg = body[0].argument;
    if (
      arg &&
      (arg.type === "Literal" ||
        arg.type === "ArrayExpression" ||
        arg.type === "ObjectExpression")
    ) {
      return "catch unconditionally returns a default/success value";
    }
  }
  return null;
}

function walk(node: any, cb: (n: any) => void): void {
  if (!node || typeof node !== "object") return;
  cb(node);
  for (const key of Object.keys(node)) {
    const val = (node as any)[key];
    if (Array.isArray(val)) val.forEach((v) => walk(v, cb));
    else if (val && typeof val === "object" && typeof val.type === "string") walk(val, cb);
  }
}

function detectJs(change: FileChange): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  if (!change.after) return out;
  let ast: any;
  try {
    ast = parse(change.after, {
      sourceType: "module",
      errorRecovery: true,
      plugins:
        change.language === "ts"
          ? ["typescript", "jsx"]
          : ["jsx"],
    });
  } catch {
    return out;
  }

  walk(ast, (n) => {
    if (n.type !== "TryStatement") return;
    const tryLine = n.loc?.start?.line;
    const handler = n.handler;
    const handlerLine = handler?.loc?.start?.line ?? tryLine;
    if (!isNewlyAdded(change, tryLine) && !isNewlyAdded(change, handlerLine)) return;

    let reason: string | null = null;
    if (!n.block || n.block.body.length === 0) {
      reason = "empty try block";
    } else if (handler) {
      reason = classifyCatch(handler.body?.body ?? null);
    } else {
      // try/finally with no catch — only suspicious if the try body is empty.
      reason = null;
    }
    if (reason) {
      out.push({
        detector: "exceptionSwallow",
        pattern: "error-swallowed",
        confidence: "suspicious",
        file: change.path,
        line: handlerLine ?? tryLine,
        evidence: `newly added try/catch: ${reason}`,
      });
    }
  });
  return out;
}

function detectPython(change: FileChange): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  if (!change.after) return out;
  try {
    const res = execaSync("python", ["-c", PY_SCRIPT], {
      input: change.after,
      encoding: "utf8",
      windowsHide: true,
      reject: false,
      timeout: 15000,
    });
    const hits: { line: number; reason: string }[] = JSON.parse(res.stdout);
    for (const h of hits) {
      if (isNewlyAdded(change, h.line)) {
        out.push({
          detector: "exceptionSwallow",
          pattern: "error-swallowed",
          confidence: "suspicious",
          file: change.path,
          line: h.line,
          evidence: `newly added try/except: ${h.reason}`,
        });
      }
    }
  } catch {
    // python unavailable or parse error — skip silently.
  }
  return out;
}

export function detectExceptionSwallow(changes: FileChange[]): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  for (const c of changes) {
    if (c.language === "python") findings.push(...detectPython(c));
    else if (c.language === "js" || c.language === "ts") findings.push(...detectJs(c));
  }
  return findings;
}
