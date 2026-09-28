import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = new URL("../migrations/20260923041240_phase_5b_1_foundation.sql", import.meta.url);
const source = readFileSync(migration, "utf8");

// Small lexical scanner: comments cannot satisfy checks; quoted text and dollar
// bodies do not split statements. This is not a PostgreSQL grammar/parser.
function statementsOf(source) {
  const statements = [];
  let buffer = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("--", i)) {
      const end = source.indexOf("\n", i + 2);
      i = end < 0 ? source.length : end;
      buffer += "\n";
    } else if (source.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (depth && i < source.length) {
        if (source.startsWith("/*", i)) { depth++; i += 2; }
        else if (source.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      assert.equal(depth, 0, "Unclosed block comment");
      buffer += " ";
    } else if (source[i] === "'" || source[i] === '"') {
      const quote = source[i];
      const start = i++;
      let closed = false;
      while (i < source.length) {
        if (source[i++] === quote) {
          if (source[i] === quote) i++;
          else { closed = true; break; }
        }
      }
      assert.ok(closed, "Unclosed SQL quoted text");
      buffer += source.slice(start, i);
    } else if (source[i] === "$" && /^\$(?:[A-Za-z_]\w*)?\$/.test(source.slice(i))) {
      const tag = source.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/)[0];
      const end = source.indexOf(tag, i + tag.length);
      assert.ok(end >= 0, "Unclosed dollar body");
      buffer += source.slice(i, end + tag.length);
      i = end + tag.length;
    } else if (source[i] === ";") {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = "";
      i++;
    } else buffer += source[i++];
  }
  assert.equal(buffer.trim(), "", "Missing final statement terminator");
  return statements;
}
function canonical(source) {
  // Used only on parsed function headers/query bodies, never as a SQL executor.
  return source.match(/'(?:''|[^'])*'|"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|<>|:=|>=|<=|!=|::|[^\s]/g)?.map(t =>
    t.startsWith("'") || t.startsWith('"') ? t : t.toLowerCase()).join(" ") ?? "";
}

function validate(source) {
const statements = statementsOf(source);
const sql = statements.join(";\n") + ";\n";
const checks = [];
function check(name, fn) {
  fn();
  checks.push(name);
}
const tables = ["businesses", "stores", "business_settings", "staff_profiles", "staff_store_assignments"];
const tableBodies = new Map([...sql.matchAll(/CREATE TABLE app\.(\w+) \(([\s\S]*?)\n\);/g)].map(m => [m[1], m[2]]));
const functions = [...sql.matchAll(/CREATE FUNCTION app\.(\w+)\(([^)]*)\)([\s\S]*?)AS \$function\$([\s\S]*?)\$function\$;/g)];
const uncommented = sql;
check("Exactly the five approved tables; empty api schema", () => {
  assert.deepEqual([...tableBodies.keys()], tables);
  assert.match(sql, /CREATE SCHEMA app AUTHORIZATION postgres;/);
  assert.match(sql, /CREATE SCHEMA api AUTHORIZATION postgres;/);
  assert.doesNotMatch(uncommented, /CREATE (?:TABLE|FUNCTION|VIEW|TYPE) api\./i);
});
check("Atomic, fail-on-existing-schema migration with explicit migration owner", () => {
  assert.match(uncommented, /^\s*BEGIN;/);
  assert.match(uncommented, /COMMIT;\s*$/);
  assert.match(sql, /CURRENT_USER <> 'postgres'/);
  assert.match(sql, /nspname IN \('app', 'api'\)/);
  assert.doesNotMatch(uncommented, /CREATE\s+(?:TABLE|SCHEMA)\s+IF NOT EXISTS|CREATE OR REPLACE/);
});
check("UUID IDs, database timestamp columns and lifecycle triggers on all tables", () => {
  for (const [name, body] of tableBodies) {
    assert.match(body, /id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid\(\)/);
    for (const col of ["created_at", "updated_at"]) {
      assert.match(body, new RegExp(col + " timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp\\(\\)"));
    }
    assert.match(sql, new RegExp("CREATE TRIGGER " + name + "_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON app\\." + name + "\\s+FOR EACH ROW EXECUTE FUNCTION app.guard_row_lifecycle\\(\\);"));
  }
  assert.doesNotMatch(uncommented, /\btimestamp\s+(?:without|NOT|DEFAULT|,)/i);
  assert.match(sql, /NEW\.created_at := OLD\.created_at/);
  assert.match(sql, /NEW\.business_id IS DISTINCT FROM OLD\.business_id/);
  assert.match(sql, /IF TG_OP = 'DELETE' THEN/);
});
check("Every foreign key is known, restrictive and tenant-safe", () => {
  const refs = [...uncommented.matchAll(/REFERENCES ([\w.]+)\(([^)]+)\) ON UPDATE (\w+) ON DELETE (\w+)/g)];
  assert.equal(refs.length, 8);
  for (const [, target, cols, update, del] of refs) {
    assert.equal(update, "RESTRICT");
    assert.equal(del, "RESTRICT");
    if (target === "auth.users" || target === "app.businesses") assert.equal(cols, "id");
    else {
      assert.ok(["app.staff_profiles", "app.stores"].includes(target));
      assert.equal(cols, "business_id, id");
    }
  }
  for (const name of ["stores", "staff_profiles"]) {
    assert.match(tableBodies.get(name), /UNIQUE \(business_id, id\)/);
  }
  assert.match(tableBodies.get("staff_profiles"), /FOREIGN KEY \(business_id, disabled_by\)/);
  const assignments = tableBodies.get("staff_store_assignments");
  assert.match(assignments, /FOREIGN KEY \(business_id, store_id\)/);
  assert.match(assignments, /FOREIGN KEY \(business_id, staff_profile_id\)/);
  assert.match(assignments, /UNIQUE \(business_id, staff_profile_id, store_id\)/);
});
check("Identity uniqueness and foreign-key lookup indexes", () => {
  assert.match(tableBodies.get("businesses"), /slug text NOT NULL UNIQUE/);
  assert.match(tableBodies.get("stores"), /UNIQUE \(business_id, code\)/);
  assert.match(tableBodies.get("business_settings"), /business_id uuid NOT NULL UNIQUE/);
  assert.match(sql, /CREATE UNIQUE INDEX staff_profiles_auth_user_key ON app\.staff_profiles\(auth_user_id\) WHERE auth_user_id IS NOT NULL;/);
  assert.match(sql, /ON app\.staff_profiles\(business_id, disabled_by\)/);
  assert.match(sql, /ON app\.staff_store_assignments\(business_id, store_id\)/);
});
check("Bounded typed settings, currency, role and staff lifecycle", () => {
  const settings = tableBodies.get("business_settings");
  assert.match(settings, /employee_operational_history_days BETWEEN 1 AND 365/);
  assert.match(settings, /employee_cash_collection_limit_paise bigint/);
  assert.match(settings, /max_order_total_paise bigint NOT NULL/);
  assert.match(settings, /max_order_items BETWEEN 1 AND 500/);
  assert.match(sql, /NEW\.revision := OLD\.revision \+ 1/);
  assert.match(tableBodies.get("businesses"), /CHECK \(currency = 'INR'\)/);
  assert.match(tableBodies.get("staff_profiles"), /CHECK \(role IN \('OWNER', 'EMPLOYEE'\)\)/);
  assert.match(sql, /is_active AND auth_user_id IS NOT NULL AND disabled_at IS NULL AND disabled_by IS NULL/);
  assert.match(sql, /NOT is_active AND disabled_at IS NOT NULL/);
});
check("Only four scalar authorization helpers are DEFINER; all execution remains private", () => {
  assert.equal(functions.length, 10);
  const executeGrant = sql.match(/GRANT EXECUTE ON FUNCTION([\s\S]*?)TO postgres;/)?.[1];
  assert.ok(executeGrant);
  for (const [, name, , options] of functions) {
    const authorization = ["current_staff_profile_id", "is_business_owner", "is_store_employee", "can_access_store"].includes(name);
    assert.match(options, authorization ? /SECURITY DEFINER/ : /SECURITY INVOKER/);
    assert.match(options, /SET search_path = ''/);
    assert.ok(executeGrant.includes("app." + name + "("), name);
  }
  assert.equal((uncommented.match(/SECURITY DEFINER/g) ?? []).length, 4);
  assert.match(sql, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role;/);
});
check("Actor comes only from auth.uid; nonstaff fails closed and EMPLOYEE stays scoped", () => {
  const byName = new Map(functions.map(f => [f[1], f]));
  const current = byName.get("current_staff_profile_id");
  assert.equal(current[2], "");
  assert.match(current[4], /sp\.auth_user_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(current[4], /sp\.is_active AND sp\.disabled_at IS NULL/);
  assert.match(current[4], /b\.is_active AND b\.deleted_at IS NULL/);
  assert.match(byName.get("is_business_owner")[4], /sp\.role = 'OWNER'/);
  assert.match(byName.get("is_store_employee")[4], /sp\.role = 'EMPLOYEE'/);
  assert.match(byName.get("is_store_employee")[4], /a\.is_active AND s\.is_active AND s\.deleted_at IS NULL/);
  assert.match(byName.get("can_access_store")[4], /s\.business_id = target_business_id AND s\.id = target_store_id/);
  assert.doesNotMatch(uncommented, /raw_user_meta_data|user_metadata|auth\.jwt|actor_id/i);
});
check("Active OWNER removal is conservatively blocked without count races", () => {
  const guard = functions.find(f => f[1] === "guard_staff_authority")[4];
  assert.match(guard, /OLD\.is_active AND OLD\.role = 'OWNER'/);
  assert.match(guard, /NOT NEW\.is_active OR NEW\.role <> 'OWNER'/);
  assert.match(guard, /NEW\.auth_user_id IS DISTINCT FROM OLD\.auth_user_id/);
  assert.match(guard, /RAISE EXCEPTION 'Active OWNER removal/);
  assert.doesNotMatch(guard, /count\(/i);
  assert.match(sql, /CREATE TRIGGER staff_profiles_authority BEFORE UPDATE ON app\.staff_profiles/);
});
check("RLS enabled and forced on all five tables; no permissive policies", () => {
  for (const name of tables) {
    for (const operation of ["ENABLE", "FORCE"]) {
      assert.ok(sql.includes("ALTER TABLE app." + name + " " + operation + " ROW LEVEL SECURITY;"));
    }
  }
  assert.doesNotMatch(uncommented, /CREATE POLICY/i);
});
check("PUBLIC/anon/authenticated/service_role receive no schema, table or function access", () => {
  assert.match(sql, /REVOKE ALL ON SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role;/);
  for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
    assert.ok(sql.includes("REVOKE ALL ON ALL " + kind + " IN SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role;"));
  }
  const grants = uncommented.match(/\bGRANT\b[\s\S]*?;/g) ?? [];
  assert.equal(grants.length, 1);
  assert.match(grants[0], /^GRANT EXECUTE ON FUNCTION[\s\S]*TO postgres;$/);
});
check("Default ACL changes are scoped only to postgres-created TRAIT objects", () => {
  const defaults = uncommented.match(/ALTER DEFAULT PRIVILEGES[\s\S]*?;/g) ?? [];
  assert.equal(defaults.length, 3);
  for (const statement of defaults) {
    assert.match(statement, /^ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app, api\s+REVOKE ALL ON (TABLES|SEQUENCES|FUNCTIONS) FROM PUBLIC, anon, authenticated, service_role;$/);
  }
});
check("No out-of-scope objects, seeds, managed-schema mutations, credentials or destructive DDL", () => {
  assert.doesNotMatch(uncommented, /\b(?:INSERT INTO|DELETE FROM|DROP|CREATE ROLE|ALTER ROLE|CREATE EXTENSION)\b/i);
  assert.doesNotMatch(uncommented, /(?:CREATE|ALTER)\s+(?:TABLE|SCHEMA|FUNCTION)\s+(?:auth|storage|public)\./i);
  assert.doesNotMatch(sql, /(?:eyJ[A-Za-z0-9_-]{20,}\.|sb_secret_|postgres(?:ql)?:\/\/|-----BEGIN .*PRIVATE KEY)/);
});

check("Statement inventory rejects later privilege changes, RLS disablement and unrelated DDL", () => {
  const seen = new Set();
  let lastFunction = -1;
  let functionRevoke = -1;
  let ownerGrant = -1;
  let assertion = -1;
  const allowedNames = {
    TABLE: tables,
    FUNCTION: functions.map(f => f[1]),
    TRIGGER: ["businesses_lifecycle", "stores_lifecycle", "stores_timezone",
      "business_settings_lifecycle", "business_settings_revision", "staff_profiles_lifecycle",
      "staff_profiles_authority", "staff_store_assignments_lifecycle", "staff_store_assignments_identity"],
    INDEX: ["staff_profiles_auth_user_key", "staff_profiles_disabled_by_idx",
      "staff_profiles_active_owner_idx", "staff_store_assignments_store_idx"],
  };
  const schemas = new Set();
  for (const [i, statement] of statements.entries()) {
    let match;
    if (statement === "BEGIN") { assert.equal(i, 0); continue; }
    if (statement === "COMMIT") { assert.equal(i, statements.length - 1); continue; }
    if (/^SET LOCAL (lock_timeout = '5s'|statement_timeout = '60s')$/.test(statement)) continue;
    if ((match = statement.match(/^CREATE SCHEMA (app|api) AUTHORIZATION postgres$/))) {
      assert.ok(!schemas.has(match[1])); schemas.add(match[1]); continue;
    }
    if ((match = statement.match(/^CREATE (?:UNIQUE )?(TABLE|FUNCTION|TRIGGER|INDEX) (?:app\.)?(\w+)\b/))) {
      const [, kind, name] = match;
      assert.ok(allowedNames[kind].includes(name), "Unapproved " + kind + " " + name);
      const key = kind + ":" + name;
      assert.ok(!seen.has(key), "Duplicate object " + key); seen.add(key);
      if (kind === "FUNCTION") lastFunction = i;
      continue;
    }
    if (/^ALTER TABLE app\.\w+ (ENABLE|FORCE) ROW LEVEL SECURITY$/.test(statement)) continue;
    if (/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app, api\s+REVOKE ALL ON (TABLES|SEQUENCES|FUNCTIONS) FROM PUBLIC, anon, authenticated, service_role$/.test(statement)) continue;
    if (/^REVOKE ALL ON SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role$/.test(statement)) continue;
    if ((match = statement.match(/^REVOKE ALL ON ALL (TABLES|SEQUENCES|FUNCTIONS) IN SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role$/))) {
      if (match[1] === "FUNCTIONS") functionRevoke = i;
      continue;
    }
    if (/^GRANT EXECUTE ON FUNCTION[\s\S]*TO postgres$/.test(statement)) { ownerGrant = i; continue; }
    if (/^DO \$preflight\$[\s\S]*\$preflight\$$/.test(statement)) { assert.equal(i, 3); continue; }
    if (/^DO \$security_assertions\$[\s\S]*\$security_assertions\$$/.test(statement)) {
      assert.equal(i, statements.length - 2); assertion = i; continue;
    }
    assert.fail("Unapproved top-level SQL: " + statement.slice(0, 100));
  }
  assert.deepEqual([...schemas], ["app", "api"]);
  for (const [kind, names] of Object.entries(allowedNames)) {
    for (const name of names) assert.ok(seen.has(kind + ":" + name), "Missing " + kind + ":" + name);
  }
  assert.ok(lastFunction < functionRevoke && functionRevoke < ownerGrant && ownerGrant < assertion);
  // Model function defaults in statement order: PUBLIC EXECUTE exists at CREATE,
  // then must be revoked before the sole owner-only grant and transaction commit.
  const publicExecute = new Set();
  for (const statement of statements) {
    const create = statement.match(/^CREATE FUNCTION app\.(\w+)\(/);
    if (create) publicExecute.add(create[1]);
    if (statement === "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role") publicExecute.clear();
  }
  assert.equal(publicExecute.size, 0);
});
check("Foreign keys match each local-to-target column mapping, not just UUID target names", () => {
  const expected = [
    ["stores", "business_id", "app.businesses", "id"],
    ["business_settings", "business_id", "app.businesses", "id"],
    ["staff_profiles", "business_id", "app.businesses", "id"],
    ["staff_profiles", "auth_user_id", "auth.users", "id"],
    ["staff_profiles", "business_id,disabled_by", "app.staff_profiles", "business_id,id"],
    ["staff_store_assignments", "business_id", "app.businesses", "id"],
    ["staff_store_assignments", "business_id,store_id", "app.stores", "business_id,id"],
    ["staff_store_assignments", "business_id,staff_profile_id", "app.staff_profiles", "business_id,id"],
  ];
  const actual = [];
  for (const [name, body] of tableBodies) {
    const clauses = body.split(/,\s*\n/); // DDL has one column/constraint per line.
    for (const clause of clauses) {
      const ref = clause.match(/REFERENCES ([\w.]+)\(([^)]+)\) ON UPDATE RESTRICT ON DELETE RESTRICT/);
      if (!ref) continue;
      const composite = clause.match(/FOREIGN KEY \(([^)]+)\)/);
      const local = composite ? composite[1] : clause.trim().match(/^\w+/)[0];
      actual.push([name, local.replaceAll(" ", ""), ref[1], ref[2].replaceAll(" ", "")]);
      if (ref[1] !== "auth.users") assert.ok(tableBodies.has(ref[1].slice(4)));
    }
  }
  assert.deepEqual(actual, expected);
});
check("Authorization query allowlist rejects weakened joins, OR bypasses and caller actor parameters", () => {
  // These complete scalar-query contracts deliberately fail closed on any
  // semantic query edit until a reviewer updates the approved contract.
  const queries = {
    current_staff_profile_id: [
      "", "uuid",
      "SELECT sp.id FROM app.staff_profiles AS sp JOIN app.businesses AS b ON b.id = sp.business_id WHERE sp.auth_user_id = (SELECT auth.uid()) AND sp.is_active AND sp.disabled_at IS NULL AND b.is_active AND b.deleted_at IS NULL"
    ],
    is_business_owner: [
      "target_business_id uuid", "boolean",
      "SELECT EXISTS (SELECT 1 FROM app.staff_profiles AS sp WHERE sp.id = app.current_staff_profile_id() AND sp.business_id = target_business_id AND sp.role = 'OWNER')"
    ],
    is_store_employee: [
      "target_business_id uuid, target_store_id uuid", "boolean",
      "SELECT EXISTS (SELECT 1 FROM app.staff_profiles AS sp JOIN app.staff_store_assignments AS a ON a.business_id = sp.business_id AND a.staff_profile_id = sp.id JOIN app.stores AS s ON s.business_id = a.business_id AND s.id = a.store_id WHERE sp.id = app.current_staff_profile_id() AND sp.role = 'EMPLOYEE' AND sp.business_id = target_business_id AND s.id = target_store_id AND a.is_active AND s.is_active AND s.deleted_at IS NULL)"
    ],
    can_access_store: [
      "target_business_id uuid, target_store_id uuid", "boolean",
      "SELECT EXISTS (SELECT 1 FROM app.stores AS s WHERE s.business_id = target_business_id AND s.id = target_store_id AND s.is_active AND s.deleted_at IS NULL AND (app.is_business_owner(target_business_id) OR app.is_store_employee(target_business_id, target_store_id)))"
    ],
  };
  for (const [, name, params, options, body] of functions) {
    if (queries[name]) {
      const [args, result, query] = queries[name];
      assert.equal(canonical(params), canonical(args), name + " signature");
      assert.equal(canonical(options), canonical("RETURNS " + result + " LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''"), name + " execution context");
      assert.equal(canonical(body), canonical(query), name + " authorization query");
    } else {
      const result = name === "valid_opening_hours" ? "boolean" : "trigger";
      const volatility = name === "valid_opening_hours" ? "IMMUTABLE" : "VOLATILE";
      assert.equal(canonical(options), canonical("RETURNS " + result + " LANGUAGE plpgsql " + volatility + " SECURITY INVOKER SET search_path = ''"));
    }
  }
});
check("End-of-transaction assertions cover effective ACLs, owner membership and forced RLS", () => {
  const statement = statements.at(-2);
  for (const name of ["pg_has_role", "has_schema_privilege", "has_table_privilege",
    "has_any_column_privilege", "has_sequence_privilege", "has_function_privilege"]) {
    assert.ok(statement.includes("pg_catalog." + name + "("), "Missing effective check " + name);
  }
  assert.match(statement, /NOT c\.relrowsecurity OR NOT c\.relforcerowsecurity/);
  assert.match(statement, /pg_catalog\.pg_policy/);
  assert.match(statement, /p\.proowner/);
  assert.match(statement, /n\.nspowner/);
  assert.match(statement, /WHERE rolname IN \('anon', 'authenticated', 'service_role'\)/);
  assert.match(statement, /'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'/);
  for (const block of statements.filter(s => s.startsWith("DO "))) {
    const body = block.slice(block.indexOf("\n") + 1, block.lastIndexOf("$"));
    const tokens = canonical(body).replace(/'(?:''|[^'])*'/g, "");
    assert.doesNotMatch(tokens, /\b(?:execute|insert|update|delete|grant|revoke|set_config)\b/i);
  }
});
check("Store mobile storage and structural validation stay bounded", () => {
  const store = tableBodies.get("stores");
  assert.ok(store.includes("contact_mobile_e164 ~ '^\\+91[6-9][0-9]{9}$'"));
  assert.match(store, /pincode ~ '\^\[1-9\]\[0-9\]\{5\}\$'/);
  assert.match(store, /opening_hours jsonb NOT NULL DEFAULT '\{\}'::jsonb CHECK \(app\.valid_opening_hours\(opening_hours\)\)/);
  assert.match(store, /delivery_enabled boolean NOT NULL DEFAULT false/);
  assert.match(store, /pickup_enabled boolean NOT NULL DEFAULT false/);
  const opening = functions.find(f => f[1] === "valid_opening_hours")[4];
  assert.match(opening, /pg_catalog\.octet_length\(value::text\) > 8192/);
  assert.match(opening, /pg_catalog\.jsonb_array_length\(day_entry\.val\) > 4/);
  assert.match(opening, /COLLATE pg_catalog\."C"/);
});
return checks;
}

const checks = validate(source);
for (const name of checks) console.log("PASS " + name);

// Negative controls are in-memory SQL mutations, never database/file changes.
// They prove the checker detects unsafe alterations, including comment tricks.
const mutations = [
  ["commented-out RLS", s => s.replace("ALTER TABLE app.staff_profiles ENABLE ROW LEVEL SECURITY;", "-- ALTER TABLE app.staff_profiles ENABLE ROW LEVEL SECURITY;")],
  ["block-commented revoke", s => s.replace("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role;", "/* REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, api FROM PUBLIC, anon, authenticated, service_role; */")],
  ["later RLS disable", s => s.replace("COMMIT;", "ALTER TABLE app.staff_profiles DISABLE ROW LEVEL SECURITY;\nCOMMIT;")],
  ["later schema CREATE grant", s => s.replace("COMMIT;", "GRANT CREATE ON SCHEMA app TO authenticated;\nCOMMIT;")],
  ["authenticated SELECT grant", s => s.replace("COMMIT;", "GRANT SELECT ON app.staff_profiles TO authenticated;\nCOMMIT;")],
  ["service-role DML grant", s => s.replace("COMMIT;", "GRANT ALL ON ALL TABLES IN SCHEMA app TO service_role;\nCOMMIT;")],
  ["PUBLIC helper execution", s => s.replace("TO postgres;", "TO PUBLIC;")],
  ["global default change", s => s.replace("FOR ROLE postgres IN SCHEMA app, api", "FOR ROLE postgres")],
  ["unqualified definer search path", s => s.replace("LANGUAGE sql STABLE SECURITY DEFINER\nSET search_path = ''", "LANGUAGE sql STABLE SECURITY DEFINER\nSET search_path = public")],
  ["invoker authorization regression", s => s.replace("LANGUAGE sql STABLE SECURITY DEFINER", "LANGUAGE sql STABLE SECURITY INVOKER")],
  ["nonstaff authorization bypass", s => s.replace("sp.auth_user_id = (SELECT auth.uid())", "(sp.auth_user_id = (SELECT auth.uid()) OR true)")],
  ["inactive staff authorized", s => s.replace("AND sp.is_active AND sp.disabled_at IS NULL", "AND true")],
  ["employee gains OWNER", s => s.replace("AND sp.role = 'OWNER'", "AND sp.role IN ('OWNER', 'EMPLOYEE')")],
  ["inactive assignment authorized", s => s.replace("AND a.is_active AND s.is_active", "AND s.is_active")],
  ["cross-business helper scope", s => s.replace("sp.business_id = target_business_id AND sp.role = 'OWNER'", "true AND sp.role = 'OWNER'")],
  ["cross-business store FK", s => s.replace("FOREIGN KEY (business_id, store_id)", "FOREIGN KEY (store_id, business_id)")],
  ["cross-business disabled_by FK", s => s.replace("FOREIGN KEY (business_id, disabled_by)", "FOREIGN KEY (disabled_by, business_id)")],
  ["partial active-only Auth uniqueness", s => s.replace("WHERE auth_user_id IS NOT NULL;", "WHERE auth_user_id IS NOT NULL AND is_active;")],
  ["removed OWNER trigger", s => s.replace("CREATE TRIGGER staff_profiles_authority BEFORE UPDATE ON app.staff_profiles\n  FOR EACH ROW EXECUTE FUNCTION app.guard_staff_authority();", "")],
  ["removed postconditions", s => s.replace(/DO \$security_assertions\$[\s\S]*?\$security_assertions\$;/, "")],
  ["unapproved definer side effect", s => s.replace("SELECT sp.id\n  FROM", "SELECT sp.id, pg_catalog.set_config('request.jwt.claim.sub', 'x', true)\n  FROM")],
  ["injected policy", s => s.replace("COMMIT;", "CREATE POLICY read_all ON app.staff_profiles FOR SELECT USING (true);\nCOMMIT;")],
];
for (const [name, mutate] of mutations) {
  const changed = mutate(source);
  assert.notEqual(changed, source, "Mutation did not apply: " + name);
  assert.throws(() => validate(changed), undefined, "Unsafe mutation passed: " + name);
}
// Comments and whitespace do not affect the approved security contracts.
assert.equal(validate("/* comment ; with nested /* comment */ */\n" + source).length, checks.length);
console.log("\n" + checks.length + " static checks and " + mutations.length + " unsafe-mutation checks passed.");
console.log("Lexical/structural review only; not PostgreSQL execution, permission or concurrency testing.");
