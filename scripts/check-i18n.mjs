#!/usr/bin/env node
/**
 * i18n coverage regression check.
 *
 * The UI translates the rendered DOM at runtime from `lib/ui-i18n.ts`.
 * Any user-visible Chinese string that is not covered by the dictionary or a
 * dynamic rule silently stays Chinese in English mode. This script statically
 * scans the UI sources (plus error messages returned by API routes) and fails
 * when a Chinese string has no English translation.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const DICT_FILE = join(ROOT, "lib", "ui-i18n.ts");
const SKIP_FILES = new Set([
  // Chinese strings here are the zh side of a manual language toggle and the
  // whole dock is marked data-no-i18n.
  "app/components/PreferencesDock.tsx",
]);
// Modules whose Chinese strings are rendered directly (labels, reasons,
// scope descriptions, fallbacks) rather than being server log text.
const LIB_UI_FILES = new Set([
  "lib/risk.ts",
  "lib/risk-signals.ts",
  "lib/permission-defs.ts",
  "lib/oidc.ts",
  "lib/geolocation.ts",
  "lib/account-risk.ts",
]);
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

function walk(dir, filter) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      out.push(...walk(full, filter));
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

function loadDictionary() {
  const source = readFileSync(DICT_FILE, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", output)(module.exports, module, () => {});
  return module.exports;
}

const { hasTranslation, translateText } = loadDictionary();

/** Dictionary hygiene: no duplicate keys, no CJK left in English values. */
function auditDictionary() {
  const source = readFileSync(DICT_FILE, "utf8");
  const sourceFile = ts.createSourceFile(DICT_FILE, source, ts.ScriptTarget.Latest, true);
  let dict;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === "EXACT") {
      dict = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  const issues = [];
  if (!dict || !ts.isObjectLiteralExpression(dict)) {
    issues.push("lib/ui-i18n.ts: could not find the EXACT dictionary");
    return issues;
  }
  const seen = new Set();
  for (const property of dict.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name.getText(sourceFile).replace(/^["']|["']$/g, "");
    if (!ts.isStringLiteral(property.initializer)) continue;
    const value = property.initializer.text;
    if (seen.has(key)) issues.push(`lib/ui-i18n.ts: duplicate key “${key}”`);
    seen.add(key);
    if (!value.trim()) issues.push(`lib/ui-i18n.ts: empty translation for “${key}”`);
    if (CJK.test(value)) {
      issues.push(`lib/ui-i18n.ts: translation still contains Chinese for “${key}” → “${value}”`);
    }
  }
  return issues;
}

const dictionaryIssues = auditDictionary();
if (dictionaryIssues.length) {
  console.error(`i18n dictionary: ${dictionaryIssues.length} problem(s)\n`);
  for (const issue of dictionaryIssues) console.error(issue);
  process.exit(1);
}

/**
 * Representative runtime strings built by the server (counts, names, nested
 * lists). These cannot be discovered by the source scan, so pin a few cases
 * that exercise the dynamic rules.
 */
const RUNTIME_SAMPLES = [
  "应用名称 至少 2 个字符",
  "授权地址 不允许内网地址",
  "图标 只支持 http/https",
  "密码必须通过 HTTPS 加密提交",
  "IP 风险分 60；账号风险事件 85；邮箱未验证",
  "已退出 3 个其他设备",
  "删除「My App」？相关授权与令牌会一并失效。",
  "1s 后可重发",
  "· 搜索「admin」",
  "点击图中的圆形",
  "点击图中的三角形",
  "点击图中的五角星",
  "点击图中的菱形",
  "请先点击图中的图形",
];
const runtimeIssues = RUNTIME_SAMPLES.filter((sample) => CJK.test(translateText(sample)));
if (runtimeIssues.length) {
  console.error(`i18n dynamic samples: ${runtimeIssues.length} still contain Chinese\n`);
  for (const sample of runtimeIssues) {
    console.error(`${sample}  →  ${translateText(sample)}`);
  }
  process.exit(1);
}

function normalize(value) {
  return value.replace(/\s+/g, " ").trim();
}

function visible(value) {
  return CJK.test(value);
}

/** Returns true when `hasTranslation` turns the whole string non-Chinese. */
function covered(value) {
  const text = normalize(value);
  if (!text) return true;
  if (!hasTranslation(text)) return false;
  return !CJK.test(translateText(text));
}

/** Replace template expressions with a sample value so rules can be tested. */
function sampleTemplate(node, sample) {
  let text = node.head.text;
  for (const span of node.templateSpans) {
    text += sample;
    text += span.literal.text;
  }
  return text;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * Collect strings that can reach the DOM:
 *  - JSX text nodes (React renders each as its own text node, split at `{}`),
 *  - visible attributes (placeholder/title/aria-label/alt),
 *  - every Chinese string literal and template literal,
 *  - HttpError messages returned by API routes (shown verbatim in toasts/errors).
 */
function collectFromSource(sourceFile, file) {
  const found = [];
  const normalized = file.split(sep).join("/");
  const isApiRoute = normalized.startsWith("app/api/") && file.endsWith(".ts");
  const isTsx = file.endsWith(".tsx");
  const isLibUi = LIB_UI_FILES.has(normalized);

  function add(value, node, kind) {
    if (!visible(value)) return;
    found.push({ value: normalize(value), node, kind });
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      add(node.text, node, "jsx-text");
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sourceFile);
      if (["placeholder", "title", "aria-label", "aria-description", "alt"].includes(name)) {
        if (ts.isStringLiteral(node.initializer)) {
          add(node.initializer.text, node.initializer, `attr:${name}`);
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const expr = node.initializer.expression;
          if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
            add(expr.text, expr, `attr:${name}`);
          }
        }
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Skip module specifiers and object keys; keys never render on their own.
      const parent = node.parent;
      if (parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))) {
        // ignore
      } else if (isApiRoute) {
        // `{ message: "..." }` payloads are shown verbatim in the UI.
        if (ts.isPropertyAssignment(parent) && parent.name.getText(sourceFile) === "message") {
          add(node.text, node, "api-message");
        }
      } else if (isTsx || isLibUi) {
        add(node.text, node, "literal");
      }
    } else if (ts.isTemplateExpression(node)) {
      if ((!isApiRoute && isTsx) || isLibUi) {
        add(sampleTemplate(node, "1"), node, "template");
      }
    } else if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && isApiRoute) {
      const callee = node.expression.getText(sourceFile);
      if (callee === "HttpError" || callee.endsWith(".HttpError")) {
        const message = node.arguments?.[2];
        if (message && (ts.isStringLiteral(message) || ts.isNoSubstitutionTemplateLiteral(message))) {
          add(message.text, message, "api-error");
        } else if (message && ts.isTemplateExpression(message)) {
          add(sampleTemplate(message, "1"), message, "api-error");
        }
      }
      if (callee === "fail") {
        const message = node.arguments?.[0];
        if (message && (ts.isStringLiteral(message) || ts.isNoSubstitutionTemplateLiteral(message))) {
          add(message.text, message, "api-redirect-error");
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

const files = [
  ...walk(join(ROOT, "app"), (file) => file.endsWith(".tsx")),
  ...walk(join(ROOT, "app", "api"), (file) => file.endsWith(".ts")),
  ...walk(join(ROOT, "lib"), (file) => file.endsWith(".ts")),
];

const problems = [];
const byValue = new Map();
for (const full of files) {
  const file = relative(ROOT, full);
  if (file === join("lib", "ui-i18n.ts")) continue;
  if (SKIP_FILES.has(file.split(sep).join("/"))) continue;
  const source = readFileSync(full, "utf8");
  if (!CJK.test(source)) continue;
  const sourceFile = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  for (const item of collectFromSource(sourceFile, file)) {
    if (covered(item.value)) continue;
    const line = lineOf(sourceFile, item.node);
    const existing = byValue.get(item.value);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const problem = { file, line, ...item, count: 1 };
    byValue.set(item.value, problem);
    problems.push(problem);
  }
}

if (problems.length) {
  console.error(`i18n coverage: ${problems.length} unique untranslated string(s)\n`);
  for (const problem of problems) {
    const more = problem.count > 1 ? ` (+${problem.count - 1})` : "";
    console.error(`${problem.file}:${problem.line}  [${problem.kind}]${more}  ${problem.value}`);
  }
  process.exit(1);
}

console.log("i18n coverage: all user-visible Chinese strings have translations");
