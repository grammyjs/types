/**
 * Generates `schemas.json`: a JSON Schema for the parameters of every method in
 * `ApiMethods`, with the doc comments as descriptions. Run by `deno task build`.
 *
 * Parameters that accept a file (the generic `F` in `ApiMethods<F>`) are
 * marked `{ "x-input-file": true }`, since how files are passed is up to the
 * consumer. Named types become shared `$defs`, referenced as `#/$defs/<Name>`
 * from the document root.
 */
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname;
const ENTRY = `${ROOT}__schema_entry.ts`;
const MARKER = "__GrammyInputFileMarker";

type Schema = Record<string, unknown>;

const entrySource = `
import type { ApiMethods } from "./methods.ts";
export interface ${MARKER} { readonly __grammyInputFile: true }
export type __Methods = ApiMethods<${MARKER}>;
`;

const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};
const host = ts.createCompilerHost(options);
const getSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (f, lang) =>
  f === ENTRY
    ? ts.createSourceFile(f, entrySource, lang, true)
    : getSourceFile(f, lang);

const program = ts.createProgram([ENTRY], options, host);
const errors = ts.getPreEmitDiagnostics(program);
if (errors.length > 0) {
  console.error(ts.formatDiagnostics(errors, host));
  Deno.exit(1);
}
const checker = program.getTypeChecker();

const methodsAlias = program.getSourceFile(ENTRY)!.statements
  .find(ts.isTypeAliasDeclaration)!;
const methodsType = checker.getTypeAtLocation(methodsAlias.name);

const defs: Record<string, Schema> = {};
const inProgress = new Set<string>();

function docOf(symbol: ts.Symbol | undefined): string | undefined {
  if (!symbol) return undefined;
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker))
    .trim();
  return text === "" ? undefined : text;
}

/** Adds the symbol's doc comment, and `deprecated` for `@deprecated` symbols. */
function annotate(schema: Schema, symbol: ts.Symbol | undefined): Schema {
  const result = { ...schema };
  const description = docOf(symbol);
  if (description !== undefined) result.description = description;
  const deprecated = symbol?.getJsDocTags(checker)
    .find((tag) => tag.name === "deprecated");
  if (deprecated) {
    result.deprecated = true;
    const note = ts.displayPartsToString(deprecated.text).trim();
    if (note !== "" && description === undefined) result.description = note;
  }
  return result;
}

/** The name a type gets in $defs, if it is a named interface or alias. */
function defName(type: ts.Type): string | undefined {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (!symbol) return undefined;
  if (symbol.getName().startsWith("__")) return undefined; // anonymous
  const decl = symbol.declarations?.[0];
  if (!decl) return undefined;
  // Only types declared in this package get their own definition.
  if (!decl.getSourceFile().fileName.startsWith(ROOT)) return undefined;
  if (!type.aliasSymbol && !ts.isInterfaceDeclaration(decl)) return undefined;
  // Qualify namespace members (InlineKeyboardButton.CommonButton) so that
  // equally named types in different namespaces don't collide.
  return checker.getFullyQualifiedName(symbol).replace(/^"[^"]*"\./, "");
}

function convert(type: ts.Type): Schema {
  if (type.getSymbol()?.getName() === MARKER) return { "x-input-file": true };

  const name = defName(type);
  if (name !== undefined) {
    if (!(name in defs) && !inProgress.has(name)) {
      inProgress.add(name);
      defs[name] = annotate(
        convertStructure(type),
        type.aliasSymbol ?? type.getSymbol(),
      );
      inProgress.delete(name);
    }
    return { $ref: `#/$defs/${name}` };
  }
  return convertStructure(type);
}

function convertStructure(type: ts.Type): Schema {
  const f = type.flags;
  if (f & ts.TypeFlags.Any || f & ts.TypeFlags.Unknown) return {};
  if (f & ts.TypeFlags.String) return { type: "string" };
  if (f & ts.TypeFlags.Number) return { type: "number" };
  if (f & ts.TypeFlags.Boolean) return { type: "boolean" };
  if (f & ts.TypeFlags.Null) return { type: "null" };
  if (type.isStringLiteral()) return { type: "string", const: type.value };
  if (type.isNumberLiteral()) return { type: "number", const: type.value };
  if (f & ts.TypeFlags.BooleanLiteral) {
    return { type: "boolean", const: checker.typeToString(type) === "true" };
  }

  if (type.isUnion()) {
    const members = type.types.filter((t) =>
      !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void))
    );
    // `boolean` is `true | false` internally.
    const bools = members.filter((t) => t.flags & ts.TypeFlags.BooleanLiteral);
    const rest = members.filter((t) =>
      !(t.flags & ts.TypeFlags.BooleanLiteral)
    );
    const parts = rest.map(convert);
    if (bools.length === 2) parts.push({ type: "boolean" });
    else parts.push(...bools.map(convert));
    if (parts.length === 1) return parts[0];
    // A union of string literals reads better as an enum.
    if (parts.every((p) => p.type === "string" && "const" in p)) {
      return { type: "string", enum: parts.map((p) => p.const) };
    }
    return { anyOf: parts };
  }

  if (type.isIntersection()) {
    // `string & {}` keeps literal autocompletion open; the `{}` adds nothing.
    const parts = type.types.filter((t) =>
      !(t.flags & ts.TypeFlags.Object &&
        checker.getPropertiesOfType(t).length === 0)
    );
    return parts.length === 1
      ? convert(parts[0])
      : { allOf: parts.map(convert) };
  }

  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    return { type: "array", items: element ? convert(element) : {} };
  }

  if (f & ts.TypeFlags.Object) return convertObject(type);

  throw new Error(`Unsupported type: ${checker.typeToString(type)}`);
}

function convertObject(type: ts.Type): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const prop of checker.getPropertiesOfType(type)) {
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    if (!decl) continue;
    const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
    properties[prop.getName()] = annotate(convert(propType), prop);
    if (!(prop.flags & ts.SymbolFlags.Optional)) required.push(prop.getName());
  }
  const schema: Schema = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
  schema.additionalProperties = index ? convert(index.type) : false;
  return schema;
}

const methods: Record<string, Schema> = {};
for (const method of checker.getPropertiesOfType(methodsType)) {
  const decl = method.valueDeclaration ?? method.declarations![0];
  const signature = checker.getTypeOfSymbolAtLocation(method, decl)
    .getCallSignatures()[0];
  const param = signature.getParameters()[0];
  const parameters = param
    ? convert(
      checker.getNonNullableType(
        checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration!),
      ),
    )
    : { type: "object", properties: {}, additionalProperties: false };
  methods[method.getName()] = { ...annotate({}, method), parameters };
}

const output = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  methods,
  $defs: Object.fromEntries(
    Object.entries(defs).sort(([a], [b]) => a.localeCompare(b)),
  ),
};
await Deno.writeTextFile(
  `${ROOT}schemas.json`,
  JSON.stringify(output, null, 2) + "\n",
);
console.log(
  `schemas.json: ${Object.keys(methods).length} methods, ${
    Object.keys(defs).length
  } definitions`,
);
